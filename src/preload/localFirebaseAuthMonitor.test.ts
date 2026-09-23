import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readLocalFirebaseAuthState,
  resetSignedOutSettleForTests
} from './localFirebaseAuthMonitor'

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

/** Only `Date.now` is faked. Faking timers wholesale would also fake `queueMicrotask`, which the
 *  IndexedDB request doubles rely on to resolve — the settle needs a clock, not a scheduler. */
let clock = 0
function at(ms: number): void {
  clock = ms
}

beforeEach(() => {
  clock = 0
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
})

/** The three shapes in which the IndexedDB read reports "nobody", each returning at a DIFFERENT
 *  await, and all three falling through to the localStorage re-read. */
type IdbShape = 'store-empty' | 'no-database' | 'database-without-store'

/**
 * An IndexedDB double that runs `duringFirstAwait` from `databases()` — the FIRST await on EVERY
 * path, so the record can be modelled as moving stores whichever guard the read returns at.
 *
 * Hooking `getAll` instead only models `store-empty`: `no-database` returns at the `databases()`
 * guard and `database-without-store` at the `objectStoreNames` check, so neither ever opens the
 * store and a `getAll` hook silently never fires. A test built that way passes for the wrong reason
 * and leaves two thirds of the re-read unexercised.
 */
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
  // Module-level settle state leaks between cases otherwise, and a leftover timestamp makes the
  // next case order-dependent — the same hazard as restoring a global by assignment.
  resetSignedOutSettleForTests()
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

  it('reports signed_out when BOTH stores are empty, once it has SETTLED', async () => {
    // A sign-out is a real answer, but only once the second store has been asked, agrees, and the
    // state has persisted — see the setPersistence window in the module. Without this case the rule
    // could be satisfied by never reporting signed_out at all.
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

    at(0)
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
    at(3000)
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

  it('NEVER reports signed_out across the setPersistence window (the cold-boot failure)', async () => {
    // The regression test, shaped like the boot that failed: steady state, the migration into
    // IndexedDB, the ~8ms window where setPersistence has removed from one store and not yet
    // written the other, then the record back in localStorage. A definite signed_out anywhere in
    // here is trusted, revokes the loopback binding and seals the install.
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

    // Long after, the window recurring must be judged from a FRESH sighting, not convicted by the
    // timestamp the first one left behind.
    at(9000)
    installLocalStorage({})
    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
  })

  it('clears the settle timer on an observation that emits NO report', async () => {
    // The load-bearing case, and the reason the timer lives in the observation path. An unsettled
    // both-empty and the stores-disagree row BOTH serialise to `pending`, so the transition between
    // them produces no state change and `poll()` emits nothing. A reset keyed on the reported state
    // would never fire here — and this is exactly the transition the real cold boot makes, since the
    // abstain row is the last thing before the window.
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
    // A hidden install view is toggled with setVisible(false) and nothing sets
    // backgroundThrottling, so it polls roughly once a minute. A poll-count rule would need three
    // minutes; elapsed time needs one poll.
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
    // Two-sided on purpose: 2999 above kills a widened comparison or a shrunken constant, 3000
    // here kills a strict `>` or a flipped one. A one-sided boundary lets a flip survive.
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
      // The mechanism the cold boot hit, and it is NOT a both-empty state. localStorage is read
      // synchronously, the IndexedDB read then takes tens of milliseconds, and setPersistence moves
      // the record INTO localStorage during that window. Composing the two reads asserts "both
      // empty" from instants that were never simultaneously true.
      //
      // All THREE shapes matter because they return at three different awaits — the databases()
      // guard, the objectStoreNames check, and the store read — and every one of them falls through
      // to the re-read. Covering only the last would leave two thirds of it unexercised.
      //
      // Asserts signed_in rather than pending: the re-read RESOLVES this, it does not defer it.
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
    // This asserted `signed_out` until review. With no localStorage at all, the absence of a
    // Firebase database says nothing about whether anyone is signed in — and a signed_out here is
    // trusted, revokes the loopback binding and seals the install. The complement of the it.each
    // above: there the database exists and is drained, here it was never created.
    removeLocalStorage()
    installIndexedDb(null)

    await expect(readLocalFirebaseAuthState()).resolves.toEqual({ status: 'pending' })
  })
})
