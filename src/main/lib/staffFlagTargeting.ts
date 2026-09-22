/**
 * Makes ops flags targetable at Comfy staff, which the installation hash alone cannot express.
 *
 * Ops flags are evaluated at boot against the installation hash (`deviceId.ts`), which PostHog
 * cannot resolve to a person. A release condition on any person attribute therefore never
 * matches — not "matches late", never — so a staff rollout silently reached nobody and
 * distinct-id allowlisting was the only mechanism that worked. This supplies a person property
 * the condition CAN match.
 *
 * ## What is stored, and what is not
 *
 * A single boolean, in `<configDir>/staff-targeting.json`. The address is compared inside the
 * page (`CLASSIFY_STAFF_JS`) and only the derived boolean crosses the IPC boundary, so it is
 * never persisted, never handed to `telemetry.ts`, and never present in main-process memory at
 * all. The privacy claim is therefore structural rather than procedural: no module downstream of
 * the page script is ever given an address, so none can leak one.
 *
 * The cost of that is deliberate and worth naming: the `@comfy.org` test lives in the CLIENT
 * (`STAFF_EMAIL_SUFFIX`), so changing which cohort is targeted needs a Desktop release rather
 * than a PostHog config edit. Sending the raw email instead would keep that flexibility, at the
 * price of a plaintext address at rest for every logged-in user.
 *
 * ## What this is NOT
 *
 * NOT an authorization boundary. The classification comes from the page's own main world, so
 * page-level code — a custom-node extension, or XSS on a hosted frontend — can forge a
 * `firebase:authUser:*` record or patch the IndexedDB API and self-classify as staff. What that
 * buys is bounded: the property only makes a person CONDITION evaluable, the server still
 * decides, and `coreBetaGrants` will only ever add args already on its own allowlist. Nothing
 * here should ever gate access, entitlement, or anything a user could want to forge their way
 * into. Closing it properly means cross-checking against main's own Firebase identity
 * (`firebaseAuthIdentity.ts`), which is a larger change than this one.
 *
 * ## Why the boolean is persisted rather than resolved at boot
 *
 * The account is only knowable from a webContents: main learns an identity via the Firebase auth
 * consensus (`firebaseAuthIdentity.ts`), and on a session RESTORED from a previous launch it
 * learns a UID and no email at all — `flowShared.ts` attaches an email only on a fresh
 * desktop-driven sign-in. That is long after the boot flag fetch has answered.
 *
 * So the classification is made whenever a view resolves auth, and read back at the NEXT boot,
 * before the flag fetch. `userTier.ts` solves the same problem the same way. The consequence is
 * that a staff member's first launch after signing in is not targeted; the one after it is.
 *
 * A second, authenticated evaluation was tried instead of persisting anything, and does not
 * work: the anonymous boot evaluation of a person-targeted flag answers an explicit `false`, not
 * a miss, and `init` treats that as authoritative and overwrites whatever the later evaluation
 * persisted. Deep review caught it. One authoritative evaluation per launch is what keeps
 * `opsFlag.ts`'s revocation contract intact, so the identity has to be ready BEFORE it.
 *
 * ## Consent
 *
 * Reading and storing the classification is local and ungated. SENDING it is gated on consent by
 * `telemetry.opsFlagPersonProperties`: the flag fetch itself deliberately bypasses the consent
 * gate (an ops flag is config pushed TO the client), but that argument does not extend to a fact
 * about the person, so this rides only on the consented path.
 *
 * One consequence to know about: because the boot evaluation is authoritative, a staff user who
 * later turns telemetry OFF stops matching the condition, the server answers an explicit
 * `false`, and `coreBetaGrants` treats that as a revocation. So declining telemetry withdraws a
 * grant already held rather than merely declining a new one. That follows from consent being a
 * real gate, and is documented rather than worked around — exempting held grants would mean
 * keeping a targeting decision alive for someone who has withdrawn consent to be targeted.
 */
import path from 'path'
import type { WebContents } from 'electron'
import { configDir } from './paths'
import { readFileSafe, writeFileSafe } from './safe-file'
import * as telemetry from './telemetry'

const PERSIST_FILENAME = 'staff-targeting.json'

/** The entire definition of the cohort, and the one place a client-side membership rule exists.
 *  Interpolated into `CLASSIFY_STAFF_JS` so the page and this module cannot drift apart.
 *
 *  Compared lower-cased so `Foo@Comfy.org` classifies the same as `foo@comfy.org`, with
 *  `toLowerCase` rather than `toLocaleLowerCase` to avoid the Turkish dotless-I hazard. */
const STAFF_EMAIL_SUFFIX = '@comfy.org'

function persistFilePath(): string {
  return path.join(configDir(), PERSIST_FILENAME)
}

/** What the disk is believed to hold, so a repeat classification does not rewrite an unchanged
 *  file on every page load. `null` means UNKNOWN — before the first read, or when the file
 *  exists but could not be read — and an unknown value never suppresses a write. */
let cached: boolean | null = null

/**
 * Read the stored classification and bind it for this launch's flag evaluation.
 *
 * MUST run before the ops flags are initialised, or the boot evaluation goes out without the
 * property and the targeting misses for that launch. Synchronous for exactly that reason: an
 * async read would have to be awaited by every caller that follows, and the ordering would be a
 * convention rather than a guarantee.
 *
 * Missing or malformed content means "not staff" — the file is user-writable JSON on disk, so
 * those failure modes read as the safe direction. An UNREADABLE file (it exists but is locked)
 * is different and must not collapse into `false`: that would leave `cached` disagreeing with a
 * file that may hold `true`, and the unchanged-classification check would then suppress the
 * write that a genuine sign-out needs to make.
 */
export function initStaffFlagTargeting(): void {
  cached = readPersistedStaff()
  telemetry.setFlagEvaluationStaff(cached === true)
  console.log('[staff-targeting] init: persisted=', cached)
}

/** `null` when the file exists but its contents could not be recovered — unknown, not absent. */
function readPersistedStaff(): boolean | null {
  const outcome = readFileSafe(persistFilePath())
  if (outcome.kind === 'unreadable') return null
  if (outcome.kind !== 'data') return false
  try {
    const parsed: unknown = JSON.parse(outcome.data)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    return (parsed as { staff?: unknown }).staff === true
  } catch {
    return false
  }
}

/**
 * Page-context classification of the signed-in account.
 *
 * Returns only a BOOLEAN. The address is compared in the page and never crosses the IPC
 * boundary, so the privacy claim above is structurally true rather than a convention — and no
 * unbounded page-controlled string reaches main-process memory or a crash dump.
 *
 * Three guards, each answering a way the naive read gets the cohort wrong:
 *
 *   - **`emailVerified`.** Firebase email/password sign-up accepts any address, so an
 *     unverified `@comfy.org` one proves nothing about domain ownership. Unverified is not staff.
 *   - **Exactly one record.** Several `firebase:authUser:` entries can coexist, and taking the
 *     first makes the answer depend on IndexedDB iteration order — a stale record for a former
 *     staff account would classify a current non-staff session as staff. More than one distinct
 *     uid is treated as unresolved, mirroring `localFirebaseAuthMonitor`'s `pending`.
 *   - **`onblocked` and a bounded wait.** A blocked `open` never fires success or error, and
 *     `executeJavaScript` has no timeout, so the awaiting main-process promise would never
 *     settle and would leak one `WebContents` reference per page load.
 *
 * `{known: false}` means "this view cannot say" — no auth store, an unresolved multi-record
 * state, or a failed read. Only `{known: true}` is a classification.
 *
 * NOT a trust boundary. This runs in the page's main world, so page-level code could forge a
 * record or patch the IndexedDB API. See the module note on that.
 *
 * @internal — exported so its own spec can run it against a stubbed IndexedDB. It holds the
 * cohort rule, so it is tested directly rather than through a main-process stand-in that could
 * agree with a mistake.
 */
export const CLASSIFY_STAFF_JS = `(async () => {
  var db = null;
  try {
    var SUFFIX = ${JSON.stringify(STAFF_EMAIL_SUFFIX)};
    var OPEN_TIMEOUT_MS = 5000;
    if (!indexedDB.databases) return { known: false };
    var dbs = await indexedDB.databases();
    if (!dbs.some(function (d) { return d && d.name === 'firebaseLocalStorageDb'; })) {
      return { known: false };
    }
    var req = indexedDB.open('firebaseLocalStorageDb');
    db = await new Promise(function (res, rej) {
      var settled = false;
      var finish = function (fn, v) { if (!settled) { settled = true; fn(v); } };
      // A blocked open fires neither success nor error. Without this the promise never
      // settles and main keeps the page alive waiting for it.
      req.onblocked = function () { finish(rej, new Error('blocked')); };
      // The databases() check above and this open are a TOCTOU pair: if the database is removed
      // in between, a versionless open CREATES it. Aborting the version change keeps the read
      // from having a side effect, and surfaces as onerror.
      req.onupgradeneeded = function () {
        try { req.transaction.abort(); } catch (_) { finish(rej, new Error('created')); }
      };
      req.onsuccess = function () {
        // The open can still succeed after a timeout or a blocked rejection. The outer
        // handle is null by then, so the finally block has nothing to close and the
        // connection would linger and block a later Firebase versionchange.
        if (settled) { try { req.result.close(); } catch (_) {} return; }
        finish(res, req.result);
      };
      req.onerror = function () { finish(rej, req.error); };
      setTimeout(function () { finish(rej, new Error('timeout')); }, OPEN_TIMEOUT_MS);
    });
    if (!db.objectStoreNames.contains('firebaseLocalStorage')) return { known: false };
    var store = db.transaction('firebaseLocalStorage', 'readonly')
      .objectStore('firebaseLocalStorage');
    var allReq = store.getAll();
    var all = await new Promise(function (res, rej) {
      allReq.onsuccess = function () { res(allReq.result); };
      allReq.onerror = function () { rej(allReq.error); };
    });
    var users = [];
    // Prototype-free. On a plain object the keys __proto__, constructor and toString are
    // already truthy, so a record whose uid is one of them would be skipped and the
    // "exactly one account" guard below would pass on what is really a two-account state.
    var uids = Object.create(null);
    (all || []).forEach(function (e) {
      if (!e || typeof e !== 'object') return;
      if (typeof e.fbase_key !== 'string') return;
      if (e.fbase_key.indexOf('firebase:authUser:') !== 0) return;
      var v = e.value;
      if (!v || typeof v.uid !== 'string' || v.uid.length === 0) return;
      if (!uids[v.uid]) { uids[v.uid] = true; users.push(v); }
    });
    // No record at all is a real signed-out state and votes "not staff".
    if (users.length === 0) return { known: true, staff: false };
    // Two accounts at once is unresolved, not a coin flip on iteration order.
    if (users.length > 1) return { known: false };
    var user = users[0];
    if (user.emailVerified !== true) return { known: true, staff: false };
    var email = typeof user.email === 'string' ? user.email : '';
    return { known: true, staff: email.trim().toLowerCase().slice(-SUFFIX.length) === SUFFIX };
  } catch (e) {
    return { known: false };
  } finally {
    if (db) { try { db.close(); } catch (_) {} }
  }
})()`

/**
 * Classify the view's signed-in account and store the result for the next launch.
 *
 * Called for LOCAL installs as well as cloud ones, which matters more than it looks: the grant
 * these flags carry is consumed only by the local launch path (`buildLaunchArgs`, launch.ts),
 * because a cloud install has no launch command and spawns no Core. Binding on cloud views alone
 * would target every surface except the one that can use the result.
 *
 * Fire-and-forget. Every failure leaves the stored classification exactly as it was, so a page
 * that cannot be read cannot revoke a grant.
 *
 * A sign-out or a switch to a non-staff account stores `false`, so a machine that changes hands
 * stops presenting as staff on the next launch. Combined with the boot evaluation being
 * authoritative, that is also what lets the server take the grant back normally.
 *
 * KNOWN GAP, deliberate for now: this is driven by `dom-ready`, so an in-page sign-out that never
 * navigates is not seen until the next navigation, reload, or launch, and the classification can
 * stay `true` across that window. Reclassification is eventual, not immediate, and must not be
 * described as immediate. The preload's `startLocalFirebaseAuthMonitor` already polls this same
 * store on a 1s tick and would close the gap, but it reports a UID and no email, so wiring this
 * to it — or to the identity consensus in `firebaseAuthIdentity.ts`, which is what properly
 * reconciles several views — is a larger change than this one.
 */
export async function refreshStaffFlagTargeting(webContents: WebContents): Promise<void> {
  try {
    const read = (await webContents.executeJavaScript(CLASSIFY_STAFF_JS)) as {
      known?: unknown
      staff?: unknown
    } | null
    // A view with no Firebase store has NO OPINION and must stay silent. Absence of an auth
    // record is not evidence of being signed out, and treating it as such lets a local install
    // that was never signed into clear a classification a signed-in view established — a wrong
    // answer, not merely a racy one. Only a view that can actually see auth state votes.
    if (!read || read.known !== true) return
    const isStaff = read.staff === true
    // Bound immediately even though this launch's flag fetch has long since gone out: a flag
    // initialised later in the session (or re-read in a test) should see the current answer, and
    // it costs nothing.
    telemetry.setFlagEvaluationStaff(isStaff)
    if (isStaff === cached) return
    writeFileSafe(persistFilePath(), JSON.stringify({ staff: isStaff, ts: Date.now() }))
    // AFTER the write, never before. `writeFileSafe` can exhaust its retries on a transient lock
    // or an unavailable config dir, and the catch below swallows that. Moving `cached` first
    // would record a write that never landed, and the equality check above would then suppress
    // every later attempt at the same classification — so the next launch would read the stale
    // value even once the filesystem recovered.
    cached = isStaff
    console.log('[staff-targeting] refresh: staff=', isStaff, '→ next launch')
  } catch (err) {
    console.log('[staff-targeting] refresh skipped:', err)
  }
}

/** @internal — exposed for tests. */
export function _resetForTest(): void {
  cached = null
}
