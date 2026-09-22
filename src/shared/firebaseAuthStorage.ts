/**
 * Where Firebase's signed-in user actually lives, and which store is allowed to answer.
 *
 * Shared because two readers in different JavaScript worlds have to agree: the preload's
 * `localFirebaseAuthMonitor` (bundled TypeScript, isolated world) and `CLASSIFY_STAFF_JS` (a string
 * injected into the page's main world, which cannot import anything). They cannot share the IO, so
 * they share the names and the rule instead — the part that drifted.
 *
 * ## The rule — THREE outcomes, not two
 *
 *     localStorage holds a record            -> AUTHORITATIVE. Any IndexedDB copy is the drained one.
 *     both stores hold nothing               -> signed out. Unambiguous.
 *     localStorage readable but EMPTY,
 *       while IndexedDB holds a user         -> ABSTAIN: `pending` / `{known: false}`. Not a verdict.
 *
 * A fourth case is the MECHANISM being gone — no `localStorage` object, or access throws. IndexedDB
 * then answers alone, because it is the only reader left. That is distinct from an empty store: "I
 * cannot read" must never be rendered as "nothing is stored".
 *
 * ## Why an empty localStorage is ambiguous, which is the whole reason for the third outcome
 *
 * Two different situations produce a readable, empty localStorage, and nothing in localStorage can
 * tell them apart:
 *
 *     a localStorage-primary frontend, genuinely signed out
 *     a frontend keeping the user in IndexedDB, signed in
 *
 * ### Correction — the second case is not a legacy edge case
 *
 * An earlier version of this file asserted that ComfyUI_frontend initialises auth with
 * `[browserLocalPersistence, indexedDBLocalPersistence, browserSessionPersistence]`, localStorage
 * first, "since frontend #3514 (2025-04)", and concluded localStorage is authoritative even when
 * empty. **That was wrong, and it described code no user runs.** Verified at the released tag:
 *
 *   - `src/platform/auth/firebaseIdentity.ts`, the module that array lives in, DOES NOT EXIST at
 *     frontend v1.52.7 — the version ComfyUI Core 0.36.0 pins. It first ships in v1.55.11.
 *   - v1.52.7 initialises auth through VueFire (`src/main.ts`: `.use(VueFire, { modules:
 *     [VueFireAuth()] })`), and `vuefire/dist/index.mjs` passes
 *     `persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence]`
 *     — INDEXEDDB FIRST.
 *   - localStorage becomes the store only later, via a fire-and-forget
 *     `void setPersistence(auth, browserLocalPersistence)` (`authStore.ts:139`), which runs when the
 *     auth store is first instantiated. On a local install that is AFTER `app.mount()`, because
 *     `main.ts` gates the cloud sync on `isCloud`.
 *
 * So both stores are authoritative, at different times:
 *
 *     boot, until the late setPersistence   -> IndexedDB holds the user, localStorage is EMPTY
 *     steady state, after it                -> localStorage holds the user, IndexedDB is drained
 *
 * The SDK does drain the non-selected persistence — that part was right. From `@firebase/auth`
 * 1.10.8, `dist/browser-cjs/index-919d47fb.js:2169`, verbatim:
 *
 *     // Attempt to clear the key in other persistences but ignore errors. This helps prevent
 *     // issues such as users getting stuck with a previous account after signing out and
 *     // refreshing the tab.
 *
 * Which store gets drained depends on which one won, and at boot that is IndexedDB winning and
 * localStorage being cleared. So reading only IndexedDB is wrong in the steady state (empty for a
 * signed-in user), and treating an empty localStorage as a verdict is wrong at boot (the user is in
 * IndexedDB). Hence three outcomes.
 *
 * ## Why ABSTAIN, and not a guess in either direction
 *
 * Guessing signed-out is destructive, not merely wrong. A trusted loopback `signed_out` report runs
 * `revokeAcceptedLocalAuthorization`, which deletes the origin's binding — and `writeBindings`
 * (`verifiedLocalFirebaseAuth.ts`) `fs.rmSync`s the file when the map empties. The install then
 * reports untrusted forever and nothing classifies: it seals itself. Abstention cannot do that,
 * because revoke fires only on `signed_out` or a uid mismatch.
 *
 * Guessing signed-in is the mirror failure: a stale IndexedDB record can outlive a sign-out (a
 * partial write, compaction lag, Desktop's own `inject.ts` writing there), so honouring it would
 * resurrect the account the SDK deliberately deleted — in consumers that persist their answer.
 *
 * `pending` asserts neither. It is the only answer that cannot be wrong.
 *
 * ## The verdict predicate, for both readers
 *
 * Exactly one distinct uid across all `firebase:authUser:*` entries, and for the staff cohort that
 * one record's `emailVerified === true`. More than one uid is unresolved, not a coin flip on
 * iteration order. Zero, in BOTH stores, is a real signed-out state.
 */

/** Key prefix for a persisted Firebase user, in localStorage and in IndexedDB alike. The full key
 *  is `firebase:authUser:<apiKey>:[DEFAULT]`, so it embeds the project's apiKey — match on this
 *  prefix, and never log or persist a whole key. */
export const FIREBASE_AUTH_KEY_PREFIX = 'firebase:authUser:'

/** The IndexedDB persistence. Holds the user at boot and on frontends that never flip to
 *  localStorage; drained once the flip happens. Consulted whenever localStorage has no record. */
export const FIREBASE_IDB_NAME = 'firebaseLocalStorageDb'
export const FIREBASE_IDB_STORE = 'firebaseLocalStorage'
