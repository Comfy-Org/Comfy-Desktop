import type { ComfyDesktop2FirebaseAuthState } from '../types/comfyDesktopBridge'

const FIREBASE_DB = 'firebaseLocalStorageDb'
const FIREBASE_STORE = 'firebaseLocalStorage'
const FIREBASE_AUTH_KEY_PREFIX = 'firebase:authUser:'
const POLL_INTERVAL_MS = 1000

function isLoopbackPage(): boolean {
  if (typeof location === 'undefined') return false
  const hostname = location.hostname.toLowerCase()
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname.startsWith('127.')
  )
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

async function openExistingFirebaseDatabase(): Promise<IDBDatabase | null> {
  const databases = await indexedDB.databases()
  if (!databases.some(({ name }) => name === FIREBASE_DB)) return null
  return requestResult(indexedDB.open(FIREBASE_DB))
}

export async function readLocalFirebaseAuthState(): Promise<ComfyDesktop2FirebaseAuthState> {
  try {
    const database = await openExistingFirebaseDatabase()
    if (!database) return { status: 'signed_out' }
    try {
      if (!database.objectStoreNames.contains(FIREBASE_STORE)) {
        return { status: 'signed_out' }
      }
      const transaction = database.transaction(FIREBASE_STORE, 'readonly')
      const entries = (await requestResult(
        transaction.objectStore(FIREBASE_STORE).getAll()
      )) as unknown[]
      const userIds = new Set<string>()
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue
        const candidate = entry as {
          fbase_key?: unknown
          value?: { uid?: unknown }
        }
        if (
          typeof candidate.fbase_key === 'string' &&
          candidate.fbase_key.startsWith(FIREBASE_AUTH_KEY_PREFIX) &&
          typeof candidate.value?.uid === 'string' &&
          candidate.value.uid.length > 0
        ) {
          userIds.add(candidate.value.uid)
        }
      }
      if (userIds.size === 0) return { status: 'signed_out' }
      if (userIds.size > 1) return { status: 'pending' }
      return { status: 'signed_in', userId: [...userIds][0]! }
    } finally {
      database.close()
    }
  } catch {
    return { status: 'pending' }
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
