/**
 * Boot-time ops-flag reader.
 *
 * Ops flags are server config pushed TO the client (availability guards, rollout gates), not
 * analytics collected FROM the user, so they read through `getOpsFlagResult`, which deliberately
 * BYPASSES the consent gate — a user who declined telemetry still gets the override, and
 * pre-consent surfaces can still resolve a value. The evaluation request supplies only the
 * installation-stable key and the flag key; implicit flag events are disabled.
 *
 * Kept separate from `experiments.ts` (locked variant assignment, next-boot cache) so an
 * operational override isn't accidentally consent-gated. Fetched once at boot; running apps
 * pick up new values on restart.
 *
 * Each flag supplies its own key, fail-direction (`fallback`), and `parse`. The shared part is
 * the plumbing every one of them needs: a single in-flight fetch, an accessor that awaits it
 * rather than racing it to the default, and a fallback that survives both a rejection and an
 * unrecognised payload. See `cloudFreeRuns.ts` and `coreCanary.ts` for the current callers.
 */
import path from 'path'
import { configDir } from './paths'
import { readFileSafe, writeFileSafe } from './safe-file'
import * as mainTelemetry from './telemetry'
import type { FeatureFlagValue } from './telemetry'

const DEFAULT_TIMEOUT_MS = 2000

/** Every persisted flag's last fetched result, keyed by flag key. One file rather than one
 *  per flag so the read-modify-write stays a single atomic replace. */
function persistFilePath(): string {
  return path.join(configDir(), 'ops-flags.json')
}

interface PersistedFileRead {
  /** `{}` for missing / unreadable / non-object / unparseable content: the file is
   *  user-writable JSON on disk, so every failure mode has to read as "no cache". */
  entries: Record<string, unknown>
  /** The primary EXISTS but its content could not be recovered — either `.bak` stood in for
   *  it, or nothing could be read at all. Its real content is therefore UNKNOWN, which is
   *  different from knowing it is empty. */
  primaryUnreadable: boolean
}

function readPersistedFile(): PersistedFileRead {
  const outcome = readFileSafe(persistFilePath())
  if (outcome.kind === 'unreadable') return { entries: {}, primaryUnreadable: true }
  if (outcome.kind !== 'data') return { entries: {}, primaryUnreadable: false }

  const primaryUnreadable = outcome.primaryUnreadable === true
  try {
    const parsed: unknown = JSON.parse(outcome.data)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { entries: {}, primaryUnreadable }
    }
    return { entries: parsed as Record<string, unknown>, primaryUnreadable }
  } catch {
    return { entries: {}, primaryUnreadable }
  }
}

/** Load for a read-modify-write. Throws when the primary exists but its entries cannot be
 *  recovered right now (a lock or permission failure outlasting the retry budget, or `.bak`
 *  standing in): the follow-up write would replace an intact file with state reconstructed
 *  from the backup, resurrecting entries the primary had already superseded. Read-only callers
 *  use `readPersistedFile`, which degrades to "no cache". Mirrors `installations.ts`'
 *  `loadForWrite` (issue #1367). */
function readPersistedFileForWrite(): Record<string, unknown> {
  const { entries, primaryUnreadable } = readPersistedFile()
  if (primaryUnreadable) {
    throw new Error(
      'ops-flags.json exists but its entries cannot be recovered right now; refusing to modify it'
    )
  }
  return entries
}

interface PersistedOpsFlagEntry {
  value: FeatureFlagValue
  payload: unknown
}

function readPersistedResult(key: string): PersistedOpsFlagEntry | undefined {
  const entry = readPersistedFile().entries[key]
  if (!entry || typeof entry !== 'object') return undefined
  const { value, payload } = entry as { value?: unknown; payload?: unknown }
  if (typeof value !== 'string' && typeof value !== 'boolean') return undefined
  return { value, payload }
}

/** Writes the backup FIRST, then the primary, both as plain atomic writes. Refuses outright
 *  (via `readPersistedFileForWrite`) when the primary cannot be read, so neither file is
 *  touched and the pair can never be left half-updated from reconstructed state.
 *
 *  `readFileSafe` serves `<file>.bak` whenever the primary is missing or unreadable, so a
 *  backup still holding a superseded treatment can resurrect a grant that was already revoked.
 *  This ordering bounds that: a failed backup write leaves the primary untouched (the caller
 *  aborts and both files still agree), and a failed primary write leaves the backup holding the
 *  NEW value, so the stale primary can only lose a treatment, never bring one back.
 *
 *  `writeFileSafe`'s own backup option must NOT be enabled on either call: it copies the OLD
 *  primary over `.bak` at write time, which is the resurrection this ordering prevents. */
function writePersistedResult(key: string, entry: PersistedOpsFlagEntry): void {
  const all = readPersistedFileForWrite()
  all[key] = entry
  const contents = JSON.stringify(all)
  const filePath = persistFilePath()
  writeFileSafe(filePath + '.bak', contents)
  writeFileSafe(filePath, contents)
}

export interface OpsFlag<T> {
  /** Boot-time fetch. The returned promise is cached so the IPC handler can await it: a
   *  renderer query landing before the fetch settles sees the resolved value, not the
   *  fallback. Idempotent within a process; never rejects. */
  init(opts: { distinctId: string; timeoutMs?: number }): Promise<void>
  /** Awaits the in-flight boot fetch so renderer queries landing before it settles still get
   *  the resolved value, not the fallback. No synchronous counterpart on purpose: every
   *  caller so far reads from an IPC handler, where racing the boot fetch to the fallback is
   *  exactly the bug this exists to avoid. */
  get(): Promise<T>
  /** @internal — exposed for tests. */
  _resetForTest(): void
}

export function makeOpsFlag<T>(opts: {
  key: string
  /** Value held before the fetch resolves, and kept when it fails or returns something
   *  `parse` doesn't recognise. This is the flag's fail direction. */
  fallback: T
  /** Return `undefined` to retain the fallback. */
  parse: (value: FeatureFlagValue | undefined, payload: unknown) => T | undefined
  /** Enables the `[label] init:` / `[label] init error:` boot logs. Omit for no logging. */
  logLabel?: string
  /** Carry the last SUCCESSFULLY FETCHED treatment across launches in
   *  `<configDir>/ops-flags.json`, so an unreachable server holds it instead of dropping to
   *  `fallback`. Any successful fetch is authoritative and overwrites what is stored —
   *  including an explicit `false`, which is how a treatment already granted is taken back.
   *
   *  REVOKING: deleting or archiving the flag does NOT revoke it. A missing key reads as
   *  `unreachable`, indistinguishable from an offline launch, so deletion HOLDS the very grant
   *  it was meant to remove. Disable the flag first (serve `false`) and let clients pick that
   *  up; delete it only afterwards.
   *
   *  Only for flags whose fail direction is a downgrade a returning user would notice; a
   *  fail-closed guard must NOT persist. */
  persist?: true
}): OpsFlag<T> {
  const { key, fallback, parse, logLabel, persist } = opts
  let cached: T = fallback
  let initPromise: Promise<void> | null = null

  /** The `unreachable` path — `getOpsFlagResult` classifies timeout/network errors rather
   *  than rejecting, so this covers both that and a defensive rejection. Read-only: an
   *  unreachable server must never overwrite what a successful fetch stored. */
  function applyPersisted(): boolean {
    if (!persist) return false
    const stored = readPersistedResult(key)
    if (!stored) return false
    const parsed = parse(stored.value, stored.payload)
    if (parsed === undefined) return false
    cached = parsed
    return true
  }

  return {
    init(initOpts) {
      if (initPromise) return initPromise
      initPromise = mainTelemetry
        .getOpsFlagResult(key, initOpts.distinctId, initOpts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
        .then((result) => {
          if (result.kind === 'unreachable') {
            if (!applyPersisted()) {
              const parsed = parse(undefined, undefined)
              if (parsed !== undefined) cached = parsed
            }
          } else {
            const parsed = parse(result.value, result.payload)
            if (parsed !== undefined) cached = parsed
            if (persist) {
              try {
                writePersistedResult(key, { value: result.value, payload: result.payload })
              } catch (err) {
                // A failed write must not cost this launch the value it just fetched.
                if (logLabel) console.log(`[${logLabel}] persist error:`, err)
              }
            }
          }

          if (logLabel)
            console.log(
              `[${logLabel}] init: fetched=`,
              result.kind === 'value' ? result.value : result.kind,
              '→ cached=',
              cached
            )
        })
        .catch((err) => {
          if (logLabel) console.log(`[${logLabel}] init error:`, err)
          // Otherwise fail to `fallback`: `cached` is only ever assigned on the resolved path.
          applyPersisted()
        })
      return initPromise
    },
    async get() {
      if (initPromise) {
        try {
          await initPromise
        } catch {
          /* keep cached */
        }
      }
      return cached
    },
    _resetForTest() {
      cached = fallback
      initPromise = null
    }
  }
}
