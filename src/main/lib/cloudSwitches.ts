/**
 * Boolean ops switches for the first-use Cloud surface.
 *
 * Both read a PostHog flag at boot via `getOpsFlag`, which BYPASSES the consent gate —
 * same reasoning as `cloudCapacity.ts`: server config pushed TO the client, not analytics
 * collected FROM the user.
 *
 * That bypass is what makes these usable here at all. The surface they govern (the
 * first-use picker) renders while consent is still `'undecided'`, and the
 * `experiments.ts` cache stays empty until consent is `'granted'` — routing either
 * through it would leave ops holding a switch that could never fire.
 *
 * Both are evaluated ANONYMOUSLY: at first use there is no Cloud session, so any
 * release condition keyed on person properties (email, cohort) cannot match here. That
 * is deliberate for the free-runs switch — see its note below — but it means
 * `desktop-cloud-reco`'s conditions must stay property-free, or the recommendation
 * would silently mis-target.
 *
 * Fetched once at boot; picked up on restart.
 */
import * as mainTelemetry from './telemetry'

const DEFAULT_TIMEOUT_MS = 2000

interface OpsSwitch {
  init: (opts: { distinctId: string; timeoutMs?: number }) => Promise<void>
  getAsync: () => Promise<boolean>
  _resetForTest: () => void
}

/**
 * `whenUnresolved` is the value used when the flag is missing, times out, errors, or
 * comes back as something unrecognised — i.e. the direction this switch fails.
 */
function createOpsSwitch(key: string, whenUnresolved: boolean): OpsSwitch {
  let cached = whenUnresolved
  let initPromise: Promise<void> | null = null
  return {
    // The returned promise is cached so the IPC handler can await it: a renderer query
    // landing before the fetch settles sees the resolved value, not the default.
    // Idempotent within a process.
    init(opts) {
      if (initPromise) return initPromise
      initPromise = mainTelemetry
        .getOpsFlag(key, opts.distinctId, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
        .then((value) => {
          if (value === true || value === 'on') cached = true
          else if (value === false || value === 'off') cached = false
          // Else keep the fail direction (undefined, or an unrecognised string).
        })
        .catch(() => {
          /* keep the fail direction */
        })
      return initPromise
    },
    async getAsync() {
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
      cached = whenUnresolved
      initPromise = null
    }
  }
}

/**
 * GPU-aware Cloud recommendation (badge + no-preselect).
 *
 * Fails OPEN: a PostHog outage shouldn't silently pull a working feature, and the
 * recommendation makes no promise to the user that could turn out to be false.
 */
export const CLOUD_RECO_FLAG_KEY = 'desktop-cloud-reco'
export const cloudRecoSwitch = createOpsSwitch(CLOUD_RECO_FLAG_KEY, true)

/**
 * "5 FREE RUNS" trial pill.
 *
 * Reads the CLOUD-owned flag rather than a desktop mirror, so the pill tracks the real
 * free-tier rollout with nothing to keep in sync. `free_tier_workflow_submission_enabled`
 * is a flag-dependency on `free_tier_job_allowance_enabled` (the BE-1304 ramp), so the
 * pill appears exactly when free-tier workflow submission actually becomes available.
 *
 * Free tier is NOT live for general users as of 2026-07-24: the parent flag's only
 * property-free release condition sits at 0% rollout, so this resolves `false` for every
 * anonymous caller and the pill stays hidden. That is the correct state, not a
 * misconfiguration — there is no offer to advertise yet. When the ramp raises that
 * condition the flag flips on its own and the pill appears; no desktop release needed.
 *
 * Evaluated remotely and anonymously (`getOpsFlag` sends no person properties and
 * desktop sets no personal API key), which is what lets PostHog resolve the dependency
 * chain server-side. Verified: an anonymous distinct id returns `false` with reason
 * `no_condition_match`.
 *
 * CAVEAT during a partial ramp: bucketing uses whatever distinct id we pass, which here
 * is the anonymous installation id — not the user id the grant is later keyed to. At 0%
 * and 100% that's exact; at intermediate percentages pill visibility and actual grant
 * eligibility are independently sampled. Fail-closed keeps that error on the safe side
 * (under-show rather than over-promise).
 *
 * Fails CLOSED, unlike the recommendation: the pill asserts a live entitlement, and
 * advertising free runs that aren't being granted is worse than showing nothing.
 */
export const CLOUD_FREE_RUNS_FLAG_KEY = 'free_tier_workflow_submission_enabled'
export const cloudFreeRunsSwitch = createOpsSwitch(CLOUD_FREE_RUNS_FLAG_KEY, false)
