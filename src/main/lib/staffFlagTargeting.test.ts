import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { FirebaseIdentityConsensus } from './firebaseAuthIdentity'

let testConfigDir = ''
vi.mock('./paths', () => ({
  configDir: () => testConfigDir
}))

const setFlagEvaluationStaff = vi.fn()
let consentState = 'granted'
vi.mock('./telemetry', () => ({
  setFlagEvaluationStaff: (isStaff: boolean) => setFlagEvaluationStaff(isStaff),
  sendsStaffProperty: (isStaff: boolean) => consentState === 'granted' && isStaff
}))

const identity = vi.hoisted(() => {
  let current: { status: string; userId?: string } = { status: 'unknown' }
  const observers = new Set<(consensus: unknown) => void>()
  const views = new Map<string, Electron.WebContents[]>()
  return {
    current: () => current,
    observers,
    views,
    publish(next: { status: string; userId?: string }, holders: Electron.WebContents[] = []) {
      current = next
      if (next.status === 'signed_in' && next.userId) views.set(next.userId, holders)
      for (const observe of [...observers]) observe(next)
    },
    reset() {
      current = { status: 'unknown' }
      observers.clear()
      views.clear()
    }
  }
})

vi.mock('./firebaseAuthIdentity', () => ({
  getFirebaseIdentityConsensus: () => identity.current(),
  observeFirebaseIdentityConsensus: (observe: (consensus: unknown) => void) => {
    identity.observers.add(observe)
    return () => identity.observers.delete(observe)
  },
  viewsReportingFirebaseUser: (userId: string) => identity.views.get(userId) ?? []
}))

const { initStaffFlagTargeting, refreshStaffFlagTargeting, CLASSIFY_STAFF_JS, _resetForTest } =
  await import('./staffFlagTargeting')

const USER = 'uid-primary'
const OTHER_USER = 'uid-other'

let pageReads = 0

function stubContents(
  staff: boolean,
  opts: { throws?: boolean; userId?: string } = {}
): Electron.WebContents {
  return {
    executeJavaScript: () => {
      pageReads += 1
      return opts.throws
        ? Promise.reject(new Error('page gone'))
        : Promise.resolve({ known: true, staff, userId: opts.userId ?? USER })
    }
  } as unknown as Electron.WebContents
}

function stubContentsWithoutAuthStore(): Electron.WebContents {
  return {
    executeJavaScript: () => {
      pageReads += 1
      return Promise.resolve({ known: false })
    }
  } as unknown as Electron.WebContents
}

function stubContentsReturning(result: unknown): Electron.WebContents {
  return {
    executeJavaScript: () => {
      pageReads += 1
      return Promise.resolve(result)
    }
  } as unknown as Electron.WebContents
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function consensusSignedIn(
  holders: Electron.WebContents[],
  userId: string = USER
): Promise<void> {
  identity.publish({ status: 'signed_in', userId }, holders)
  await settle()
}

async function consensusSignedOut(): Promise<void> {
  identity.publish({ status: 'signed_out' })
  await settle()
}

async function consensusUnresolved(
  status: Extract<
    FirebaseIdentityConsensus,
    { status: 'pending' | 'conflicted' | 'unknown' }
  >['status']
): Promise<void> {
  identity.publish({ status })
  await settle()
}

function persistFilePath(): string {
  return path.join(testConfigDir, 'staff-targeting.json')
}

function storedFile(): unknown {
  return JSON.parse(fs.readFileSync(persistFilePath(), 'utf-8'))
}

function nextLaunchBinding(): boolean {
  setFlagEvaluationStaff.mockClear()
  _resetForTest()
  initStaffFlagTargeting()
  return setFlagEvaluationStaff.mock.calls.at(-1)?.[0] as boolean
}

beforeEach(() => {
  testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-targeting-'))
  setFlagEvaluationStaff.mockClear()
  consentState = 'granted'
  pageReads = 0
  _resetForTest()
  identity.reset()
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(testConfigDir, { recursive: true, force: true })
})

function fakeIndexedDB(opts: {
  databases?: { name: string }[]
  stores?: string[]
  entries?: unknown[]
  openOutcome?: 'success' | 'error' | 'blocked' | 'never'
  onIdbRead?: () => void
}) {
  const closed = { count: 0 }
  const idbReadFired = { done: false }
  const db = {
    objectStoreNames: {
      contains: (n: string) => (opts.stores ?? ['firebaseLocalStorage']).includes(n)
    },
    transaction: () => ({
      objectStore: () => ({
        getAll: () => {
          const req: Record<string, unknown> = { result: opts.entries ?? [] }
          queueMicrotask(() => (req['onsuccess'] as (() => void) | undefined)?.())
          return req
        }
      })
    }),
    close: () => {
      closed.count += 1
    }
  }
  const idb = {
    databases: () => {
      if (!idbReadFired.done) {
        idbReadFired.done = true
        opts.onIdbRead?.()
      }
      return Promise.resolve(opts.databases ?? [{ name: 'firebaseLocalStorageDb' }])
    },
    open: () => {
      const req: Record<string, unknown> = { result: db, error: new Error('open failed') }
      const outcome = opts.openOutcome ?? 'success'
      if (outcome !== 'never') {
        queueMicrotask(() => {
          const handler = { success: 'onsuccess', error: 'onerror', blocked: 'onblocked' }[outcome]
          ;(req[handler] as (() => void) | undefined)?.()
        })
      }
      return req
    }
  }
  return { idb, closed }
}

function authRecord(uid: string, email: string | null, emailVerified = true): unknown {
  return { fbase_key: `firebase:authUser:key:${uid}`, value: { uid, email, emailVerified } }
}

function fakeLocalStorage(
  entries: Array<[string, string]> | null,
  opts: { throws?: boolean; getItemThrows?: boolean } = {}
): unknown {
  if (entries === null) return null
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
    getItem: (k: string) => {
      if (opts.getItemThrows) throw new Error('site data blocked mid-read')
      return entries.find(([key]) => key === k)?.[1] ?? null
    }
  }
}

async function classify(
  opts: Parameters<typeof fakeIndexedDB>[0] & {
    localStorage?: Array<[string, string]> | null
    localStorageThrows?: boolean
    localStorageGetItemThrows?: boolean
    localStorageDuringAwait?: Array<[string, string]>
  }
): Promise<{
  result: { known?: boolean; staff?: boolean; userId?: string | null }
  closed: number
}> {
  const lsEntries =
    opts.localStorage === undefined || opts.localStorage === null ? null : [...opts.localStorage]
  const { idb, closed } = fakeIndexedDB({
    ...opts,
    onIdbRead: () => {
      if (lsEntries && opts.localStorageDuringAwait) lsEntries.push(...opts.localStorageDuringAwait)
    }
  })
  const run = new Function(
    'indexedDB',
    'setTimeout',
    'localStorage',
    `return ${CLASSIFY_STAFF_JS}`
  ) as (
    i: unknown,
    t: unknown,
    l: unknown
  ) => Promise<{ known?: boolean; staff?: boolean; userId?: string | null }>
  const result = await run(
    idb,
    setTimeout,
    fakeLocalStorage(lsEntries, {
      throws: opts.localStorageThrows,
      getItemThrows: opts.localStorageGetItemThrows
    }) ?? undefined
  )
  return { result, closed: closed.count }
}

function localRecord(uid: string, email: string | null, emailVerified = true): [string, string] {
  return [`firebase:authUser:apikey:${uid}`, JSON.stringify({ uid, email, emailVerified })]
}

describe('CLASSIFY_STAFF_JS', () => {
  it.each([
    ['a plain staff address', 'someone@comfy.org', true],
    ['mixed case', 'Foo@Comfy.Org', true],
    ['surrounding whitespace', '  foo@comfy.org  ', true],
    ['both at once', '  Staff.Person@COMFY.ORG ', true],
    ['a non-staff address', 'someone@example.com', false],
    ['a lookalike domain', 'someone@notcomfy.org', false],
    ['the domain in the local part', 'comfy.org@example.com', false],
    ['an empty address', '', false],
    ['a null address', null, false]
  ])('classifies %s', async (_label, email, expected) => {
    const { result } = await classify({ entries: [authRecord('u1', email as string | null)] })

    expect(result).toEqual({ known: true, staff: expected, userId: 'u1' })
  })

  it('refuses an unverified address, which proves nothing about domain ownership', async () => {
    const { result } = await classify({ entries: [authRecord('u1', 'someone@comfy.org', false)] })

    expect(result).toEqual({ known: true, staff: false, userId: 'u1' })
  })

  it('reports signed out, for no account, when no auth record exists', async () => {
    const { result } = await classify({ entries: [] })

    expect(result).toEqual({ known: true, staff: false, userId: null })
  })

  it('declines to answer when two accounts are stored', async () => {
    const { result } = await classify({
      entries: [authRecord('u1', 'someone@comfy.org'), authRecord('u2', 'other@example.com')]
    })

    expect(result).toEqual({ known: false })
  })

  it('still answers when one account is stored under duplicate keys', async () => {
    const { result } = await classify({
      entries: [authRecord('u1', 'someone@comfy.org'), authRecord('u1', 'someone@comfy.org')]
    })

    expect(result).toEqual({ known: true, staff: true, userId: 'u1' })
  })

  it.each([['__proto__'], ['constructor'], ['toString']])(
    'counts a record whose uid is %s, so the one-account guard cannot be slipped past',
    async (uid) => {
      const { result } = await classify({
        entries: [authRecord('real', 'someone@comfy.org'), authRecord(uid, 'other@example.com')]
      })

      expect(result).toEqual({ known: false })
    }
  )

  it.each([
    ['there is no Firebase database', { databases: [] }],
    ['the object store is missing', { stores: [] }],
    ['the open fails', { openOutcome: 'error' as const }],
    ['the open is blocked', { openOutcome: 'blocked' as const }]
  ])('declines to answer when %s', async (_label, opts) => {
    const { result } = await classify(opts)

    expect(result).toEqual({ known: false })
  })

  it('ignores entries that are not auth records', async () => {
    const { result } = await classify({
      entries: [{ fbase_key: 'something:else', value: { uid: 'x', email: 'a@comfy.org' } }, null]
    })

    expect(result).toEqual({ known: true, staff: false, userId: null })
  })

  it('reports which account it classified, so main can check it is the agreed one', async () => {
    const { result } = await classify({ entries: [authRecord('uid-primary', 'foo@comfy.org')] })

    expect(result).toMatchObject({ userId: 'uid-primary' })
  })

  it('caps an absurd uid one past what main will accept, rather than truncating into a match', async () => {
    const { result } = await classify({ entries: [authRecord('u'.repeat(300), 'foo@comfy.org')] })

    expect(result.userId).toHaveLength(257)
  })

  it('gives up on an open that never settles, rather than hanging forever', async () => {
    vi.useFakeTimers()
    try {
      const pending = classify({ openOutcome: 'never' })
      await vi.advanceTimersByTimeAsync(5000)
      const { result } = await pending

      expect(result).toEqual({ known: false })
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes the database even when it answers nothing', async () => {
    const { closed } = await classify({ stores: [] })

    expect(closed).toBe(1)
  })

  it('never returns the address itself', async () => {
    const { result } = await classify({ entries: [authRecord('u1', 'someone@comfy.org')] })

    expect(JSON.stringify(result)).not.toContain('comfy.org')
  })
})

describe('initStaffFlagTargeting', () => {
  it('binds false when nothing has been stored yet', () => {
    initStaffFlagTargeting()

    expect(setFlagEvaluationStaff).toHaveBeenCalledWith(false)
  })

  it.each([
    ['corrupt JSON', '{not json'],
    ['a non-object', '"staff"'],
    ['an array', '[true]'],
    ['a missing key', '{}'],
    ['a non-boolean value', '{"staff":"true"}']
  ])('binds false for %s, failing to the safe direction', (_label, contents) => {
    fs.writeFileSync(persistFilePath(), contents, 'utf-8')

    initStaffFlagTargeting()

    expect(setFlagEvaluationStaff).toHaveBeenCalledWith(false)
  })

  it('binds true for a stored staff classification', () => {
    fs.writeFileSync(persistFilePath(), JSON.stringify({ staff: true }), 'utf-8')

    initStaffFlagTargeting()

    expect(setFlagEvaluationStaff).toHaveBeenCalledWith(true)
  })
})

describe('classification driven by the identity consensus', () => {
  beforeEach(() => {
    initStaffFlagTargeting()
    setFlagEvaluationStaff.mockClear()
  })

  it('stores the classification for the next launch', async () => {
    await consensusSignedIn([stubContents(true)])

    expect(storedFile()).toMatchObject({ staff: true })
  })

  it('stores only a boolean — never the address it classified', async () => {
    await consensusSignedIn([stubContents(true)])

    expect(fs.readFileSync(persistFilePath(), 'utf-8')).not.toContain('someone@comfy.org')
    expect(fs.readFileSync(persistFilePath(), 'utf-8')).not.toContain('comfy.org')
  })

  it('stores only a boolean — never the UID it checked against', async () => {
    await consensusSignedIn([stubContents(true)])

    expect(fs.readFileSync(persistFilePath(), 'utf-8')).not.toContain(USER)
  })

  it('never hands telemetry anything but a boolean', async () => {
    await consensusSignedIn([stubContents(true)])

    for (const [arg] of setFlagEvaluationStaff.mock.calls) {
      expect(typeof arg).toBe('boolean')
    }
  })

  it('carries a staff classification into the next launch', async () => {
    await consensusSignedIn([stubContents(true)])

    expect(nextLaunchBinding()).toBe(true)
  })

  it('leaves a non-staff account untargeted, and writes nothing to say so', async () => {
    await consensusSignedIn([stubContents(false)])

    expect(fs.existsSync(persistFilePath())).toBe(false)
    expect(nextLaunchBinding()).toBe(false)
  })

  it('stores false for a non-staff account when the disk says otherwise', async () => {
    fs.writeFileSync(persistFilePath(), JSON.stringify({ staff: true }), 'utf-8')
    initStaffFlagTargeting()

    await consensusSignedIn([stubContents(false)])

    expect(storedFile()).toMatchObject({ staff: false })
    expect(nextLaunchBinding()).toBe(false)
  })

  it('binds the classification immediately as well as storing it', async () => {
    await consensusSignedIn([stubContents(true)])

    expect(setFlagEvaluationStaff).toHaveBeenLastCalledWith(true)
  })

  it('does not rewrite the file when the classification is unchanged', async () => {
    await consensusSignedIn([stubContents(true)])
    const firstWrite = fs.statSync(persistFilePath()).mtimeMs

    await consensusSignedIn([stubContents(true)])
    await consensusSignedIn([stubContents(true)])

    expect(fs.statSync(persistFilePath()).mtimeMs).toBe(firstWrite)
  })

  it('reclassifies on a switch to a non-staff account', async () => {
    await consensusSignedIn([stubContents(true)])

    await consensusSignedIn([stubContents(false, { userId: OTHER_USER })], OTHER_USER)

    expect(nextLaunchBinding()).toBe(false)
  })

  it('re-binds the agreed account across a pending outcome even when no view can answer', async () => {
    await consensusSignedIn([stubContents(true)])
    await consensusUnresolved('pending')
    setFlagEvaluationStaff.mockClear()

    await consensusSignedIn([], USER)

    expect(setFlagEvaluationStaff).toHaveBeenLastCalledWith(true)
    expect(nextLaunchBinding()).toBe(true)
  })

  it('revalidates a returning account, because a UID is not a classification', async () => {
    await consensusSignedIn([stubContents(true)])
    expect(storedFile()).toMatchObject({ staff: true })
    await consensusUnresolved('pending')
    pageReads = 0

    await consensusSignedIn([stubContents(false)], USER)

    expect(pageReads).toBeGreaterThan(0)
    expect(storedFile()).toMatchObject({ staff: false })
  })

  it('binds the known answer before revalidating, so a returning account never flaps', async () => {
    await consensusSignedIn([stubContents(true)])
    await consensusUnresolved('pending')
    setFlagEvaluationStaff.mockClear()

    identity.publish({ status: 'signed_in', userId: USER }, [stubContents(true)])

    expect(setFlagEvaluationStaff).toHaveBeenCalledWith(true)
    await settle()
    expect(setFlagEvaluationStaff).not.toHaveBeenCalledWith(false)
  })
})

describe('applying a change without a restart', () => {
  const onFlagPropertiesChange = vi.fn()
  beforeEach(() => {
    onFlagPropertiesChange.mockClear()
  })

  it('re-evaluates after a staff sign-in with consent, once the property is bound and stored', async () => {
    const atCallback: { bound?: unknown; stored?: unknown } = {}
    initStaffFlagTargeting({
      onFlagPropertiesChange: () => {
        atCallback.bound = setFlagEvaluationStaff.mock.calls.at(-1)?.[0]
        atCallback.stored = storedFile()
        onFlagPropertiesChange()
      }
    })

    await consensusSignedIn([stubContents(true)])

    expect(onFlagPropertiesChange).toHaveBeenCalledTimes(1)
    expect(atCallback.bound, 'the refresh reads the bound property synchronously').toBe(true)
    expect(atCallback.stored, 'the next boot is targeted on the same answer').toMatchObject({
      staff: true
    })
  })

  it('does not re-evaluate without consent, since the property is not sent', async () => {
    for (const state of ['undecided', 'denied']) {
      _resetForTest()
      fs.rmSync(persistFilePath(), { force: true })
      consentState = state
      initStaffFlagTargeting({ onFlagPropertiesChange })
      const readsBefore = pageReads

      await consensusSignedIn([stubContents(true)])

      expect(pageReads, `classified under ${state}`).toBe(readsBefore + 1)
    }

    expect(onFlagPropertiesChange).not.toHaveBeenCalled()
  })

  it('still re-evaluates when the classification write fails, from the bound answer', async () => {
    fs.mkdirSync(persistFilePath() + '.tmp', { recursive: true })
    initStaffFlagTargeting({ onFlagPropertiesChange })

    await consensusSignedIn([stubContents(true)])

    expect(fs.existsSync(persistFilePath()), 'the write did fail').toBe(false)
    expect(
      onFlagPropertiesChange,
      'this launch is targeted; the write is retried later'
    ).toHaveBeenCalledTimes(1)
  })

  it('does not re-evaluate after a non-staff sign-in', async () => {
    initStaffFlagTargeting({ onFlagPropertiesChange })

    await consensusSignedIn([stubContents(false)])

    expect(pageReads, 'classified').toBe(1)
    expect(onFlagPropertiesChange).not.toHaveBeenCalled()
  })

  it('does not re-evaluate a staff launch that booted already targeted', async () => {
    fs.writeFileSync(persistFilePath(), JSON.stringify({ staff: true }), 'utf-8')
    initStaffFlagTargeting({ onFlagPropertiesChange })

    await consensusSignedIn([stubContents(true)])
    await consensusUnresolved('pending')
    await consensusSignedIn([stubContents(true)])

    expect(pageReads, 'classified, then revalidated').toBe(2)
    expect(onFlagPropertiesChange).not.toHaveBeenCalled()
  })

  it('re-evaluates again on a staff sign-out, withdrawing staff targeting for the next launch', async () => {
    initStaffFlagTargeting({ onFlagPropertiesChange })
    await consensusSignedIn([stubContents(true)])

    await consensusSignedOut()

    expect(onFlagPropertiesChange).toHaveBeenCalledTimes(2)
    expect(storedFile()).toMatchObject({ staff: false })
  })
})

describe('what reading a single view got wrong', () => {
  beforeEach(() => {
    initStaffFlagTargeting()
    setFlagEvaluationStaff.mockClear()
  })

  it('reclassifies on a sign-out that never navigates', async () => {
    await consensusSignedIn([stubContents(true)])
    expect(nextLaunchBinding()).toBe(true)

    await consensusSignedOut()

    expect(storedFile()).toMatchObject({ staff: false })
    expect(nextLaunchBinding()).toBe(false)
  })

  it('holds when two views are signed into two accounts, rather than letting one win', async () => {
    await consensusSignedIn([stubContents(true)])
    expect(nextLaunchBinding()).toBe(true)

    await consensusUnresolved('conflicted')

    expect(nextLaunchBinding()).toBe(true)
    expect(storedFile()).toMatchObject({ staff: true })
  })

  it('refuses a view that classified an account the process does not agree is signed in', async () => {
    await consensusSignedIn([stubContents(true)])
    expect(nextLaunchBinding()).toBe(true)
    pageReads = 0

    await consensusSignedIn([stubContents(false, { userId: OTHER_USER })], USER)

    expect(pageReads).toBeGreaterThan(0)
    expect(nextLaunchBinding()).toBe(true)
  })

  it('refuses an over-length uid that trimming would sneak under the limit', async () => {
    const agreed = 'u'.repeat(256)
    await consensusSignedIn(
      [stubContentsReturning({ known: true, staff: true, userId: agreed + '\n' })],
      agreed
    )

    expect(fs.existsSync(persistFilePath())).toBe(false)
  })

  it('refuses a uid too long for the gate consensus itself applies', async () => {
    await consensusSignedIn([
      stubContentsReturning({ known: true, staff: true, userId: 'u'.repeat(257) })
    ])

    expect(fs.existsSync(persistFilePath())).toBe(false)
  })

  it('asks the next view when the first cannot answer', async () => {
    await consensusSignedIn([stubContentsWithoutAuthStore(), stubContents(true)])

    expect(nextLaunchBinding()).toBe(true)
  })

  it('does not apply a read whose account was superseded while it was in flight', async () => {
    const slowRead: { release?: (value: unknown) => void } = {}
    const slowView = {
      executeJavaScript: () =>
        new Promise((resolve) => {
          slowRead.release = resolve
        })
    } as unknown as Electron.WebContents

    identity.publish({ status: 'signed_in', userId: USER }, [slowView])
    await settle()
    await consensusSignedOut()

    slowRead.release?.({ known: true, staff: true, userId: USER })
    await settle()

    expect(setFlagEvaluationStaff).not.toHaveBeenCalledWith(true)
    expect(fs.existsSync(persistFilePath())).toBe(false)
    expect(nextLaunchBinding()).toBe(false)
  })
})

describe('one answer per consensus outcome', () => {
  beforeEach(() => {
    initStaffFlagTargeting()
    setFlagEvaluationStaff.mockClear()
  })

  it('does not let a slower view overwrite a verdict already accepted for this outcome', async () => {
    const slow: { release?: (value: unknown) => void } = {}
    const slowView = {
      executeJavaScript: () =>
        new Promise((resolve) => {
          slow.release = resolve
        })
    } as unknown as Electron.WebContents

    identity.publish({ status: 'signed_in', userId: USER }, [slowView])
    await settle()
    await refreshStaffFlagTargeting(stubContents(true))
    expect(storedFile()).toMatchObject({ staff: true })

    slow.release?.({ known: true, staff: false, userId: USER })
    await settle()

    expect(storedFile()).toMatchObject({ staff: true })
    expect(nextLaunchBinding()).toBe(true)
  })

  it('still answers a later outcome, so the guard is per-outcome and not permanent', async () => {
    await consensusSignedIn([stubContents(false)])
    await consensusUnresolved('pending')

    await consensusSignedIn([stubContents(true)], USER)

    expect(storedFile()).toMatchObject({ staff: true })
  })
})

describe('retrying a write that did not land', () => {
  beforeEach(() => {
    initStaffFlagTargeting()
    setFlagEvaluationStaff.mockClear()
  })

  it('retries the revocation write, which the consensus will not redeliver', async () => {
    await consensusSignedIn([stubContents(true)])
    expect(storedFile()).toMatchObject({ staff: true })

    fs.mkdirSync(persistFilePath() + '.tmp', { recursive: true })
    await consensusSignedOut()
    expect(storedFile()).toMatchObject({ staff: true })

    fs.rmSync(persistFilePath() + '.tmp', { recursive: true, force: true })
    await refreshStaffFlagTargeting(stubContents(true))

    expect(storedFile()).toMatchObject({ staff: false })
    expect(nextLaunchBinding()).toBe(false)
  })

  it('does not let a dom-ready view DECIDE a sign-out, only re-apply one', async () => {
    await consensusSignedIn([stubContents(true)])
    await consensusUnresolved('unknown')
    pageReads = 0

    await refreshStaffFlagTargeting(stubContents(false))

    expect(pageReads).toBe(0)
    expect(nextLaunchBinding()).toBe(true)
  })
})

describe('bounding a page that does not answer', () => {
  beforeEach(() => {
    initStaffFlagTargeting()
    setFlagEvaluationStaff.mockClear()
  })

  it('gives up on a wedged view and asks the next one', async () => {
    vi.useFakeTimers()
    try {
      const wedged = {
        executeJavaScript: () => new Promise(() => {})
      } as unknown as Electron.WebContents

      identity.publish({ status: 'signed_in', userId: USER }, [wedged, stubContents(true)])
      await vi.advanceTimersByTimeAsync(10_000)

      expect(storedFile()).toMatchObject({ staff: true })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('outcomes that are the absence of an answer', () => {
  beforeEach(() => {
    initStaffFlagTargeting()
    setFlagEvaluationStaff.mockClear()
  })

  it.each([
    ['a contributor is still resolving', 'pending' as const],
    ['two views disagree about the account', 'conflicted' as const],
    ['no view can say at all', 'unknown' as const]
  ])('holds the stored classification when %s', async (_label, status) => {
    await consensusSignedIn([stubContents(true)])

    await consensusUnresolved(status)

    expect(nextLaunchBinding()).toBe(true)
  })

  it('does not revoke a staff grant when the last window closes', async () => {
    await consensusSignedIn([stubContents(true)])
    const afterSignIn = fs.statSync(persistFilePath()).mtimeMs

    await consensusUnresolved('unknown')

    expect(storedFile()).toMatchObject({ staff: true })
    expect(fs.statSync(persistFilePath()).mtimeMs).toBe(afterSignIn)
    expect(nextLaunchBinding()).toBe(true)
  })

  it.each([
    ['a view with no auth store', () => stubContentsWithoutAuthStore()],
    ['a read that returned null', () => stubContentsReturning(null)],
    ['a read that returned an unexpected shape', () => stubContentsReturning('nope')],
    ['a read that threw', () => stubContents(false, { throws: true })]
  ])('stays silent for %s rather than voting "not staff"', async (_label, make) => {
    await consensusSignedIn([stubContents(true)])
    expect(nextLaunchBinding()).toBe(true)
    pageReads = 0

    await consensusSignedIn([make()])

    expect(pageReads).toBeGreaterThan(0)
    expect(nextLaunchBinding()).toBe(true)
  })

  it('treats a non-boolean verdict as not staff', async () => {
    await consensusSignedIn([stubContents(true)])
    expect(nextLaunchBinding()).toBe(true)

    await consensusSignedIn(
      [stubContentsReturning({ known: true, staff: 'yes', userId: OTHER_USER })],
      OTHER_USER
    )

    expect(storedFile()).toMatchObject({ staff: false })
    expect(nextLaunchBinding()).toBe(false)
  })

  it('survives a page-context read that throws, leaving the stored value alone', async () => {
    await consensusSignedIn([stubContents(true)])

    await expect(
      refreshStaffFlagTargeting(stubContents(false, { throws: true }))
    ).resolves.toBeUndefined()
    expect(nextLaunchBinding()).toBe(true)
  })
})

describe('refreshStaffFlagTargeting', () => {
  beforeEach(() => {
    initStaffFlagTargeting()
    setFlagEvaluationStaff.mockClear()
  })

  it('classifies when the consensus resolved but nothing could answer for it yet', async () => {
    await consensusSignedIn([stubContentsWithoutAuthStore()])
    expect(fs.existsSync(persistFilePath())).toBe(false)

    await refreshStaffFlagTargeting(stubContents(true))

    expect(nextLaunchBinding()).toBe(true)
  })

  it.each([
    ['nothing is agreed yet', 'unknown' as const],
    ['a contributor is still resolving', 'pending' as const],
    ['two views disagree', 'conflicted' as const]
  ])('declines to classify while %s', async (_label, status) => {
    await consensusUnresolved(status)

    await refreshStaffFlagTargeting(stubContents(true))

    expect(fs.existsSync(persistFilePath())).toBe(false)
  })

  it('leaves a resolved sign-out to the consensus rather than one view reaching dom-ready', async () => {
    await consensusSignedIn([stubContents(true)])

    await refreshStaffFlagTargeting(stubContents(false, { userId: USER }))

    expect(nextLaunchBinding()).toBe(true)
  })

  it('costs nothing once the agreed account is classified', async () => {
    await consensusSignedIn([stubContents(true)])
    const executeJavaScript = vi.fn()

    await refreshStaffFlagTargeting({ executeJavaScript } as unknown as Electron.WebContents)

    expect(executeJavaScript).not.toHaveBeenCalled()
  })

  it('refuses a view that read a different account', async () => {
    await consensusSignedIn([stubContentsWithoutAuthStore()])

    await refreshStaffFlagTargeting(stubContents(true, { userId: OTHER_USER }))

    expect(fs.existsSync(persistFilePath())).toBe(false)
  })
})

describe('persisting the classification', () => {
  beforeEach(() => {
    initStaffFlagTargeting()
    setFlagEvaluationStaff.mockClear()
  })

  it('retries the write on a later resolution after a failure', async () => {
    fs.mkdirSync(persistFilePath() + '.tmp', { recursive: true })
    await consensusSignedIn([stubContents(true)])
    expect(fs.existsSync(persistFilePath())).toBe(false)

    const executeJavaScript = vi.fn()
    fs.rmSync(persistFilePath() + '.tmp', { recursive: true, force: true })
    await refreshStaffFlagTargeting({ executeJavaScript } as unknown as Electron.WebContents)

    expect(executeJavaScript).not.toHaveBeenCalled()
    expect(storedFile()).toMatchObject({ staff: true })
    expect(nextLaunchBinding()).toBe(true)
  })

  it('keeps writing after an unreadable stored file, rather than assuming not-staff', async () => {
    fs.writeFileSync(persistFilePath(), JSON.stringify({ staff: true }), 'utf-8')
    fs.chmodSync(persistFilePath(), 0o000)
    let unreadable = false
    try {
      fs.readFileSync(persistFilePath())
    } catch {
      unreadable = true
    }
    if (!unreadable) {
      fs.chmodSync(persistFilePath(), 0o644)
      return
    }
    initStaffFlagTargeting()

    await consensusSignedIn([stubContents(false)])

    fs.chmodSync(persistFilePath(), 0o644)
    expect(storedFile()).toMatchObject({ staff: false })
  })

  it('survives an unwritable config dir', async () => {
    fs.rmSync(testConfigDir, { recursive: true, force: true })

    await expect(refreshStaffFlagTargeting(stubContents(true))).resolves.toBeUndefined()
  })
})

describe('CLASSIFY_STAFF_JS reads localStorage first', () => {
  it('classifies a staff account held in localStorage', async () => {
    const { result } = await classify({
      localStorage: [localRecord('u1', 'someone@comfy.org')],
      entries: []
    })

    expect(result).toEqual({ known: true, staff: true, userId: 'u1' })
  })

  it('applies the same cohort rule there — an unverified address proves nothing', async () => {
    const { result } = await classify({
      localStorage: [localRecord('u1', 'someone@comfy.org', false)],
      entries: []
    })

    expect(result).toEqual({ known: true, staff: false, userId: 'u1' })
  })

  it('declines to answer when localStorage holds two accounts', async () => {
    const { result } = await classify({
      localStorage: [
        localRecord('u1', 'someone@comfy.org'),
        localRecord('u2', 'other@example.com')
      ],
      entries: []
    })

    expect(result).toEqual({ known: false })
  })

  it('ignores localStorage keys that are not auth records', async () => {
    const { result } = await classify({
      localStorage: [
        ['Comfy.Settings', '{"foo":1}'],
        ['firebase:authUser:apikey:unparseable', 'not json at all'],
        localRecord('u1', 'someone@comfy.org')
      ],
      entries: []
    })

    expect(result).toEqual({ known: true, staff: true, userId: 'u1' })
  })

  it('abstains when localStorage is empty and IndexedDB holds a user', async () => {
    const { result } = await classify({
      localStorage: [],
      entries: [authRecord('u1', 'someone@comfy.org')]
    })

    expect(result).toEqual({ known: false })
  })

  it('reports no account when BOTH stores are empty, which is not ambiguous', async () => {
    const { result } = await classify({ localStorage: [], entries: [] })

    expect(result).toEqual({ known: true, staff: false, userId: null })
  })

  it('answers a MISSING database the same as an empty one when localStorage is readable', async () => {
    const { result } = await classify({ localStorage: [], databases: [] })

    expect(result).toEqual({ known: true, staff: false, userId: null })
  })

  it('still declines when the database is missing AND localStorage is unavailable', async () => {
    const { result } = await classify({ databases: [] })

    expect(result).toEqual({ known: false })
  })

  it('declines when a localStorage value read throws part-way through enumeration', async () => {
    const { result } = await classify({
      localStorage: [localRecord('u1', 'someone@comfy.org')],
      localStorageGetItemThrows: true,
      entries: [authRecord('u1', 'someone@comfy.org')]
    })

    expect(result).toEqual({ known: false })
  })

  it('declines when two localStorage keys claim one uid with DIFFERENT addresses', async () => {
    const { result } = await classify({
      localStorage: [
        [
          'firebase:authUser:apikey:[DEFAULT]',
          JSON.stringify({ uid: 'u1', email: 'someone@example.com', emailVerified: true })
        ],
        [
          'firebase:authUser:apikey:[FORGED]',
          JSON.stringify({ uid: 'u1', email: 'someone@comfy.org', emailVerified: true })
        ]
      ],
      entries: []
    })

    expect(result).toEqual({ known: false })
  })

  it('still answers when two localStorage keys claim one uid and AGREE', async () => {
    const { result } = await classify({
      localStorage: [
        [
          'firebase:authUser:apikey:[DEFAULT]',
          JSON.stringify({ uid: 'u1', email: 'someone@comfy.org', emailVerified: true })
        ],
        [
          'firebase:authUser:apikey:[OTHER]',
          JSON.stringify({ uid: 'u1', email: '  Someone@COMFY.org ', emailVerified: true })
        ]
      ],
      entries: []
    })

    expect(result).toEqual({ known: true, staff: true, userId: 'u1' })
  })

  it('declines when two IndexedDB records claim one uid with different addresses', async () => {
    const { result } = await classify({
      entries: [authRecord('u1', 'someone@example.com'), authRecord('u1', 'someone@comfy.org')]
    })

    expect(result).toEqual({ known: false })
  })

  it('re-reads localStorage before concluding nobody is signed in', async () => {
    const { result } = await classify({
      localStorage: [],
      entries: [],
      localStorageDuringAwait: [localRecord('u1', 'someone@comfy.org')]
    })

    expect(result).toEqual({ known: true, staff: true, userId: 'u1' })
  })

  it('re-reads before concluding even when the database does not exist', async () => {
    const { result } = await classify({
      localStorage: [],
      databases: [],
      localStorageDuringAwait: [localRecord('u1', 'someone@comfy.org')]
    })

    expect(result).toEqual({ known: true, staff: true, userId: 'u1' })
  })

  it('still reports no account when nothing arrives during the read', async () => {
    const { result } = await classify({ localStorage: [], entries: [] })

    expect(result).toEqual({ known: true, staff: false, userId: null })
  })

  it('never consults IndexedDB when localStorage holds a user', async () => {
    const { result } = await classify({
      localStorage: [localRecord('u1', 'someone@comfy.org')],
      entries: [authRecord('u2', 'other@example.com')]
    })

    expect(result).toEqual({ known: true, staff: true, userId: 'u1' })
  })

  it('falls back to IndexedDB only when there is no localStorage at all', async () => {
    const { result } = await classify({
      localStorage: null,
      entries: [authRecord('u1', 'someone@comfy.org')]
    })

    expect(result).toEqual({ known: true, staff: true, userId: 'u1' })
  })

  it('does not assert a sign-out when localStorage is unreadable and IndexedDB is drained', async () => {
    const { result } = await classify({
      localStorage: [],
      localStorageThrows: true,
      entries: []
    })

    expect(result).toEqual({ known: false })
  })

  it('still answers from IndexedDB when localStorage is blocked but a record exists there', async () => {
    const { result } = await classify({
      localStorage: [],
      localStorageThrows: true,
      entries: [authRecord('u1', 'someone@comfy.org')]
    })

    expect(result).toEqual({ known: true, staff: true, userId: 'u1' })
  })

  it('leaves an established grant alone on that same unreadable-storage row', async () => {
    initStaffFlagTargeting()
    await consensusSignedIn([stubContents(true)])
    expect(nextLaunchBinding()).toBe(true)

    await refreshStaffFlagTargeting(
      stubContentsReturning({ known: true, staff: false, userId: null })
    )

    expect(storedFile()).toMatchObject({ staff: true })
    expect(nextLaunchBinding()).toBe(true)
  })

  it('falls back to IndexedDB when localStorage throws, which is not the same as empty', async () => {
    const { result } = await classify({
      localStorage: [],
      localStorageThrows: true,
      entries: [authRecord('u1', 'someone@comfy.org')]
    })

    expect(result).toEqual({ known: true, staff: true, userId: 'u1' })
  })

  it('counts a localStorage record whose uid is __proto__, so the one-account guard holds', async () => {
    const { result } = await classify({
      localStorage: [
        localRecord('real', 'someone@comfy.org'),
        localRecord('__proto__', 'other@example.com')
      ],
      entries: []
    })

    expect(result).toEqual({ known: false })
  })
})
