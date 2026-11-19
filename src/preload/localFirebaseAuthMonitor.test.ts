import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readLocalFirebaseAuthState,
  resetSignedOutSettleForTests
} from './localFirebaseAuthMonitor'

const originalIndexedDb = globalThis.indexedDB
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

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

function removeLocalStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined })
}

function installThrowingLocalStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('access denied')
    }
  })
}

function installThrowingGetItem(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      'firebase:authUser:api-key:[DEFAULT]': 'unreadable',
      getItem: () => {
        throw new Error('access denied')
      }
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

let clock = 0
function at(ms: number): void {
  clock = ms
}

beforeEach(() => {
  clock = 0
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
})

type IdbShape = 'store-empty' | 'no-database' | 'database-without-store'

function installIndexedDbMovingRecord(shape: IdbShape, duringFirstAwait: () => void): void {
  const database = {
    close: () => {},
    objectStoreNames: { contains: () => shape !== 'database-without-store' },
    transaction: () => ({
      objectStore: () => ({ getAll: () => successfulRequest([]) })
    })
  } as unknown as IDBDatabase
  let fired = false
  globalThis.indexedDB = {
    databases: async () => {
      if (!fired) {
        fired = true
        duringFirstAwait()
      }
      return shape === 'no-database' ? [] : [{ name: 'firebaseLocalStorageDb' }]
    },
    open: () => successfulRequest(database)
  } as unknown as IDBFactory
}

afterEach(() => {
  vi.restoreAllMocks()
  resetSignedOutSettleForTests()
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: originalIndexedDb
  })
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
    installLocalStorage({})
    installIndexedDb([
      { fbase_key: 'firebase:authUser:api-key:[DEFAULT]', value: { uid: 'user-in-idb' } }
    ])

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
  })

  it('reports signed_out when BOTH stores are empty, once it has SETTLED', async () => {
    installLocalStorage({})
    installIndexedDb([])

    at(0)
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
    at(3000)
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
      { fbase_key: 'firebase:authUser:api-key:[DEFAULT]', value: { uid: 'stale-ghost' } }
    ])

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
  })

  it('ABSTAINS on a mid-read throw even when IndexedDB holds a user', async () => {
    installThrowingGetItem()
    installIndexedDb([
      { fbase_key: 'firebase:authUser:api-key:[DEFAULT]', value: { uid: 'possibly-stale' } }
    ])

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
  })

  it('rejects an over-long page-controlled uid rather than passing it over IPC', async () => {
    installLocalStorage({ 'firebase:authUser:api-key:[DEFAULT]': { uid: 'x'.repeat(258) } })
    installIndexedDb([])

    at(0)
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
    at(3000)
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'signed_out' })
  })

  it('falls back to IndexedDB when there is NO localStorage object at all', async () => {
    removeLocalStorage()
    installIndexedDb([
      { fbase_key: 'firebase:authUser:api-key:[DEFAULT]', value: { uid: 'legacy-user' } }
    ])

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({
      status: 'signed_in',
      userId: 'legacy-user'
    })
  })

  it.each([
    ['access throws at enumeration', installThrowingLocalStorage],
    ['a per-key getItem throws', installThrowingGetItem]
  ])(
    'does NOT report a stale IndexedDB record as signed_in when %s',
    async (_label, breakStorage) => {
      breakStorage()
      installIndexedDb([
        { fbase_key: 'firebase:authUser:api-key:[DEFAULT]', value: { uid: 'possibly-stale' } }
      ])

      await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
    }
  )

  it.each([
    ['localStorage is absent', removeLocalStorage],
    ['localStorage access throws', installThrowingLocalStorage],
    ['a per-key getItem throws', installThrowingGetItem]
  ])(
    'ABSTAINS rather than reporting signed_out when %s and IndexedDB is drained',
    async (_label, breakStorage) => {
      breakStorage()
      installIndexedDb([])

      await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
    }
  )

  it('ABSTAINS when localStorage is empty and the IndexedDB getter throws', async () => {
    installLocalStorage({})
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('SecurityError')
      }
    })

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
  })

  it('NEVER reports signed_out across the setPersistence window (the cold-boot failure)', async () => {
    at(0)
    installLocalStorage({ 'firebase:authUser:k:[DEFAULT]': { uid: 'u' } })
    installIndexedDb([])
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({
      status: 'signed_in',
      userId: 'u'
    })

    at(905)
    installLocalStorage({})
    installIndexedDb([{ fbase_key: 'firebase:authUser:k:[DEFAULT]', value: { uid: 'u' } }])
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })

    at(3100)
    installIndexedDb([])
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })

    at(3108)
    installLocalStorage({ 'firebase:authUser:k:[DEFAULT]': { uid: 'u' } })
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({
      status: 'signed_in',
      userId: 'u'
    })

    at(9000)
    installLocalStorage({})
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
  })

  it('clears the settle timer on an observation that emits NO report', async () => {
    at(0)
    installLocalStorage({})
    installIndexedDb([])
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })

    at(1000)
    installIndexedDb([{ fbase_key: 'firebase:authUser:k:[DEFAULT]', value: { uid: 'u' } }])
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })

    at(5000)
    installIndexedDb([])
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
  })

  it('settles on WALL-CLOCK, so one poll a minute later still reports signed_out', async () => {
    installLocalStorage({})
    installIndexedDb([])

    at(0)
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
    at(60_000)
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'signed_out' })
  })

  it('holds through irregular spacing and converts exactly AT the threshold', async () => {
    installLocalStorage({})
    installIndexedDb([])

    at(0)
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
    for (const t of [50, 120, 900, 2999]) {
      at(t)
      await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
    }
    at(3000)
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'signed_out' })
  })

  it('treats a backwards clock as unsettled rather than convicting', async () => {
    installLocalStorage({})
    installIndexedDb([])

    at(10_000)
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
    at(0)
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
  })

  it.each(['store-empty', 'no-database', 'database-without-store'] as const)(
    're-reads localStorage and rescues signed_in when IndexedDB reports nobody via %s',
    async (shape) => {
      installLocalStorage({})
      installIndexedDbMovingRecord(shape, () => {
        installLocalStorage({ 'firebase:authUser:k:[DEFAULT]': { uid: 'moved-mid-read' } })
      })

      await expect(readLocalFirebaseAuthState()).resolves.toEqual({
        status: 'signed_in',
        userId: 'moved-mid-read'
      })
    }
  )

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

  it('legacy: abstains when localStorage is absent and no Firebase database exists', async () => {
    removeLocalStorage()
    installIndexedDb(null)

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
  })
})
