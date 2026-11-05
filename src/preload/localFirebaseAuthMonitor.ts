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

function stateForUserIds(userIds: Set<string>): ComfyDesktop2FirebaseAuthState {
  if (userIds.size === 0) return { status: 'signed_out' }
  if (userIds.size > 1) return { status: 'pending' }
  return { status: 'signed_in', userId: [...userIds][0]! }
}

const MAX_UID_CHARS = 257

function uidFromRecord(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const uid = (value as { uid?: unknown }).uid
  if (typeof uid !== 'string' || uid.length === 0 || uid.length > MAX_UID_CHARS) return null
  return uid
}

type LocalStorageRead =
  | { kind: 'unavailable' }
  | { kind: 'unreadable' }
  | { kind: 'empty' }
  | { kind: 'records'; userIds: Set<string> }

function readFromLocalStorage(): LocalStorageRead {
  let keys: string[]
  try {
    if (typeof localStorage === 'undefined') return { kind: 'unavailable' }
    keys = Object.keys(localStorage)
  } catch {
    return { kind: 'unreadable' }
  }
  const userIds = new Set<string>()
  for (const key of keys) {
    if (!key.startsWith(FIREBASE_AUTH_KEY_PREFIX)) continue
    let raw: string | null
    try {
      raw = localStorage.getItem(key)
    } catch {
      return { kind: 'unreadable' }
    }
    if (!raw) continue
    try {
      const uid = uidFromRecord(JSON.parse(raw))
      if (uid) userIds.add(uid)
    } catch {}
  }
  return userIds.size === 0 ? { kind: 'empty' } : { kind: 'records', userIds }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

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
  if (local.kind === 'records') return stateForUserIds(local.userIds)

  if (local.kind === 'unreadable') return { status: 'pending' }

  let secondStore: 'present' | 'absent' | 'unreadable'
  try {
    secondStore = typeof indexedDB === 'undefined' ? 'absent' : 'present'
  } catch {
    secondStore = 'unreadable'
  }
  if (secondStore === 'unreadable') return { status: 'pending' }
  if (secondStore === 'absent') {
    return local.kind === 'empty' ? { status: 'signed_out' } : { status: 'pending' }
  }

  const fromIdb = await readFromIndexedDb()
  if (local.kind === 'unavailable') {
    return fromIdb.status === 'signed_out' ? { status: 'pending' } : fromIdb
  }
  if (fromIdb.status !== 'signed_out') return { status: 'pending' }

  const recheck = readFromLocalStorage()
  if (recheck.kind === 'records') return stateForUserIds(recheck.userIds)
  if (recheck.kind !== 'empty') return { status: 'pending' }
  return { status: 'signed_out' }
}

const SIGNED_OUT_SETTLE_MS = 3000

let noRecordSince: number | null = null

export function resetSignedOutSettleForTests(): void {
  noRecordSince = null
}

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
  return now - noRecordSince >= SIGNED_OUT_SETTLE_MS
    ? { status: 'signed_out' }
    : { status: 'pending' }
}

export async function readLocalFirebaseAuthState(): Promise<ComfyDesktop2FirebaseAuthState> {
  return settled(await observe())
}

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
      return
    } finally {
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
