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

/** Enumeration succeeds, the per-key value read throws — the mechanism failing mid-read. */
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

afterEach(() => {
  // defineProperty, not assignment: a test may have installed `indexedDB` as a throwing ACCESSOR,
  // and assigning to an accessor without a setter does not replace it — it fails silently in sloppy
  // mode and throws under modules. Either way the throwing getter would leak into every later test.
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
    // The ambiguous row, and the reason the rule has three outcomes. Our own sign-in writes the
    // record to IndexedDB only and reloads, so on a first loopback sign-in localStorage has never
    // held a key — this state is normal, not a stale leftover. Reporting signed_out here is trusted,
    // revokes the loopback binding and seals the install; reporting signed_in would honour a record
    // that may genuinely be stale. The only answer that cannot be wrong is neither.
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
      { fbase_key: 'firebase:authUser:api-key:[DEFAULT]', value: { uid: 'stale-ghost' } }
    ])

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
  })

  it('ABSTAINS on a mid-read throw even when IndexedDB holds a user', async () => {
    // The distinction between `unreadable` and `unavailable`, and the reason they are separate
    // kinds. A per-key throw means localStorage HOLDS Firebase keys we cannot read, so it is the
    // store in use and IndexedDB is drained — a record there is the stale copy, and trusting it
    // would assert a definite signed_in off exactly the kind of record this change exists to stop
    // honouring. Contrast the it.each below, where localStorage is ABSENT: there IndexedDB is the
    // only store and its record IS the answer, which is what keeps legacy frontends working.
    installThrowingGetItem()
    installIndexedDb([
      { fbase_key: 'firebase:authUser:api-key:[DEFAULT]', value: { uid: 'possibly-stale' } }
    ])

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
  })

  it('rejects an over-long page-controlled uid rather than passing it over IPC', async () => {
    // The record is entirely page-controlled. main's normalizePostHogUserId is the real validator,
    // but an unbounded uid should not reach the bridge to be rejected there.
    installLocalStorage({ 'firebase:authUser:api-key:[DEFAULT]': { uid: 'x'.repeat(258) } })
    installIndexedDb([])

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

  it.each([
    ['localStorage is absent', removeLocalStorage],
    ['localStorage access throws', installThrowingLocalStorage],
    ['a per-key getItem throws', installThrowingGetItem]
  ])(
    'ABSTAINS rather than reporting signed_out when %s and IndexedDB is drained',
    async (_label, breakStorage) => {
      // Raised in review. An empty IndexedDB is not evidence of a sign-out: on a localStorage-primary
      // frontend it is empty BECAUSE the SDK drained it, and here the store that would hold the user
      // cannot be read at all. Reporting signed_out would be trusted, would revoke the loopback
      // binding and would seal the install — on no evidence. A record there is evidence; its absence
      // is not.
      breakStorage()
      installIndexedDb([])

      await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
    }
  )

  it('ABSTAINS when localStorage is empty and the IndexedDB getter throws', async () => {
    // A blocked/partitioned IndexedDB is not an empty one. Without this the reader reports a
    // definite signed_out having consulted neither store — and it used to throw out of the whole
    // function instead, skipping the report for the tick entirely.
    installLocalStorage({})
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('SecurityError')
      }
    })

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
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

  it('legacy: abstains when localStorage is absent and no Firebase database exists', async () => {
    // This asserted `signed_out` until review. With no localStorage at all, the absence of a
    // Firebase database says nothing about whether anyone is signed in — and a signed_out here is
    // trusted, revokes the loopback binding and seals the install. The complement of the it.each
    // above: there the database exists and is drained, here it was never created.
    removeLocalStorage()
    installIndexedDb(null)

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
  })
})
