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
 *  through the decision logic: the point is to show what each store held at each instant, including
 *  the states the rule collapses into one answer. Counts only — no uids, no keys. */
function localAuthKeyCount(): number | 'unavailable' {
  try {
    if (typeof localStorage === 'undefined') return 'unavailable'
    return Object.keys(localStorage).filter((key) => key.startsWith(FIREBASE_AUTH_KEY_PREFIX))
      .length
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
      return entries.filter((entry) => {
        if (!entry || typeof entry !== 'object') return false
        const key = (entry as { fbase_key?: unknown }).fbase_key
        return typeof key === 'string' && key.startsWith(FIREBASE_AUTH_KEY_PREFIX)
      }).length
    } finally {
      database.close()
    }
  } catch {
    return 'unavailable'
  }
}

/** TEMPORARY DIAGNOSTIC — never for merge. `entriesTotal` is everything in the store,
 *  `entriesKeyMatched` the `firebase:authUser:*` subset, `entriesUsable` those that parse to a uid.
 *  Separates "no record", "a record that does not match" and "a record we cannot read", which the
 *  status alone collapses into one answer. */
interface DiagEntryCounts {
  total: number
  keyMatched: number
  usable: number
}

function formatCounts(counts: DiagEntryCounts | 'unavailable'): string {
  if (counts === 'unavailable') return 'unavailable'
  return (
    'entriesTotal=' +
    String(counts.total) +
    ' entriesKeyMatched=' +
    String(counts.keyMatched) +
    ' entriesUsable=' +
    String(counts.usable)
  )
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
        // Counted in keyMatched but not usable, which is the distinction this exists to show.
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
        const candidate = entry as { fbase_key?: unknown; value?: unknown }
        if (
          typeof candidate.fbase_key !== 'string' ||
          !candidate.fbase_key.startsWith(FIREBASE_AUTH_KEY_PREFIX)
        ) {
          continue
        }
        keyMatched += 1
        if (uidFromRecord(candidate.value)) usable += 1
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

/**
 * TEMPORARY DIAGNOSTIC — never for merge. Samples BOTH stores every 100ms for the first 5s of the
 * page. Runs alongside the normal poll, stops itself, and never reports a state.
 */
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
      diag('boot t=' + String(elapsed) + 'ms ls=' + String(local) + ' idb=' + String(idb))
    } finally {
      tracing = false
    }
  }
  void tick()
  const interval = setInterval(() => void tick(), BOOT_TRACE_INTERVAL_MS)
  const stopper = setTimeout(() => {
    clearInterval(interval)
    diag('boot trace ended after ' + String(BOOT_TRACE_DURATION_MS) + 'ms')
  }, BOOT_TRACE_DURATION_MS)
  return () => {
    clearInterval(interval)
    clearTimeout(stopper)
  }
}

export async function readLocalFirebaseAuthState(): Promise<ComfyDesktop2FirebaseAuthState> {
  const local = readFromLocalStorage()
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

  const fromIdb = await readFromIndexedDb()
  if (local.kind === 'unavailable') {
    // IndexedDB is the only reader left, but an EMPTY IndexedDB is not evidence of a sign-out. On a
    // localStorage-primary frontend it is empty precisely BECAUSE the SDK drained it, and here the
    // store that would hold the user cannot be read at all. Reporting signed_out on that would be
    // trusted, would revoke the loopback binding and would seal the install — on no evidence. A
    // record here is evidence and is reported; the absence of one is not.
    return fromIdb.status === 'signed_out' ? { status: 'pending' } : fromIdb
  }
  // Readable but empty. If IndexedDB agrees there is no user, the sign-out is real. If it holds one,
  // the stores disagree and we ABSTAIN: `signed_out` here is trusted, revokes the loopback binding
  // and seals the install, and `signed_in` would honour a record that may genuinely be stale.
  return fromIdb.status === 'signed_out' ? { status: 'signed_out' } : { status: 'pending' }
}

/** Report local Firebase persistence because the frontend's own sync is Cloud-only. */
export function startLocalFirebaseAuthMonitor(
  report: (state: ComfyDesktop2FirebaseAuthState) => void,
  diag: (detail: string) => void = () => {}
): (() => void) | null {
  if (!isLoopbackPage()) return null
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
    // TEMPORARY DIAGNOSTIC — never for merge. Emitted EVERY poll, not only on change, because
    // change-only reporting is what hid 55 seconds of this the first time.
    diag('poll ls=' + String(localAuthKeyCount()) + ' -> ' + state.status)
    diag('entries ls ' + formatCounts(countLocalStorageEntries()))
    diag('entries idb ' + formatCounts(await countIdbEntries()))
    const serialized = JSON.stringify(state)
    if (serialized === lastState) return
    lastState = serialized
    report(state)
  }
  report({ status: 'pending' })
  lastState = JSON.stringify({ status: 'pending' })
  void poll()
  const interval = setInterval(() => void poll(), POLL_INTERVAL_MS)
  return () => {
    stopped = true
    clearInterval(interval)
    stopBootTrace()
  }
}
