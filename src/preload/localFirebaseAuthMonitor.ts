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

/**
 * What localStorage can tell us. Three failure states, not two, because "I cannot read" splits:
 *
 *   `unavailable`  there is NO `localStorage` object at all. The frontend cannot be using it, so
 *                  IndexedDB is the only store and answers alone — this is what keeps legacy
 *                  IndexedDB-primary frontends working.
 *   `unreadable`   the object EXISTS but access threw, at enumeration or on a single key. The
 *                  frontend may well be using it and we simply cannot see it, so nothing is
 *                  asserted in either direction.
 *   `empty`        readable, and holding no Firebase record. A real observation, not a failure.
 *
 * Collapsing `unreadable` into `unavailable` is the defect Codex and CodeRabbit both found: it hands
 * the answer to a store that, on a localStorage-primary frontend, holds only what the SDK's
 * best-effort cleanup failed to delete.
 */
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
    // BLOCKED, NOT ABSENT. The object EXISTS — `typeof` said so one line above — and access threw:
    // blocked site data, or a partitioned context. That is the same epistemic state as a per-key
    // throw below, and must answer the same way. Calling it `unavailable` would let IndexedDB answer
    // alone, and on a localStorage-primary frontend IndexedDB holds at most the copy the SDK's
    // best-effort cleanup left behind — so a stale record would be reported as a DEFINITE signed_in,
    // which is then either believed or becomes a uid mismatch that revokes the binding.
    return { kind: 'unreadable' }
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

/** The SECOND persistence reader, and a live path rather than a legacy one. `observe()` reaches it
 *  when localStorage is READABLE AND EMPTY, or genuinely absent, and `indexedDB` itself is present —
 *  not merely "when localStorage holds no record": an UNREADABLE localStorage abstains before this,
 *  as does an unreadable or absent `indexedDB`.
 *
 *  The readable-and-empty case arises DURING boot on the released frontend, not at the first read
 *  of one: localStorage still holds the previous session's record, so the first polls take the
 *  localStorage path. The SDK's IndexedDB-first migration then drains localStorage, and this reader
 *  answers until the auth store's later `setPersistence` moves the record back.
 *  See `shared/firebaseAuthStorage.ts`. */
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

async function observe(): Promise<ComfyDesktop2FirebaseAuthState> {
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
    // There is no localStorage object at all, so the frontend cannot be using it and IndexedDB is
    // the only store WE read. A record there is the answer and is reported — this is what keeps a
    // legacy IndexedDB-primary frontend working.
    //
    // Its ABSENCE is still not a sign-out, and the reason is not the drained-store one that applies
    // elsewhere: the SDK's persistence hierarchy also includes sessionStorage, which this reader
    // never reads. So "IndexedDB is empty" does not mean "no store holds a user", and asserting a
    // sign-out from it would be trusted, would revoke the loopback binding and would seal the
    // install.
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
  if (recheck.kind === 'records') return stateForUserIds(recheck.userIds)
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
  report: (state: ComfyDesktop2FirebaseAuthState) => void
): (() => void) | null {
  if (!isLoopbackPage()) return null
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
  }
}
