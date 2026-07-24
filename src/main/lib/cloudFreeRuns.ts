/**
 * Free-tier availability for the first-use "5 FREE RUNS" pill.
 *
 * Reads cloud's own `free_tier_workflow_submission_enabled` — a dependency on
 * `free_tier_job_allowance_enabled` — so the pill tracks the real free-tier rollout
 * instead of a desktop mirror someone has to keep in sync. Resolves false for everyone
 * while free tier isn't live, and flips on its own when the ramp lands.
 *
 * Read via `getOpsFlag`, which bypasses the consent gate — same reasoning as
 * `cloudCapacity.ts`. The bypass is load-bearing: this surface only renders while consent
 * is `'undecided'`, and the `experiments.ts` cache stays empty until consent is
 * `'granted'`, so a value routed through it would never arrive.
 *
 * Fails CLOSED: the pill asserts a live entitlement, and advertising runs that aren't
 * granted is worse than showing nothing. Fetched once at boot.
 */
import * as mainTelemetry from './telemetry'

export const CLOUD_FREE_RUNS_FLAG_KEY = 'free_tier_workflow_submission_enabled'

const DEFAULT_TIMEOUT_MS = 2000

let cached = false
let initPromise: Promise<void> | null = null

/**
 * Boot-time fetch. The returned promise is cached so the IPC handler can await it: a
 * renderer query landing before the fetch settles sees the resolved value, not the
 * default. Idempotent within a process.
 */
export function initCloudFreeRuns(opts: { distinctId: string; timeoutMs?: number }): Promise<void> {
  if (initPromise) return initPromise
  initPromise = mainTelemetry
    .getOpsFlag(CLOUD_FREE_RUNS_FLAG_KEY, opts.distinctId, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    .then((value) => {
      cached = value === true || value === 'on'
    })
    .catch(() => {
      /* fail closed: keep `false` */
    })
  return initPromise
}

/** Awaits the in-flight boot fetch so renderer queries landing before it settles still
 *  get the resolved value, not the fail-closed default. */
export async function getCloudFreeRunsEnabledAsync(): Promise<boolean> {
  if (initPromise) {
    try {
      await initPromise
    } catch {
      /* keep cached */
    }
  }
  return cached
}

/** @internal — exposed for tests. */
export function _resetForTest(): void {
  cached = false
  initPromise = null
}
