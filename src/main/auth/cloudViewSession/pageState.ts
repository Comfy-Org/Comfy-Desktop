import {
  CLEANUP_OWNER_KEY,
  DESKTOP_SESSION_MARKER_KEY,
  storedFirebaseUidReaderSource,
  webSessionUidReaderSource
} from '../firebaseBridge/injectScript'

export { DESKTOP_SESSION_MARKER_KEY }
export const WEB_SESSION_DELETE_TIMEOUT_MS = 8000

export interface DesktopSessionMarker {
  v: 1
  uid: string
  sub: string
  fam: string | null
  state: 'active' | 'declined'
}

export interface CloudViewAuthState {
  uid: string | null
  marker: DesktopSessionMarker | null
}

export function parseMarker(raw: unknown): DesktopSessionMarker | null {
  if (typeof raw !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const m = parsed as Record<string, unknown>
  if (m.v !== 1 || typeof m.uid !== 'string' || m.uid === '') return null
  if (typeof m.sub !== 'string' || m.sub === '') return null
  if (m.fam !== null && typeof m.fam !== 'string') return null
  if (m.state !== 'active' && m.state !== 'declined') return null
  return { v: 1, uid: m.uid, sub: m.sub, fam: m.fam, state: m.state }
}

export function serializeMarker(marker: DesktopSessionMarker): string {
  return JSON.stringify(marker)
}

function storageKeyFor(apiKey: string): string {
  return `firebase:authUser:${apiKey}:[DEFAULT]`
}

function firebaseDbExistsSource(): string {
  return `const firebaseDbExists = async () => {
    const names = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : null;
    if (!names) return undefined;
    return names.some((d) => d && d.name === 'firebaseLocalStorageDb');
  };`
}

export function buildReadStateScript(apiKey: string, expectedOrigin: string): string {
  return `(async () => {
  const expectedOrigin = ${JSON.stringify(expectedOrigin)};
  if (location.origin !== expectedOrigin) return null;
  const storageKey = ${JSON.stringify(storageKeyFor(apiKey))};
  let marker = null;
  try { marker = localStorage.getItem(${JSON.stringify(DESKTOP_SESSION_MARKER_KEY)}); } catch (_) {}
  ${storedFirebaseUidReaderSource()}
  ${webSessionUidReaderSource()}
  ${firebaseDbExistsSource()}
  const sessionUid = await readSessionUid();
  if (sessionUid === undefined || location.origin !== expectedOrigin) return null;
  const dbExists = await firebaseDbExists();
  if (dbExists === undefined) return null;
  const dbUid = !dbExists ? null : await new Promise((resolve) => {
    const req = indexedDB.open('firebaseLocalStorageDb');
    req.onerror = () => resolve(undefined);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('firebaseLocalStorage')) { db.close(); resolve(null); return; }
      const get = db.transaction('firebaseLocalStorage', 'readonly')
        .objectStore('firebaseLocalStorage').get(storageKey);
      get.onerror = () => { db.close(); resolve(undefined); };
      get.onsuccess = () => {
        db.close();
        const value = get.result && get.result.value;
        resolve(value && typeof value.uid === 'string' && value.uid ? value.uid : null);
      };
    };
  });
  const storedUid = readStoredUid();
  if (dbUid === undefined || storedUid === undefined || location.origin !== expectedOrigin) return null;
  return { uid: dbUid || storedUid || sessionUid, marker };
})()`
}

export type RemoveDesktopSessionOutcome = 'signed_out' | 'kept' | 'superseded'

export function buildRemoveDesktopSessionScript(
  apiKey: string,
  expectedOrigin: string,
  expectedUid: string,
  expectedMarker: DesktopSessionMarker | null,
  cleanupToken: string
): string {
  const expectedMarkerJson = JSON.stringify(expectedMarker ? serializeMarker(expectedMarker) : null)
  return `(async () => {
  const expectedOrigin = ${JSON.stringify(expectedOrigin)};
  if (location.origin !== expectedOrigin) return 'kept';
  const storageKey = ${JSON.stringify(storageKeyFor(apiKey))};
  const expectedUid = ${JSON.stringify(expectedUid)};
  const expectedMarker = ${expectedMarkerJson};
  const markerKey = ${JSON.stringify(DESKTOP_SESSION_MARKER_KEY)};
  const cleanupKey = ${JSON.stringify(CLEANUP_OWNER_KEY)};
  const cleanupToken = ${JSON.stringify(cleanupToken)};
  const controller = new AbortController();
  globalThis[cleanupKey] = { token: cleanupToken, controller };
  const isCurrent = () => {
    const held = globalThis[cleanupKey];
    return location.origin === expectedOrigin && !!held && held.token === cleanupToken;
  };
  const stillOwned = () => {
    if (!isCurrent()) return false;
    try { return localStorage.getItem(markerKey) === expectedMarker; } catch (_) { return false; }
  };
  const release = () => {
    const held = globalThis[cleanupKey];
    if (held && held.token === cleanupToken) globalThis[cleanupKey] = null;
  };
  ${webSessionUidReaderSource()}
  ${firebaseDbExistsSource()}
  if (!stillOwned()) { release(); return 'superseded'; }
  const sessionUid = await readSessionUid(controller.signal);
  if (!stillOwned()) { release(); return 'superseded'; }
  let sessionEnded = false;
  if (sessionUid === expectedUid) {
    try {
      const response = await fetch('/api/auth/session', {
        method: 'DELETE',
        credentials: 'include',
        signal: AbortSignal.timeout(${WEB_SESSION_DELETE_TIMEOUT_MS})
      });
      sessionEnded = response.ok;
    } catch (_) {}
  }
  let superseded = false;
  const dbExists = await firebaseDbExists();
  const dbResult = dbExists === false ? 'kept' : dbExists === undefined ? 'failed' : await new Promise((resolve) => {
    const req = indexedDB.open('firebaseLocalStorageDb');
    req.onerror = () => resolve('failed');
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('firebaseLocalStorage')) { db.close(); resolve('kept'); return; }
      const tx = db.transaction('firebaseLocalStorage', 'readwrite');
      let deleted = false;
      tx.oncomplete = () => { db.close(); resolve(deleted ? 'deleted' : 'kept'); };
      tx.onerror = () => { db.close(); resolve('failed'); };
      tx.onabort = () => { db.close(); resolve('failed'); };
      const store = tx.objectStore('firebaseLocalStorage');
      const get = store.get(storageKey);
      get.onsuccess = () => {
        const value = get.result && get.result.value;
        if (!value || value.uid !== expectedUid) return;
        if (!stillOwned()) { superseded = true; return; }
        store.delete(storageKey);
        deleted = true;
      };
    };
  });
  let storedRemoved = false;
  let storedLeft = false;
  for (const storageName of ['localStorage', 'sessionStorage']) {
    if (superseded) break;
    try {
      const storage = globalThis[storageName];
      const raw = storage.getItem(storageKey);
      if (!raw) continue;
      let uid;
      try { uid = JSON.parse(raw).uid; } catch (_) { storedLeft = true; continue; }
      if (uid !== expectedUid) continue;
      if (!stillOwned()) { superseded = true; break; }
      storage.removeItem(storageKey);
      if (storage.getItem(storageKey) === null) storedRemoved = true;
      else storedLeft = true;
    } catch (_) {
      storedLeft = true;
    }
  }
  const sessionLeft = sessionUid === undefined || (sessionUid === expectedUid && !sessionEnded);
  const desktopSessionLeft = superseded || dbResult === 'failed' || storedLeft || sessionLeft;
  if (!desktopSessionLeft && stillOwned()) {
    try { localStorage.removeItem(markerKey); } catch (_) {}
  }
  release();
  const signedOut = dbResult === 'deleted' || storedRemoved || sessionEnded;
  if (signedOut && !superseded) location.reload();
  if (superseded) return 'superseded';
  return signedOut ? 'signed_out' : 'kept';
})()`
}

export function buildWriteMarkerScript(
  expectedOrigin: string,
  marker: DesktopSessionMarker | null,
  expectedMarker: DesktopSessionMarker | null
): string {
  const key = JSON.stringify(DESKTOP_SESSION_MARKER_KEY)
  const value = JSON.stringify(marker ? serializeMarker(marker) : null)
  const expected = JSON.stringify(expectedMarker ? serializeMarker(expectedMarker) : null)
  return `(() => {
  if (location.origin !== ${JSON.stringify(expectedOrigin)}) return false;
  try {
    if (localStorage.getItem(${key}) !== ${expected}) return false;
    const value = ${value};
    if (value === null) localStorage.removeItem(${key});
    else localStorage.setItem(${key}, value);
    return true;
  } catch (_) { return false; }
})()`
}
