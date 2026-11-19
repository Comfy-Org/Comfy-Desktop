export const DESKTOP_SESSION_MARKER_KEY = '__comfyDesktopCloudViewSession'

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

export function buildReadStateScript(apiKey: string, expectedOrigin: string): string {
  return `(async () => {
  const expectedOrigin = ${JSON.stringify(expectedOrigin)};
  if (location.origin !== expectedOrigin) return null;
  const storageKey = ${JSON.stringify(storageKeyFor(apiKey))};
  let marker = null;
  try { marker = localStorage.getItem(${JSON.stringify(DESKTOP_SESSION_MARKER_KEY)}); } catch (_) {}
  const names = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : null;
  if (!names) return null;
  if (!names.some((d) => d && d.name === 'firebaseLocalStorageDb')) return { uid: null, marker };
  const uid = await new Promise((resolve) => {
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
  if (uid === undefined || location.origin !== expectedOrigin) return null;
  return { uid, marker };
})()`
}

export function buildRemoveDesktopSessionScript(
  apiKey: string,
  expectedOrigin: string,
  expectedUid: string
): string {
  return `(async () => {
  const expectedOrigin = ${JSON.stringify(expectedOrigin)};
  if (location.origin !== expectedOrigin) return false;
  const storageKey = ${JSON.stringify(storageKeyFor(apiKey))};
  const expectedUid = ${JSON.stringify(expectedUid)};
  const removed = await new Promise((resolve) => {
    const req = indexedDB.open('firebaseLocalStorageDb');
    req.onerror = () => resolve(false);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('firebaseLocalStorage')) { db.close(); resolve(false); return; }
      const tx = db.transaction('firebaseLocalStorage', 'readwrite');
      let deleted = false;
      tx.oncomplete = () => { db.close(); resolve(deleted); };
      tx.onerror = () => { db.close(); resolve(false); };
      tx.onabort = () => { db.close(); resolve(false); };
      const store = tx.objectStore('firebaseLocalStorage');
      const get = store.get(storageKey);
      get.onsuccess = () => {
        const value = get.result && get.result.value;
        if (value && value.uid === expectedUid && location.origin === expectedOrigin) {
          store.delete(storageKey);
          deleted = true;
        }
      };
    };
  });
  try { localStorage.removeItem(${JSON.stringify(DESKTOP_SESSION_MARKER_KEY)}); } catch (_) {}
  if (removed) location.reload();
  return removed;
})()`
}

export function buildWriteMarkerScript(
  expectedOrigin: string,
  marker: DesktopSessionMarker | null
): string {
  const key = JSON.stringify(DESKTOP_SESSION_MARKER_KEY)
  const value = marker ? JSON.stringify(serializeMarker(marker)) : 'null'
  return `(() => {
  if (location.origin !== ${JSON.stringify(expectedOrigin)}) return false;
  try {
    const value = ${value};
    if (value === null) localStorage.removeItem(${key});
    else localStorage.setItem(${key}, value);
    return true;
  } catch (_) { return false; }
})()`
}
