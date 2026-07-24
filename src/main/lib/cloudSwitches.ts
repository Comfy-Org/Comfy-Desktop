/**
 * Boolean ops switches for the first-use Cloud surface. Fetched once at boot.
 *
 * Read via `getOpsFlag`, which bypasses the consent gate — same reasoning as
 * `cloudCapacity.ts`. The bypass is load-bearing: this surface only renders while
 * consent is `'undecided'`, and the `experiments.ts` cache stays empty until consent is
 * `'granted'`, so a switch routed through it could never fire.
 *
 * Evaluated anonymously — no Cloud session exists at first use — so
 * `desktop-cloud-reco`'s release conditions must stay property-free or it mis-targets.
 */
import * as mainTelemetry from './telemetry'

const DEFAULT_TIMEOUT_MS = 2000

interface OpsSwitch {
  init: (opts: { distinctId: string; timeoutMs?: number }) => Promise<void>
  getAsync: () => Promise<boolean>
  _resetForTest: () => void
}

/** `whenUnresolved` is the direction this switch fails: the value used when the flag is
 *  missing, times out, errors, or returns something unrecognised. */
function createOpsSwitch(key: string, whenUnresolved: boolean): OpsSwitch {
  let cached = whenUnresolved
  let initPromise: Promise<void> | null = null
  return {
    // Promise cached so the IPC handler can await it — a query landing mid-fetch sees
    // the resolved value, not the default. Idempotent within a process.
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

/** Recommendation badge + no-preselect. Fails OPEN: it makes the user no promise that
 *  could turn out false, so an outage shouldn't pull a working feature. */
export const CLOUD_RECO_FLAG_KEY = 'desktop-cloud-reco'
export const cloudRecoSwitch = createOpsSwitch(CLOUD_RECO_FLAG_KEY, true)

/** "5 FREE RUNS" pill. Reads cloud's own flag — a dependency on
 *  `free_tier_job_allowance_enabled` — so it tracks the real free-tier rollout instead
 *  of a desktop mirror someone has to keep in sync. Resolves false for everyone while
 *  free tier isn't live, and flips on its own when the ramp lands. Fails CLOSED: the
 *  pill asserts a live entitlement, and advertising runs that aren't granted is worse
 *  than showing nothing. */
export const CLOUD_FREE_RUNS_FLAG_KEY = 'free_tier_workflow_submission_enabled'
export const cloudFreeRunsSwitch = createOpsSwitch(CLOUD_FREE_RUNS_FLAG_KEY, false)
