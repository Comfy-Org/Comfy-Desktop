import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'

const userTierDataDir = path.join(os.tmpdir(), 'launcher-test-usertier')

vi.mock('electron', () => ({
  app: { getPath: () => userTierDataDir }
}))

const telemetry = await import('./telemetry')
const { refreshCloudUserTier, getUserTier, initUserTier, _resetForTest, FETCH_TIER_JS } =
  await import('./userTier')

function stubContents(result: unknown): { wc: Electron.WebContents } {
  return {
    wc: {
      executeJavaScript: () => Promise.resolve(result)
    } as unknown as Electron.WebContents
  }
}

describe('userTier ops-flag binding', () => {
  let bound: string[]

  beforeEach(async () => {
    await fs.rm(userTierDataDir, { recursive: true, force: true })
    await fs.mkdir(userTierDataDir, { recursive: true })
    _resetForTest()
    bound = []
    vi.spyOn(telemetry, 'capture').mockReturnValue(true)
    vi.spyOn(telemetry, 'setFlagEvaluationUserTier').mockImplementation((tier) => {
      bound.push(tier)
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(userTierDataDir, { recursive: true, force: true })
  })

  it('binds the persisted tier at init', async () => {
    await fs.writeFile(
      path.join(userTierDataDir, 'cloud-user-tier.json'),
      JSON.stringify({ tier: 'paid', ts: 1 })
    )

    await initUserTier()

    expect(bound).toEqual(['paid'])
  })

  it('binds unknown at init when nothing is persisted', async () => {
    await initUserTier()

    expect(bound).toEqual(['unknown'])
  })

  it.each(['{not json', JSON.stringify({ tier: 'gold' })])(
    'binds unknown at init for an unusable file (%s)',
    async (contents) => {
      await fs.writeFile(path.join(userTierDataDir, 'cloud-user-tier.json'), contents)

      await expect(initUserTier()).resolves.toBeUndefined()

      expect(bound).toEqual(['unknown'])
    }
  )

  it('binds each refreshed tier', async () => {
    await refreshCloudUserTier(stubContents({ tier: 'FREE' }).wc)
    await refreshCloudUserTier(stubContents({ tier: 'PRO' }).wc)

    expect(bound).toEqual(['free', 'paid'])
  })

  it.each([null, { error: 'network' }, { error: 'http_401' }])(
    'leaves the binding alone when a refresh cannot answer (%j)',
    async (result) => {
      await refreshCloudUserTier(stubContents({ tier: 'PRO' }).wc)
      await refreshCloudUserTier(stubContents(result).wc)

      expect(bound).toEqual(['paid'])
    }
  )
})

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

describe('FETCH_TIER_JS', () => {
  const PROD_KEY = 'firebase:authUser:apikey:[DEFAULT]'
  const record = (token: string) => ({ stsTokenManager: { accessToken: token } })

  function fakeLocalStorage(
    entries: Array<[string, string]> | null,
    opts: { throws?: boolean } = {}
  ): unknown {
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
    const { result, authHeaders } = await run({
      localStorage: [[PROD_KEY, JSON.stringify(record('tok-ls'))]]
    })

    expect(result).toEqual({ tier: 'PRO' })
    expect(authHeaders).toEqual(['Bearer tok-ls'])
  })

  it('returns null when localStorage is READABLE and holds no record', async () => {
    const { result, authHeaders } = await run({
      localStorage: [],
      entries: [{ fbase_key: PROD_KEY, value: record('tok-idb') }]
    })

    expect(result).toBeNull()
    expect(authHeaders).toEqual([])
  })

  it('falls back to IndexedDB only when localStorage is ABSENT', async () => {
    const { result, authHeaders } = await run({
      localStorage: null,
      entries: [{ fbase_key: PROD_KEY, value: record('tok-idb') }]
    })

    expect(result).toEqual({ tier: 'PRO' })
    expect(authHeaders).toEqual(['Bearer tok-idb'])
  })

  it('falls back when localStorage EXISTS but access throws', async () => {
    const { result } = await run({
      localStorageThrows: true,
      entries: [{ fbase_key: PROD_KEY, value: record('tok-idb') }]
    })

    expect(result).toEqual({ tier: 'PRO' })
  })

  it('does not create the database when none exists', async () => {
    const { result, opened } = await run({ localStorage: null, databases: [] })

    expect(opened).toBe(0)
    expect(result).toBeNull()
  })

  it('gives up cleanly on a store-less database', async () => {
    const { result } = await run({ localStorage: null, stores: [] })

    expect(result).toBeNull()
  })

  it('closes the database connection it opened', async () => {
    const { closed } = await run({
      localStorage: null,
      entries: [{ fbase_key: PROD_KEY, value: record('tok-idb') }]
    })

    expect(closed).toBe(1)
  })

  it('tries a second record when the first token is stale, instead of giving up', async () => {
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
    const { result } = await run({
      localStorage: [[PROD_KEY, JSON.stringify(record('tok-dead'))]],
      fetchImpl: (() => Promise.resolve({ ok: false, status: 403 })) as unknown as typeof fetch
    })

    expect(result).toEqual({ error: 'http_403' })
  })

  it('does NOT try the next candidate when the failure is transient', async () => {
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
    expect(result).toEqual({ error: 'http_401', truncated: true })
  })

  it('does NOT claim truncation when the cap was not actually hit', async () => {
    const tried: string[] = []
    const { result } = await run({
      localStorage: Array.from({ length: 4 }, (_, i) => [
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

  it('does not mark truncation when a DUPLICATE token is dropped rather than a distinct one', async () => {
    const tried: string[] = []
    const ls: Array<[string, string]> = Array.from({ length: 4 }, (_, i) => [
      `firebase:authUser:key${i}:[DEFAULT]`,
      JSON.stringify(record(`tok-${i}`))
    ]) as Array<[string, string]>
    ls.push(['firebase:authUser:dupe:[DEFAULT]', JSON.stringify(record('tok-0'))])
    const { result } = await run({
      localStorage: ls,
      fetchImpl: ((_u: string, init?: { headers?: Record<string, string> }) => {
        tried.push(init?.headers?.['Authorization'] ?? '')
        return Promise.resolve({ ok: false, status: 401 })
      }) as unknown as typeof fetch
    })

    expect(tried).toHaveLength(4)
    expect(result).toEqual({ error: 'http_401' })
  })

  it('reports an ABSENT subscription_tier as absent, not as FREE', async () => {
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
