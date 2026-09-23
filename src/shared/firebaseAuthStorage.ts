/**
 * Where Firebase's signed-in user actually lives, and which store is allowed to answer.
 *
 * Shared because two readers in different JavaScript worlds have to agree: the preload's
 * `localFirebaseAuthMonitor` (bundled TypeScript, isolated world) and `CLASSIFY_STAFF_JS` (a string
 * injected into the page's main world, which cannot import anything). They cannot share the IO, so
 * they share the names and the rule instead — the part that drifted.
 *
 * ## The rule
 *
 * `localStorage` IS AUTHORITATIVE WHENEVER IT IS READABLE — INCLUDING WHEN IT HOLDS NO USER.
 * IndexedDB is consulted only when the localStorage MECHANISM is unavailable: no `localStorage`
 * object, or access throws. Never because it happened to be empty.
 *
 * ## Correction: the frontend's hierarchy is NOT localStorage-first
 *
 * An earlier version of this file stated that ComfyUI_frontend initialises auth with
 * `[browserLocalPersistence, indexedDBLocalPersistence, browserSessionPersistence]` — localStorage
 * first — "since frontend #3514 (2025-04)". **That described code no user runs.** Verified at the
 * released tag rather than a branch tip:
 *
 *   - `src/platform/auth/firebaseIdentity.ts`, the module that array lives in, DOES NOT EXIST at
 *     frontend v1.52.7 — the version ComfyUI Core 0.36.0 pins. It first ships in v1.55.11.
 *   - v1.52.7 initialises auth through VueFire (`src/main.ts`: `.use(VueFire, { modules:
 *     [VueFireAuth()] })`), and `vuefire/dist/index.mjs` passes
 *     `persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence]`
 *     — INDEXEDDB FIRST.
 *   - localStorage becomes the store only later, via a fire-and-forget
 *     `void setPersistence(auth, browserLocalPersistence)` (`authStore.ts:139`), which runs when the
 *     auth store is first instantiated — on a local install AFTER `app.mount()`, because `main.ts`
 *     gates the cloud sync on `isCloud`.
 *
 * So BOTH stores are authoritative, at different times:
 *
 *     boot, until the late setPersistence   -> IndexedDB holds the user, localStorage is EMPTY
 *     steady state, after it                -> localStorage holds the user, IndexedDB is drained
 *
 * The SDK does drain the persistence that lost — that part was right. From `@firebase/auth` 1.10.8,
 * `dist/browser-cjs/index-919d47fb.js:2169`, verbatim:
 *
 *     // Attempt to clear the key in other persistences but ignore errors. This helps prevent
 *     // issues such as users getting stuck with a previous account after signing out and
 *     // refreshing the tab.
 *
 * Which store gets drained depends on which one won. Reading only IndexedDB is therefore wrong in
 * the steady state (empty for a signed-in user), which is the bug this branch fixes.
 *
 * ## KNOWN GAP in the rule above, not yet fixed here
 *
 * Because at boot the user is in IndexedDB and localStorage is legitimately empty, "authoritative
 * even when empty" returns a definite signed-out for a signed-in user for the first seconds of every
 * page. That is not cosmetic: a trusted loopback `signed_out` runs
 * `revokeAcceptedLocalAuthorization`, which deletes the origin's binding, and `writeBindings`
 * (`verifiedLocalFirebaseAuth.ts`) `fs.rmSync`s the file when the map empties — so the install seals
 * itself for every later launch.
 *
 * A three-outcome rule that ABSTAINS when localStorage is empty and IndexedDB holds a user is
 * proposed and awaiting a decision; it is deliberately NOT implemented here, so do not read this
 * section as describing the code below. Until it lands, the gap is real and documented rather than
 * discovered again. Note also that the mirror fallback (`localStorage || IndexedDB`) is NOT the
 * answer: a stale IndexedDB record can outlive a sign-out, so honouring it unconditionally would
 * resurrect the account the SDK deliberately deleted.
 *
 * ## The verdict predicate, for both readers
 *
 * Exactly one distinct uid across all `firebase:authUser:*` entries, and for the staff cohort that
 * one record's `emailVerified === true`. More than one uid is unresolved, not a coin flip on
 * iteration order. Zero is a real signed-out state.
 */

/** Key prefix for a persisted Firebase user, in localStorage and in IndexedDB alike. The full key
 *  is `firebase:authUser:<apiKey>:[DEFAULT]`, so it embeds the project's apiKey — match on this
 *  prefix, and never log or persist a whole key. */
export const FIREBASE_AUTH_KEY_PREFIX = 'firebase:authUser:'

/** The legacy IndexedDB persistence. Read ONLY when localStorage is unavailable — see the rule. */
export const FIREBASE_IDB_NAME = 'firebaseLocalStorageDb'
export const FIREBASE_IDB_STORE = 'firebaseLocalStorage'
