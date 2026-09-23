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

  /** localStorage for the script. `absent` models no object at all; `throws` models blocked site
   *  data, where the object EXISTS and touching it raises — the distinction the reader turns on. */
  function fakeLocalStorage(
    entries: Array<[string, string]> | null,
    opts: { throws?: boolean } = {}
  ): unknown {
    // `throws` is checked FIRST: a previous version returned undefined on the null guard before
    // ever reaching it, so the throwing Proxy was unreachable and its test passed vacuously.
    if (opts.throws)
      return new Proxy(
        {},
        {
          get() {
            throw new Error('site data blocked')
          }
        }
      )
    if (entries === null) return undefined
    return {
      get length() {
        return entries.length
      },
      key: (i: number) => entries[i]?.[0] ?? null,
      getItem: (k: string) => entries.find(([key]) => key === k)?.[1] ?? null
    }
  }

  /** IndexedDB for the script, able to model a MISSING database and a STORE-LESS one — the two
   *  states a versionless open would otherwise paper over by silently creating a database. */
  function fakeIndexedDB(opts: {
    entries?: unknown[]
    databases?: { name: string }[]
    stores?: string[]
  }) {
    const closed = { count: 0 }
    const opened = { count: 0 }
    const db = {
      objectStoreNames: {
        contains: (n: string) => (opts.stores ?? ['firebaseLocalStorage']).includes(n)
      },
      transaction: () => ({
        objectStore: () => ({
          getAll: () => {
            const r: Record<string, unknown> = { result: opts.entries ?? [] }
            queueMicrotask(() => (r['onsuccess'] as (() => void) | undefined)?.())
            return r
          }
        })
      }),
      close: () => {
        closed.count += 1
      }
    }
    const idb = {
      databases: () => Promise.resolve(opts.databases ?? [{ name: 'firebaseLocalStorageDb' }]),
      open: () => {
        opened.count += 1
        const req: Record<string, unknown> = { result: db, error: new Error('open failed') }
        queueMicrotask(() => (req['onsuccess'] as (() => void) | undefined)?.())
        return req
      }
    }
    return { idb, closed, opened }
  }

  async function run(opts: {
    localStorage?: Array<[string, string]> | null
    localStorageThrows?: boolean
    entries?: unknown[]
    databases?: { name: string }[]
    stores?: string[]
    fetchImpl?: typeof fetch
  }) {
    const calls: string[] = []
    const { idb, closed, opened } = fakeIndexedDB(opts)
    const fetchStub =
      opts.fetchImpl ??
      (((_url: string, init?: { headers?: Record<string, string> }) => {
        calls.push(init?.headers?.['Authorization'] ?? '')
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ subscription_tier: 'PRO' })
        })
      }) as unknown as typeof fetch)
    const fn = new Function(
      'indexedDB',
      'localStorage',
      'fetch',
      'setTimeout',
      'AbortSignal',
      `return ${FETCH_TIER_JS}`
    ) as (i: unknown, l: unknown, f: unknown, t: unknown, a: unknown) => Promise<unknown>
    const result = await fn(
      idb,
      fakeLocalStorage(opts.localStorage ?? null, { throws: opts.localStorageThrows }),
      fetchStub,
      setTimeout,
      undefined
    )
    return { result, authHeaders: calls, closed: closed.count, opened: opened.count }
  }

  it('reads the token from localStorage, where the session settles', async () => {
    // The regression. Before this fix the script looked only in IndexedDB, which the SDK clears
    // once the auth store moves the record — so every signed-in cloud session read as signed out.
    const { result, authHeaders } = await run({
      localStorage: [[PROD_KEY, JSON.stringify(record('tok-ls'))]]
    })

    expect(result).toEqual({ tier: 'PRO' })
    expect(authHeaders).toEqual(['Bearer tok-ls'])
  })

  it('returns null when localStorage is READABLE and holds no record', async () => {
    // It does NOT fall through to IndexedDB. A record there is either the live user mid-boot or
    // one the SDK discarded at sign-out, and nothing distinguishes them — a discarded token still
    // inside its hour would fetch the former account's tier and persist it. The tier resolves on
    // a later refresh instead.
    const { result, authHeaders } = await run({
      localStorage: [],
      entries: [{ fbase_key: PROD_KEY, value: record('tok-idb') }]
    })

    expect(result).toBeNull()
    expect(authHeaders).toEqual([])
  })

  it('falls back to IndexedDB only when localStorage is ABSENT', async () => {
    // No localStorage object at all: the frontend cannot be using it, so IndexedDB is the store.
    const { result, authHeaders } = await run({
      localStorage: null,
      entries: [{ fbase_key: PROD_KEY, value: record('tok-idb') }]
    })

    expect(result).toEqual({ tier: 'PRO' })
    expect(authHeaders).toEqual(['Bearer tok-idb'])
  })

  it('falls back when localStorage EXISTS but access throws', async () => {
    // Blocked or partitioned storage — the case whose test previously never ran, because the stub
    // returned undefined before it reached the throwing branch.
    const { result } = await run({
      localStorageThrows: true,
      entries: [{ fbase_key: PROD_KEY, value: record('tok-idb') }]
    })

    expect(result).toEqual({ tier: 'PRO' })
  })

  it('does not create the database when none exists', async () => {
    // A versionless open SILENTLY CREATES an empty version-1 database, and the transaction below
    // then throws NotFoundError. The harm is the side effect, so that is what this asserts:
    // `open()` must never be called when the database is not listed. Checking only the return
    // value cannot see it — a created-then-empty database also yields null.
    const { result, opened } = await run({ localStorage: null, databases: [] })

    expect(opened).toBe(0)
    expect(result).toBeNull()
  })

  it('gives up cleanly on a store-less database', async () => {
    const { result } = await run({ localStorage: null, stores: [] })

    expect(result).toBeNull()
  })

  it('closes the database connection it opened', async () => {
    // An unclosed handle blocks a later Firebase versionchange.
    const { closed } = await run({
      localStorage: null,
      entries: [{ fbase_key: PROD_KEY, value: record('tok-idb') }]
    })

    expect(closed).toBe(1)
  })

  it('tries a second record when the first token is stale, instead of giving up', async () => {
    // Not hypothetical: a Firebase project switch leaves the old apiKey's record behind, and the
    // key embeds the apiKey, so two records coexist. Enumeration order must not decide.
    const tried: string[] = []
    const { result } = await run({
      localStorage: [
        ['firebase:authUser:oldkey:[DEFAULT]', JSON.stringify(record('tok-stale'))],
        [PROD_KEY, JSON.stringify(record('tok-live'))]
      ],
      fetchImpl: ((_u: string, init?: { headers?: Record<string, string> }) => {
        const bearer = init?.headers?.['Authorization'] ?? ''
        tried.push(bearer)
        if (bearer === 'Bearer tok-stale') return Promise.resolve({ ok: false, status: 401 })
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ subscription_tier: 'CREATOR' })
        })
      }) as unknown as typeof fetch
    })

    expect(result).toEqual({ tier: 'CREATOR' })
    expect(tried).toEqual(['Bearer tok-stale', 'Bearer tok-live'])
  })

  it('reports an error rather than null when every candidate is rejected', async () => {
    // Distinct from "nobody is signed in": records exist and none was accepted. null would tell
    // the caller there is no user, which is a different and wrong claim.
    const { result } = await run({
      localStorage: [[PROD_KEY, JSON.stringify(record('tok-dead'))]],
      fetchImpl: (() => Promise.resolve({ ok: false, status: 403 })) as unknown as typeof fetch
    })

    expect(result).toEqual({ error: 'http_403' })
  })

  it('does NOT try the next candidate when the failure is transient', async () => {
    // The trap: two records, the FIRST is the live user and the second a leftover still inside its
    // hour. If a 5xx on the live token promoted the next candidate, the leftover would be accepted
    // and the FORMER ACCOUNT'S tier persisted — during an outage, which is when it is least
    // noticeable. A 5xx is the server, not the credential.
    const tried: string[] = []
    const { result } = await run({
      localStorage: [
        [PROD_KEY, JSON.stringify(record('tok-live'))],
        ['firebase:authUser:oldkey:[DEFAULT]', JSON.stringify(record('tok-leftover'))]
      ],
      fetchImpl: ((_u: string, init?: { headers?: Record<string, string> }) => {
        tried.push(init?.headers?.['Authorization'] ?? '')
        return Promise.resolve({ ok: false, status: 503 })
      }) as unknown as typeof fetch
    })

    expect(tried).toEqual(['Bearer tok-live'])
    expect(result).toEqual({ error: 'http_503' })
  })

  it('does NOT try the next candidate when the request throws', async () => {
    // Same reasoning for a network failure or a timeout: it says nothing about the token.
    const tried: string[] = []
    const { result } = await run({
      localStorage: [
        [PROD_KEY, JSON.stringify(record('tok-live'))],
        ['firebase:authUser:oldkey:[DEFAULT]', JSON.stringify(record('tok-leftover'))]
      ],
      fetchImpl: ((_u: string, init?: { headers?: Record<string, string> }) => {
        tried.push(init?.headers?.['Authorization'] ?? '')
        return Promise.reject(Object.assign(new Error('boom'), { name: 'TypeError' }))
      }) as unknown as typeof fetch
    })

    expect(tried).toEqual(['Bearer tok-live'])
    expect(result).toEqual({ error: 'network' })
  })

  it('does NOT try the next candidate on a malformed body', async () => {
    // The server answered, so the credential was accepted; the next token is not a remedy.
    const tried: string[] = []
    const { result } = await run({
      localStorage: [
        [PROD_KEY, JSON.stringify(record('tok-live'))],
        ['firebase:authUser:oldkey:[DEFAULT]', JSON.stringify(record('tok-leftover'))]
      ],
      fetchImpl: ((_u: string, init?: { headers?: Record<string, string> }) => {
        tried.push(init?.headers?.['Authorization'] ?? '')
        return Promise.resolve({ ok: true, json: () => Promise.resolve('not-an-object') })
      }) as unknown as typeof fetch
    })

    expect(tried).toEqual(['Bearer tok-live'])
    expect(result).toEqual({ error: 'bad_json' })
  })

  it('stops after a bounded number of candidates', async () => {
    // The records are page-controlled, so the candidate list must not be.
    const tried: string[] = []
    const { result } = await run({
      localStorage: Array.from({ length: 6 }, (_, i) => [
        `firebase:authUser:key${i}:[DEFAULT]`,
        JSON.stringify(record(`tok-${i}`))
      ]) as Array<[string, string]>,
      fetchImpl: ((_u: string, init?: { headers?: Record<string, string> }) => {
        tried.push(init?.headers?.['Authorization'] ?? '')
        return Promise.resolve({ ok: false, status: 401 })
      }) as unknown as typeof fetch
    })

    expect(tried).toHaveLength(4)
    expect(result).toEqual({ error: 'http_401' })
  })

  it('reports an ABSENT subscription_tier as absent, not as FREE', async () => {
    // The real shape for at least one live account: /customers/me answers 200 with no
    // `subscription_tier` field at all. Defaulting it to 'FREE' inside the page script made the
    // log print `raw= FREE`, indistinguishable from the API actually saying FREE — so the log
    // asserted an observation it had never made. `setTier` already maps null/missing to 'free',
    // so the field is passed through verbatim and the defaulting happens in exactly one place.
    const { result } = await run({
      localStorage: [[PROD_KEY, JSON.stringify(record('tok-ls'))]],
      fetchImpl: (() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ is_admin: false })
        })) as unknown as typeof fetch
    })

    expect(result).toEqual({ tier: null })
  })

  it('passes a real subscription_tier through unchanged', async () => {
    // The control for the above: a present field must not be flattened either.
    const { result } = await run({
      localStorage: [[PROD_KEY, JSON.stringify(record('tok-ls'))]],
      fetchImpl: (() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ subscription_tier: 'FREE' })
        })) as unknown as typeof fetch
    })

    expect(result).toEqual({ tier: 'FREE' })
  })

  it('returns null when neither store holds a usable token', async () => {
    const { result } = await run({ localStorage: null, entries: [] })

    expect(result).toBeNull()
  })

  it('ignores a record with no access token', async () => {
    const { result } = await run({
      localStorage: [[PROD_KEY, JSON.stringify({ stsTokenManager: {} })]]
    })

    expect(result).toBeNull()
  })
})
