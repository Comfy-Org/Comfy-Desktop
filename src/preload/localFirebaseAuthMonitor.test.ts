import { afterEach, describe, expect, it } from 'vitest'
import { readLocalFirebaseAuthState } from './localFirebaseAuthMonitor'

const originalIndexedDb = globalThis.indexedDB
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

/** localStorage holding the given `firebase:authUser:*` records. */
function installLocalStorage(records: Record<string, unknown>): void {
  const store: Record<string, string> = {}
  for (const [key, value] of Object.entries(records)) store[key] = JSON.stringify(value)
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store[key] ?? null,
      ...store
    }
  })
}

/** The ONLY thing that licenses the IndexedDB fallback: the mechanism is absent. */
function removeLocalStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined })
}

/** Present but throwing — a blocked or partitioned context. Also counts as unavailable. */
function installThrowingLocalStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('access denied')
    }
  })
}

function successfulRequest<T>(result: T): IDBRequest<T> {
  const request = { result } as IDBRequest<T>
  queueMicrotask(() => request.onsuccess?.(new Event('success')))
  return request
}

function installIndexedDb(entries: unknown[] | null): void {
  const database = {
    close: () => {},
    objectStoreNames: { contains: () => entries !== null },
    transaction: () => ({
      objectStore: () => ({
        getAll: () => successfulRequest(entries ?? [])
      })
    })
  } as unknown as IDBDatabase
  globalThis.indexedDB = {
    databases: async () => (entries === null ? [] : [{ name: 'firebaseLocalStorageDb' }]),
    open: () => successfulRequest(database)
  } as unknown as IDBFactory
}

afterEach(() => {
  globalThis.indexedDB = originalIndexedDb
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('local Firebase auth monitor', () => {
  it('reports the single user from localStorage, which the SDK migrates it into', async () => {
    installLocalStorage({ 'firebase:authUser:api-key:[DEFAULT]': { uid: 'firebase-user' } })
    installIndexedDb(null)

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({
      status: 'signed_in',
      userId: 'firebase-user'
    })
  })

  it('is pending when localStorage holds two accounts', async () => {
    installLocalStorage({
      'firebase:authUser:a:[DEFAULT]': { uid: 'user-a' },
      'firebase:authUser:b:[DEFAULT]': { uid: 'user-b' }
    })

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
  })

  it('IGNORES an IndexedDB record when localStorage is readable and empty', async () => {
    // The whole fix. The SDK deletes the key from non-primary persistences, so a record still in
    // IndexedDB is one Firebase DISCARDED — honouring it resurrects a signed-out account. An empty
    // localStorage is an answer, not a reason to look elsewhere.
    installLocalStorage({})
    installIndexedDb([
      { fbase_key: 'firebase:authUser:api-key:[DEFAULT]', value: { uid: 'stale-ghost' } }
    ])

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'signed_out' })
  })

  it('skips a malformed localStorage entry without falling through to IndexedDB', async () => {
    installLocalStorage({})
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        'firebase:authUser:api-key:[DEFAULT]': 'not json',
        getItem: () => 'not json'
      }
    })
    installIndexedDb([
      { fbase_key: 'firebase:authUser:api-key:[DEFAULT]', value: { uid: 'stale-ghost' } }
    ])

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'signed_out' })
  })

  it.each([
    ['localStorage is absent', removeLocalStorage],
    ['localStorage access throws', installThrowingLocalStorage]
  ])('falls back to IndexedDB only when %s', async (_label, breakStorage) => {
    breakStorage()
    installIndexedDb([
      { fbase_key: 'firebase:authUser:api-key:[DEFAULT]', value: { uid: 'legacy-user' } }
    ])

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({
      status: 'signed_in',
      userId: 'legacy-user'
    })
  })

  it('legacy: reports the single persisted Firebase user', async () => {
    removeLocalStorage()
    installIndexedDb([
      {
        fbase_key: 'firebase:authUser:api-key:[DEFAULT]',
        value: { uid: 'firebase-user' }
      }
    ])

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({
      status: 'signed_in',
      userId: 'firebase-user'
    })
  })

  it('legacy: fails pending when multiple Firebase projects disagree', async () => {
    removeLocalStorage()
    installIndexedDb([
      { fbase_key: 'firebase:authUser:a:[DEFAULT]', value: { uid: 'user-a' } },
      { fbase_key: 'firebase:authUser:b:[DEFAULT]', value: { uid: 'user-b' } }
    ])

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
  })

  it('legacy: reports signed out without Firebase persistence', async () => {
    removeLocalStorage()
    installIndexedDb(null)

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'signed_out' })
  })
})
