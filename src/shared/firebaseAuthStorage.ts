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
 * The remaining cases are the two ways localStorage stops answering, and they are NOT the same:
 *
 *     ABSENT — no `localStorage` object at all. The frontend cannot be using it, so IndexedDB is the
 *       only store and answers alone. A RECORD there is the answer, which is what keeps a legacy
 *       IndexedDB-primary frontend working. Its ABSENCE is still not a sign-out, because the SDK's
 *       hierarchy also includes sessionStorage and neither reader reads it.
 *
 *     BLOCKED — the object EXISTS (`typeof` says so) and access threw, at enumeration or on a single
 *       key: blocked site data, a partitioned context. The frontend may well be using it and we
 *       simply cannot see it, so NOTHING is asserted in either direction. IndexedDB must not answer
 *       here: on a localStorage-primary frontend it holds at most what the SDK's best-effort cleanup
 *       failed to delete, so a record there would be reported as a definite sign-in from a STALE uid
 *       — believed, or turned into a uid mismatch that revokes the loopback binding.
 *
 * An earlier version of this file grouped BLOCKED with ABSENT. Codex and CodeRabbit each found it
 * independently, and they were right: `typeof` distinguishes them cleanly, so the information was
 * there and was thrown away. "I cannot read" must never be rendered as "nothing is stored", and it
 * must not be rendered as "there is nothing here to read from" either.
 *
 * ## One DELIBERATE asymmetry between the two readers
 *
 * Where the IndexedDB database exists, both readers answer identically. Where the MECHANISM or the
 * database is ABSENT they differ, and that is intended rather than drift:
 *
 *   - the monitor treats a missing database as an empty one and reports `signed_out`, because it
 *     must — a genuinely signed-out user has to reach that state or the identity consensus never
 *     resolves, which is the whole job of that reader;
 *   - `CLASSIFY_STAFF_JS` returns `{known: false}` instead, because it never needs to assert a
 *     sign-out: the outcome either way is the absence of a grant, and abstaining cannot revoke a
 *     binding.
 *
 * ## A SECOND deliberate asymmetry: a BLOCKED store
 *
 * When localStorage EXISTS but access throws, the two readers also differ, and this one was added
 * after two independent reviewers found both readers treating a blocked store as an absent one:
 *
 *   - the monitor abstains outright and does not consult IndexedDB at all, because a stale record
 *     there would become a definite `signed_in`, which is either believed or becomes a uid mismatch
 *     that REVOKES the binding — the destructive path;
 *   - `CLASSIFY_STAFF_JS` still reports a RECORD found in IndexedDB, because its worst case is a
 *     grant withheld or granted from a stale address, never a revocation, and answering keeps a
 *     frontend that persists to IndexedDB working with site data blocked.
 *
 * Both agree on the half that matters: the ABSENCE of a record in IndexedDB is never evidence of a
 * sign-out when the store that would hold it could not be read. They differ only on whether a record
 * found there may answer, and the difference is the cost of being wrong in each reader.
 *
 * So "both readers apply one rule" is true of the three outcomes above and not of this corner. Said
 * explicitly because a docstring that was confidently wrong is what produced this change, and the
 * same trap one turn later would be worse, not smaller.
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
 * ## Why ABSTAIN, and not a guess in either direction
 *
 * An empty localStorage is genuinely ambiguous, and nothing in localStorage distinguishes the cases:
 * a localStorage-primary frontend that is signed out looks identical to a session living in
 * IndexedDB. Desktop's own sign-in produces the second one — `inject.ts` writes the record to
 * IndexedDB ONLY and reloads, so on a first loopback sign-in localStorage has never held a Firebase
 * key. That is not a timing window and does not depend on the frontend version.
 *
 * Guessing signed-out is destructive, not merely wrong. A trusted loopback `signed_out` runs
 * `revokeAcceptedLocalAuthorization`, which deletes the origin's binding — and `writeBindings`
 * (`verifiedLocalFirebaseAuth.ts`) `fs.rmSync`s the file when the map empties. The install then has
 * no trusted view, the consensus never resolves again, and nothing classifies on any later launch.
 *
 * Guessing signed-in is the mirror failure: a stale IndexedDB record can outlive a sign-out, so
 * honouring it would resurrect the account the SDK deliberately deleted — in consumers that persist
 * their answer to disk.
 *
 * `pending` asserts neither, and cannot revoke: only `signed_out` and a uid mismatch reach the
 * revocation path.
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

/** The other Firebase persistence — not a legacy one. It holds the live user through boot on the
 *  released frontend, and is read whenever localStorage is readable and EMPTY as well as when the
 *  mechanism is absent. "Read only when localStorage is unavailable" was this file's own earlier
 *  wording and is withdrawn: see the rule above. */
export const FIREBASE_IDB_NAME = 'firebaseLocalStorageDb'
export const FIREBASE_IDB_STORE = 'firebaseLocalStorage'
