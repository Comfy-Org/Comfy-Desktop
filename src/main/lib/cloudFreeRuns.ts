/**
 * Free-tier availability for the first-use "5 FREE RUNS" pill.
 *
 * Reads cloud's own `free_tier_workflow_submission_enabled` — a dependency on
 * `free_tier_job_allowance_enabled` — so the pill tracks the real free-tier rollout
 * instead of a desktop mirror someone has to keep in sync. Resolves false for everyone
 * while free tier isn't live, and flips on its own when the ramp lands.
 *
 * The consent-gate bypass (see `opsFlag.ts`) is load-bearing here, not just inherited: this
 * surface only renders while consent is `'undecided'`, and the `experiments.ts` cache stays
 * empty until consent is `'granted'`, so a value routed through it would never arrive.
 *
 * Fails CLOSED: the pill asserts a live entitlement, and advertising runs that aren't
 * granted is worse than showing nothing.
 */
import { makeOpsFlag } from './opsFlag'

export const CLOUD_FREE_RUNS_FLAG_KEY = 'free_tier_workflow_submission_enabled'

const flag = makeOpsFlag<boolean>({
  key: CLOUD_FREE_RUNS_FLAG_KEY,
  fallback: false,
  // Explicit yes only — `'off'`, `undefined`, and any unrecognised string all read as false.
  parse: (value) => value === true || value === 'on'
})

/** Boot-time fetch. Idempotent within a process; never rejects. */
export const initCloudFreeRuns = flag.init

/** Awaits the in-flight boot fetch so renderer queries landing before it settles still
 *  get the resolved value, not the fail-closed default. */
export const getCloudFreeRunsEnabledAsync = flag.get

/** @internal — exposed for tests. */
export const _resetForTest = flag._resetForTest
