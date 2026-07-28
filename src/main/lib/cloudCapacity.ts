/**
 * Cloud capacity-protection switch.
 *
 * Reads the `desktop-cloud-capacity` PostHog flag at boot. The read bypasses the consent gate:
 * this is server config pushed TO the client to protect service availability, not analytics
 * collected FROM the user, so a user who declined telemetry still benefits when GPUs are
 * saturated. See `opsFlag.ts` for the shared plumbing and the rest of that reasoning.
 *
 * Fail-safe direction is `'normal'`: an unreachable or unrecognised flag must not take Cloud
 * away from users who could otherwise book it.
 */
import { makeOpsFlag } from './opsFlag'
import type { CloudCapacityStatus } from '../../types/ipc'

export const CLOUD_CAPACITY_FLAG_KEY = 'desktop-cloud-capacity'

const VALID: ReadonlySet<CloudCapacityStatus> = new Set(['normal', 'degraded', 'disabled'])

const flag = makeOpsFlag<CloudCapacityStatus>({
  key: CLOUD_CAPACITY_FLAG_KEY,
  fallback: 'normal',
  logLabel: 'cloud-capacity',
  // `undefined`, booleans, and unknown strings all keep `'normal'`.
  parse: (value) =>
    typeof value === 'string' && VALID.has(value as CloudCapacityStatus)
      ? (value as CloudCapacityStatus)
      : undefined
})

/** Boot-time fetch. Idempotent within a process; never rejects. */
export const initCloudCapacity = flag.init

/** Awaits the in-flight init fetch so renderer queries landing before it settles still get
 *  the resolved status, not the `'normal'` default. */
export const getCloudCapacityStatusAsync = flag.get

/** @internal — exposed for tests. */
export const _resetForTest = flag._resetForTest
