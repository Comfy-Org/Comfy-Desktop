/**
 * GPU-aware Cloud recommendation kill switch.
 *
 * Reads the `desktop-cloud-reco` PostHog flag at boot via `getOpsFlag`, which BYPASSES
 * the consent gate — same reasoning as `cloudCapacity.ts`: server config pushed TO the
 * client, not analytics collected FROM the user.
 *
 * That bypass is what makes the switch usable here at all. The surface it governs (the
 * first-use picker) renders while consent is still `'undecided'`, and the
 * `experiments.ts` cache stays empty until consent is `'granted'` — routing this through
 * it would leave ops holding a switch that could never fire.
 *
 * Fails OPEN: only an explicit `'off'` / `false` disables, so a PostHog outage can't
 * silently pull a working feature. Fetched once at boot; picked up on restart.
 */
import * as mainTelemetry from './telemetry'

export const CLOUD_RECO_FLAG_KEY = 'desktop-cloud-reco'

const DEFAULT_TIMEOUT_MS = 2000

let cached = true
let initPromise: Promise<void> | null = null

/**
 * Boot-time fetch. The returned promise is cached so the IPC handler can await it: a
 * renderer query landing before the fetch settles sees the resolved value, not the default.
 * Idempotent within a process.
 */
export function initCloudReco(opts: { distinctId: string; timeoutMs?: number }): Promise<void> {
  if (initPromise) return initPromise
  initPromise = mainTelemetry
    .getOpsFlag(CLOUD_RECO_FLAG_KEY, opts.distinctId, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    .then((value) => {
      // Only an explicit off disables. `undefined` (flag missing / timed out),
      // `true`, and any unrecognised string all leave the feature on.
      if (value === 'off' || value === false) cached = false
    })
    .catch(() => {
      // fail-open: keep `true`
    })
  return initPromise
}

/** Awaits the in-flight init fetch so renderer queries landing before it settles still get
 *  the resolved value, not the fail-open default. */
export async function getCloudRecoEnabledAsync(): Promise<boolean> {
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
  cached = true
  initPromise = null
}
