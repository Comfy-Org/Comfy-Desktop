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

/**
 * The authoritative read. `'unavailable'` means the MECHANISM is missing — no `localStorage`, or
 * access threw — and is the ONLY thing that licenses falling back to IndexedDB.
 *
 * An empty localStorage returns `signed_out`, deliberately. See the rule in
 * `shared/firebaseAuthStorage.ts`: the SDK deletes the key from non-primary persistences, so a
 * record still sitting in IndexedDB is one Firebase discarded, and honouring it would resurrect a
 * signed-out account.
 */
function readFromLocalStorage(): ComfyDesktop2FirebaseAuthState | 'unavailable' {
  let keys: string[]
  try {
    if (typeof localStorage === 'undefined') return 'unavailable'
    keys = Object.keys(localStorage)
  } catch {
    // Blocked storage, or a partitioned context that throws on access.
    return 'unavailable'
  }
  const userIds = new Set<string>()
  for (const key of keys) {
    if (!key.startsWith(FIREBASE_AUTH_KEY_PREFIX)) continue
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const uid = uidFromRecord(JSON.parse(raw))
      if (uid) userIds.add(uid)
    } catch {
      // A malformed entry is not evidence the mechanism is unavailable, so it must NOT fall through
      // to the drained store. Skip it and let the remaining keys answer.
    }
  }
  return stateForUserIds(userIds)
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

export async function readLocalFirebaseAuthState(): Promise<ComfyDesktop2FirebaseAuthState> {
  const authoritative = readFromLocalStorage()
  if (authoritative !== 'unavailable') return authoritative
  if (typeof indexedDB === 'undefined') return { status: 'pending' }
  return readFromIndexedDb()
}

/** Report local Firebase persistence because the frontend's own sync is Cloud-only. */
export function startLocalFirebaseAuthMonitor(
  report: (state: ComfyDesktop2FirebaseAuthState) => void
): (() => void) | null {
  if (!isLoopbackPage() || typeof indexedDB === 'undefined') return null
  let lastState = ''
  let stopped = false
  let polling = false
  const poll = async (): Promise<void> => {
    if (stopped || polling) return
    polling = true
    const state = await readLocalFirebaseAuthState()
    polling = false
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
