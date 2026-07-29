import { randomUUID } from 'node:crypto'
import type { WebContents, WebFrameMain } from 'electron'

const INJECTION_OWNER_KEY = '__comfyDesktopFirebaseSessionInjectionOwner'
export const FIREBASE_SESSION_INJECTION_OWNER_FIELD = '__comfyDesktopInjectionOwner'

export interface FirebaseSessionInjection {
  contents: WebContents
  frame: WebFrameMain | null
  token: string
}

let activeInjection: FirebaseSessionInjection | null = null

function setInjectionOwnerScript(token: string | null): string {
  return `globalThis[${JSON.stringify(INJECTION_OWNER_KEY)}] = ${JSON.stringify(token)}`
}

function invalidateInjection(injection: FirebaseSessionInjection): void {
  const { frame } = injection
  if (!frame || frame.isDestroyed()) return
  void frame.executeJavaScript(setInjectionOwnerScript(null)).catch(() => {})
}

function currentOrigin(contents: WebContents): string | null {
  try {
    return new URL(contents.getURL()).origin
  } catch {
    return null
  }
}

export function isFirebaseSessionInjectionRecordOwnedBy(
  record: unknown,
  ownerToken: string
): boolean {
  return (
    !!record &&
    typeof record === 'object' &&
    (record as Record<string, unknown>)[FIREBASE_SESSION_INJECTION_OWNER_FIELD] === ownerToken
  )
}

/**
 * Own the next Firebase session write and invalidate any write still running
 * for a superseded sign-in flow.
 */
export function beginFirebaseSessionInjection(contents: WebContents): FirebaseSessionInjection {
  if (activeInjection) invalidateInjection(activeInjection)
  const injection = { contents, frame: null, token: randomUUID() }
  activeInjection = injection
  return injection
}

export function releaseFirebaseSessionInjection(injection: FirebaseSessionInjection): void {
  if (activeInjection !== injection) return
  activeInjection = null
  invalidateInjection(injection)
}

/**
 * Build the JavaScript string passed to `comfyContents.executeJavaScript`
 * to write the captured Firebase user into the embedded view's IndexedDB
 * and reload the page so Firebase's SDK rehydrates from persistence.
 *
 * Schema (stable across Firebase JS SDK v9-v11):
 *   - DB:     `firebaseLocalStorageDb`
 *   - Store:  `firebaseLocalStorage`
 *   - KeyPath:`fbase_key`
 *   - Key:    `firebase:authUser:<apiKey>:[DEFAULT]`
 *   - Value:  `{ fbase_key, value: <user.toJSON()> }`
 *
 * After the write, `location.reload()` triggers Firebase's persistence
 * read on init, which fires `onAuthStateChanged(user)` and lets the
 * cloud frontend's existing `useSessionCookie.createSession()` flow
 * post the ID token to `/auth/session` — same path as a normal popup
 * sign-in.
 */
export function buildIndexedDbInjectScript(
  user: Record<string, unknown>,
  apiKey: string,
  expectedOrigin: string,
  ownerToken: string
): string {
  const userJson = JSON.stringify(user)
  const apiKeyJson = JSON.stringify(apiKey)
  const expectedOriginJson = JSON.stringify(expectedOrigin)
  const ownerTokenJson = JSON.stringify(ownerToken)
  const ownerKeyJson = JSON.stringify(INJECTION_OWNER_KEY)
  const recordOwnerKeyJson = JSON.stringify(FIREBASE_SESSION_INJECTION_OWNER_FIELD)
  // Wrapped in an IIFE that resolves once the IDB transaction commits
  // (so `executeJavaScript`'s returned Promise tracks the actual write).
  return `(async () => {
  const ownerKey = ${ownerKeyJson};
  const expectedOrigin = ${expectedOriginJson};
  const ownerToken = ${ownerTokenJson};
  const recordOwnerKey = ${recordOwnerKeyJson};
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
      const store = tx.objectStore('firebaseLocalStorage');
      if (isCurrent()) {
        store.put({
          fbase_key: storageKey,
          value: userValue,
          [recordOwnerKey]: ownerToken
        });
      }
      else { tx.abort(); db.close(); resolve(false); }
    };
  });
  if (!committed || !isCurrent()) return false;
  // Tell the next page-load (handled by attach.ts's dom-ready patch) to
  // hide documentElement briefly so the cloud login page doesn't flash
  // between Firebase rehydrating and the FE redirecting to the workspace.
  try { sessionStorage.setItem('__comfyDesktopPostSignin', '1'); } catch (_) {}
  location.reload();
  return true;
})()`
}

/**
 * Bind the credential-bearing script to the main frame observed after the
 * origin check. A navigation destroys that frame; a superseding flow changes
 * its in-page owner token, so neither race can commit and reload stale auth.
 */
export async function injectFirebaseSession(
  injection: FirebaseSessionInjection,
  expectedOrigin: string,
  user: Record<string, unknown>,
  apiKey: string
): Promise<boolean> {
  if (
    activeInjection !== injection ||
    injection.contents.isDestroyed() ||
    currentOrigin(injection.contents) !== expectedOrigin
  ) {
    return false
  }

  const frame = injection.contents.mainFrame
  injection.frame = frame
  await frame.executeJavaScript(setInjectionOwnerScript(injection.token))
  if (
    activeInjection !== injection ||
    frame.isDestroyed() ||
    injection.contents.mainFrame !== frame ||
    currentOrigin(injection.contents) !== expectedOrigin
  ) {
    invalidateInjection(injection)
    return false
  }

  const result = await frame.executeJavaScript(
    buildIndexedDbInjectScript(user, apiKey, expectedOrigin, injection.token),
    true
  )
  return result === true && activeInjection === injection
}
