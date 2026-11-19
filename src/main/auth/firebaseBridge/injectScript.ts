export const INJECTION_OWNER_KEY = '__comfyDesktopFirebaseSessionInjectionOwner'
export const FIREBASE_SESSION_INJECTION_OWNER_FIELD = '__comfyDesktopInjectionOwner'

export interface InjectWriteOptions {
  onlyIfSignedOut?: boolean
  marker?: { key: string; value: string }
}

export function buildIndexedDbInjectScript(
  user: Record<string, unknown>,
  apiKey: string,
  expectedOrigin: string,
  ownerToken: string,
  options: InjectWriteOptions = {}
): string {
  const onlyIfSignedOutJson = JSON.stringify(options.onlyIfSignedOut === true)
  const markerJson = JSON.stringify(options.marker ?? null)
  const userJson = JSON.stringify(user)
  const apiKeyJson = JSON.stringify(apiKey)
  const expectedOriginJson = JSON.stringify(expectedOrigin)
  const ownerTokenJson = JSON.stringify(ownerToken)
  const ownerKeyJson = JSON.stringify(INJECTION_OWNER_KEY)
  const recordOwnerKeyJson = JSON.stringify(FIREBASE_SESSION_INJECTION_OWNER_FIELD)
  return `(async () => {
  const ownerKey = ${ownerKeyJson};
  const expectedOrigin = ${expectedOriginJson};
  const ownerToken = ${ownerTokenJson};
  const recordOwnerKey = ${recordOwnerKeyJson};
  const onlyIfSignedOut = ${onlyIfSignedOutJson};
  const marker = ${markerJson};
  const isCurrent = () =>
    location.origin === expectedOrigin && globalThis[ownerKey] === ownerToken;
  if (!isCurrent()) return false;
  const userValue = ${userJson};
  const apiKey = ${apiKeyJson};
  const storageKey = 'firebase:authUser:' + apiKey + ':[DEFAULT]';
  const committed = await new Promise((resolve, reject) => {
    const req = indexedDB.open('firebaseLocalStorageDb', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
        db.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
      }
    };
    req.onerror = () => reject(new Error('open: ' + (req.error && req.error.message || 'unknown')));
    req.onsuccess = () => {
      const db = req.result;
      if (!isCurrent()) { db.close(); resolve(false); return; }
      const tx = db.transaction('firebaseLocalStorage', 'readwrite');
      tx.oncomplete = () => {
        if (isCurrent()) { db.close(); resolve(true); return; }
        const cleanup = db.transaction('firebaseLocalStorage', 'readwrite');
        cleanup.oncomplete = () => { db.close(); resolve(false); };
        cleanup.onerror = () => { db.close(); resolve(false); };
        const cleanupStore = cleanup.objectStore('firebaseLocalStorage');
        const current = cleanupStore.get(storageKey);
        current.onsuccess = () => {
          if (current.result && current.result[recordOwnerKey] === ownerToken) {
            cleanupStore.delete(storageKey);
          }
        };
      };
      tx.onerror = () => reject(new Error('tx: ' + (tx.error && tx.error.message || 'unknown')));
      tx.onabort = () => { db.close(); resolve(false); };
      const store = tx.objectStore('firebaseLocalStorage');
      const write = () => {
        if (isCurrent()) {
          store.put({
            fbase_key: storageKey,
            value: userValue,
            [recordOwnerKey]: ownerToken
          });
        }
        else { tx.abort(); }
      };
      if (!onlyIfSignedOut) { write(); return; }
      const existing = store.get(storageKey);
      existing.onsuccess = () => {
        if (existing.result) { tx.abort(); return; }
        write();
      };
    };
  });
  if (!committed || !isCurrent()) return false;
  if (marker) {
    try { localStorage.setItem(marker.key, marker.value); } catch (_) {}
  }
  // Tell the next page-load (handled by attach.ts's dom-ready patch) to
  // hide documentElement briefly so the cloud login page doesn't flash
  // between Firebase rehydrating and the FE redirecting to the workspace.
  try { sessionStorage.setItem('__comfyDesktopPostSignin', '1'); } catch (_) {}
  location.reload();
  return true;
})()`
}
