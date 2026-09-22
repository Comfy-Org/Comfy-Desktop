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
 * ## Why, and why the obvious fallback is wrong
 *
 * ComfyUI_frontend initialises auth with `[browserLocalPersistence, indexedDBLocalPersistence,
 * browserSessionPersistence]` — localStorage first, and has since frontend #3514 (2025-04). The SDK
 * resolves that hierarchy by migrating the user it finds into the primary persistence and then
 * DELETING the key from the others. From `@firebase/auth` 1.10.8,
 * `dist/browser-cjs/index-919d47fb.js:2169`, verbatim:
 *
 *     // Attempt to clear the key in other persistences but ignore errors. This helps prevent
 *     // issues such as users getting stuck with a previous account after signing out and
 *     // refreshing the tab.
 *
 * So IndexedDB is drained by design, seconds after boot, while the user stays signed in. Reading it
 * returns an empty store for a signed-in account — which is what made staff targeting never work in
 * production and the identity consensus never resolve for local installs.
 *
 * A fallback of `localStorage || IndexedDB` would be worse than the bug it replaces. After migration
 * a stale IndexedDB record can survive (a partial write, compaction lag, Desktop's own
 * `inject.ts` writing there), so falling back on an EMPTY localStorage would resurrect exactly the
 * record the SDK deleted — reintroducing the failure its own comment says the deletion prevents, in
 * consumers that persist their answer to disk. Hence: absence of the MECHANISM, not absence of a
 * record.
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
