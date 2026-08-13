/**
 * Distributions feature-visibility switch.
 *
 * Reads the `distributions_enabled` PostHog flag at boot via `getOpsFlag`, which
 * deliberately BYPASSES the consent gate: this is server config pushed TO the client
 * to control whether the distributions UI is shown, not analytics collected FROM the
 * user, so a user who declined telemetry still gets the correct gate. Only the
 * anonymous distinct id and flag key leave the device.
 *
 * Shares its key with the platform website's own `distributions_enabled` PostHog flag
 * (see Comfy-Org/platform `constants/posthog.ts`) so a single flag toggles the
 * distributions feature on both surfaces.
 *
 * The distributions feature shipped unflagged before this switch existed, so the
 * default is `true` (fail OPEN) — a fetch miss/timeout must never accidentally hide
 * a feature every existing user already sees.
 *
 * Mirrors `cloudFreeRuns.ts`: fetched once at boot; running apps pick up new values
 * on restart.
 */
import * as mainTelemetry from './telemetry'

export const DISTRIBUTIONS_ENABLED_FLAG_KEY = 'distributions_enabled'

const DEFAULT_TIMEOUT_MS = 2000

let cached = true
let initPromise: Promise<void> | null = null

/**
 * Boot-time fetch. The returned promise is cached so the IPC handler can await it: a
 * renderer query landing before the fetch settles sees the resolved value, not the
 * default. Idempotent within a process.
 */
export function initDistributionsEnabled(opts: {
  distinctId: string
  timeoutMs?: number
}): Promise<void> {
  if (initPromise) return initPromise
  initPromise = mainTelemetry
    .getOpsFlag(DISTRIBUTIONS_ENABLED_FLAG_KEY, opts.distinctId, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    .then((value) => {
      if (typeof value === 'boolean') {
        cached = value
      }
      // Else keep the current cache (undefined, string, or unknown value).
      console.log('[distributions-enabled] init: fetched=', value, '→ cached=', cached)
    })
    .catch((err) => {
      console.log('[distributions-enabled] init error:', err)
      // fail-safe: keep the current cache (defaults to `true`)
    })
  return initPromise
}

/** Awaits the in-flight init fetch so renderer queries landing before it settles still get
 *  the resolved value, not the `true` default. */
export async function getDistributionsEnabledAsync(): Promise<boolean> {
  if (initPromise) {
    try {
      await initPromise
    } catch {
      /* keep cached */
    }
  }
  return cached
}

/** Synchronous accessor returning the current cache. Prefer the async variant from an
 *  IPC handler so the first call doesn't race the boot fetch. */
export function getDistributionsEnabled(): boolean {
  return cached
}

/** @internal — exposed for tests. */
export function _resetForTest(): void {
  cached = true
  initPromise = null
}
