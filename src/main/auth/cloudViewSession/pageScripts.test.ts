import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildIndexedDbInjectScript } from '../firebaseBridge/injectScript'
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

async function run(script: string): Promise<unknown> {
  const win = await openFrame()
  Reflect.set(win, OWNER_KEY, OWNER)
  return (win as unknown as { eval: (code: string) => unknown }).eval(script)
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
  await deleteFirebaseDb()
})

afterEach(() => {
  for (const frame of frames) frame.remove()
  frames = []
  localStorage.clear()
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

  it('reads nothing when the page is on another origin', async () => {
    await seedUser('person-uid')
    await expect(run(buildReadStateScript(API_KEY, 'https://cloud.comfy.org'))).resolves.toBe(null)
  })
})

describe('buildRemoveDesktopSessionScript', () => {
  it('removes the session when it is still the user Desktop added', async () => {
    await seedUser('desktop-uid')
    localStorage.setItem(DESKTOP_SESSION_MARKER_KEY, serializeMarker(MARKER))
    await expect(
      run(buildRemoveDesktopSessionScript(API_KEY, ORIGIN, 'desktop-uid'))
    ).resolves.toBe(true)
    await expect(storedUid()).resolves.toBe(null)
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(null)
  })

  it('keeps a session for any other user', async () => {
    await seedUser('person-uid')
    await expect(
      run(buildRemoveDesktopSessionScript(API_KEY, ORIGIN, 'desktop-uid'))
    ).resolves.toBe(false)
    await expect(storedUid()).resolves.toBe('person-uid')
  })
})

describe('buildWriteMarkerScript', () => {
  it('writes and clears the marker', async () => {
    await expect(run(buildWriteMarkerScript(ORIGIN, MARKER))).resolves.toBe(true)
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(serializeMarker(MARKER))
    await expect(run(buildWriteMarkerScript(ORIGIN, null))).resolves.toBe(true)
    expect(localStorage.getItem(DESKTOP_SESSION_MARKER_KEY)).toBe(null)
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

  it('still replaces the session for the existing sign-in flows', async () => {
    await seedUser('person-uid')
    await expect(run(buildIndexedDbInjectScript(user, API_KEY, ORIGIN, OWNER))).resolves.toBe(true)
    await expect(storedUid()).resolves.toBe('desktop-uid')
  })
})
