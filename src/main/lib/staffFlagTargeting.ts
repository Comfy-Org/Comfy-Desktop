import path from 'path'
import type { WebContents } from 'electron'
import {
  getFirebaseIdentityConsensus,
  observeFirebaseIdentityConsensus,
  viewsReportingFirebaseUser,
  type FirebaseIdentityConsensus
} from './firebaseAuthIdentity'
import {
  FIREBASE_AUTH_KEY_PREFIX,
  FIREBASE_IDB_NAME,
  FIREBASE_IDB_STORE
} from '../../shared/firebaseAuthStorage'
import { normalizePostHogUserId } from './opaqueIdentifier'
import { configDir } from './paths'
import { readFileSafe, writeFileSafe } from './safe-file'
import * as telemetry from './telemetry'

const PERSIST_FILENAME = 'staff-targeting.json'

const STAFF_EMAIL_SUFFIX = '@comfy.org'

function persistFilePath(): string {
  return path.join(configDir(), PERSIST_FILENAME)
}

let cached: boolean | null = null

let classifiedUserId: string | null = null

let classifiedStaff: boolean | null = null

let classificationGeneration = 0

let answeredGeneration: number | null = null

let unobserveConsensus: (() => void) | null = null

let lastEvaluationSentStaff = false

let onFlagPropertiesChange: (() => void) | null = null

const PAGE_READ_TIMEOUT_MS = 10_000

const MAX_PAGE_USER_ID_CHARS = 256

export function initStaffFlagTargeting(opts: { onFlagPropertiesChange?: () => void } = {}): void {
  cached = readPersistedStaff()
  telemetry.setFlagEvaluationStaff(cached === true)
  lastEvaluationSentStaff = telemetry.sendsStaffProperty(cached === true)
  onFlagPropertiesChange ??= opts.onFlagPropertiesChange ?? null
  unobserveConsensus ??= observeFirebaseIdentityConsensus(onIdentityConsensus)
  console.log('[staff-targeting] init: persisted=', cached)
}

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

export const CLASSIFY_STAFF_JS = `(async () => {
  var db = null;
  try {
    var SUFFIX = ${JSON.stringify(STAFF_EMAIL_SUFFIX)};
    var PREFIX = ${JSON.stringify(FIREBASE_AUTH_KEY_PREFIX)};
    var IDB_NAME = ${JSON.stringify(FIREBASE_IDB_NAME)};
    var IDB_STORE = ${JSON.stringify(FIREBASE_IDB_STORE)};
    var OPEN_TIMEOUT_MS = 5000;
    // The cohort rule, in ONE place. Both readers end here, so neither can introduce a shape the
    // other does not produce - the storage changed, what absence MEANS did not.
    var verdict = function (users) {
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
    };
    // Prototype-free. On a plain object the keys __proto__, constructor and toString are
    // already truthy, so a record whose uid is one of them would be skipped and the
    // "exactly one account" guard would pass on what is really a two-account state.
    // The fields the verdict actually reads, normalised the same way it normalises them. Two
    // records for one account are only interchangeable if these agree.
    var identity = function (v) {
      var email = typeof v.email === 'string' ? v.email.trim().toLowerCase() : '';
      return (v.emailVerified === true ? '1' : '0') + '\u0000' + email;
    };
    var collect = function () {
      var seen = Object.create(null);
      var users = [];
      var conflict = false;
      return {
        users: users,
        // A uid claimed twice by records that DISAGREE. Keeping the first silently let a second
        // key decide the cohort by enumeration order: a page-origin script could plant a record
        // carrying the genuine uid and a forged verified @comfy.org address, collapse to one
        // user, pass the "exactly one account" guard, and pass main's uid cross-check because the
        // uid is real. There is no basis for preferring either record, so we do not pick one.
        conflicted: function () { return conflict; },
        add: function (v) {
          if (!v || typeof v !== 'object') return;
          if (typeof v.uid !== 'string' || v.uid.length === 0) return;
          var prev = seen[v.uid];
          if (prev) {
            if (identity(prev) !== identity(v)) conflict = true;
            return;
          }
          seen[v.uid] = v;
          users.push(v);
        }
      };
    };

    // localStorage FIRST, and decisive when it CONTAINS a record: that is where the session
    // settles, and it is read before IndexedDB for that reason - NOT because it is first in the
    // frontend's hierarchy. On the released frontend it is not: the hierarchy is IndexedDB-first
    // and the session reaches localStorage only when the auth store runs its later setPersistence.
    //
    // An empty but readable localStorage decides NOTHING, and the read continues. IndexedDB is
    // consulted next WHERE IT CAN BE - an absent or throwing one abstains rather than answering,
    // for the same reason. What is found there is resolved by the rules below - a record means the
    // stores disagree and the answer is {known:false}, because during boot the live user IS in
    // IndexedDB and reading an empty localStorage as "no account" would produce the definite
    // sign-out that deletes the loopback binding.
    //
    // Once the session HAS settled in localStorage, the SDK clears the other persistences - quoting
    // @firebase/auth dist/browser-cjs/index-919d47fb.js:2169:
    //
    //   "Attempt to clear the key in other persistences but ignore errors. This helps prevent
    //    issues such as users getting stuck with a previous account after signing out and
    //    refreshing the tab."
    //
    // So a record in IndexedDB can be one the SDK discarded - but it can equally be the live user
    // mid-boot, and nothing in the record says which. That ambiguity is why an empty localStorage
    // abstains on a record found there rather than answering from it, in either direction.
    // The BARE identifier, deliberately - not window.localStorage. Reading it off window couples
    // this to a global that exists in the page but not in every context a reader might evaluate it
    // in, and the failure is silent: the ReferenceError is caught below, ls becomes null, and we
    // fall through to the store the SDK drains - byte-identically to the bug this fixes.
    var ls = null;
    // ABSENT and BLOCKED both leave ls null, and they are NOT the same thing. Absent means
    // IndexedDB is the only persistence there is, so it may answer alone. Blocked means the store
    // that would hold the session EXISTS and could not be read - and on a localStorage-primary
    // frontend IndexedDB is empty precisely because the SDK drained it, so its silence is not
    // evidence of anything. A typeof check tells them apart: an absent global is undefined, a blocked
    // one throws on access.
    var lsBlocked = false;
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        // Touch it: presence is not readability. Blocked site data throws here, not above.
        void localStorage.length;
        ls = localStorage;
      }
    } catch (_) {
      ls = null;
      lsBlocked = true;
    }
    // null means the MECHANISM is unavailable. An empty array means it is readable and holds no
    // user - a different thing, and the whole point of the rule below.
    // Runs TWICE: once before the IndexedDB round-trip and once after, because a conclusion of
    // "no account anywhere" must not be assembled from reads taken at different instants. Returns
    // null when the mechanism failed part-way through.
    var scanLocal = function () {
      var acc = collect();
      for (var i = 0; i < ls.length; i++) {
        var k, raw;
        try {
          k = ls.key(i);
          if (typeof k !== 'string' || k.indexOf(PREFIX) !== 0) continue;
          raw = ls.getItem(k);
        } catch (_) {
          // The MECHANISM failing part-way through, after the initial touch succeeded. This is a
          // different thing from localStorage being absent, and it must not be treated as one:
          // absent means IndexedDB is the only store there is and may answer alone, whereas this
          // means the authoritative store EXISTS and we cannot finish reading it. Falling through
          // to IndexedDB here would answer from records the SDK drains - the bug this file fixes.
          // Deliberate and explicit, rather than left to the outer catch, so it can be tested.
          return null;
        }
        if (typeof raw !== 'string') continue;
        try { acc.add(JSON.parse(raw)); } catch (_) {}
      }
      return acc;
    };
    // Every "nobody is signed in" conclusion below rests on THIS read, which is taken before the
    // IndexedDB await. localStorage is synchronous, so re-reading costs one pass and delays
    // nothing - and without it the two reads can straddle the frontend's setPersistence, which
    // moves the record INTO localStorage, and report an account that never went away.
    var concludeNoAccount = function () {
      var recheck = scanLocal();
      if (recheck === null || recheck.conflicted()) return { known: false };
      // The record arrived during the round-trip: it was there all along, in the other store.
      if (recheck.users.length > 0) return verdict(recheck.users);
      return verdict([]);
    };
    var lsUsers = null;
    if (ls) {
      var fromLocal = scanLocal();
      if (fromLocal === null || fromLocal.conflicted()) return { known: false };
      lsUsers = fromLocal.users;
      // A user HERE is authoritative: localStorage is where the SDK settles the session, and any
      // IndexedDB copy is the one it drained.
      if (lsUsers.length > 0) return verdict(lsUsers);
    }

    if (!indexedDB.databases) return { known: false };
    var dbs = await indexedDB.databases();
    if (!dbs.some(function (d) { return d && d.name === IDB_NAME; })) {
      // No Firebase database at all. If localStorage was READABLE and held no user, nobody is
      // signed in in either store - the identical situation to a database that exists and is
      // empty, which returns a definite "no account" a few lines below. Answering those two
      // differently made the verdict depend on whether the SDK had ever created the database.
      // With localStorage unavailable we have no evidence from either store and still abstain.
      return lsUsers !== null ? concludeNoAccount() : { known: false };
    }
    var req = indexedDB.open(IDB_NAME);
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
    if (!db.objectStoreNames.contains(IDB_STORE)) return { known: false };
    var store = db.transaction(IDB_STORE, 'readonly')
      .objectStore(IDB_STORE);
    var allReq = store.getAll();
    var all = await new Promise(function (res, rej) {
      allReq.onsuccess = function () { res(allReq.result); };
      allReq.onerror = function () { rej(allReq.error); };
    });
    var fromIdb = collect();
    (all || []).forEach(function (e) {
      if (!e || typeof e !== 'object') return;
      if (typeof e.fbase_key !== 'string') return;
      if (e.fbase_key.indexOf(PREFIX) !== 0) return;
      fromIdb.add(e.value);
    });
    if (fromIdb.conflicted()) return { known: false };
    if (lsUsers !== null) {
      // localStorage was READABLE and held no user, and IndexedDB does. That is ambiguous and
      // cannot be resolved by reading: it is either a frontend that persists to IndexedDB (the
      // record is live), or one that is mid-boot before the session moves to localStorage, or a
      // leftover the SDK has already discarded. ABSTAIN rather than guess - a wrong "signed out"
      // here is accepted as a trusted report and DELETES the loopback binding, and a wrong
      // "signed in" resurrects an account that signed out.
      if (fromIdb.users.length > 0) return { known: false };
      // Both reads say nobody - but they were taken at different instants, so re-read before
      // concluding it. See concludeNoAccount below.
      return concludeNoAccount();
    }
    if (lsBlocked) {
      // The authoritative store exists and we could not read it. A RECORD in IndexedDB is still
      // evidence and is reported, so a frontend that persists there keeps working; the ABSENCE of
      // one is not, because we never got to ask the store that would hold it.
      return fromIdb.users.length > 0 ? verdict(fromIdb.users) : { known: false };
    }
    // No localStorage mechanism AT ALL, so IndexedDB is the only persistence there is.
    return verdict(fromIdb.users);
  } catch (e) {
    return { known: false };
  } finally {
    if (db) { try { db.close(); } catch (_) {} }
  }
})()`

function applyClassification(isStaff: boolean): void {
  telemetry.setFlagEvaluationStaff(isStaff)
  persistClassification(isStaff)
  const sendsStaff = telemetry.sendsStaffProperty(isStaff)
  if (sendsStaff !== lastEvaluationSentStaff) {
    lastEvaluationSentStaff = sendsStaff
    onFlagPropertiesChange?.()
  }
}

function persistClassification(isStaff: boolean): void {
  if (isStaff === cached) return
  try {
    writeFileSafe(persistFilePath(), JSON.stringify({ staff: isStaff, ts: Date.now() }))
    cached = isStaff
    console.log('[staff-targeting] classified: staff=', isStaff)
  } catch (err) {
    console.log('[staff-targeting] store skipped:', err)
  }
}

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

async function classifyFromView(
  webContents: WebContents,
  userId: string,
  generation: number
): Promise<boolean> {
  let read: { known?: unknown; staff?: unknown; userId?: unknown } | null
  try {
    read = (await readClassificationFromPage(webContents)) as typeof read
  } catch (err) {
    console.log('[staff-targeting] read skipped:', err)
    return false
  }
  if (generation !== classificationGeneration) return false
  if (answeredGeneration === generation) return false
  if (!read || read.known !== true) return false
  if (typeof read.userId !== 'string' || read.userId.length > MAX_PAGE_USER_ID_CHARS) return false
  if (normalizePostHogUserId(read.userId) !== userId) return false
  const isStaff = read.staff === true
  answeredGeneration = generation
  classifiedUserId = userId
  classifiedStaff = isStaff
  applyClassification(isStaff)
  return true
}

async function classifyAgreedAccount(userId: string, generation: number): Promise<void> {
  for (const webContents of viewsReportingFirebaseUser(userId)) {
    if (generation !== classificationGeneration) return
    if (await classifyFromView(webContents, userId, generation)) return
  }
}

function onIdentityConsensus(consensus: FirebaseIdentityConsensus): void {
  classificationGeneration += 1
  if (consensus.status === 'signed_out') {
    classifiedUserId = null
    classifiedStaff = false
    applyClassification(false)
    return
  }
  if (consensus.status !== 'signed_in') return
  if (classifiedUserId === consensus.userId && classifiedStaff !== null) {
    applyClassification(classifiedStaff)
    void classifyAgreedAccount(consensus.userId, classificationGeneration)
    return
  }
  classifiedUserId = consensus.userId
  classifiedStaff = null
  void classifyAgreedAccount(consensus.userId, classificationGeneration)
}

export async function refreshStaffFlagTargeting(webContents: WebContents): Promise<void> {
  const consensus = getFirebaseIdentityConsensus()
  if (consensus.status === 'signed_out') {
    applyClassification(false)
    return
  }
  if (consensus.status !== 'signed_in') return
  if (classifiedUserId === consensus.userId && classifiedStaff !== null) {
    applyClassification(classifiedStaff)
    return
  }
  await classifyFromView(webContents, consensus.userId, classificationGeneration)
}

export function _resetForTest(): void {
  cached = null
  classifiedUserId = null
  classifiedStaff = null
  classificationGeneration = 0
  answeredGeneration = null
  unobserveConsensus?.()
  unobserveConsensus = null
  lastEvaluationSentStaff = false
  onFlagPropertiesChange = null
}
