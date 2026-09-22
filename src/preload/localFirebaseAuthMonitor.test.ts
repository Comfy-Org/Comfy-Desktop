import { afterEach, describe, expect, it } from 'vitest'
import { readLocalFirebaseAuthState } from './localFirebaseAuthMonitor'

const originalIndexedDb = globalThis.indexedDB

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
})

describe('local Firebase auth monitor', () => {
  it('reports the single persisted Firebase user', async () => {
    installIndexedDb([
      {
        fbase_key: 'firebase:authUser:api-key:[DEFAULT]',
        value: { uid: 'firebase-user' }
      }
    ])

    await expect(readLocalFirebaseAuthState()).resolves.toMatchObject({
      state: { status: 'signed_in', userId: 'firebase-user' },
      observation: 'records-one'
    })
  })

  it('fails pending when multiple Firebase projects disagree', async () => {
    installIndexedDb([
      { fbase_key: 'firebase:authUser:a:[DEFAULT]', value: { uid: 'user-a' } },
      { fbase_key: 'firebase:authUser:b:[DEFAULT]', value: { uid: 'user-b' } }
    ])

    await expect(readLocalFirebaseAuthState()).resolves.toMatchObject({
      state: { status: 'pending' },
      observation: 'records-many'
    })
  })

  it('reports signed out without Firebase persistence', async () => {
    installIndexedDb(null)

    await expect(readLocalFirebaseAuthState()).resolves.toMatchObject({
      state: { status: 'signed_out' },
      observation: 'unreadable-no-db'
    })
  })
})
