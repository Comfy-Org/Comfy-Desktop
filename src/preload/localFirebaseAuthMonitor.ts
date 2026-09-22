import type { ComfyDesktop2FirebaseAuthState } from '../types/comfyDesktopBridge'

const FIREBASE_DB = 'firebaseLocalStorageDb'
const FIREBASE_STORE = 'firebaseLocalStorage'
const FIREBASE_AUTH_KEY_PREFIX = 'firebase:authUser:'
const POLL_INTERVAL_MS = 1000

function isLoopbackPage(): boolean {
  if (typeof location === 'undefined') return false
  const hostname = location.hostname.toLowerCase()
  return hostname === 'localhost' || hostname === '[::1]' || hostname.startsWith('127.')
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/**
 * TEMPORARY DIAGNOSTIC — never for merge.
 *
 * What the store actually looked like, BEFORE it is collapsed into a status. The shipped reader maps
 * three distinct observations onto `signed_out` (no database, no object store, zero records) and two
 * onto `pending` (more than one account, and a failed read), so the log cannot tell apart the cases
 * a fix has to treat differently. This names them; it changes nothing.
 */
export type LocalFirebaseObservation =
  | 'records-one'
  | 'records-many'
  | 'empty'
  | 'unreadable-no-db'
  | 'unreadable-no-store'
  | 'error'

export interface LocalFirebaseRead {
  state: ComfyDesktop2FirebaseAuthState
  observation: LocalFirebaseObservation
  /** Counts and names only — never a key's value, and never the apiKey the full key embeds. */
  detail: string
}

/** Names of the databases this origin has, capped. If Firebase moved its record to another
 *  database, ours reads empty while the session is healthy and nothing else would show it. */
function describeDatabases(names: (string | undefined)[]): string {
  const visible = names.filter((n): n is string => typeof n === 'string').slice(0, 5)
  return 'dbCount=' + names.length + ' dbs=' + (visible.map((n) => n.slice(0, 40)).join(',') || '-')
}

export async function readLocalFirebaseAuthState(): Promise<LocalFirebaseRead> {
  try {
    const databases = await indexedDB.databases()
    const dbs = describeDatabases(databases.map(({ name }) => name))
    if (!databases.some(({ name }) => name === FIREBASE_DB)) {
      return {
        state: { status: 'signed_out' },
        observation: 'unreadable-no-db',
        detail: dbs + ' listed=false'
      }
    }
    const database = await requestResult(indexedDB.open(FIREBASE_DB))
    try {
      if (!database.objectStoreNames.contains(FIREBASE_STORE)) {
        return {
          state: { status: 'signed_out' },
          observation: 'unreadable-no-store',
          detail: dbs + ' listed=true store=missing'
        }
      }
      const transaction = database.transaction(FIREBASE_STORE, 'readonly')
      const entries = (await requestResult(
        transaction.objectStore(FIREBASE_STORE).getAll()
      )) as unknown[]
      const userIds = new Set<string>()
      // Counted separately because the reader skips an entry for TWO different reasons, and they
      // point at opposite owners: a wrong KEY means our prefix no longer matches what Firebase
      // writes (every `empty` we have logged would be a misreading); a right key with no usable uid
      // means a partially-written record, e.g. mid token-refresh rewrite.
      let keyMatched = 0
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue
        const candidate = entry as { fbase_key?: unknown; value?: { uid?: unknown } }
        if (
          typeof candidate.fbase_key !== 'string' ||
          !candidate.fbase_key.startsWith(FIREBASE_AUTH_KEY_PREFIX)
        ) {
          continue
        }
        keyMatched += 1
        if (typeof candidate.value?.uid === 'string' && candidate.value.uid.length > 0) {
          userIds.add(candidate.value.uid)
        }
      }
      // entries: everything in the store. matched: entries we recognise as an auth record.
      // "genuinely empty" and "has entries we do not recognise" are indistinguishable without both,
      // and they point at opposite causes.
      const detail =
        dbs +
        ' listed=true entriesTotal=' +
        entries.length +
        ' entriesKeyMatched=' +
        keyMatched +
        ' entriesUsable=' +
        userIds.size +
        ' prefix=' +
        FIREBASE_AUTH_KEY_PREFIX
      // Mapping preserved EXACTLY as shipped. Only the labels are new.
      if (userIds.size === 0) {
        return { state: { status: 'signed_out' }, observation: 'empty', detail }
      }
      if (userIds.size > 1) {
        return { state: { status: 'pending' }, observation: 'records-many', detail }
      }
      return {
        state: { status: 'signed_in', userId: [...userIds][0]! },
        observation: 'records-one',
        detail
      }
    } finally {
      database.close()
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      state: { status: 'pending' },
      observation: 'error',
      detail: 'err=' + message.slice(0, 80)
    }
  }
}

/** Report local Firebase persistence because the frontend's own sync is Cloud-only. */
/** How often an unchanged observation is still recorded, so a long steady stretch is a POSITIVE
 *  statement about each interval rather than an inference from silence. Four wrong conclusions were
 *  drawn from absent output tonight; this converts the last of them into data. */
const DIAG_HEARTBEAT_MS = 5000

export function startLocalFirebaseAuthMonitor(
  report: (state: ComfyDesktop2FirebaseAuthState) => void,
  reportDiag?: (detail: string) => void
): (() => void) | null {
  if (!isLoopbackPage() || typeof indexedDB === 'undefined') return null
  let lastState = ''
  let stopped = false
  let polling = false
  let lastDiagLine = ''
  let lastDiagAt = 0
  const poll = async (): Promise<void> => {
    if (stopped || polling) return
    polling = true
    const read = await readLocalFirebaseAuthState()
    polling = false
    if (stopped) return
    // DIAGNOSTIC, on its own channel and gated on the OBSERVATION — not the state. Gating this on
    // the state is what hid 55 seconds: three observations collapse to `signed_out`, so a change
    // among them serializes identically and vanishes. The report path below is untouched.
    // Compares the WHOLE line, not just the observation: the detail carries the counts and the
    // database-name list, so a record moving to a DIFFERENT DATABASE — same observation, same
    // counts — still fires. Gating on the observation alone would have made that hypothesis
    // untestable, which is the collapse this instrument exists to undo.
    const now = Date.now()
    const line = 'observation=' + read.observation + ' ' + read.detail
    if (reportDiag && (line !== lastDiagLine || now - lastDiagAt >= DIAG_HEARTBEAT_MS)) {
      lastDiagLine = line
      lastDiagAt = now
      reportDiag(line)
    }
    const serialized = JSON.stringify(read.state)
    if (serialized === lastState) return
    lastState = serialized
    // The observation still rides the report payload for the state-change case, unchanged.
    report({
      ...read.state,
      diagObservation: read.observation
    } as unknown as ComfyDesktop2FirebaseAuthState)
  }
  report({ status: 'pending' })
  lastState = JSON.stringify({ status: 'pending' })
  void poll()
  const interval = setInterval(() => void poll(), POLL_INTERVAL_MS)
  return () => {
    stopped = true
    clearInterval(interval)
  }
}
