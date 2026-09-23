/**
 * Cloud user-tier cache. Holds the signed-in customer's subscription tier for billing
 * telemetry and free-tier offer UI.
 *
 * Sourced from comfy-api `GET /customers/me` (via the cloud webContents' Firebase token) and
 * persisted to `userData/cloud-user-tier.json` so the next launch's first render sees it.
 * Anomalies leave the cache alone rather than clobber a known-paid tier.
 */
import { app, type WebContents } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import {
  FIREBASE_AUTH_KEY_PREFIX,
  FIREBASE_IDB_NAME,
  FIREBASE_IDB_STORE
} from '../../shared/firebaseAuthStorage'
import * as telemetry from './telemetry'
import type { CloudUserTier } from '../../types/ipc'

/** Subscription tier names that map to `paid`; anything else (FREE, missing, malformed) maps to `free`. */
const PAID_TIER_NAMES: ReadonlySet<string> = new Set([
  'STANDARD',
  'CREATOR',
  'PRO',
  'FOUNDERS_EDITION'
])

const PERSIST_FILENAME = 'cloud-user-tier.json'

let cached: CloudUserTier = 'unknown'
let initPromise: Promise<void> | null = null
let persistPath: string | null = null

function getPersistPath(): string {
  if (!persistPath) {
    persistPath = path.join(app.getPath('userData'), PERSIST_FILENAME)
  }
  return persistPath
}

/** Boot-time read of the persisted tier. Idempotent; never rejects (missing/malformed stays `'unknown'`). */
export function initUserTier(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      const raw = await fs.readFile(getPersistPath(), 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      if (
        parsed &&
        typeof parsed === 'object' &&
        'tier' in parsed &&
        (parsed.tier === 'free' || parsed.tier === 'paid')
      ) {
        cached = parsed.tier
      }
    } catch {
      // first launch, missing file, or corrupt — stay 'unknown'
    }

    console.log('[user-tier] init: persisted=', cached)
  })()
  return initPromise
}

export function getUserTier(): CloudUserTier {
  return cached
}

export async function getUserTierAsync(): Promise<CloudUserTier> {
  if (initPromise) {
    try {
      await initPromise
    } catch {
      /* keep cached */
    }
  }
  return cached
}

/** Update cache + persisted file from a raw `subscription_tier`; null/missing → `free`. No-op when unchanged. */
async function setTier(rawTierName: string | null | undefined): Promise<void> {
  const next: CloudUserTier =
    typeof rawTierName === 'string' && PAID_TIER_NAMES.has(rawTierName.toUpperCase())
      ? 'paid'
      : 'free'
  if (next === cached) return
  const previous = cached
  cached = next
  // Emit only on a real transition between two known tiers. The first
  // resolution out of `unknown` is hydration, not a change, so it is not a
  // conversion signal. A `free → paid` flip shortly after
  // `billing.checkout_returned` is the desktop-visible conversion.
  if (previous === 'free' || previous === 'paid') {
    telemetry.capture('comfy.desktop.billing.tier_changed', {
      from_tier: previous,
      to_tier: next
    })
  }
  try {
    await fs.writeFile(getPersistPath(), JSON.stringify({ tier: next, ts: Date.now() }), 'utf-8')
  } catch (err) {
    console.log('[user-tier] persist failed:', err)
  }
}

/**
 * Page-context script that reads the Firebase token from IndexedDB and calls `/customers/me`.
 * Returns `{tier}` on success, `{error}` on recoverable failure, or `null` if no signed-in user.
 * Runs in the cloud page's isolated context so main never handles a raw Firebase token.
 */
export const FETCH_TIER_JS = `(async () => {
  const PREFIX = ${JSON.stringify(FIREBASE_AUTH_KEY_PREFIX)};
  const IDB_NAME = ${JSON.stringify(FIREBASE_IDB_NAME)};
  const IDB_STORE = ${JSON.stringify(FIREBASE_IDB_STORE)};
  const tokenOf = (rec) => {
    if (!rec || typeof rec !== 'object') return null;
    const mgr = rec.stsTokenManager;
    if (!mgr || typeof mgr !== 'object') return null;
    const t = mgr.accessToken;
    return typeof t === 'string' && t.length > 0 ? t : null;
  };
  // More than one firebase:authUser:* record can exist - a project switch leaves the old apiKey's
  // key behind, and the key embeds the apiKey. Taking whichever enumerates first is not a choice:
  // a stale record can 401 forever while a valid token sits untried, or, if the stale one is still
  // valid, fetch the FORMER ACCOUNT'S tier and persist it. So collect the candidates and let the
  // API arbitrate - the active token is the one /customers/me accepts. Bounded because the records
  // are page-controlled.
  const MAX_CANDIDATES = 4;
  try {
    const tokens = [];
    const addToken = (t) => {
      if (t && tokens.indexOf(t) === -1 && tokens.length < MAX_CANDIDATES) tokens.push(t);
    };
    // localStorage FIRST, because that is where the session SETTLES. The frontend's SDK starts
    // IndexedDB-first and the auth store then moves the record to localStorage, clearing the
    // others - so reading IndexedDB alone finds a copy the SDK discarded, or nothing at all, and
    // this reader reported "no signed-in user" for every signed-in cloud session. Same root cause
    // as the auth-consensus readers; see shared/firebaseAuthStorage.ts.
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        void localStorage.length;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (typeof k !== 'string' || k.indexOf(PREFIX) !== 0) continue;
          const raw = localStorage.getItem(k);
          if (typeof raw !== 'string') continue;
          try { addToken(tokenOf(JSON.parse(raw))); } catch (_) {}
        }
      }
    } catch (_) {
      // Blocked or partitioned storage. Unlike the consensus readers this one has no destructive
      // path - a wrong answer leaves the cached tier alone - so it simply tries the other store.
    }

    if (tokens.length === 0) {
      const dbReq = indexedDB.open(IDB_NAME);
      const db = await new Promise((res, rej) => {
        dbReq.onsuccess = () => res(dbReq.result);
        dbReq.onerror = () => rej(dbReq.error);
      });
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const allReq = store.getAll();
      const all = await new Promise((res, rej) => {
        allReq.onsuccess = () => res(allReq.result);
        allReq.onerror = () => rej(allReq.error);
      });
      (all || []).forEach((e) => {
        if (!e || typeof e !== 'object') return;
        if (typeof e.fbase_key !== 'string' || e.fbase_key.indexOf(PREFIX) !== 0) return;
        addToken(tokenOf(e.value));
      });
    }
    if (tokens.length === 0) return null;
    let lastError = null;
    for (const candidate of tokens) {
      const resp = await fetch('https://api.comfy.org/customers/me', {
        headers: { 'Authorization': 'Bearer ' + candidate },
        credentials: 'omit',
      });
      if (!resp.ok) { lastError = 'http_' + resp.status; continue; }
      const data = await resp.json().catch(() => null);
      if (!data || typeof data !== 'object') { lastError = 'bad_json'; continue; }
      return { tier: data.subscription_tier || 'FREE' };
    }
    return { error: lastError || 'no_valid_token' };
  } catch (e) {
    return { error: (e && e.message) ? String(e.message) : 'unknown' };
  }
})()`

interface FetchResult {
  tier?: string
  error?: string
}

/** Fire-and-forget tier refresh against a cloud webContents. Errors never throw; leave cache alone. */
export async function refreshCloudUserTier(webContents: WebContents): Promise<void> {
  try {
    const result = (await webContents.executeJavaScript(FETCH_TIER_JS)) as FetchResult | null
    if (!result) {
      // No signed-in record; don't overwrite a known-paid cache (may be transient during sign-in).
      return
    }
    if (result.error) {
      console.log('[user-tier] refresh skipped:', result.error)
      return
    }
    await setTier(result.tier ?? null)

    console.log('[user-tier] refresh: raw=', result.tier, '→ cached=', cached)
  } catch (err) {
    console.log('[user-tier] executeJavaScript failed:', err)
  }
}

/** @internal — exposed for tests. */
export function _resetForTest(): void {
  cached = 'unknown'
  initPromise = null
  persistPath = null
}
