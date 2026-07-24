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
 * For the same reason both are evaluated ANONYMOUSLY: at first use there is no Cloud
 * session, so a flag whose release conditions depend on person properties (email,
 * cohort) cannot resolve here. Keep the release conditions of these two keys
 * property-free — a percentage or property rollout would silently mis-target.
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
 * Fails CLOSED, unlike the recommendation: the pill asserts a live entitlement, and
 * advertising free runs that aren't being granted is worse than showing nothing. An
 * unreachable flag means we can't confirm the offer, so we don't make it.
 *
 * NOTE: deliberately NOT the cloud repo's `free_tier_job_allowance_enabled`. That is a
 * per-user backend rollout gate whose release conditions are `email icontains
 * @comfy.org` at 100% and everyone else at 0%, so it evaluates false for every
 * anonymous desktop client — wiring the pill to it would hide the pill in production.
 * This key is the client-side mirror; ops flips it in tandem with the cloud
 * `FreeTierJobAllowanceEnabled` dynamic config.
 */
export const CLOUD_FREE_RUNS_FLAG_KEY = 'desktop-cloud-free-runs'
export const cloudFreeRunsSwitch = createOpsSwitch(CLOUD_FREE_RUNS_FLAG_KEY, false)
