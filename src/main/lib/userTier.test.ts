import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'

const userTierDataDir = path.join(os.tmpdir(), 'launcher-test-usertier')

vi.mock('electron', () => ({
  app: { getPath: () => userTierDataDir }
}))

const telemetry = await import('./telemetry')
const { refreshCloudUserTier, getUserTier, _resetForTest, FETCH_TIER_JS } =
  await import('./userTier')

/** Stub WebContents whose executeJavaScript resolves to a fixed tier result. */
function stubContents(result: unknown): { wc: Electron.WebContents } {
  return {
    wc: {
      executeJavaScript: () => Promise.resolve(result)
    } as unknown as Electron.WebContents
  }
}

describe('userTier tier_changed telemetry', () => {
  let captured: Array<{ event: string; ctx: Record<string, unknown> }>

  beforeEach(async () => {
    await fs.rm(userTierDataDir, { recursive: true, force: true })
    await fs.mkdir(userTierDataDir, { recursive: true })
    _resetForTest()
    captured = []
    vi.spyOn(telemetry, 'capture').mockImplementation((event, ctx) => {
      captured.push({ event, ctx: (ctx ?? {}) as Record<string, unknown> })
      return true
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(userTierDataDir, { recursive: true, force: true })
  })

  const tierChanges = (): Array<{ event: string; ctx: Record<string, unknown> }> =>
    captured.filter((c) => c.event === 'comfy.desktop.billing.tier_changed')

  it('does not emit on the first resolution out of unknown (hydration, not a change)', async () => {
    expect(getUserTier()).toBe('unknown')
    await refreshCloudUserTier(stubContents({ tier: 'FREE' }).wc)
    expect(getUserTier()).toBe('free')
    expect(tierChanges()).toHaveLength(0)
  })

  it('emits from_tier/to_tier on a real free → paid transition', async () => {
    await refreshCloudUserTier(stubContents({ tier: 'FREE' }).wc)
    await refreshCloudUserTier(stubContents({ tier: 'PRO' }).wc)
    expect(getUserTier()).toBe('paid')
    expect(tierChanges()).toHaveLength(1)
    expect(tierChanges()[0]!.ctx).toMatchObject({ from_tier: 'free', to_tier: 'paid' })
  })

  it('emits on a paid → free downgrade too', async () => {
    await refreshCloudUserTier(stubContents({ tier: 'CREATOR' }).wc)
    await refreshCloudUserTier(stubContents({ tier: 'FREE' }).wc)
    expect(tierChanges()).toHaveLength(1)
    expect(tierChanges()[0]!.ctx).toMatchObject({ from_tier: 'paid', to_tier: 'free' })
  })

  it('does not emit when the tier is unchanged', async () => {
    await refreshCloudUserTier(stubContents({ tier: 'PRO' }).wc)
    await refreshCloudUserTier(stubContents({ tier: 'STANDARD' }).wc)
    expect(getUserTier()).toBe('paid')
    expect(tierChanges()).toHaveLength(0)
  })

  it('leaves the cache (and emits nothing) when no signed-in user is present', async () => {
    await refreshCloudUserTier(stubContents({ tier: 'PRO' }).wc)
    captured = []
    await refreshCloudUserTier(stubContents(null).wc)
    expect(getUserTier()).toBe('paid')
    expect(tierChanges()).toHaveLength(0)
  })
})

// The injected script itself, which the suite above never reaches: those cases stub
// `executeJavaScript` wholesale, so FETCH_TIER_JS was entirely untested. That is how it shipped
// reading only the store the frontend's SDK drains.
describe('FETCH_TIER_JS', () => {
  const PROD_KEY = 'firebase:authUser:apikey:[DEFAULT]'
  const record = (token: string) => ({ stsTokenManager: { accessToken: token } })

  /** localStorage good enough for the script: length, key(i), getItem(k). */
  function fakeLocalStorage(
    entries: Array<[string, string]> | null,
    opts: { throws?: boolean } = {}
  ) {
    if (entries === null) return undefined
    if (opts.throws) {
      return new Proxy(
        {},
        {
          get() {
            throw new Error('site data blocked')
          }
        }
      )
    }
    return {
      get length() {
        return entries.length
      },
      key: (i: number) => entries[i]?.[0] ?? null,
      getItem: (k: string) => entries.find(([key]) => key === k)?.[1] ?? null
    }
  }

  /** IndexedDB good enough for the script; handlers attach after open() as in a browser. */
  function fakeIndexedDB(entries: unknown[] | null) {
    return {
      open: () => {
        const req: Record<string, unknown> = {
          result: {
            transaction: () => ({
              objectStore: () => ({
                getAll: () => {
                  const r: Record<string, unknown> = { result: entries ?? [] }
                  queueMicrotask(() => (r['onsuccess'] as (() => void) | undefined)?.())
                  return r
                }
              })
            })
          },
          error: new Error('open failed')
        }
        queueMicrotask(() => {
          const h = entries === null ? 'onerror' : 'onsuccess'
          ;(req[h] as (() => void) | undefined)?.()
        })
        return req
      }
    }
  }

  async function run(opts: {
    localStorage?: Array<[string, string]> | null
    localStorageThrows?: boolean
    idbEntries?: unknown[] | null
    fetchImpl?: typeof fetch
  }) {
    const calls: string[] = []
    const fetchStub =
      opts.fetchImpl ??
      ((_url: string, init?: { headers?: Record<string, string> }) => {
        calls.push(init?.headers?.['Authorization'] ?? '')
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ subscription_tier: 'PRO' })
        })
      })
    const fn = new Function('indexedDB', 'localStorage', 'fetch', `return ${FETCH_TIER_JS}`) as (
      i: unknown,
      l: unknown,
      f: unknown
    ) => Promise<unknown>
    const result = await fn(
      fakeIndexedDB(opts.idbEntries ?? []),
      fakeLocalStorage(opts.localStorage ?? null, { throws: opts.localStorageThrows }),
      fetchStub
    )
    return { result, authHeaders: calls }
  }

  it('reads the token from localStorage, where the session settles', async () => {
    // The regression. Before this fix the script looked only in IndexedDB, which the SDK clears
    // once the auth store moves the record — so every signed-in cloud session read as signed out.
    const { result, authHeaders } = await run({
      localStorage: [[PROD_KEY, JSON.stringify(record('tok-ls'))]],
      idbEntries: []
    })

    expect(result).toEqual({ tier: 'PRO' })
    expect(authHeaders).toEqual(['Bearer tok-ls'])
  })

  it('falls back to IndexedDB when localStorage holds no record', async () => {
    // Boot, before the migration completes — and any frontend that persists to IndexedDB.
    const { result, authHeaders } = await run({
      localStorage: [],
      idbEntries: [{ fbase_key: PROD_KEY, value: record('tok-idb') }]
    })

    expect(result).toEqual({ tier: 'PRO' })
    expect(authHeaders).toEqual(['Bearer tok-idb'])
  })

  it('prefers localStorage over a stale IndexedDB copy', async () => {
    // Both stores hold a record: the IndexedDB one is what the SDK left behind, so it must lose.
    const { authHeaders } = await run({
      localStorage: [[PROD_KEY, JSON.stringify(record('tok-live'))]],
      idbEntries: [{ fbase_key: PROD_KEY, value: record('tok-stale') }]
    })

    expect(authHeaders).toEqual(['Bearer tok-live'])
  })

  it('still reaches IndexedDB when localStorage access throws', async () => {
    // Blocked or partitioned storage. Unlike the consensus readers this one has no destructive
    // path, so it tries the other store rather than abstaining.
    const { result } = await run({
      localStorageThrows: true,
      idbEntries: [{ fbase_key: PROD_KEY, value: record('tok-idb') }]
    })

    expect(result).toEqual({ tier: 'PRO' })
  })

  it('returns null when neither store holds a usable token', async () => {
    const { result } = await run({ localStorage: [], idbEntries: [] })

    expect(result).toBeNull()
  })

  it('ignores a record with no access token in either store', async () => {
    const { result } = await run({
      localStorage: [[PROD_KEY, JSON.stringify({ stsTokenManager: {} })]],
      idbEntries: [{ fbase_key: PROD_KEY, value: { stsTokenManager: { accessToken: '' } } }]
    })

    expect(result).toBeNull()
  })
})
