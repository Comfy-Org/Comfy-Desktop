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
 * A single boolean, in `<configDir>/staff-targeting.json`. The ADDRESS is compared inside the
 * page (`CLASSIFY_STAFF_JS`) and never crosses the IPC boundary at all, so it is never persisted,
 * never handed to `telemetry.ts`, and never present in main-process memory. The privacy claim is
 * therefore structural rather than procedural: no module downstream of the page script is ever
 * given an address, so none can leak one.
 *
 * Besides the boolean the page returns the UID it classified, which main compares against the
 * agreed account and discards. That is not a new class of data at this boundary: the same UID,
 * from the same store, already crosses it continuously on the identity-consensus path
 * (`reportFirebaseAuthState`). It is bounded in the page and re-checked by
 * `normalizePostHogUserId`, the same gate consensus applies, so nothing unbounded lands in
 * main-process memory or a crash dump — and no address is involved either way.
 *
 * The cost of that is deliberate and worth naming: the `@comfy.org` test lives in the CLIENT
 * (`STAFF_EMAIL_SUFFIX`), so changing which cohort is targeted needs a Desktop release rather
 * than a PostHog config edit. Sending the raw email instead would keep that flexibility, at the
 * price of a plaintext address at rest for every logged-in user.
 *
 * ## Which account gets classified
 *
 * The one the whole process agrees on — `firebaseAuthIdentity.ts`'s consensus — not whichever
 * view loaded a document most recently. A view is a single sample of a state several views
 * contribute to, and reading one directly gets three things wrong at once: it cannot see a
 * sign-out that never navigates, it has no way to reconcile two views signed into two accounts,
 * and it will happily classify an account this process does not believe is signed in.
 *
 * So the outcome drives the classification:
 *
 *   - **`signed_in`** — ask a view the consensus counts as holding that account, and accept its
 *     answer only if the page agrees it classified that same UID.
 *   - **`signed_out`** — store `false`. Every contributor resolved and none is signed in, which
 *     is the one state that is real evidence of a sign-out.
 *   - **`pending` / `conflicted` / `unknown`** — hold. A view mid-resolution, two views disagreeing
 *     about which account is signed in, and no view able to say at all are all *absence* of an
 *     answer. Writing one anyway is how a wrong classification outlives the session that caused
 *     it, because whatever lands on disk is what the next boot is targeted on.
 *
 * `unknown` matters more than it looks: closing the last window leaves nobody to affirm the
 * account, and `firebaseAuthIdentity` rightly detaches telemetry there. Persisting `false` on the
 * same signal would revoke a staff grant for quitting the app.
 *
 * ## What this is NOT
 *
 * Still NOT an authorization boundary, and the consensus does not make it one. Both the
 * classification and the reports that consensus reconciles come from pages, reading the same
 * IndexedDB, so page-level code — a custom-node extension, or XSS on a hosted frontend — that can
 * forge a `firebase:authUser:*` record can forge both halves and self-classify as staff. What the
 * cross-check removes is *non-hostile* wrongness: the last document to load deciding, a stale
 * second record deciding, and a classification landing while two views disagree.
 *
 * What a forgery buys is unchanged and bounded: the property only makes a person CONDITION
 * evaluable, the server still decides, and `coreBetaGrants` will only ever add args already on its
 * own allowlist. Nothing here should ever gate access, entitlement, or anything a user could want
 * to forge their way into.
 *
 * ## Why the boolean is persisted rather than resolved at boot
 *
 * The account is only knowable from a webContents: main learns an identity via the Firebase auth
 * consensus (`firebaseAuthIdentity.ts`), and on a session RESTORED from a previous launch it
 * learns a UID and no email at all — `flowShared.ts` attaches an email only on a fresh
 * desktop-driven sign-in. That is long after the boot flag fetch has answered.
 *
 * So the classification is made whenever the consensus resolves, and read back at the NEXT boot,
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
import {
  getFirebaseIdentityConsensus,
  observeFirebaseIdentityConsensus,
  viewsReportingFirebaseUser,
  type FirebaseIdentityConsensus
} from './firebaseAuthIdentity'
import { normalizePostHogUserId } from './opaqueIdentifier'
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

/** The account the in-memory classification belongs to, so returning to an account already
 *  classified this session costs no page read. `null` when the classification belongs to no
 *  account (a resolved sign-out) or when none has been made. */
let classifiedUserId: string | null = null

/** The classification held for `classifiedUserId`. `null` means the account is agreed but not yet
 *  classified — a page read is in flight, or every attempt at one failed. */
let classifiedStaff: boolean | null = null

/** Bumped on every consensus change. A page read is asynchronous and the account can be superseded
 *  while one is in flight; without this an answer about the account signed out a moment ago would
 *  be applied to whoever is signed in now. */
let classificationGeneration = 0

/** The generation whose classification has already been accepted. Two reads can be in flight for
 *  one generation — a `dom-ready` retry alongside the consensus observer's own — and both would
 *  pass the generation check, so the slower one would overwrite the faster one's verdict purely on
 *  settle order. One accepted answer per consensus outcome; later arrivals for it are ignored. */
let answeredGeneration: number | null = null

let unobserveConsensus: (() => void) | null = null

/** A page read that never settles must not keep a `WebContents` awaited forever, nor block the
 *  views behind it. `CLASSIFY_STAFF_JS` bounds its own `indexedDB.open`, but `databases()` and
 *  `getAll` are unbounded and a hostile page can replace either with a promise that never
 *  resolves. `executeJavaScript` has no timeout of its own. */
const PAGE_READ_TIMEOUT_MS = 10_000

/** What `normalizePostHogUserId` will accept, applied to the raw string so trimming cannot sneak an
 *  over-length uid under the limit. The page caps at one past this, so a longer uid is rejected. */
const MAX_PAGE_USER_ID_CHARS = 256

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
  // Subscribed here rather than at module load so the wiring is explicit and ordered: this runs
  // before any view exists, so no outcome can be missed, and a second call cannot double-subscribe.
  unobserveConsensus ??= observeFirebaseIdentityConsensus(onIdentityConsensus)
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
 * Returns a BOOLEAN and the UID it is about — never the address, which is compared in the page and
 * never crosses the IPC boundary, so the privacy claim above is structurally true rather than a
 * convention.
 *
 * The UID is what lets main check that this page classified the account the process actually
 * agrees is signed in. Bounded to 257 characters here — one past what `normalizePostHogUserId`
 * will accept — so an over-length UID is REJECTED in main rather than silently truncated into a
 * collision with a different account, and no unbounded page-controlled string reaches
 * main-process memory or a crash dump. `null` when no account is stored.
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
    // No record at all is a real signed-out state and votes "not staff", for no account.
    if (users.length === 0) return { known: true, staff: false, userId: null };
    // Two accounts at once is unresolved, not a coin flip on iteration order.
    if (users.length > 1) return { known: false };
    var user = users[0];
    // One past the 256 main will accept, so an over-length uid is REJECTED there rather than
    // truncated into a match with a different account.
    var userId = user.uid.slice(0, 257);
    if (user.emailVerified !== true) return { known: true, staff: false, userId: userId };
    var email = typeof user.email === 'string' ? user.email : '';
    return {
      known: true,
      staff: email.trim().toLowerCase().slice(-SUFFIX.length) === SUFFIX,
      userId: userId
    };
  } catch (e) {
    return { known: false };
  } finally {
    if (db) { try { db.close(); } catch (_) {} }
  }
})()`

/**
 * Bind a classification and carry it to the next launch.
 *
 * The one place a classification reaches telemetry or the disk. Bound immediately even though
 * this launch's flag fetch has long since gone out: a flag initialised later in the session (or
 * re-read in a test) should see the current answer, and it costs nothing.
 */
function applyClassification(isStaff: boolean): void {
  telemetry.setFlagEvaluationStaff(isStaff)
  if (isStaff === cached) return
  try {
    writeFileSafe(persistFilePath(), JSON.stringify({ staff: isStaff, ts: Date.now() }))
    // AFTER the write, never before. `writeFileSafe` can exhaust its retries on a transient lock
    // or an unavailable config dir, and the catch below swallows that. Moving `cached` first
    // would record a write that never landed, and the equality check above would then suppress
    // every later attempt at the same classification — so the next launch would read the stale
    // value even once the filesystem recovered.
    cached = isStaff
    console.log('[staff-targeting] classified: staff=', isStaff, '→ next launch')
  } catch (err) {
    console.log('[staff-targeting] store skipped:', err)
  }
}

/**
 * Run the classification script in a view, giving up if the page does not answer.
 *
 * The timeout bounds THIS await, not the page's work — `executeJavaScript` cannot be cancelled, so
 * a wedged page keeps its own promise. What it does buy is that one such page no longer holds up
 * every view behind it, and no read is awaited for the life of the session.
 */
async function readClassificationFromPage(webContents: WebContents): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      webContents.executeJavaScript(CLASSIFY_STAFF_JS),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('page read timed out')), PAGE_READ_TIMEOUT_MS)
        timer.unref?.()
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Ask one view to classify `userId`, and accept its answer only if it agrees that is the account
 * it read.
 *
 * The cross-check is the point. A view can be trusted to report auth state and still be the wrong
 * one to ask: its store can hold a different account than the one consensus settled on (on Cloud
 * the reporter is the frontend's own auth sync, a different source entirely from the IndexedDB
 * this reads), or it can have changed underneath between the report and this read. Disagreement
 * is not a failure to retry — it means this view is answering about somebody else.
 *
 * Returns whether a classification was applied, so a caller can move on to the next view.
 */
async function classifyFromView(
  webContents: WebContents,
  userId: string,
  generation: number
): Promise<boolean> {
  let read: { known?: unknown; staff?: unknown; userId?: unknown } | null
  try {
    read = (await readClassificationFromPage(webContents)) as typeof read
  } catch (err) {
    // A page that cannot be read must not revoke a grant.
    console.log('[staff-targeting] read skipped:', err)
    return false
  }
  // The account can be superseded while the read is in flight.
  if (generation !== classificationGeneration) return false
  // Another read already answered for this outcome. Letting a second one through would make the
  // verdict depend on which page happened to settle last.
  if (answeredGeneration === generation) return false
  // A view with no Firebase store has NO OPINION and must stay silent. Absence of an auth record
  // is not evidence of being signed out, so only a view that can actually see auth state votes.
  if (!read || read.known !== true) return false
  // Bound the raw string BEFORE normalizing: `normalizePostHogUserId` trims and only then applies
  // its 256-character limit, so a 257-character uid ending in whitespace would normalize down to
  // 256 and be accepted — defeating the page-side cap that exists to reject rather than truncate.
  if (typeof read.userId !== 'string' || read.userId.length > MAX_PAGE_USER_ID_CHARS) return false
  if (normalizePostHogUserId(read.userId) !== userId) return false
  const isStaff = read.staff === true
  answeredGeneration = generation
  classifiedUserId = userId
  classifiedStaff = isStaff
  applyClassification(isStaff)
  return true
}

/**
 * Ask each view consensus counts as holding `userId` until one agrees it read that account.
 *
 * Sequential, so the common single-view case costs one page read. A view that does not answer no
 * longer holds up the ones behind it: `readClassificationFromPage` bounds every call, and
 * `classifyFromView` returns false on that timeout, so this loop moves on to the next view.
 *
 * ACCEPTED DEBT, decided rather than overlooked. First accepted answer wins, so where two views
 * hold the same account and disagree — one store still carrying a verified `@comfy.org` address,
 * another the updated or unverified one — the verdict depends on iteration order. Raised in review
 * and kept deliberately:
 *
 *   - The harm is bounded. This is cohort targeting, not authorization: the server evaluates the
 *     condition, and a grant only ever adds an arg from `CORE_BETA_GRANTABLE_ARGS`. The wrong
 *     tie-break costs a missed or spurious beta arg, never access to anything.
 *   - It is already less order-dependent than what it replaces, where classification ran per view
 *     on `dom-ready` with no UID check at all, so the last document to load decided — including a
 *     view signed into a different account.
 *   - Both alternatives introduce order-sensitivity of their own. Requiring agreement lets one
 *     stale or incomplete copy veto a correct `true`; preferring `true` biases toward granting.
 *     Choosing between them is really a decision about what `CLASSIFY_STAFF_JS` should return for
 *     a record with no email or an unverified one — the cohort rule this module inherited.
 */
async function classifyAgreedAccount(userId: string, generation: number): Promise<void> {
  for (const webContents of viewsReportingFirebaseUser(userId)) {
    if (generation !== classificationGeneration) return
    if (await classifyFromView(webContents, userId, generation)) return
  }
}

/**
 * Drive the classification from the reconciled identity rather than from a page load.
 *
 * See the module note on which outcomes may write and which must hold. The short version: only
 * `signed_out` and `signed_in` are evidence; `pending`, `conflicted` and `unknown` are the absence
 * of an answer, and a persisted fact must not move on those.
 */
function onIdentityConsensus(consensus: FirebaseIdentityConsensus): void {
  classificationGeneration += 1
  if (consensus.status === 'signed_out') {
    // Every contributor resolved and none is signed in. This is what lets a machine that changes
    // hands stop presenting as staff — and, with the boot evaluation authoritative, what lets the
    // server take a grant back normally.
    classifiedUserId = null
    classifiedStaff = false
    applyClassification(false)
    return
  }
  if (consensus.status !== 'signed_in') return
  if (classifiedUserId === consensus.userId && classifiedStaff !== null) {
    // Already classified this session — the common case, since a navigation takes the consensus
    // through `pending` and back. Bind the known answer FIRST, so the account keeps its
    // classification with no gap and a write that exhausted `writeFileSafe`'s attempts is retried.
    applyClassification(classifiedStaff)
    // Then revalidate, because a UID is not a classification. `staff` is derived from `email` and
    // `emailVerified`, both of which can change while Firebase keeps reporting the same UID — an
    // address verified mid-session, or one that changes domain. Caching the verdict against the
    // UID alone would make it immutable for the life of the process, which is stricter than the
    // behaviour this replaces: the per-view read ran on every `dom-ready` and would have seen the
    // change. Every document load takes the consensus through `pending` and back, so this runs on
    // that same cadence and costs the same one page read.
    void classifyAgreedAccount(consensus.userId, classificationGeneration)
    return
  }
  classifiedUserId = consensus.userId
  classifiedStaff = null
  // A switch straight from one account to another with no resolved sign-out between them holds
  // the outgoing account's classification for the duration of one page read. Held, not cleared:
  // clearing would revoke a grant on a report that may yet turn out to be transient.
  void classifyAgreedAccount(consensus.userId, classificationGeneration)
}

/**
 * Offer a freshly loaded view as a classifier for the account already agreed on.
 *
 * A retry path, not an authority. The consensus observer above is what normally classifies; this
 * covers the case where it resolved while the views it asked could not answer — a page mid-load,
 * an `executeJavaScript` that threw — and a later view can. It is a no-op unless an account is
 * agreed and still unclassified, so the ordinary page load costs nothing.
 *
 * Called for LOCAL installs as well as cloud ones, which matters more than it looks: the grant
 * these flags carry is consumed only by the local launch path (`buildLaunchArgs`, launch.ts),
 * because a cloud install has no launch command and spawns no Core. Binding on cloud views alone
 * would target every surface except the one that can use the result.
 *
 * Fire-and-forget. Every failure leaves the stored classification exactly as it was, so a page
 * that cannot be read cannot revoke a grant.
 */
export async function refreshStaffFlagTargeting(webContents: WebContents): Promise<void> {
  const consensus = getFirebaseIdentityConsensus()
  // A resolved sign-out is the observer's to DECIDE — it is a fact about every view, and one view
  // reaching dom-ready says nothing about the others. But re-applying a decision already taken is
  // a write retry, not a decision, and the revocation write is the one with no other retry path:
  // `publishConsensus` is change-only so `signed_out` is not re-delivered while it stands, and a
  // `writeFileSafe` that threw would otherwise leave `staff: true` on disk for every later launch
  // — silently reversing the revocation this module exists to make.
  if (consensus.status === 'signed_out') {
    applyClassification(false)
    return
  }
  if (consensus.status !== 'signed_in') return
  if (classifiedUserId === consensus.userId && classifiedStaff !== null) {
    // Nothing to ask this view — but a page load is also the moment to retry a write that
    // `writeFileSafe` could not land, since the next launch reads whatever the disk holds.
    applyClassification(classifiedStaff)
    return
  }
  await classifyFromView(webContents, consensus.userId, classificationGeneration)
}

/** @internal — exposed for tests. */
export function _resetForTest(): void {
  cached = null
  classifiedUserId = null
  classifiedStaff = null
  classificationGeneration = 0
  answeredGeneration = null
  unobserveConsensus?.()
  unobserveConsensus = null
}
