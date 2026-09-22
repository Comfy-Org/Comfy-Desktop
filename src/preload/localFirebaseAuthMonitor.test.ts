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

  it('ABSTAINS when localStorage is empty but IndexedDB holds a user', async () => {
    // The boot window, and the reason the rule has three outcomes rather than two. Until the
    // frontend's late setPersistence runs, the user lives in IndexedDB and localStorage is
    // legitimately empty. Reporting signed_out here is what revokes the loopback binding and seals
    // the install; reporting signed_in would resurrect a record that may genuinely be stale. The
    // only answer that cannot be wrong is neither.
    installLocalStorage({})
    installIndexedDb([
      { fbase_key: 'firebase:authUser:api-key:[DEFAULT]', value: { uid: 'user-in-idb' } }
    ])

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
  })

  it('reports signed_out only when BOTH stores are empty', async () => {
    // The other half of the same rule: a sign-out is a real answer, but only once the second store
    // has been asked and agrees. Without this case the rule above could be satisfied by never
    // reporting signed_out at all.
    installLocalStorage({})
    installIndexedDb([])

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'signed_out' })
  })

  it('abstains on a malformed localStorage entry rather than trusting IndexedDB', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        'firebase:authUser:api-key:[DEFAULT]': 'not json',
        getItem: () => 'not json'
      }
    })
    installIndexedDb([
      { fbase_key: 'firebase:authUser:api-key:[DEFAULT]', value: { uid: 'maybe-stale' } }
    ])

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
  })

  it('treats a THROWING getItem as the mechanism failing, not as an absent record', async () => {
    // Enumeration succeeds, the value read throws. That is "I cannot read", which must not be
    // rendered as "nothing is stored" — otherwise a storage failure becomes a definite verdict.
    // CLASSIFY_STAFF_JS lets the same failure reach its outer catch and says nothing; this matches.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        'firebase:authUser:api-key:[DEFAULT]': 'unreadable',
        getItem: () => {
          throw new Error('access denied')
        }
      }
    })
    installIndexedDb([
      { fbase_key: 'firebase:authUser:api-key:[DEFAULT]', value: { uid: 'live-user' } }
    ])

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({
      status: 'signed_in',
      userId: 'live-user'
    })
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
