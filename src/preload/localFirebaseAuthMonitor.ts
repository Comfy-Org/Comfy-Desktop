import type { ComfyDesktop2FirebaseAuthState } from '../types/comfyDesktopBridge'
import {
  FIREBASE_AUTH_KEY_PREFIX,
  FIREBASE_IDB_NAME,
  FIREBASE_IDB_STORE
} from '../shared/firebaseAuthStorage'

const POLL_INTERVAL_MS = 1000

function isLoopbackPage(): boolean {
  if (typeof location === 'undefined') return false
  const hostname = location.hostname.toLowerCase()
  return hostname === 'localhost' || hostname === '[::1]' || hostname.startsWith('127.')
}

/** A signed-in state derived from however many distinct uids a persistence holds. Shared shape so
 *  both persistences answer by the same predicate: one uid is a user, several is unresolved, none is
 *  a real sign-out. */
function stateForUserIds(userIds: Set<string>): ComfyDesktop2FirebaseAuthState {
  if (userIds.size === 0) return { status: 'signed_out' }
  if (userIds.size > 1) return { status: 'pending' }
  return { status: 'signed_in', userId: [...userIds][0]! }
}

/** One over main's own limit, so an over-long uid is rejected HERE rather than crossing IPC to be
 *  rejected there. `normalizePostHogUserId` in main remains the real validator; this only bounds
 *  what a page can push through the bridge, since the record is entirely page-controlled. */
const MAX_UID_CHARS = 257

function uidFromRecord(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const uid = (value as { uid?: unknown }).uid
  if (typeof uid !== 'string' || uid.length === 0 || uid.length > MAX_UID_CHARS) return null
  return uid
}

/** What localStorage can tell us. `unavailable` is the MECHANISM being gone — no `localStorage`, or
 *  a read that threw — and is deliberately distinct from `empty`: "I cannot read" is not "nothing is
 *  stored", and only the former lets IndexedDB answer on its own. */
type LocalStorageRead =
  | { kind: 'unavailable' }
  | { kind: 'unreadable' }
  | { kind: 'empty' }
  | { kind: 'records'; userIds: Set<string> }

/**
 * The first read. It reports what localStorage HAS and deliberately does not decide: an empty
 * localStorage is ambiguous (see `shared/firebaseAuthStorage.ts`), because our own sign-in injection
 * writes the record to IndexedDB only, and on the shipped frontend the user also lives there for the
 * first seconds of a page. Only `readLocalFirebaseAuthState` turns this into a state.
 */
function readFromLocalStorage(): LocalStorageRead {
  let keys: string[]
  try {
    if (typeof localStorage === 'undefined') return { kind: 'unavailable' }
    keys = Object.keys(localStorage)
  } catch {
    // Blocked storage, or a partitioned context that throws on access.
    return { kind: 'unavailable' }
  }
  const userIds = new Set<string>()
  for (const key of keys) {
    if (!key.startsWith(FIREBASE_AUTH_KEY_PREFIX)) continue
    let raw: string | null
    try {
      raw = localStorage.getItem(key)
    } catch {
      // Enumeration worked and this key MATCHES the Firebase prefix, but reading its value threw.
      // Distinct from `unavailable`: localStorage holds Firebase keys we cannot read, so it is
      // almost certainly the store in use and IndexedDB is drained — a record there would be the
      // stale copy. Not provably so, because the SDK's clearing of other persistences is
      // best-effort ("ignore errors"), so a stale localStorage key can survive on a frontend that
      // keeps the user in IndexedDB. The cost of abstaining in that case is a `pending` instead of
      // a `signed_in`, on an install needing four conditions at once, which is the safe direction.
      return { kind: 'unreadable' }
    }
    if (!raw) continue
    try {
      const uid = uidFromRecord(JSON.parse(raw))
      if (uid) userIds.add(uid)
    } catch {
      // A malformed entry is not a mechanism failure. Skip it; the remaining keys still answer.
    }
  }
  return userIds.size === 0 ? { kind: 'empty' } : { kind: 'records', userIds }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/** Legacy path, for frontends old enough to still persist here. Unreachable on any frontend that
 *  lists `browserLocalPersistence`, which every version since #3514 (2025-04) does. */
async function readFromIndexedDb(): Promise<ComfyDesktop2FirebaseAuthState> {
  try {
    const databases = await indexedDB.databases()
    if (!databases.some(({ name }) => name === FIREBASE_IDB_NAME)) return { status: 'signed_out' }
    const database = await requestResult(indexedDB.open(FIREBASE_IDB_NAME))
    try {
      if (!database.objectStoreNames.contains(FIREBASE_IDB_STORE)) return { status: 'signed_out' }
      const transaction = database.transaction(FIREBASE_IDB_STORE, 'readonly')
      const entries = (await requestResult(
        transaction.objectStore(FIREBASE_IDB_STORE).getAll()
      )) as unknown[]
      const userIds = new Set<string>()
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue
        const candidate = entry as { fbase_key?: unknown; value?: unknown }
        if (
          typeof candidate.fbase_key !== 'string' ||
          !candidate.fbase_key.startsWith(FIREBASE_AUTH_KEY_PREFIX)
        ) {
          continue
        }
        const uid = uidFromRecord(candidate.value)
        if (uid) userIds.add(uid)
      }
      return stateForUserIds(userIds)
    } finally {
      database.close()
    }
  } catch {
    return { status: 'pending' }
  }
}

/** TEMPORARY DIAGNOSTIC — never for merge. Raw COUNTS from each store, deliberately NOT routed
 *  through the decision logic. Counts only — no uids, no keys. */
function localAuthKeyCount(): number | 'unavailable' {
  try {
    if (typeof localStorage === 'undefined') return 'unavailable'
    return Object.keys(localStorage).filter((k) => k.startsWith(FIREBASE_AUTH_KEY_PREFIX)).length
  } catch {
    return 'unavailable'
  }
}

/** TEMPORARY DIAGNOSTIC — never for merge. */
async function idbAuthKeyCount(): Promise<number | 'unavailable'> {
  try {
    if (typeof indexedDB === 'undefined') return 'unavailable'
    const databases = await indexedDB.databases()
    if (!databases.some(({ name }) => name === FIREBASE_IDB_NAME)) return 0
    const database = await requestResult(indexedDB.open(FIREBASE_IDB_NAME))
    try {
      if (!database.objectStoreNames.contains(FIREBASE_IDB_STORE)) return 0
      const entries = (await requestResult(
        database
          .transaction(FIREBASE_IDB_STORE, 'readonly')
          .objectStore(FIREBASE_IDB_STORE)
          .getAll()
      )) as unknown[]
      return entries.filter((e) => {
        if (!e || typeof e !== 'object') return false
        const k = (e as { fbase_key?: unknown }).fbase_key
        return typeof k === 'string' && k.startsWith(FIREBASE_AUTH_KEY_PREFIX)
      }).length
    } finally {
      database.close()
    }
  } catch {
    return 'unavailable'
  }
}

/** TEMPORARY DIAGNOSTIC — never for merge. Separates "no record", "a record that does not match" and
 *  "a record we cannot read", which the status alone collapses into one answer. */
interface DiagEntryCounts {
  total: number
  keyMatched: number
  usable: number
}

function formatCounts(c: DiagEntryCounts | 'unavailable'): string {
  if (c === 'unavailable') return 'unavailable'
  return `entriesTotal=${c.total} entriesKeyMatched=${c.keyMatched} entriesUsable=${c.usable}`
}

function countLocalStorageEntries(): DiagEntryCounts | 'unavailable' {
  try {
    if (typeof localStorage === 'undefined') return 'unavailable'
    const keys = Object.keys(localStorage)
    let keyMatched = 0
    let usable = 0
    for (const key of keys) {
      if (!key.startsWith(FIREBASE_AUTH_KEY_PREFIX)) continue
      keyMatched += 1
      try {
        const raw = localStorage.getItem(key)
        if (raw && uidFromRecord(JSON.parse(raw))) usable += 1
      } catch {
        // keyMatched but not usable — the distinction this exists to show.
      }
    }
    return { total: keys.length, keyMatched, usable }
  } catch {
    return 'unavailable'
  }
}

async function countIdbEntries(): Promise<DiagEntryCounts | 'unavailable'> {
  try {
    if (typeof indexedDB === 'undefined') return 'unavailable'
    const databases = await indexedDB.databases()
    if (!databases.some(({ name }) => name === FIREBASE_IDB_NAME)) {
      return { total: 0, keyMatched: 0, usable: 0 }
    }
    const database = await requestResult(indexedDB.open(FIREBASE_IDB_NAME))
    try {
      if (!database.objectStoreNames.contains(FIREBASE_IDB_STORE)) {
        return { total: 0, keyMatched: 0, usable: 0 }
      }
      const entries = (await requestResult(
        database
          .transaction(FIREBASE_IDB_STORE, 'readonly')
          .objectStore(FIREBASE_IDB_STORE)
          .getAll()
      )) as unknown[]
      let keyMatched = 0
      let usable = 0
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue
        const c = entry as { fbase_key?: unknown; value?: unknown }
        if (typeof c.fbase_key !== 'string' || !c.fbase_key.startsWith(FIREBASE_AUTH_KEY_PREFIX)) {
          continue
        }
        keyMatched += 1
        if (uidFromRecord(c.value)) usable += 1
      }
      return { total: entries.length, keyMatched, usable }
    } finally {
      database.close()
    }
  } catch {
    return 'unavailable'
  }
}

const BOOT_TRACE_INTERVAL_MS = 100
const BOOT_TRACE_DURATION_MS = 5000

/** TEMPORARY DIAGNOSTIC — never for merge. Samples BOTH stores every 100ms for the first 5s, runs
 *  alongside the decision poll, stops itself, and never reports a state. */
function startBootTrace(diag: (detail: string) => void): () => void {
  const started = Date.now()
  let tracing = false
  const tick = async (): Promise<void> => {
    if (tracing) return
    tracing = true
    try {
      const elapsed = Date.now() - started
      const local = localAuthKeyCount()
      const idb = await idbAuthKeyCount()
      diag(`boot t=${String(elapsed)}ms ls=${String(local)} idb=${String(idb)}`)
    } finally {
      tracing = false
    }
  }
  void tick()
  const interval = setInterval(() => void tick(), BOOT_TRACE_INTERVAL_MS)
  const stopper = setTimeout(() => {
    clearInterval(interval)
    diag(`boot trace ended after ${String(BOOT_TRACE_DURATION_MS)}ms`)
  }, BOOT_TRACE_DURATION_MS)
  return () => {
    clearInterval(interval)
    clearTimeout(stopper)
  }
}

/** TEMPORARY DIAGNOSTIC — never for merge. The DECISION poll, not just the trace, runs fast for the
 *  first 10s so the run samples the ~45ms IndexedDB-read window the TOCTOU lives in. `poll()` skips
 *  while one is in flight, so these coalesce into BACK-TO-BACK reads rather than overlapping ones:
 *  near-continuous coverage, and it PROVOKES the condition instead of avoiding it, which is the
 *  point — we are here to watch the re-read rescue it. */
const BOOT_FAST_POLL_MS = 25
const BOOT_FAST_POLL_DURATION_MS = 10_000

/**
 * TEMPORARY DIAGNOSTIC — never for merge. INSTRUMENT, NOT PRODUCT.
 *
 * Widens the reader's own exposure window to a KNOWN quantity. The race is between our localStorage
 * read and our IndexedDB read: the frontend's `setPersistence` deletes the record from IndexedDB and
 * then writes it to localStorage, so a poll whose LS read predates that write and whose IDB read
 * follows that delete composes two observations that were never simultaneously true.
 *
 * The natural gap is the IndexedDB round-trip, whose width we have never actually measured — the
 * ~45ms we reasoned from came from two DIAG re-read lines emitted after the decision, not from this
 * path. Sampling an unmeasured window more often cannot be reasoned about; setting it to 150ms can.
 *
 * Placed immediately before the IndexedDB read, NOT after the localStorage read, so the early-return
 * paths that never touch IndexedDB are not delayed. A hit under this delay proves the re-read
 * CORRECTS the race; it says nothing about how often the race occurs naturally.
 */
const DIAG_LS_IDB_DELAY_MS = 150

function diagDelayBeforeIdbRead(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, DIAG_LS_IDB_DELAY_MS))
}

/** TEMPORARY DIAGNOSTIC — never for merge. The observation path deliberately holds no reference to
 *  the reporting path's diag callback: that separation is what makes "clear the settle timer from
 *  the report path" unexpressible. This module-level sink is the diagnostic-build concession that
 *  lets `observe()` announce the re-read firing, and it exists only on this throwaway branch. */
let diagSink: (detail: string) => void = () => {}

async function observe(): Promise<ComfyDesktop2FirebaseAuthState> {
  const local = readFromLocalStorage()
  // TEMPORARY DIAGNOSTIC — never for merge. The instant the race is measured from.
  const decisionStartedAt = Date.now()
  // A record in localStorage wins outright: it is the store the session settles in, and any copy
  // left in IndexedDB is one the SDK discarded — so a signed-out account cannot come back.
  if (local.kind === 'records') return stateForUserIds(local.userIds)

  // localStorage has keys we could not read. IndexedDB must NOT answer here: it is drained because
  // localStorage is the store in use, so a record there is the stale copy and its absence is not a
  // sign-out either. Neither direction is evidence, so neither is asserted.
  if (local.kind === 'unreadable') return { status: 'pending' }

  // `typeof` does not protect a throwing accessor — it only suppresses ReferenceError for an
  // unresolvable binding — and this getter throws SecurityError in a partitioned context. Without
  // the catch that escapes the whole function, skipping the report for the tick.
  //
  // ABSENT and UNREADABLE are then distinguished for the same reason they are on the localStorage
  // side: a store that cannot be consulted has told us nothing, and "both stores are empty" is only
  // a sign-out if both were actually asked.
  let secondStore: 'present' | 'absent' | 'unreadable'
  try {
    secondStore = typeof indexedDB === 'undefined' ? 'absent' : 'present'
  } catch {
    secondStore = 'unreadable'
  }
  if (secondStore === 'unreadable') return { status: 'pending' }
  if (secondStore === 'absent') {
    // There is genuinely no second store, so an empty localStorage is the whole truth. An
    // unreadable one leaves us with nothing to say.
    return local.kind === 'empty' ? { status: 'signed_out' } : { status: 'pending' }
  }

  await diagDelayBeforeIdbRead()
  const fromIdb = await readFromIndexedDb()
  // TEMPORARY DIAGNOSTIC — never for merge. THE MEASUREMENT WE HAVE INFERRED THREE TIMES AND NEVER
  // TAKEN: the width of the reader's own exposure window, from the localStorage read to the
  // IndexedDB read resolving. Every earlier figure came from the `entries` re-read lines, which are
  // emitted AFTER the decision and measure a different pair of reads entirely.
  //
  // This INCLUDES the injected delay, so the natural window is recoverable by subtraction:
  // natural ~= (decision gap) - DIAG_LS_IDB_DELAY_MS. That is the number nobody has ever had.
  diagSink(`decision gap ms=${String(Date.now() - decisionStartedAt)}`)
  if (local.kind === 'unavailable') {
    // IndexedDB is the only reader left, but an EMPTY IndexedDB is not evidence of a sign-out. On a
    // localStorage-primary frontend it is empty precisely BECAUSE the SDK drained it, and here the
    // store that would hold the user cannot be read at all. Reporting signed_out on that would be
    // trusted, would revoke the loopback binding and would seal the install — on no evidence. A
    // record here is evidence and is reported; the absence of one is not.
    return fromIdb.status === 'signed_out' ? { status: 'pending' } : fromIdb
  }
  // IndexedDB holds a user, or could not say. Either way the stores do not agree that there is
  // nobody, so ABSTAIN: `signed_out` here is trusted, revokes the loopback binding and seals the
  // install, and `signed_in` would honour a record that may genuinely be stale.
  if (fromIdb.status !== 'signed_out') return { status: 'pending' }

  // BOTH READS SAY NOTHING — but they were taken at DIFFERENT INSTANTS. `local` is synchronous and
  // was read before the IndexedDB round-trip, which takes tens of milliseconds, and the frontend's
  // `setPersistence` moves the record INTO localStorage. Composing the two would assert "both empty"
  // from observations that were never simultaneously true: exactly the cold-boot failure, where a
  // complete 100ms trace of the whole boot contained no both-empty sample at all and the reader
  // reported one anyway. Re-read localStorage — it is synchronous, so this costs one read and delays
  // nothing. This is the PRIMARY fix for that failure; the settle below is the backstop for the
  // genuinely narrow instant inside `setPersistence`, which is a different cause.
  const recheck = readFromLocalStorage()
  if (recheck.kind === 'records') {
    // TEMPORARY DIAGNOSTIC — never for merge. THE line the re-run exists to see. Its presence proves
    // the window was sampled AND the fix fired; its absence means the window was never sampled, which
    // is INCONCLUSIVE rather than a pass, because a clean log looks identical either way.
    diagSink('reread rescued signed_in (localStorage gained the record during the IndexedDB read)')
    return stateForUserIds(recheck.userIds)
  }
  if (recheck.kind !== 'empty') return { status: 'pending' }
  return { status: 'signed_out' }
}

/**
 * How long "no record in either store" must PERSIST before it is a sign-out.
 *
 * NOT A MEASURED VALUE, and there is nothing to measure it against: the window it guards has never
 * been observed. An earlier ~8ms figure was inferred from two timestamps in a CURATED log excerpt
 * and is withdrawn — the complete log showed no both-empty sample at all. 3000ms was chosen because
 * the asymmetry is lopsided: being wrong toward "revokes three seconds later" costs nothing, being wrong
 * toward "still seals the install" costs the install. Do not tune this down on the assumption it was
 * derived from data.
 *
 * WALL-CLOCK, deliberately, not a count of polls. The poll runs at 1s only while the view is
 * VISIBLE; install views are toggled with `setVisible(false)` and nothing sets
 * `backgroundThrottling`, so a hidden view polls roughly once a minute and "three polls" would mean
 * three minutes.
 */
const SIGNED_OUT_SETTLE_MS = 3000

/**
 * When the current run of "no record anywhere" was first observed, or null if the last observation
 * found something. Lives HERE, in the observation path, and `poll()` holds no reference to it — so
 * the tempting bug of clearing it from the reporting path is not expressible. That matters because
 * an unsettled sign-out and the stores-disagree row both serialise to `pending`, so a transition
 * between them emits NO report at all: a reset keyed on the reported state would never fire on
 * exactly the transition that must clear it.
 */
let noRecordSince: number | null = null

/** TEST ONLY. Module state has to be cleared between cases or they become order-dependent — the
 *  same hazard as restoring a global by assignment. Named honestly rather than hidden behind
 *  something clever. */
export function resetSignedOutSettleForTests(): void {
  noRecordSince = null
}

/**
 * The one place a `signed_out` verdict can be produced, so the settle cannot be bypassed and
 * "anything else clears the timer" is structural rather than repeated at each return.
 *
 * WHY: `PersistenceUserManager.setPersistence` (@firebase/auth 1.10.8) REMOVES from the old store
 * and only then WRITES to the new one — `await this.removeCurrentUser()`, then
 * `this.setCurrentUser(...)` — so for the duration of that write the user is in NEITHER store.
 *
 * THIS INSTANT HAS NEVER BEEN OBSERVED. The cold boot that prompted this work was a DIFFERENT bug —
 * the reader composing two reads taken at different instants, fixed by the localStorage re-read in
 * `observe()` — and a complete 100ms trace of that entire boot contained no both-empty sample. So
 * this gate rests on reading the SDK, not on measurement, which is exactly why it is the backstop
 * and not the primary fix.
 *
 * The boot migration is the OPPOSITE order (`create()` writes the new store before removing the
 * others), so it never presents this state. One hazard, one gate.
 */
function settled(state: ComfyDesktop2FirebaseAuthState): ComfyDesktop2FirebaseAuthState {
  if (state.status !== 'signed_out') {
    noRecordSince = null
    return state
  }
  const now = Date.now()
  if (noRecordSince === null) {
    noRecordSince = now
    return { status: 'pending' }
  }
  // A clock stepped backwards yields a negative elapsed, which never satisfies this — pending, the
  // safe direction. A suspend/resume yields a huge elapsed, which is correct: no polls ran while
  // suspended, so the first poll afterwards is looking at a settled state.
  return now - noRecordSince >= SIGNED_OUT_SETTLE_MS
    ? { status: 'signed_out' }
    : { status: 'pending' }
}

export async function readLocalFirebaseAuthState(): Promise<ComfyDesktop2FirebaseAuthState> {
  return settled(await observe())
}

/** Report local Firebase persistence because the frontend's own sync is Cloud-only. */
export function startLocalFirebaseAuthMonitor(
  report: (state: ComfyDesktop2FirebaseAuthState) => void,
  diag: (detail: string) => void = () => {}
): (() => void) | null {
  if (!isLoopbackPage()) return null
  diagSink = diag
  diag(
    `DIAG DELAY ${String(DIAG_LS_IDB_DELAY_MS)}ms between LS and IDB reads (instrument, not product)`
  )
  const stopBootTrace = startBootTrace(diag)
  let lastState = ''
  let stopped = false
  let polling = false
  const poll = async (): Promise<void> => {
    if (stopped || polling) return
    polling = true
    let state: ComfyDesktop2FirebaseAuthState
    try {
      state = await readLocalFirebaseAuthState()
    } catch {
      // A rejection here would escape `void poll()` as an unhandled rejection on every tick. Say
      // nothing rather than guess: the last reported state stands until a poll can answer.
      return
    } finally {
      // Without `finally`, one rejection leaves `polling` true for the life of the page and the
      // monitor goes permanently silent — downstream indistinguishable from a user who never
      // signed in.
      polling = false
    }
    if (stopped) return
    // TEMPORARY DIAGNOSTIC — never for merge. Every poll, not only on change.
    diag(`poll ls=${String(localAuthKeyCount())} -> ${state.status}`)
    diag(`entries ls ${formatCounts(countLocalStorageEntries())}`)
    diag(`entries idb ${formatCounts(await countIdbEntries())}`)
    const serialized = JSON.stringify(state)
    if (serialized === lastState) return
    lastState = serialized
    report(state)
  }
  report({ status: 'pending' })
  lastState = JSON.stringify({ status: 'pending' })
  void poll()
  let interval = setInterval(() => void poll(), BOOT_FAST_POLL_MS)
  const slowDown = setTimeout(() => {
    clearInterval(interval)
    diag(`decision poll dropping to ${String(POLL_INTERVAL_MS)}ms`)
    interval = setInterval(() => void poll(), POLL_INTERVAL_MS)
  }, BOOT_FAST_POLL_DURATION_MS)
  return () => {
    stopped = true
    clearInterval(interval)
    clearTimeout(slowDown)
    stopBootTrace()
  }
}
