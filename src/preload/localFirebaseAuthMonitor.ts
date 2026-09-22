import type { ComfyDesktop2FirebaseAuthState } from '../types/comfyDesktopBridge'

const FIREBASE_DB = 'firebaseLocalStorageDb'
const FIREBASE_STORE = 'firebaseLocalStorage'
const FIREBASE_AUTH_KEY_PREFIX = 'firebase:authUser:'
const POLL_INTERVAL_MS = 1000

function isLoopbackPage(): boolean {
  if (typeof location === 'undefined') return false
  const hostname = location.hostname.toLowerCase()
  return hostname === 'localhost' || hostname === '[::1]' || hostname.startsWith('127.')
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/**
 * TEMPORARY DIAGNOSTIC — never for merge.
 *
 * What the store actually looked like, BEFORE it is collapsed into a status. The shipped reader maps
 * three distinct observations onto `signed_out` (no database, no object store, zero records) and two
 * onto `pending` (more than one account, and a failed read), so the log cannot tell apart the cases
 * a fix has to treat differently. This names them; it changes nothing.
 */
export type LocalFirebaseObservation =
  | 'records-one'
  | 'records-many'
  | 'empty'
  | 'unreadable-no-db'
  | 'unreadable-no-store'
  | 'error'

export interface LocalFirebaseRead {
  state: ComfyDesktop2FirebaseAuthState
  observation: LocalFirebaseObservation
}

export async function readLocalFirebaseAuthState(): Promise<LocalFirebaseRead> {
  try {
    const databases = await indexedDB.databases()
    if (!databases.some(({ name }) => name === FIREBASE_DB)) {
      return { state: { status: 'signed_out' }, observation: 'unreadable-no-db' }
    }
    const database = await requestResult(indexedDB.open(FIREBASE_DB))
    try {
      if (!database.objectStoreNames.contains(FIREBASE_STORE)) {
        return { state: { status: 'signed_out' }, observation: 'unreadable-no-store' }
      }
      const transaction = database.transaction(FIREBASE_STORE, 'readonly')
      const entries = (await requestResult(
        transaction.objectStore(FIREBASE_STORE).getAll()
      )) as unknown[]
      const userIds = new Set<string>()
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue
        const candidate = entry as { fbase_key?: unknown; value?: { uid?: unknown } }
        if (
          typeof candidate.fbase_key === 'string' &&
          candidate.fbase_key.startsWith(FIREBASE_AUTH_KEY_PREFIX) &&
          typeof candidate.value?.uid === 'string' &&
          candidate.value.uid.length > 0
        ) {
          userIds.add(candidate.value.uid)
        }
      }
      // Mapping preserved EXACTLY as shipped. Only the label is new.
      if (userIds.size === 0) return { state: { status: 'signed_out' }, observation: 'empty' }
      if (userIds.size > 1) return { state: { status: 'pending' }, observation: 'records-many' }
      return {
        state: { status: 'signed_in', userId: [...userIds][0]! },
        observation: 'records-one'
      }
    } finally {
      database.close()
    }
  } catch {
    return { state: { status: 'pending' }, observation: 'error' }
  }
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
    const read = await readLocalFirebaseAuthState()
    polling = false
    if (stopped) return
    const serialized = JSON.stringify(read.state)
    if (serialized === lastState) return
    lastState = serialized
    // TEMPORARY DIAGNOSTIC: the observation rides the existing report payload because a
    // console.log here reaches only the renderer console, which nothing forwards to the main log.
    // Cast is deliberate and diagnostic-only: the extra field is not part of the bridge type, it
    // survives at runtime, rides the existing IPC, and is read and logged on the MAIN side.
    report({
      ...read.state,
      diagObservation: read.observation
    } as unknown as ComfyDesktop2FirebaseAuthState)
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
