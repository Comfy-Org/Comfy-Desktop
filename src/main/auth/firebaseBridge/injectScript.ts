export const INJECTION_OWNER_KEY = '__comfyDesktopFirebaseSessionInjectionOwner'
export const DESKTOP_SESSION_MARKER_KEY = '__comfyDesktopCloudViewSession'
export const CLEANUP_OWNER_KEY = '__comfyDesktopCloudViewCleanup'
export const FIREBASE_SESSION_INJECTION_OWNER_FIELD = '__comfyDesktopInjectionOwner'
export const WEB_SESSION_CREATE_TIMEOUT_MS = 8000
export const WEB_SESSION_READ_TIMEOUT_MS = 8000

export function webSessionUidReaderSource(): string {
  return `const readSessionUid = async (cancel) => {
    try {
      const timeout = AbortSignal.timeout(${WEB_SESSION_READ_TIMEOUT_MS});
      const response = await fetch('/api/auth/session', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal: cancel ? AbortSignal.any([cancel, timeout]) : timeout
      });
      if (response.status === 429 || response.status >= 500) return undefined;
      if (!response.ok) return null;
      const body = await response.json().catch(() => undefined);
      if (body === undefined) return undefined;
      const id = body && body.user && body.user.id;
      return typeof id === 'string' && id ? id : null;
    } catch (_) {
      return undefined;
    }
  };`
}

export function storedFirebaseUidReaderSource(): string {
  return `const readStoredUid = () => {
    try {
      for (const storage of [localStorage, sessionStorage]) {
        const raw = storage.getItem(storageKey);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.uid === 'string' && parsed.uid) return parsed.uid;
      }
      return null;
    } catch (_) {
      return undefined;
    }
  };`
}

export function buildCancelCleanupScript(token: string): string {
  return `(() => {
  const key = ${JSON.stringify(CLEANUP_OWNER_KEY)};
  const held = globalThis[key];
  if (!held || held.token !== ${JSON.stringify(token)}) return false;
  globalThis[key] = null;
  try { held.controller.abort(); } catch (_) {}
  return true;
})()`
}

function signedInSessionGuardSource(): string {
  return `${webSessionUidReaderSource()}
  ${storedFirebaseUidReaderSource()}
  if (readStoredUid() !== null) return false;
  if ((await readSessionUid()) !== null) return false;
  if (!isCurrent() || readStoredUid() !== null) return false;`
}

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
  const desktopMarkerKeyJson = JSON.stringify(DESKTOP_SESSION_MARKER_KEY)
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
  const apiKey = ${apiKeyJson};
  const storageKey = 'firebase:authUser:' + apiKey + ':[DEFAULT]';
  ${options.onlyIfSignedOut === true ? signedInSessionGuardSource() : ''}
  const userValue = ${userJson};
  let markerWritten = false;
  let markerUnsaved = false;
  let previousMarker = null;
  const saveMarker = () => {
    if (!marker) return true;
    try {
      previousMarker = localStorage.getItem(marker.key);
      localStorage.setItem(marker.key, marker.value);
      markerWritten = true;
      return localStorage.getItem(marker.key) === marker.value;
    } catch (_) {
      return false;
    }
  };
  const restoreMarker = () => {
    if (!markerWritten) return;
    markerWritten = false;
    try {
      if (localStorage.getItem(marker.key) !== marker.value) return;
      if (previousMarker === null) localStorage.removeItem(marker.key);
      else localStorage.setItem(marker.key, previousMarker);
    } catch (_) {}
  };
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
        restoreMarker();
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
      tx.onerror = () => {
        restoreMarker();
        reject(new Error('tx: ' + (tx.error && tx.error.message || 'unknown')));
      };
      tx.onabort = () => { restoreMarker(); db.close(); resolve(false); };
      const store = tx.objectStore('firebaseLocalStorage');
      const write = () => {
        if (!isCurrent()) { tx.abort(); return; }
        if (!saveMarker()) { markerUnsaved = true; tx.abort(); return; }
        store.put({
          fbase_key: storageKey,
          value: userValue,
          [recordOwnerKey]: ownerToken
        });
      };
      if (!onlyIfSignedOut) { write(); return; }
      const existing = store.get(storageKey);
      existing.onsuccess = () => {
        if (existing.result || readStoredUid() !== null) { tx.abort(); return; }
        write();
      };
    };
  });
  if (markerUnsaved) return 'marker_unsaved';
  if (!committed || !isCurrent()) return false;
  if (!marker) {
    try {
      const desktopMarkerKey = ${desktopMarkerKeyJson};
      const held = JSON.parse(localStorage.getItem(desktopMarkerKey) || 'null');
      if (held && held.state === 'active') {
        localStorage.setItem(desktopMarkerKey, JSON.stringify({ ...held, state: 'declined' }));
      }
    } catch (_) {}
  }
  const idToken = userValue && userValue.stsTokenManager && userValue.stsTokenManager.accessToken;
  if (idToken) {
    try {
      await fetch('/api/auth/session', {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: 'Bearer ' + idToken },
        signal: AbortSignal.timeout(${WEB_SESSION_CREATE_TIMEOUT_MS})
      });
    } catch (_) {}
    if (!isCurrent()) return false;
  }
  try { sessionStorage.setItem('__comfyDesktopPostSignin', '1'); } catch (_) {}
  location.reload();
  return true;
})()`
}
