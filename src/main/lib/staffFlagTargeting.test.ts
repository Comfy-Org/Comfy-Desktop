// Classifying the signed-in account for ops-flag person targeting, and carrying that
// classification to the next launch.
//
// The boot flag evaluation is the only authoritative one, so what matters here is that the
// stored answer is bound BEFORE it and that the stored answer is a boolean and nothing else.
// Whether the property may leave the process is telemetry's gate (`telemetry.test.ts`).
//
// The classification is driven by the reconciled identity, so the consensus is what these tests
// drive. `firebaseAuthIdentity` is stubbed down to the three things this module asks of it —
// the current outcome, a subscription, and which views hold a given account — because the
// reconciliation itself has its own suite and this one should fail for reasons that belong to it.
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
vi.mock('./telemetry', () => ({
  setFlagEvaluationStaff: (isStaff: boolean) => setFlagEvaluationStaff(isStaff)
}))

const identity = vi.hoisted(() => {
  let current: { status: string; userId?: string } = { status: 'unknown' }
  const observers = new Set<(consensus: unknown) => void>()
  const views = new Map<string, Electron.WebContents[]>()
  return {
    current: () => current,
    observers,
    views,
    /** Stand in for `reconcile()` publishing an outcome. Always dispatches: change-only delivery
     *  is the identity engine's contract and is pinned in its own suite. */
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

/** The account every test signs in as unless it is about two of them. */
const USER = 'uid-primary'
const OTHER_USER = 'uid-other'

/** How many times a stub view has actually been asked to classify.
 *
 *  Load-bearing, not bookkeeping. A test that expects a view to be CONSULTED and then asserts only
 *  on the stored classification passes just as happily when the view is never read at all — the
 *  short-circuit for an already-classified account makes exactly that happen. Counting the reads
 *  is what separates "this abstained correctly" from "this was never asked". */
let pageReads = 0

/** A view that CAN classify — it reached an auth store and reached a verdict. */
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

/** A view with NO auth store — it has no opinion about who is signed in. */
function stubContentsWithoutAuthStore(): Electron.WebContents {
  return {
    executeJavaScript: () => {
      pageReads += 1
      return Promise.resolve({ known: false })
    }
  } as unknown as Electron.WebContents
}

/** A view whose read returns something unexpected entirely. */
function stubContentsReturning(result: unknown): Electron.WebContents {
  return {
    executeJavaScript: () => {
      pageReads += 1
      return Promise.resolve(result)
    }
  } as unknown as Electron.WebContents
}

/** Let the page reads a consensus change kicks off settle. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** The whole process agrees this account is signed in, held by these views. */
async function consensusSignedIn(
  holders: Electron.WebContents[],
  userId: string = USER
): Promise<void> {
  identity.publish({ status: 'signed_in', userId }, holders)
  await settle()
}

/** Every contributor resolved and none is signed in. */
async function consensusSignedOut(): Promise<void> {
  identity.publish({ status: 'signed_out' })
  await settle()
}

/** An outcome that is the absence of an answer rather than an answer. */
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

/** What the boot evaluation would be told on the NEXT launch: a fresh process reads the file
 *  this one left behind. */
function nextLaunchBinding(): boolean {
  setFlagEvaluationStaff.mockClear()
  _resetForTest()
  initStaffFlagTargeting()
  return setFlagEvaluationStaff.mock.calls.at(-1)?.[0] as boolean
}

beforeEach(() => {
  testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-targeting-'))
  setFlagEvaluationStaff.mockClear()
  pageReads = 0
  _resetForTest()
  identity.reset()
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(testConfigDir, { recursive: true, force: true })
})

/** Minimal IndexedDB good enough for `CLASSIFY_STAFF_JS`. Handlers are attached after `open()`
 *  returns, exactly as in a browser, so every callback fires on a later microtask. */
function fakeIndexedDB(opts: {
  databases?: { name: string }[]
  stores?: string[]
  entries?: unknown[]
  openOutcome?: 'success' | 'error' | 'blocked' | 'never'
  /** Fires while the IndexedDB read is in flight — the window the script awaits across. */
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
      // The FIRST await the script makes, and the only one on the missing-database path — so this
      // is where "during the IndexedDB round-trip" has to be modelled if both conclusion paths are
      // to be covered. Fires once: a second push would plant a duplicate record, which the
      // contested-uid guard would reject for an unrelated reason.
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

/** A stored Firebase auth record. */
function authRecord(uid: string, email: string | null, emailVerified = true): unknown {
  return { fbase_key: `firebase:authUser:key:${uid}`, value: { uid, email, emailVerified } }
}

/** Run the REAL injected script against a stubbed IndexedDB. */
/** A `localStorage` good enough for the script: length, key(i), getItem(k). `throws` models
 *  blocked site data, where touching the object raises rather than returning nothing. */
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
      // Enumeration succeeded and this one value read fails: the mechanism dying part-way
      // through, which is NOT the same as localStorage being absent.
      if (opts.getItemThrows) throw new Error('site data blocked mid-read')
      return entries.find(([key]) => key === k)?.[1] ?? null
    }
  }
}

async function classify(
  opts: Parameters<typeof fakeIndexedDB>[0] & {
    /** `null` (the default) means NO localStorage persistence, so the IndexedDB fallback runs.
     *  Existing cases pass nothing and therefore keep exercising the fallback unchanged. */
    localStorage?: Array<[string, string]> | null
    localStorageThrows?: boolean
    localStorageGetItemThrows?: boolean
    /** Entries that appear in localStorage WHILE the IndexedDB read is in flight, modelling the
     *  frontend's `setPersistence` moving the record in mid-read. */
    localStorageDuringAwait?: Array<[string, string]>
  }
): Promise<{
  result: { known?: boolean; staff?: boolean; userId?: string | null }
  closed: number
}> {
  // One array, shared with the stub, so a push during the await is visible to the script's
  // SECOND read and not its first — which is the whole point of the interleaving.
  const lsEntries =
    opts.localStorage === undefined || opts.localStorage === null ? null : [...opts.localStorage]
  const { idb, closed } = fakeIndexedDB({
    ...opts,
    onIdbRead: () => {
      if (lsEntries && opts.localStorageDuringAwait) lsEntries.push(...opts.localStorageDuringAwait)
    }
  })
  // Injected as a bare identifier, matching how the script reads it. Passing `undefined` models a
  // context with no localStorage at all, which is what `typeof localStorage === 'undefined'` sees.
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
  // DIAG BRANCH ONLY. The instrumented script adds a `why` branch label to every verdict, which
  // production reads and logs. Every assertion here is an exact `toEqual`, so strip it rather than
  // loosening ~100 assertions to `objectContaining`. This line does not exist on the PR branch.
  if (result && typeof result === 'object') delete (result as { why?: unknown }).why
  return { result, closed: closed.count }
}

/** A stored Firebase user, as localStorage holds it: a JSON string under a prefixed key. */
function localRecord(uid: string, email: string | null, emailVerified = true): [string, string] {
  return [`firebase:authUser:apikey:${uid}`, JSON.stringify({ uid, email, emailVerified })]
}

// The cohort rule lives in the injected script, so it is tested there rather than through a
// main-process stand-in that could agree with a mistake.
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
    // Firebase email/password sign-up accepts any address, so an unverified `@comfy.org` one is
    // self-asserted. Without this check anyone could sign up and enter the cohort.
    const { result } = await classify({ entries: [authRecord('u1', 'someone@comfy.org', false)] })

    expect(result).toEqual({ known: true, staff: false, userId: 'u1' })
  })

  it('reports signed out, for no account, when no auth record exists', async () => {
    const { result } = await classify({ entries: [] })

    expect(result).toEqual({ known: true, staff: false, userId: null })
  })

  it('declines to answer when two accounts are stored', async () => {
    // Taking the first would make the answer depend on iteration order, and a stale record for a
    // former staff account would classify a current non-staff session as staff.
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
      // On a plain object these keys are truthy before any record is seen, so such a record
      // would be skipped, leaving one survivor and passing the "exactly one account" check on
      // a two-account state.
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
    // None of these is evidence of being signed out, so none may vote "not staff".
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
    // Truncating at exactly 256 would let a 300-character uid land on the same string as a
    // different account. One past it fails `normalizePostHogUserId` outright, and nothing
    // unbounded crosses the IPC boundary either way.
    const { result } = await classify({ entries: [authRecord('u'.repeat(300), 'foo@comfy.org')] })

    expect(result.userId).toHaveLength(257)
  })

  it('gives up on an open that never settles, rather than hanging forever', async () => {
    // `executeJavaScript` has no timeout, so without the bounded wait the awaiting main-process
    // promise never settles and leaks a `WebContents` reference per page load.
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
    // A leaked connection blocks a later Firebase `versionchange`.
    const { closed } = await classify({ stores: [] })

    expect(closed).toBe(1)
  })

  it('never returns the address itself', async () => {
    // The privacy claim, pinned at the boundary it is made about.
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
    // The file is user-writable JSON on disk, so every failure mode has to read as "not staff"
    // rather than throwing or granting.
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
    // The whole privacy argument: an address is classified in page context and discarded, so
    // there is no path by which one could reach disk or PostHog.
    await consensusSignedIn([stubContents(true)])

    expect(fs.readFileSync(persistFilePath(), 'utf-8')).not.toContain('someone@comfy.org')
    expect(fs.readFileSync(persistFilePath(), 'utf-8')).not.toContain('comfy.org')
  })

  it('stores only a boolean — never the UID it checked against', async () => {
    // The uid is compared and discarded. It is not part of what the next launch is targeted on,
    // and persisting it would put an account identifier at rest for no purpose.
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
    // The behaviour the whole design exists to produce, end to end across a restart: sign in on
    // one launch, be targeted on the next.
    await consensusSignedIn([stubContents(true)])

    expect(nextLaunchBinding()).toBe(true)
  })

  it('does not target the launch it runs on', async () => {
    // The accepted cost, pinned: the boot evaluation has already gone out by the time the
    // consensus resolves, and this deliberately does not try to redo it.
    expect(nextLaunchBinding()).toBe(false)

    await consensusSignedIn([stubContents(true)])

    expect(storedFile()).toMatchObject({ staff: true })
  })

  it('leaves a non-staff account untargeted, and writes nothing to say so', async () => {
    // An absent file already means "not staff", so the overwhelmingly common case costs no disk
    // write at all. The write that matters is the one that REVOKES, covered below.
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
    // Every resolution reaches here, so "no change" has to cost nothing.
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
    // The common shape, since every navigation takes the consensus through `pending` and back.
    // The account must keep its classification with no gap, and must not depend on a view still
    // being readable by then.
    await consensusSignedIn([stubContents(true)])
    await consensusUnresolved('pending')
    setFlagEvaluationStaff.mockClear()

    await consensusSignedIn([], USER)

    expect(setFlagEvaluationStaff).toHaveBeenLastCalledWith(true)
    expect(nextLaunchBinding()).toBe(true)
  })

  it('revalidates a returning account, because a UID is not a classification', async () => {
    // `staff` comes from `email` and `emailVerified`, both mutable while Firebase keeps reporting
    // the same UID — an address verified mid-session, or one that changes domain. Caching the
    // verdict against the UID alone would make it immutable for the life of the process, which is
    // stricter than the per-view read this replaces: that ran on every `dom-ready` and would have
    // seen the change.
    //
    // Deliberately does NOT call `nextLaunchBinding()` part-way through: that resets the module,
    // which clears the session cache and sends the second resolution down the first-classification
    // path instead of the already-classified short-circuit this test exists to cover. An earlier
    // version did, and passed with the revalidation removed.
    await consensusSignedIn([stubContents(true)])
    expect(storedFile()).toMatchObject({ staff: true })
    await consensusUnresolved('pending')
    pageReads = 0

    await consensusSignedIn([stubContents(false)], USER)

    expect(pageReads).toBeGreaterThan(0)
    expect(storedFile()).toMatchObject({ staff: false })
  })

  it('binds the known answer before revalidating, so a returning account never flaps', async () => {
    // The revalidation is a page read and therefore asynchronous. If the known answer were not
    // bound first, the account would spend that window unclassified.
    await consensusSignedIn([stubContents(true)])
    await consensusUnresolved('pending')
    setFlagEvaluationStaff.mockClear()

    identity.publish({ status: 'signed_in', userId: USER }, [stubContents(true)])

    expect(setFlagEvaluationStaff).toHaveBeenCalledWith(true)
    await settle()
    // The `true` assertion alone does not detect a flap — it still passes if the revalidation
    // emits `false` and then `true`. The mock is cleared before the transition and the known
    // answer is bound synchronously, so no `false` belongs anywhere in this window.
    expect(setFlagEvaluationStaff).not.toHaveBeenCalledWith(false)
  })
})

// The three limitations #1550 shipped with, each of which is the same root cause: a classification
// read from one view's page rather than from the state every view contributes to.
describe('what reading a single view got wrong', () => {
  beforeEach(() => {
    initStaffFlagTargeting()
    setFlagEvaluationStaff.mockClear()
  })

  it('reclassifies on a sign-out that never navigates', async () => {
    // Limitation 1. The old path ran on `dom-ready`, so an in-page sign-out was invisible until
    // the next navigation, reload or launch, and the machine kept presenting as staff across it.
    // The consensus sees it as soon as the view reports, with no navigation involved.
    await consensusSignedIn([stubContents(true)])
    expect(nextLaunchBinding()).toBe(true)

    await consensusSignedOut()

    expect(storedFile()).toMatchObject({ staff: false })
    expect(nextLaunchBinding()).toBe(false)
  })

  it('holds when two views are signed into two accounts, rather than letting one win', async () => {
    // Limitation 2. Per-view reads had no way to reconcile a disagreement, so whichever document
    // loaded last decided. A conflict is not an answer to be raced for — it means this process
    // does not know which account it is serving.
    await consensusSignedIn([stubContents(true)])
    expect(nextLaunchBinding()).toBe(true)

    await consensusUnresolved('conflicted')

    expect(nextLaunchBinding()).toBe(true)
    expect(storedFile()).toMatchObject({ staff: true })
  })

  it('refuses a view that classified an account the process does not agree is signed in', async () => {
    // Limitation 3, to the extent a client CAN fix it. The consensus says one account; this view
    // read another — a stale record, or a different source than the one that reported. Its answer
    // is about somebody else, so it is not a failure to retry but an answer to discard.
    await consensusSignedIn([stubContents(true)])
    expect(nextLaunchBinding()).toBe(true)
    pageReads = 0

    await consensusSignedIn([stubContents(false, { userId: OTHER_USER })], USER)

    // Without this the test passes when the view is never read at all, and the cross-check it is
    // named for never runs.
    expect(pageReads).toBeGreaterThan(0)
    expect(nextLaunchBinding()).toBe(true)
  })

  it('refuses an over-length uid that trimming would sneak under the limit', async () => {
    // `normalizePostHogUserId` trims BEFORE applying its 256-character limit, so a 257-character
    // uid whose last character is whitespace normalizes down to 256 and matches — defeating the
    // page-side cap that exists to reject rather than truncate. The raw length is what is bounded.
    const agreed = 'u'.repeat(256)
    await consensusSignedIn(
      [stubContentsReturning({ known: true, staff: true, userId: agreed + '\n' })],
      agreed
    )

    expect(fs.existsSync(persistFilePath())).toBe(false)
  })

  it('refuses a uid too long for the gate consensus itself applies', async () => {
    // Rejected rather than truncated: a truncated uid could collide with a different account.
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
    // A page read is asynchronous. Without the generation check, an answer about the account that
    // signed out a moment ago would be applied to whoever is signed in now.
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
    // A `dom-ready` retry runs with the CURRENT generation, so it can be in flight alongside the
    // consensus observer's own read for the same one. Both would pass the generation check, and
    // whichever settled last would win — making the verdict a function of page-read latency.
    const slow: { release?: (value: unknown) => void } = {}
    const slowView = {
      executeJavaScript: () =>
        new Promise((resolve) => {
          slow.release = resolve
        })
    } as unknown as Electron.WebContents

    identity.publish({ status: 'signed_in', userId: USER }, [slowView])
    await settle()
    // A second view answers first, for the same outcome. `true` rather than `false` so the
    // accepted answer leaves a file — an absent file is what "not staff" already looks like, so
    // asserting on it would not distinguish "not overwritten" from "never written".
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
    // `publishConsensus` is change-only, so an unchanged `signed_out` is never redelivered — the
    // consensus will not bring this write back on its own. `refreshStaffFlagTargeting` re-applies
    // it on each later `dom-ready`, which is the retry path this test drives; without that, a
    // `writeFileSafe` that threw would leave `staff: true` on disk for every later launch,
    // silently reversing the revocation.
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
    // Re-applying a decision the consensus already took is a write retry. Taking one on a single
    // view's say-so would be a decision, and one view says nothing about the others.
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
    // `executeJavaScript` has no timeout, and the injected script only bounds `indexedDB.open` —
    // `databases()` and `getAll` are unbounded, and a page can replace either with a promise that
    // never settles. Without a main-process bound that one view blocks every view behind it.
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
    // None of these is evidence. Writing on one is how a wrong classification outlives the
    // session that caused it, because whatever lands on disk is what the next boot is targeted on.
    await consensusSignedIn([stubContents(true)])

    await consensusUnresolved(status)

    expect(nextLaunchBinding()).toBe(true)
  })

  it('does not revoke a staff grant when the last window closes', async () => {
    // `unknown`, not `signed_out`. The identity engine rightly detaches telemetry here — an
    // in-memory binding with nobody left to affirm it should stop claiming events — but the same
    // signal must not reach the disk, or quitting the app would revoke the grant.
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
    // Absence of an auth record is not evidence of being signed out. A local install that was
    // never signed into must not clear a classification a signed-in view established — that
    // would be a wrong answer, not merely a racy one.
    await consensusSignedIn([stubContents(true)])
    expect(nextLaunchBinding()).toBe(true)
    pageReads = 0

    await consensusSignedIn([make()])

    // The abstention has to be a decision the view took, not a read that never happened.
    expect(pageReads).toBeGreaterThan(0)
    expect(nextLaunchBinding()).toBe(true)
  })

  it('treats a non-boolean verdict as not staff', async () => {
    // Observed against a stored `true`, so "wrote nothing" cannot pass for "stored false".
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
    // Fire-and-forget; an escaping rejection would be unhandled. A page that cannot be read must
    // not revoke a grant.
    await consensusSignedIn([stubContents(true)])

    await expect(
      refreshStaffFlagTargeting(stubContents(false, { throws: true }))
    ).resolves.toBeUndefined()
    expect(nextLaunchBinding()).toBe(true)
  })
})

// `dom-ready` no longer classifies on its own authority; it offers a freshly loaded view as a
// classifier for an account already agreed on.
describe('refreshStaffFlagTargeting', () => {
  beforeEach(() => {
    initStaffFlagTargeting()
    setFlagEvaluationStaff.mockClear()
  })

  it('classifies when the consensus resolved but nothing could answer for it yet', async () => {
    // The retry path this exists for: the consensus resolved while the views it asked were
    // mid-load or unreadable, and a later view can answer.
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
    // One view loading a document says nothing about the others. The sign-out is a fact about
    // every contributor, and the observer is what acts on it.
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
    // The cache moves only after a successful write. Moving it first would record a write that
    // never landed, and the unchanged-classification check would then suppress every later
    // attempt — leaving the next launch reading the stale value even once the disk recovered.
    //
    // The failure has to be REAL. Removing the config dir does not cause one: `writeFileSafe`
    // recreates the parent (`mkdirSync(dirname, {recursive: true})`), so the write would
    // succeed and this test would pass through the unchanged-classification path having proven
    // nothing. Blocking the staging path with a directory makes the rename fail for real.
    fs.mkdirSync(persistFilePath() + '.tmp', { recursive: true })
    await consensusSignedIn([stubContents(true)])
    expect(fs.existsSync(persistFilePath())).toBe(false)

    // The classification is already known for this account, so the retry must come from
    // re-applying it rather than from asking the page again.
    const executeJavaScript = vi.fn()
    fs.rmSync(persistFilePath() + '.tmp', { recursive: true, force: true })
    await refreshStaffFlagTargeting({ executeJavaScript } as unknown as Electron.WebContents)

    expect(executeJavaScript).not.toHaveBeenCalled()
    expect(storedFile()).toMatchObject({ staff: true })
    expect(nextLaunchBinding()).toBe(true)
  })

  it('keeps writing after an unreadable stored file, rather than assuming not-staff', async () => {
    // An unreadable file is UNKNOWN, not absent. Folding it into `false` would leave the cache
    // disagreeing with a file that may hold `true`, and the unchanged-classification check would
    // then suppress the write a genuine sign-out needs to make.
    fs.writeFileSync(persistFilePath(), JSON.stringify({ staff: true }), 'utf-8')
    fs.chmodSync(persistFilePath(), 0o000)
    // `chmod 000` does not stop root, and does nothing on Windows. Without this the read would
    // succeed, the test would pass down the ordinary path, and the unreadable branch it claims
    // to cover would never run — a test that chmods and nods.
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

// The store the frontend's Firebase SDK actually keeps the session in. It migrates the user into
// the first persistence of the frontend's hierarchy — localStorage — and REMOVES it from the
// others, so reading IndexedDB finds a record the SDK decided to discard, or nothing at all.
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
        // A prefixed key whose value is not parseable. Distinct from the good record's key:
        // localStorage is a map, so two entries cannot share one.
        ['firebase:authUser:apikey:unparseable', 'not json at all'],
        localRecord('u1', 'someone@comfy.org')
      ],
      entries: []
    })

    expect(result).toEqual({ known: true, staff: true, userId: 'u1' })
  })

  it('abstains when localStorage is empty and IndexedDB holds a user', async () => {
    // The ambiguous row, and it is not an edge case: on the frontend Desktop ships, VueFire settles
    // the session in IndexedDB at boot and it moves to localStorage only later, when the auth
    // store runs `setPersistence`. So EVERY boot passes through this state while signed in.
    //
    // It cannot be resolved by reading. Either the record is live (a frontend that persists to
    // IndexedDB, or one mid-boot), or it is one the SDK already discarded. Guessing "signed out"
    // is the expensive direction: that report is trusted and DELETES the loopback binding.
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
    // Same world as the test above - nobody signed in anywhere - reached by a machine where the
    // SDK never created the database. It used to return `{known:false}` from the `databases()`
    // guard while the empty-database case returned a definite "no account", so the verdict
    // depended on whether Firebase had ever run here. The two must agree.
    const { result } = await classify({ localStorage: [], databases: [] })

    expect(result).toEqual({ known: true, staff: false, userId: null })
  })

  it('still declines when the database is missing AND localStorage is unavailable', async () => {
    // The negative control for the test above: with no readable localStorage there is no evidence
    // from either store, so the answer must stay an abstention rather than become "no account".
    const { result } = await classify({ databases: [] })

    expect(result).toEqual({ known: false })
  })

  it('declines when a localStorage value read throws part-way through enumeration', async () => {
    // The authoritative store EXISTS and cannot be finished. IndexedDB here holds a record that
    // would classify as staff, so a fall-through would be visible as `staff: true` - which is
    // exactly the bug this file fixes, reached through a different door.
    const { result } = await classify({
      localStorage: [localRecord('u1', 'someone@comfy.org')],
      localStorageGetItemThrows: true,
      entries: [authRecord('u1', 'someone@comfy.org')]
    })

    expect(result).toEqual({ known: false })
  })

  it('declines when two localStorage keys claim one uid with DIFFERENT addresses', async () => {
    // Two keys, one account, and they disagree about the field the cohort rule reads. Both match
    // the Firebase prefix, so a page-origin script can plant the second one carrying the genuine
    // uid and a forged verified address; de-duplicating by uid and keeping whichever enumerated
    // first would let key order decide staff membership, and main's uid cross-check would pass
    // because the uid is real.
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
    // The control that keeps the rule above from being a blanket "two keys means abstain": a
    // duplicate that says the same thing is not a conflict and must not suppress a real verdict.
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
    // The same conflict on the fallback path, which has always de-duplicated by uid.
    const { result } = await classify({
      entries: [authRecord('u1', 'someone@example.com'), authRecord('u1', 'someone@comfy.org')]
    })

    expect(result).toEqual({ known: false })
  })

  it('re-reads localStorage before concluding nobody is signed in', async () => {
    // THE COLD-BOOT FAILURE, as a unit test. localStorage is read synchronously and is empty;
    // the IndexedDB read takes a round-trip; the frontend's `setPersistence` moves the record INTO
    // localStorage during it; IndexedDB then also reads empty. Composing those two observations
    // asserts "no account anywhere" from a pair that was never simultaneously true. Re-reading
    // finds the record, so the account is classified rather than declared absent.
    const { result } = await classify({
      localStorage: [],
      entries: [],
      localStorageDuringAwait: [localRecord('u1', 'someone@comfy.org')]
    })

    expect(result).toEqual({ known: true, staff: true, userId: 'u1' })
  })

  it('re-reads before concluding even when the database does not exist', async () => {
    // The same straddle on the other conclusion path: `databases()` is awaited too, so a verdict
    // of "no account" there rests on an equally stale read.
    const { result } = await classify({
      localStorage: [],
      databases: [],
      localStorageDuringAwait: [localRecord('u1', 'someone@comfy.org')]
    })

    expect(result).toEqual({ known: true, staff: true, userId: 'u1' })
  })

  it('still reports no account when nothing arrives during the read', async () => {
    // The control that stops the re-read becoming "never conclude anything": with no interleaving,
    // both stores really are empty and the definite answer must survive.
    const { result } = await classify({ localStorage: [], entries: [] })

    expect(result).toEqual({ known: true, staff: false, userId: null })
  })

  it('never consults IndexedDB when localStorage holds a user', async () => {
    // Authoritative in the direction that matters: a stale IndexedDB record cannot override the
    // live one, so a signed-out account cannot come back.
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
    // The row a human reviewer found open on the monitor side. localStorage could not be read, so
    // the store that would hold the session was never consulted; an empty IndexedDB is then not
    // evidence of a sign-out, because on a localStorage-primary frontend it is empty PRECISELY
    // because the SDK drained it.
    //
    // This reader does not reach the destructive path the monitor does — `userId: null` is rejected
    // by `classifyFromView`, so nothing is written and no binding is revoked. The test pins that
    // outcome rather than the mechanism, because the protection currently lives downstream of this
    // return value rather than in it.
    const { result } = await classify({
      localStorage: [],
      localStorageThrows: true,
      entries: []
    })

    expect(result).toEqual({ known: true, staff: false, userId: null })
  })

  it('leaves an established grant alone on that same unreadable-storage row', async () => {
    // The outcome that actually matters: whatever the read returns, a storage failure must not
    // take a grant away. NB this describe is otherwise script-level, so the module needs its
    // observer subscribed before a consensus can classify anything.
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
    // Blocked site data is "I cannot read", not "nothing is stored". Treating it as authoritative
    // would let a storage permission decide the cohort.
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
