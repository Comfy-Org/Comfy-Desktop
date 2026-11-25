import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  buildCancelCleanupScript,
  buildIndexedDbInjectScript
} from '../firebaseBridge/injectScript'
import {
  buildReadStateScript,
  buildRemoveDesktopSessionScript,
  buildWriteMarkerScript,
  DESKTOP_SESSION_MARKER_KEY,
  type DesktopSessionMarker,
  serializeMarker
} from './pageState'

const API_KEY = 'AIzaTEST'
const STORAGE_KEY = `firebase:authUser:${API_KEY}:[DEFAULT]`
const OWNER_KEY = '__comfyDesktopFirebaseSessionInjectionOwner'
const OWNER = 'owner-token'
const ORIGIN = location.origin
const MARKER: DesktopSessionMarker = {
  v: 1,
  uid: 'desktop-uid',
  sub: 'desktop-sub',
  fam: 'fam-1',
  state: 'active'
}

const NEWER_MARKER: DesktopSessionMarker = { ...MARKER, fam: 'fam-2' }
const CLEANUP_TOKEN = 'cleanup-token'

function removeScript(uid = 'desktop-uid', marker: DesktopSessionMarker | null = MARKER): string {
  return buildRemoveDesktopSessionScript(API_KEY, ORIGIN, uid, marker, CLEANUP_TOKEN)
}

let frames: HTMLIFrameElement[] = []

async function openFrame(): Promise<Window> {
  const frame = document.createElement('iframe')
  frame.src = URL.createObjectURL(new Blob(['<!doctype html><body></body>'], { type: 'text/html' }))
  const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve()))
  document.body.append(frame)
  frames.push(frame)
  await loaded
  return frame.contentWindow as Window
}

interface FakeWebSession {
  uid: string | null
  readStatus?: number
  deleteStatus?: number
  deletes: number
  posts: number
  duringRead?: () => void
}

function webSession(uid: string | null, statuses: Partial<FakeWebSession> = {}): FakeWebSession {
  return { uid, deletes: 0, posts: 0, ...statuses }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function sessionEndpoint(session: FakeWebSession) {
  return async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    expect(String(input)).toBe('/api/auth/session')
    const method = init.method ?? 'GET'
    if (method === 'GET') {
      if (session.readStatus) return json(session.readStatus, {})
      const uidAtRequest = session.uid
      session.duringRead?.()
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      return uidAtRequest
        ? json(200, { user: { id: uidAtRequest } })
        : json(401, { code: 'no_session' })
    }
    if (method === 'DELETE') {
      session.deletes += 1
      const status = session.deleteStatus ?? 200
      if (status === 200) session.uid = null
      return json(status, { success: status === 200 })
    }
    session.posts += 1
    return json(200, { success: true })
  }
}

async function run(
  script: string,
  session = webSession(null),
  prepare: (win: Window & typeof globalThis) => void = () => {}
): Promise<unknown> {
  const win = await openFrame()
  Reflect.set(win, OWNER_KEY, OWNER)
  Reflect.set(win, 'fetch', sessionEndpoint(session))
  prepare(win as Window & typeof globalThis)
  return (win as unknown as { eval: (code: string) => unknown }).eval(script)
}

const RELOAD_SETTLE_MS = 300

function countReloads(win: Window): () => number {
  let reloads = 0
  win.frameElement?.addEventListener('load', () => {
    reloads += 1
  })
  return () => reloads
}

function reloadsSettled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RELOAD_SETTLE_MS))
}

function deleteFirebaseDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('firebaseLocalStorageDb')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('firebaseLocalStorageDb deletion blocked'))
  })
}

function withStore<T>(
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<T> | null
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('firebaseLocalStorageDb', 1)
    req.onupgradeneeded = () =>
      req.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' })
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('firebaseLocalStorage', mode)
      const request = use(tx.objectStore('firebaseLocalStorage'))
      tx.oncomplete = () => {
        db.close()
        resolve(request ? (request.result ?? null) : null)
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    }
  })
}

function persistUser(storage: Storage, uid: string): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({ uid, stsTokenManager: {} }))
}

function seedUser(uid: string): Promise<unknown> {
  return withStore('readwrite', (store) =>
    store.put({ fbase_key: STORAGE_KEY, value: { uid, stsTokenManager: {} } })
  )
}

async function storedUid(): Promise<string | null> {
  const record = (await withStore('readonly', (store) => store.get(STORAGE_KEY))) as {
    value?: { uid?: string }
  } | null
  return record?.value?.uid ?? null
}

async function firebaseDbExists(): Promise<boolean> {
  const dbs = await indexedDB.databases()
  return dbs.some((db) => db.name === 'firebaseLocalStorageDb')
}

beforeEach(async () => {
  localStorage.clear()
  sessionStorage.clear()
  await deleteFirebaseDb()
})

afterEach(() => {
  for (const frame of frames) frame.remove()
  frames = []
  localStorage.clear()
  sessionStorage.clear()
})

describe('buildReadStateScript', () => {
  it('reports no user without creating the Firebase database', async () => {
    await expect(run(buildReadStateScript(API_KEY, ORIGIN))).resolves.toEqual({
      uid: null,
      marker: null
    })
    await expect(firebaseDbExists()).resolves.toBe(false)
  })

  it('reports the signed-in uid and the raw marker', async () => {
    await seedUser('person-uid')
    localStorage.setItem(DESKTOP_SESSION_MARKER_KEY, serializeMarker(MARKER))
    await expect(run(buildReadStateScript(API_KEY, ORIGIN))).resolves.toEqual({
      uid: 'person-uid',
      marker: serializeMarker(MARKER)
    })
  })

  it.each([
    ['localStorage', () => localStorage],
    ['sessionStorage', () => sessionStorage]
  ])('reports a Firebase user the page keeps in %s', async (_name, storage) => {
    persistUser(storage(), 'person-uid')
    await expect(run(buildReadStateScript(API_KEY, ORIGIN))).resolves.toEqual({
      uid: 'person-uid',
      marker: null
    })
  })

  it('reports a person signed in only by the web session cookie', async () => {
    await expect(
      run(buildReadStateScript(API_KEY, ORIGIN), webSession('sso-person-uid'))
    ).resolves.toEqual({ uid: 'sso-person-uid', marker: null })
  })

  it('reads nothing when the web session cannot be read', async () => {
    await expect(
      run(buildReadStateScript(API_KEY, ORIGIN), webSession(null, { readStatus: 503 }))
    ).resolves.toBe(null)
  })

  it('reads nothing when the page is on another origin', async () => {
    await seedUser('person-uid')
    await expect(run(buildReadStateScript(API_KEY, 'https://cloud.comfy.org'))).resolves.toBe(null)
  })
})

describe('buildRemoveDesktopSessionScript', () => {
  function holdMarker(marker: DesktopSessionMarker = MARKER): void {
    localStorage.setItem(DESKTOP_SESSION_MARKER_KEY, serializeMarker(marker))
  }

  it('removes the session when it is still the user Desktop added', async () => {
    await seedUser('desktop-uid')
    holdMarker()
    await expect(run(removeScript())).resolves.toBe('signed_out')
    await expect(storedUid()).resolves.toBe(null)
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(null)
  })

  it('keeps a session for any other user', async () => {
    await seedUser('person-uid')
    holdMarker()
    await expect(run(removeScript())).resolves.toBe('kept')
    await expect(storedUid()).resolves.toBe('person-uid')
  })

  it("removes Desktop's user once the page has moved it into localStorage", async () => {
    persistUser(localStorage, 'desktop-uid')
    holdMarker()
    await expect(run(removeScript())).resolves.toBe('signed_out')
    expect(localStorage.getItem(STORAGE_KEY)).toBe(null)
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(null)
    await expect(firebaseDbExists()).resolves.toBe(false)
  })

  it('keeps a person the page keeps in localStorage', async () => {
    persistUser(localStorage, 'person-uid')
    holdMarker()
    await expect(run(removeScript())).resolves.toBe('kept')
    expect(localStorage.getItem(STORAGE_KEY)).not.toBe(null)
  })

  it('keeps the marker when the stored user could not be removed', async () => {
    persistUser(localStorage, 'desktop-uid')
    holdMarker()
    await expect(
      run(removeScript(), webSession(null), (win) => {
        const removeItem = win.Storage.prototype.removeItem
        win.Storage.prototype.removeItem = function (this: Storage, key: string) {
          if (key !== STORAGE_KEY) removeItem.call(this, key)
        }
      })
    ).resolves.toBe('kept')
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(serializeMarker(MARKER))
  })

  it('touches no credential once another view recorded newer ownership', async () => {
    await seedUser('desktop-uid')
    persistUser(localStorage, 'desktop-uid')
    persistUser(sessionStorage, 'desktop-uid')
    holdMarker(NEWER_MARKER)
    const session = webSession('desktop-uid')
    await expect(run(removeScript(), session)).resolves.toBe('superseded')
    await expect(storedUid()).resolves.toBe('desktop-uid')
    expect(localStorage.getItem(STORAGE_KEY)).not.toBe(null)
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBe(null)
    expect(session).toMatchObject({ uid: 'desktop-uid', deletes: 0 })
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(serializeMarker(NEWER_MARKER))
  })

  it.each([
    ['a newer Desktop grant', serializeMarker(NEWER_MARKER)],
    ["the person's own sign-in", serializeMarker({ ...MARKER, state: 'declined' })]
  ])(
    'touches no credential when %s takes the view during the session read',
    async (_name, next) => {
      await seedUser('desktop-uid')
      holdMarker()
      const session = webSession('desktop-uid', {
        duringRead: () => localStorage.setItem(DESKTOP_SESSION_MARKER_KEY, next)
      })
      await expect(run(removeScript(), session)).resolves.toBe('superseded')
      await expect(storedUid()).resolves.toBe('desktop-uid')
      expect(session.deletes).toBe(0)
      expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(next)
    }
  )

  it('never ends a newer login whose cookie lands while a cancelled cleanup reads the session', async () => {
    await seedUser('desktop-uid')
    holdMarker()
    let page: (Window & typeof globalThis) | null = null
    const session = webSession('desktop-uid', {
      duringRead: () => {
        session.uid = 'person-uid'
        ;(page as unknown as { eval: (code: string) => unknown }).eval(
          buildCancelCleanupScript(CLEANUP_TOKEN)
        )
      }
    })
    await expect(
      run(removeScript(), session, (win) => {
        page = win
      })
    ).resolves.toBe('superseded')
    expect(session).toMatchObject({ uid: 'person-uid', deletes: 0 })
    await expect(storedUid()).resolves.toBe('desktop-uid')
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(serializeMarker(MARKER))
  })

  it('ignores a cancel meant for another cleanup', async () => {
    await seedUser('desktop-uid')
    holdMarker()
    let page: (Window & typeof globalThis) | null = null
    const session = webSession('desktop-uid', {
      duringRead: () => {
        ;(page as unknown as { eval: (code: string) => unknown }).eval(
          buildCancelCleanupScript('another-cleanup')
        )
      }
    })
    await expect(
      run(removeScript(), session, (win) => {
        page = win
      })
    ).resolves.toBe('signed_out')
    expect(session.deletes).toBe(1)
  })

  it("ends the web session cookie when it is Desktop's user", async () => {
    await seedUser('desktop-uid')
    holdMarker()
    const session = webSession('desktop-uid')
    await expect(run(removeScript(), session)).resolves.toBe('signed_out')
    expect(session).toMatchObject({ uid: null, deletes: 1 })
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(null)
  })

  it("signs out a view that kept only Desktop's web session cookie", async () => {
    holdMarker()
    const session = webSession('desktop-uid')
    await expect(run(removeScript(), session)).resolves.toBe('signed_out')
    expect(session.deletes).toBe(1)
  })

  it("never ends another person's web session", async () => {
    holdMarker()
    const session = webSession('person-uid')
    await expect(run(removeScript(), session)).resolves.toBe('kept')
    expect(session).toMatchObject({ uid: 'person-uid', deletes: 0 })
  })

  it('keeps the marker when the web session could not be ended, so the next load tries again', async () => {
    holdMarker()
    const session = webSession('desktop-uid', { deleteStatus: 503 })
    await expect(run(removeScript(), session)).resolves.toBe('kept')
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(serializeMarker(MARKER))
  })

  it("reloads the view once Desktop's session is gone", async () => {
    await seedUser('desktop-uid')
    holdMarker()
    let reloads = (): number => 0
    await expect(
      run(removeScript(), webSession(null), (win) => {
        reloads = countReloads(win)
      })
    ).resolves.toBe('signed_out')
    await expect.poll(reloads).toBe(1)
  })

  it('leaves the reload to the sign-in that cancelled it after the web session ended', async () => {
    await seedUser('desktop-uid')
    holdMarker()
    const session = webSession('desktop-uid')
    let reloads = (): number => 0
    await expect(
      run(removeScript(), session, (win) => {
        reloads = countReloads(win)
        const endpoint = win.fetch
        win.fetch = async (input, init) => {
          const response = await endpoint(input, init)
          if (init?.method === 'DELETE') {
            ;(win as unknown as { eval: (code: string) => unknown }).eval(
              buildCancelCleanupScript(CLEANUP_TOKEN)
            )
          }
          return response
        }
      })
    ).resolves.toBe('superseded')
    expect(session.deletes).toBe(1)
    await expect(storedUid()).resolves.toBe('desktop-uid')
    await reloadsSettled()
    expect(reloads()).toBe(0)
  })
})

describe('buildWriteMarkerScript', () => {
  it('writes and clears the marker', async () => {
    await expect(run(buildWriteMarkerScript(ORIGIN, MARKER, null))).resolves.toBe(true)
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(serializeMarker(MARKER))
    await expect(run(buildWriteMarkerScript(ORIGIN, null, MARKER))).resolves.toBe(true)
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(null)
  })

  it('leaves a marker another view changed since this one read it', async () => {
    localStorage.setItem(DESKTOP_SESSION_MARKER_KEY, serializeMarker(NEWER_MARKER))
    await expect(run(buildWriteMarkerScript(ORIGIN, null, MARKER))).resolves.toBe(false)
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(serializeMarker(NEWER_MARKER))
  })
})

describe('buildIndexedDbInjectScript with onlyIfSignedOut', () => {
  const user = { uid: 'desktop-uid', stsTokenManager: {} }
  const marker = { key: DESKTOP_SESSION_MARKER_KEY, value: serializeMarker(MARKER) }

  it('signs a signed-out view in and records the marker', async () => {
    await expect(
      run(
        buildIndexedDbInjectScript(user, API_KEY, ORIGIN, OWNER, { onlyIfSignedOut: true, marker })
      )
    ).resolves.toBe(true)
    await expect(storedUid()).resolves.toBe('desktop-uid')
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(marker.value)
  })

  it('never replaces a session that is already there', async () => {
    await seedUser('person-uid')
    await expect(
      run(
        buildIndexedDbInjectScript(user, API_KEY, ORIGIN, OWNER, { onlyIfSignedOut: true, marker })
      )
    ).resolves.toBe(false)
    await expect(storedUid()).resolves.toBe('person-uid')
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(null)
  })

  it('never signs in over a person signed in only by the web session cookie', async () => {
    await expect(
      run(
        buildIndexedDbInjectScript(user, API_KEY, ORIGIN, OWNER, { onlyIfSignedOut: true, marker }),
        webSession('sso-person-uid')
      )
    ).resolves.toBe(false)
    await expect(firebaseDbExists()).resolves.toBe(false)
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(null)
  })

  it.each([
    ['localStorage', () => localStorage],
    ['sessionStorage', () => sessionStorage]
  ])('never signs in over a person the page keeps in %s', async (_name, storage) => {
    persistUser(storage(), 'person-uid')
    await expect(
      run(
        buildIndexedDbInjectScript(user, API_KEY, ORIGIN, OWNER, { onlyIfSignedOut: true, marker })
      )
    ).resolves.toBe(false)
    await expect(firebaseDbExists()).resolves.toBe(false)
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(null)
  })

  it('writes no credential when its marker cannot be saved', async () => {
    let puts = 0
    await expect(
      run(
        buildIndexedDbInjectScript(user, API_KEY, ORIGIN, OWNER, { onlyIfSignedOut: true, marker }),
        webSession(null),
        (win) => {
          win.Storage.prototype.setItem = () => {
            throw new DOMException('quota', 'QuotaExceededError')
          }
          const put = win.IDBObjectStore.prototype.put
          win.IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args) {
            puts += 1
            return put.apply(this, args)
          }
        }
      )
    ).resolves.toBe('marker_unsaved')
    expect(puts).toBe(0)
    await expect(storedUid()).resolves.toBe(null)
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(null)
  })

  it('puts back the previous marker when the credential write is abandoned', async () => {
    const previous = serializeMarker({ ...MARKER, state: 'declined', fam: 'fam-0' })
    localStorage.setItem(DESKTOP_SESSION_MARKER_KEY, previous)
    await expect(
      run(
        buildIndexedDbInjectScript(user, API_KEY, ORIGIN, OWNER, { onlyIfSignedOut: true, marker }),
        webSession(null),
        (win) => {
          win.IDBObjectStore.prototype.put = function (this: IDBObjectStore) {
            this.transaction.abort()
            return {} as IDBRequest<IDBValidKey>
          }
        }
      )
    ).resolves.toBe(false)
    await expect(storedUid()).resolves.toBe(null)
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(previous)
  })

  it('stands aside when the web session cannot be read', async () => {
    await expect(
      run(
        buildIndexedDbInjectScript(user, API_KEY, ORIGIN, OWNER, { onlyIfSignedOut: true, marker }),
        webSession(null, { readStatus: 503 })
      )
    ).resolves.toBe(false)
    await expect(firebaseDbExists()).resolves.toBe(false)
  })

  it('still replaces the session for the existing sign-in flows', async () => {
    await seedUser('person-uid')
    await expect(run(buildIndexedDbInjectScript(user, API_KEY, ORIGIN, OWNER))).resolves.toBe(true)
    await expect(storedUid()).resolves.toBe('desktop-uid')
  })

  it("hands the view to a person who signs in again with Desktop's account", async () => {
    await expect(
      run(
        buildIndexedDbInjectScript(user, API_KEY, ORIGIN, OWNER, { onlyIfSignedOut: true, marker })
      )
    ).resolves.toBe(true)
    await withStore('readwrite', (store) => store.delete(STORAGE_KEY))

    await expect(run(buildIndexedDbInjectScript(user, API_KEY, ORIGIN, OWNER))).resolves.toBe(true)

    await expect(run(buildReadStateScript(API_KEY, ORIGIN))).resolves.toEqual({
      uid: 'desktop-uid',
      marker: serializeMarker({ ...MARKER, state: 'declined' })
    })
  })

  it('leaves no marker behind for a sign-in Desktop never made', async () => {
    await expect(run(buildIndexedDbInjectScript(user, API_KEY, ORIGIN, OWNER))).resolves.toBe(true)
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(null)
  })
})
