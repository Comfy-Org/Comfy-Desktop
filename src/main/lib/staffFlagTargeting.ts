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
 * A single boolean, in `<configDir>/staff-targeting.json`. The email is classified the moment it
 * is read and then discarded: it is never persisted, never handed to `telemetry.ts`, and never
 * leaves the page context it was read in. So the strongest privacy claim here is structural
 * rather than procedural — there is no code path by which an address could reach PostHog or the
 * disk, because no module downstream of this one is ever given one.
 *
 * The cost of that is deliberate and worth naming: the `@comfy.org` test lives in the CLIENT
 * (`isStaffEmail`), so changing which cohort is targeted needs a Desktop release rather than a
 * PostHog config edit. Sending the raw email instead would keep that flexibility, at the price
 * of a plaintext address at rest for every logged-in user.
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
 */
import path from 'path'
import type { WebContents } from 'electron'
import { configDir } from './paths'
import { readFileSafe, writeFileSafe } from './safe-file'
import * as telemetry from './telemetry'

const PERSIST_FILENAME = 'staff-targeting.json'

/** Lower-cased before comparison so `Foo@Comfy.org` classifies the same as `foo@comfy.org`;
 *  `toLowerCase` rather than `toLocaleLowerCase` to avoid the Turkish dotless-I hazard. */
const STAFF_EMAIL_SUFFIX = '@comfy.org'

function persistFilePath(): string {
  return path.join(configDir(), PERSIST_FILENAME)
}

/**
 * Whether an address belongs to Comfy staff.
 *
 * Exported for its own test rather than inlined: it is the entire definition of the cohort, and
 * the one place a client-side membership rule exists at all.
 */
export function isStaffEmail(email: string | null | undefined): boolean {
  if (typeof email !== 'string') return false
  return email.trim().toLowerCase().endsWith(STAFF_EMAIL_SUFFIX)
}

/** Mirrors the process-wide value so a repeat classification does not rewrite an unchanged file
 *  on every page load. `null` until `initStaffFlagTargeting` has read the disk. */
let cached: boolean | null = null

/**
 * Read the stored classification and bind it for this launch's flag evaluation.
 *
 * MUST run before the ops flags are initialised, or the boot evaluation goes out without the
 * property and the targeting misses for that launch. Synchronous for exactly that reason: an
 * async read would have to be awaited by every caller that follows, and the ordering would be a
 * convention rather than a guarantee.
 *
 * Missing, unreadable, or malformed content all mean "not staff" — the file is user-writable
 * JSON on disk, so every failure mode has to read as the safe direction.
 */
export function initStaffFlagTargeting(): void {
  cached = readPersistedStaff()
  telemetry.setFlagEvaluationStaff(cached)
  console.log('[staff-targeting] init: persisted=', cached)
}

function readPersistedStaff(): boolean {
  const outcome = readFileSafe(persistFilePath())
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
 * Page-context read of the signed-in account's email.
 *
 * Follows `localFirebaseAuthMonitor.ts` rather than `userTier.ts`: it checks
 * `indexedDB.databases()` before opening, so a read never CREATES an empty database on an origin
 * that has no Firebase record; it guards `objectStoreNames.contains`, so an absent store reads as
 * signed-out instead of throwing; and it closes the connection, so a later Firebase
 * `versionchange` is not blocked. `userTier.ts` predates that pattern and does none of the three.
 *
 * Resolves `null` for no signed-in user, no record, or a record without an email — all ordinary
 * states, not failures.
 */
const READ_ACCOUNT_EMAIL_JS = `(async () => {
  var db = null;
  try {
    if (!indexedDB.databases) return null;
    var dbs = await indexedDB.databases();
    if (!dbs.some(function (d) { return d && d.name === 'firebaseLocalStorageDb'; })) return null;
    var req = indexedDB.open('firebaseLocalStorageDb');
    db = await new Promise(function (res, rej) {
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
    if (!db.objectStoreNames.contains('firebaseLocalStorage')) return null;
    var store = db.transaction('firebaseLocalStorage', 'readonly')
      .objectStore('firebaseLocalStorage');
    var allReq = store.getAll();
    var all = await new Promise(function (res, rej) {
      allReq.onsuccess = function () { res(allReq.result); };
      allReq.onerror = function () { rej(allReq.error); };
    });
    var entry = (all || []).find(function (e) {
      return e && typeof e === 'object' && typeof e.fbase_key === 'string' &&
        e.fbase_key.indexOf('firebase:authUser:') === 0;
    });
    var email = entry && entry.value ? entry.value.email : null;
    return typeof email === 'string' && email.length > 0 ? email : null;
  } catch (e) {
    return null;
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
 */
export async function refreshStaffFlagTargeting(webContents: WebContents): Promise<void> {
  try {
    const email = (await webContents.executeJavaScript(READ_ACCOUNT_EMAIL_JS)) as string | null
    const isStaff = isStaffEmail(email)
    // Bound immediately even though this launch's flag fetch has long since gone out: a flag
    // initialised later in the session (or re-read in a test) should see the current answer, and
    // it costs nothing.
    telemetry.setFlagEvaluationStaff(isStaff)
    if (isStaff === cached) return
    cached = isStaff
    writeFileSafe(persistFilePath(), JSON.stringify({ staff: isStaff, ts: Date.now() }))
    console.log('[staff-targeting] refresh: staff=', isStaff, '→ next launch')
  } catch (err) {
    console.log('[staff-targeting] refresh skipped:', err)
  }
}

/** @internal — exposed for tests. */
export function _resetForTest(): void {
  cached = null
}
