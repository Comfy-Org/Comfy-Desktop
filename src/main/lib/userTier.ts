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
  const OPEN_TIMEOUT_MS = 5000;
  const FETCH_TIMEOUT_MS = 10000;
  // The records are page-controlled, so the candidate list must be too.
  const MAX_CANDIDATES = 4;
  let db = null;
  const tokenOf = (rec) => {
    if (!rec || typeof rec !== 'object') return null;
    const mgr = rec.stsTokenManager;
    if (!mgr || typeof mgr !== 'object') return null;
    const t = mgr.accessToken;
    return typeof t === 'string' && t.length > 0 ? t : null;
  };
  const tokens = [];
  // Set when the cap actually dropped a distinct token. Without it a truncated candidate list and a
  // genuine sign-out both return 'no_valid_token', so "we did not look at all of them" would read
  // downstream as "nobody is signed in" - the cap is right, but it must not be invisible.
  let truncated = false;
  const addToken = (t) => {
    if (!t || tokens.indexOf(t) !== -1) return;
    if (tokens.length >= MAX_CANDIDATES) { truncated = true; return; }
    tokens.push(t);
  };
  try {
    // localStorage FIRST, because that is where the session SETTLES. The SDK starts
    // IndexedDB-first and the auth store then moves the record here, clearing the others - so
    // reading IndexedDB alone finds a copy the SDK discarded, or nothing, which is why this
    // reader reported no signed-in user for every signed-in cloud session.
    // More than one record can exist: a project switch leaves the old apiKey's key behind and the
    // key embeds the apiKey. Collect them all and let the API arbitrate.
    let lsReadable = false;
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        void localStorage.length;
        lsReadable = true;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (typeof k !== 'string' || k.indexOf(PREFIX) !== 0) continue;
          const raw = localStorage.getItem(k);
          if (typeof raw !== 'string') continue;
          try { addToken(tokenOf(JSON.parse(raw))); } catch (_) {}
        }
      }
    } catch (_) {
      lsReadable = false;
    }

    if (tokens.length === 0) {
      // localStorage was READABLE and held nothing. IndexedDB may hold the live user mid-boot, or
      // a copy the SDK's best-effort cleanup left after a sign-out - and nothing in the record
      // says which. A discarded token still inside its hour would fetch the FORMER ACCOUNT'S tier
      // and persist it. So only a localStorage that could not be read AT ALL licenses the
      // fallback, which is the rule the consensus readers apply for the same reason.
      // Reading only one store also means no verdict is ever assembled from two reads taken at
      // different instants, so the cross-store straddle cannot arise here.
      if (lsReadable) return null;

      if (!indexedDB.databases) return null;
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d && d.name === IDB_NAME)) return null;

      const req = indexedDB.open(IDB_NAME);
      db = await new Promise((res, rej) => {
        let settled = false;
        const finish = (fn, v) => { if (!settled) { settled = true; fn(v); } };
        // A blocked open fires neither success nor error; without this the promise never settles
        // and main keeps the page alive awaiting it.
        req.onblocked = () => finish(rej, new Error('blocked'));
        // databases() and this open are a TOCTOU pair: a versionless open CREATES the database if
        // it vanished in between. Aborting the version change keeps a READ from having a side
        // effect - otherwise this leaves an empty store-less db behind and the transaction below
        // throws NotFoundError.
        req.onupgradeneeded = () => {
          try { req.transaction.abort(); } catch (_) { finish(rej, new Error('created')); }
        };
        req.onsuccess = () => {
          // The open can still succeed after a timeout or a blocked rejection; close it rather
          // than leaving a connection that blocks a later Firebase versionchange.
          if (settled) { try { req.result.close(); } catch (_) {} return; }
          finish(res, req.result);
        };
        req.onerror = () => finish(rej, req.error);
        setTimeout(() => finish(rej, new Error('timeout')), OPEN_TIMEOUT_MS);
      });
      if (!db.objectStoreNames.contains(IDB_STORE)) return null;
      const store = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE);
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

    // The active token is the one the API accepts. A stale record would otherwise 401 forever
    // while a valid token sat untried.
    let lastError = null;
    for (const candidate of tokens) {
      let resp;
      try {
        resp = await fetch('https://api.comfy.org/customers/me', {
          headers: { 'Authorization': 'Bearer ' + candidate },
          credentials: 'omit',
          // Without this a stalled server leaves executeJavaScript - and the main-process caller
          // awaiting it - pending for the life of the page.
          signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
            ? AbortSignal.timeout(FETCH_TIMEOUT_MS)
            : undefined,
        });
      } catch (e) {
        // Transient. Says NOTHING about this token, so do not advance: trying the next candidate
        // during an outage would reach for a LEFTOVER record and revive a former account's tier,
        // which is the outcome the candidate list exists to prevent. Retry on the next refresh.
        return { error: (e && e.name === 'TimeoutError') ? 'timeout' : 'network' };
      }
      if (!resp.ok) {
        // Only an auth rejection means THIS TOKEN is not accepted. A 5xx is the server, not the
        // credential, so it must not promote the next candidate either.
        if (resp.status === 401 || resp.status === 403) {
          lastError = 'http_' + resp.status;
          continue;
        }
        return { error: 'http_' + resp.status };
      }
      const data = await resp.json().catch(() => null);
      // Malformed body from an ACCEPTED token: the server answered, so the credential was fine.
      if (!data || typeof data !== 'object') return { error: 'bad_json' };
      // Pass the field THROUGH, defaulting nowhere. setTier already maps null/missing/unknown to
      // 'free', so defaulting here was redundant - and it destroyed the only evidence of whether
      // the API actually said anything. An account with no subscription_tier logged 'raw= FREE',
      // indistinguishable from the API returning FREE, which made the log assert an observation it
      // had not made.
      return { tier: data.subscription_tier ?? null };
    }
    // truncated rides ALONGSIDE the error rather than replacing it. The first attempt at this made
    // it a separate 'no_valid_token_truncated' value, which is unreachable: falling through this loop
    // requires the 401/403 continue, so lastError is always set unless tokens was EMPTY - and an
    // empty list cannot have been truncated. The case that actually occurs is every candidate
    // REJECTED while more existed, which returns http_401 and is otherwise indistinguishable from
    // having seen them all.
    const err = lastError || 'no_valid_token';
    return truncated ? { error: err, truncated: true } : { error: err };
  } catch (e) {
    // The ONLY error path not drawn from a fixed vocabulary, and it reaches the main-process launch
    // log via '[user-tier] refresh skipped:', which QA uploads bundle. Every reachable throw here is
    // bounded - DOMException from IndexedDB, plus the explicit 'blocked' / 'created' / 'timeout' -
    // and the one genuinely page-controlled source, JSON.parse(raw) on a page-written record, is
    // swallowed by its own inner catch and never arrives here. That containment is what keeps this
    // safe: if that inner catch is ever removed or widened, a page could choose this string.
    return { error: (e && e.message) ? String(e.message) : 'unknown' };
  } finally {
    if (db) { try { db.close(); } catch (_) {} }
  }
})()`

interface FetchResult {
  /** The API's `subscription_tier` verbatim: `null` when the field is absent, never defaulted here. */
  tier?: string | null
  error?: string
  /** Set only when the candidate cap dropped a distinct token, so "every candidate was rejected"
   *  can be told apart from "we did not look at all of them". */
  truncated?: boolean
}

/** Fire-and-forget tier refresh against a cloud webContents. Errors never throw; leave cache alone. */
export async function refreshCloudUserTier(webContents: WebContents): Promise<void> {
  try {
    const result = (await webContents.executeJavaScript(FETCH_TIER_JS)) as FetchResult | null
    if (!result) {
      // No signed-in record; don't overwrite a known-paid cache (may be transient during sign-in).
      // LOGGED, because the silence was the expensive part. A native run spent two boots unable to
      // tell "no record found" from "the refresh never ran" - from outside the app they look
      // identical, and the empty-result path emitted nothing at all.
      // Deliberately does NOT claim both stores were read: when localStorage is readable and empty
      // the script returns without consulting IndexedDB at all, so "either store" would be false
      // in the commonest case this line fires.
      console.log('[user-tier] refresh: no usable auth record; cache left alone')
      return
    }
    if (result.error) {
      // The truncation marker is appended rather than folded into the error, so an existing reader
      // grepping for a known error value still matches.
      console.log(
        '[user-tier] refresh skipped:',
        result.error,
        result.truncated === true ? '(candidate list truncated — more records than the cap)' : ''
      )
      return
    }
    await setTier(result.tier ?? null)

    console.log(
      '[user-tier] refresh: raw=',
      result.tier === null || result.tier === undefined ? '(absent)' : result.tier,
      '→ cached=',
      cached
    )
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
