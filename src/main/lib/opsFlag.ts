/**
 * Boot-time ops-flag reader.
 *
 * Ops flags are server config pushed TO the client (kill switches, rollout gates), not
 * analytics collected FROM the user, so they read through `getOpsFlagResult`, which deliberately
 * BYPASSES the consent gate — a user who declined telemetry still gets the kill switch, and
 * pre-consent surfaces can still resolve a value. The evaluation request supplies only the
 * installation-stable key and the flag key; implicit flag events are disabled.
 *
 * Kept separate from `experiments.ts` (locked variant assignment, next-boot cache) so a kill
 * switch isn't accidentally consent-gated. Fetched once at boot; running apps pick up new
 * values on restart.
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
import type { FeatureFlagValue, OpsFlagResult } from './telemetry'

const DEFAULT_TIMEOUT_MS = 2000

/** Every persisted flag's last fetched result, keyed by flag key. One file rather than one
 *  per flag so the read-modify-write stays a single atomic replace. */
function persistFilePath(): string {
  return path.join(configDir(), 'ops-flags.json')
}

/** The whole file, or `{}` for missing / unreadable / non-object / unparseable content. The
 *  file is user-writable JSON on disk, so every failure mode has to read as "no cache". */
function readPersistedFile(): Record<string, unknown> {
  const outcome = readFileSafe(persistFilePath())
  if (outcome.kind !== 'data') return {}
  try {
    const parsed: unknown = JSON.parse(outcome.data)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

function readPersistedResult(key: string): OpsFlagResult | undefined {
  const entry = readPersistedFile()[key]
  if (!entry || typeof entry !== 'object') return undefined
  const { value, payload } = entry as { value?: unknown; payload?: unknown }
  if (typeof value !== 'string' && typeof value !== 'boolean') return undefined
  return { value, payload }
}

function writePersistedResult(key: string, result: OpsFlagResult): void {
  const all = readPersistedFile()
  all[key] = result
  writeFileSafe(persistFilePath(), JSON.stringify(all))
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
  /** Keep the last fetched result in `<configDir>/ops-flags.json` and read it back when a
   *  fetch misses, so an offline launch holds the treatment it already had instead of
   *  dropping to `fallback`. Only for flags whose fail direction is a downgrade a returning
   *  user would notice; a fail-closed kill switch must NOT persist. */
  persist?: true
}): OpsFlag<T> {
  const { key, fallback, parse, logLabel, persist } = opts
  let cached: T = fallback
  let initPromise: Promise<void> | null = null

  /** The miss path — `getOpsFlagResult` catches timeout/network errors and RESOLVES
   *  `undefined` rather than rejecting, so this covers both that and a defensive rejection.
   *  Read-only: a miss must never overwrite what an online launch stored. */
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
          if (result === undefined) {
            if (!applyPersisted()) {
              const parsed = parse(undefined, undefined)
              if (parsed !== undefined) cached = parsed
            }
          } else {
            const parsed = parse(result.value, result.payload)
            if (parsed !== undefined) cached = parsed
            if (persist) {
              try {
                writePersistedResult(key, result)
              } catch (err) {
                // A failed write must not cost this launch the value it just fetched.
                if (logLabel) console.log(`[${logLabel}] persist error:`, err)
              }
            }
          }

          if (logLabel)
            console.log(`[${logLabel}] init: fetched=`, result?.value, '→ cached=', cached)
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
