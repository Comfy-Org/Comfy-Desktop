/**
 * Shared Firebase persistence identifiers for the preload auth monitor and
 * staff-flag classifier.
 *
 * A live session can reside in localStorage or IndexedDB while Firebase changes
 * persistence. An empty localStorage alone does not establish sign-out, and an
 * unreadable store is distinct from an absent one. The readers handle storage
 * availability, ambiguous identities, and sign-out settling before reporting
 * an auth state or granting staff flags.
 */

/**
 * ## A THIRD reader, and it applies the SAME store rule: `userTier.ts`
 *
 * `FETCH_TIER_JS` needs the record's ACCESS TOKEN rather than a verdict about who is signed in, and
 * it has no destructive path — an anomaly leaves the cached tier alone, and a stale token simply
 * fails `/customers/me`. That weaker consequence would have licensed a weaker store rule, and an
 * earlier draft of this block claimed it took one. **It does not.** The shipped rule is the strict
 * one:
 *
 *   - localStorage READABLE, holds a record  → use it.
 *   - localStorage READABLE, holds nothing   → `null`. IndexedDB is NOT consulted.
 *   - localStorage ABSENT or BLOCKED         → only then fall back to IndexedDB.
 *
 * So on the store question it behaves like `CLASSIFY_STAFF_JS`, not like something looser.
 *
 * The reason is specific to tokens rather than to verdicts, which is why it is worth stating. A
 * readable-but-empty localStorage cannot distinguish "the live user is mid-boot in IndexedDB" from
 * "the SDK's best-effort cleanup left a copy behind after a sign-out". A discarded token still
 * inside its hour is accepted by `/customers/me`, so the fallback would fetch the FORMER ACCOUNT'S
 * tier and persist it — the one destructive outcome available to a reader with no destructive path.
 * Reading a single store also means no verdict is assembled from two reads taken at different
 * instants, so the cross-store straddle cannot arise here either.
 *
 * What this reader genuinely does NOT take is the **wall-clock settle**: there is no binding to
 * revoke and no sign-out to assert, so a transient `null` costs one unresolved tier on one launch
 * and the next boot re-reads. That is the asymmetry, and it is the only one.
 */
/** Key prefix for a persisted Firebase user, in localStorage and in IndexedDB alike. The full key
 *  is `firebase:authUser:<apiKey>:[DEFAULT]`, so it embeds the project's apiKey — match on this
 *  prefix, and never log or persist a whole key. */
export const FIREBASE_AUTH_KEY_PREFIX = 'firebase:authUser:'

/** IndexedDB database and object store used for Firebase Auth persistence. */
export const FIREBASE_IDB_NAME = 'firebaseLocalStorageDb'
export const FIREBASE_IDB_STORE = 'firebaseLocalStorage'
