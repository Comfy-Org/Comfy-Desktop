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

function uidFromRecord(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const uid = (value as { uid?: unknown }).uid
  return typeof uid === 'string' && uid.length > 0 ? uid : null
}

/** What localStorage can tell us. `unavailable` is the MECHANISM being gone — no `localStorage`, or
 *  a read that threw — and is deliberately distinct from `empty`: "I cannot read" is not "nothing is
 *  stored", and only the former lets IndexedDB answer on its own. */
type LocalStorageRead =
  | { kind: 'unavailable' }
  | { kind: 'empty' }
  | { kind: 'records'; userIds: Set<string> }

/**
 * The first read. It reports what localStorage HAS and deliberately does not decide: an empty
 * localStorage is ambiguous (see `shared/firebaseAuthStorage.ts`), because at boot the user lives in
 * IndexedDB while localStorage is legitimately empty. Only `readLocalFirebaseAuthState` turns this
 * into a state.
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
      // Enumeration worked but this value read threw: the mechanism failing mid-read, NOT an absent
      // record. Counting it absent would turn a read failure into a verdict. `CLASSIFY_STAFF_JS`
      // lets the same failure reach its outer catch and says nothing; this matches it.
      return { kind: 'unavailable' }
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

/** Not a legacy path. This is where the user lives for the first seconds of every boot, before the
 *  frontend's late `setPersistence` flips to localStorage — and permanently on frontends that never
 *  flip. Drained once the flip happens. */
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

const BOOT_TRACE_INTERVAL_MS = 100
const BOOT_TRACE_DURATION_MS = 5000

/**
 * TEMPORARY DIAGNOSTIC — never for merge. Samples BOTH stores every 100ms for the first 5s of the
 * page: the window the reader rule was argued about for hours and nobody had watched. Runs alongside
 * the normal poll, stops itself, and never reports a state.
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
  // A record in localStorage wins outright: after the flip it is the live store, and any copy left
  // in IndexedDB is the one the SDK discarded.
  if (local.kind === 'records') return stateForUserIds(local.userIds)

  if (typeof indexedDB === 'undefined') {
    // No second store to ask. An empty localStorage is then the whole truth; an unreadable one
    // leaves us with nothing to say.
    return local.kind === 'empty' ? { status: 'signed_out' } : { status: 'pending' }
  }

  const fromIdb = await readFromIndexedDb()
  // Mechanism gone: IndexedDB is the only reader left, so it answers alone.
  if (local.kind === 'unavailable') return fromIdb
  // Readable but empty. If IndexedDB agrees there is no user, the sign-out is real. If it holds one,
  // the stores disagree and we ABSTAIN: reporting `signed_out` here would revoke the loopback
  // binding and seal the install, and reporting `signed_in` would resurrect a possibly stale record.
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
    } finally {
      // Without `finally`, one rejection leaves `polling` true for the life of the page and the
      // monitor goes permanently silent — downstream indistinguishable from a user who never
      // signed in.
      polling = false
    }
    if (stopped) return
    // TEMPORARY DIAGNOSTIC — never for merge. `ls=` plus the status names the row that fired:
    // ls=1 signed_in is the steady state, ls=0 pending is the ABSTAIN row (the boot window), and
    // ls=0 signed_out is both stores agreeing. Emitted EVERY poll, not only on change, because the
    // change-only report is exactly what hid 55 seconds of this last time.
    diag('poll ls=' + String(localAuthKeyCount()) + ' -> ' + state.status)
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
