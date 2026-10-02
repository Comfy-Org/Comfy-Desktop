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
 * unrecognised payload. See `cloudFreeRuns.ts` and `coreBetaGrants.ts` for the current callers.
 */
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { inspect } from 'util'
import { configDir } from './paths'
import { readFileSafe, writeFileSafe } from './safe-file'
import * as mainTelemetry from './telemetry'
import type { FeatureFlagValue, OpsFlagFetchResult } from './telemetry'

type OpsFlagValueResult = Extract<OpsFlagFetchResult, { kind: 'value' }>

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

/** E2E-only: write `E2E_OPS_FLAGS_SEED` into `ops-flags.json` before the first read.
 *
 *  The harness cannot place this file itself. It isolates a run by overriding `HOME`, but
 *  `configDir()` resolves to Electron's `userData` off Linux, and on macOS Application Support
 *  ignores that override — so a file the harness writes under its temp home is never read, and
 *  seeding the real path would write into the developer's own profile. `settings.json` has the
 *  same problem and solves it exactly this way; this mirrors `maybeSeedFromEnv` in
 *  `settings.ts`, including the packaged-build guard and dropping the var so the payload cannot
 *  reach spawned children. Runs at most once per process. */
let e2eSeedApplied = false
function maybeSeedFromEnv(): void {
  if (e2eSeedApplied) return
  e2eSeedApplied = true
  // Env gate first: it is a plain string read, whereas `app` is only a real object inside the
  // Electron runtime. Unit tests import this module outside it, so touching `app` on the
  // common path would make every persisted-read test depend on mocking electron.
  if (process.env['E2E'] !== '1') return
  const seed = process.env['E2E_OPS_FLAGS_SEED']
  if (!seed) return
  delete process.env['E2E_OPS_FLAGS_SEED']
  try {
    // Inside the try with everything else: `readPersistedFile`'s whole contract is to degrade
    // to "no cache", and a partially-mocked `app` throwing here would take that down with it.
    // Hard guard: never run in production builds.
    if (app.isPackaged) return
    JSON.parse(seed) // validate before writing
    const filePath = persistFilePath()
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    // Backup first, then primary — the same ordering `writePersistedResult` relies on, so a
    // seeded run cannot be served a stale `.bak` from a previous one.
    writeFileSafe(filePath + '.bak', seed)
    writeFileSafe(filePath, seed)
  } catch (err) {
    console.warn('OpsFlag: failed to apply E2E_OPS_FLAGS_SEED:', (err as Error).message)
  }
}

function readPersistedFile(): PersistedFileRead {
  maybeSeedFromEnv()
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
   *  "Successfully fetched" includes a fetch that answered AFTER this launch's deadline. The
   *  deadline is a bound on how long boot waits, not on how long the answer stays useful: a
   *  cold `/flags` POST measured ~2572 ms on Windows and is always cold at boot, so a 2000 ms
   *  race is lost every launch and a revocation that only ever arrives late would never land.
   *  A late value is written for the NEXT launch and deliberately does not disturb this one.
   *
   *  REVOKING: deleting or archiving the flag does NOT revoke it. A missing key reads as
   *  `unreachable`, indistinguishable from an offline launch, so deletion HOLDS the very grant
   *  it was meant to remove — late arrivals included, since a late miss is `unreachable` too.
   *  Disable the flag first (serve `false`) and let clients pick that up; delete it only
   *  afterwards.
   *
   *  Only for flags whose fail direction is a downgrade a returning user would notice; a
   *  fail-closed guard must NOT persist. */
  persist?: true
}): OpsFlag<T> {
  const { key, fallback, parse, logLabel, persist } = opts
  let cached: T = fallback
  let initPromise: Promise<void> | null = null
  /** Captured by each `init`, bumped by `_resetForTest`. A fetch this flag abandoned at the
   *  deadline can still settle long after the launch (or the test) that started it moved on;
   *  without the token its write would land under whatever state replaced it. */
  let generation = 0

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

  /** Store a value the server produced after this launch's deadline, so the NEXT launch reads
   *  it. Only ever reached for an explicit value — `getOpsFlagResult` withholds late misses and
   *  late errors, both of which are `unreachable` and must never be persisted.
   *
   *  Deliberately does not touch `cached`. The deadline governs this launch's decision, and a
   *  treatment that flipped partway through a session would be a worse failure than one that
   *  converges on restart.
   *
   *  `writePersistedResult` is a read-modify-write over a single shared `ops-flags.json`, and a
   *  late write is the first thing that makes concurrent writers structurally possible — it can
   *  now land after its own launch has moved on, so two overlapping launches could interleave.
   *  Left unlocked on purpose: `coreBetaGrants` is the only flag that persists, so there is one
   *  writer per process, and the loser of such a race re-fetches on the next launch anyway.
   *  Revisit if a second `persist` flag is ever added. */
  function persistLate(generationAtInit: number, result: OpsFlagValueResult): void {
    if (generationAtInit !== generation) return
    try {
      writePersistedResult(key, { value: result.value, payload: result.payload })
    } catch (err) {
      // Same containment as the in-band write: a failed persist costs the next launch its
      // convergence and nothing else, so it must not escape as an unhandled rejection.
      if (logLabel) console.log(`[${logLabel}] late persist error:`, err)
    }
  }

  return {
    init(initOpts) {
      if (initPromise) return initPromise
      const generationAtInit = generation
      initPromise = mainTelemetry
        .getOpsFlagResult(
          key,
          initOpts.distinctId,
          initOpts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          // Non-persisting flags pass no callback at all, so they stay write-free structurally
          // rather than by a guard inside one — no write path is attached to the abandoned fetch.
          // (`getOpsFlagResult` still observes that fetch to report how it settled; reporting is
          // not a write, and deliberately does not depend on whether the flag persists.)
          persist ? (late) => persistLate(generationAtInit, late) : undefined
        )
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
              // One line at full depth: the default inspect folds nested payloads to `[Array]`
              // and wraps across lines that a `[label]` grep then misses.
              inspect(cached, { depth: null, breakLength: Infinity, compact: true })
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
      // Strands any fetch still in flight, so a late result from the previous test cannot
      // write into the next one's config dir.
      generation += 1
    }
  }
}
