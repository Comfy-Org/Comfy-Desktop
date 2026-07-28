/**
 * Boot-time ops-flag reader.
 *
 * Ops flags are server config pushed TO the client (kill switches, rollout gates), not
 * analytics collected FROM the user, so they read through `getOpsFlag`, which deliberately
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
 * unrecognised payload. See `cloudCapacity.ts` and `cloudFreeRuns.ts` for the two callers.
 */
import * as mainTelemetry from './telemetry'
import type { FeatureFlagValue } from './telemetry'

const DEFAULT_TIMEOUT_MS = 2000

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
  /** Narrow the raw flag value. Return `undefined` to keep the fallback — that is how an
   *  unrecognised payload is distinguished from a legitimate value. */
  parse: (value: FeatureFlagValue | undefined) => T | undefined
  /** Enables the `[label] init:` / `[label] init error:` boot logs. Omit for no logging. */
  logLabel?: string
}): OpsFlag<T> {
  const { key, fallback, parse, logLabel } = opts
  let cached: T = fallback
  let initPromise: Promise<void> | null = null

  return {
    init(initOpts) {
      if (initPromise) return initPromise
      initPromise = mainTelemetry
        .getOpsFlag(key, initOpts.distinctId, initOpts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
        .then((value) => {
          const parsed = parse(value)
          if (parsed !== undefined) cached = parsed

          if (logLabel) console.log(`[${logLabel}] init: fetched=`, value, '→ cached=', cached)
        })
        .catch((err) => {
          if (logLabel) console.log(`[${logLabel}] init error:`, err)
          // fail to `fallback`: `cached` is only ever assigned on the resolved path.
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
