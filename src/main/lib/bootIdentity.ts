/**
 * Boot wiring for the installation id.
 *
 * Boot does not wait for the id. The first window opens while the hardware
 * lookup is still running, and each consumer waits only when it needs the id:
 *
 *   - telemetry holds captures until the id is bound (`holdUntilBound`);
 *   - the ops flags wait up to `FLAG_ID_WAIT_MS`, then read as unreachable
 *     rather than fetch under any other id, so a sticky rollout only ever
 *     evaluates the final one;
 *   - the experiments refresh waits for the id; `getFlag()` serves the disk
 *     cache meanwhile;
 *   - `first_launch` and the legacy-id migration run once the id resolves.
 *
 * Nothing here persists an id; `initDeviceId()` does, once, when it resolves.
 */
import {
  clearLegacyIdentityRetryMarker,
  consumeFirstLaunch,
  deviceIdWithin,
  getDeviceId,
  getIdClass,
  getIdLookupTiming,
  hasCompletedFirstLaunch,
  hasPersistedDeviceId,
  initDeviceId,
  markIdentityMigrationCompleted
} from './deviceId'
import * as mainTelemetry from './telemetry'
import type { TelemetryValue } from './telemetry'
import { getInitialAnonymousDistinctId } from './websiteAnonymousIdentity'
import { recoverPendingIdentityRotation } from './pendingIdentityMerge'
import { initExperiments } from './experiments'
import { initCloudFreeRuns } from './cloudFreeRuns'
import { initCoreBetaGrants } from './coreBetaGrants'
import { initStaffFlagTargeting } from './staffFlagTargeting'

/**
 * How long the ops flags wait for the id. The first-use picker awaits
 * `cloudFreeRuns`, so this plus the fetch's own timeout is how long it can
 * wait; it matches the boot wait this replaces.
 */
export const FLAG_ID_WAIT_MS = 2000

export interface BootIdentityOptions {
  appVersion: string
  /** UI locale setting, reported on `first_launch`. */
  locale: string | undefined
  /** Tracked global settings, registered as person properties at bind. */
  trackedSettings: () => Record<string, TelemetryValue>
}

/**
 * Start resolving the installation id and wire every boot consumer to it.
 * Returns at once; the returned promise settles when the id is bound.
 */
export function startBootIdentity(opts: BootIdentityOptions): Promise<void> {
  // Read before anything can write device-id.txt or the first-launch guard.
  const existingInstallation = hasCompletedFirstLaunch() || hasPersistedDeviceId()
  const anonymousDistinctId = recoverPendingIdentityRotation(
    getInitialAnonymousDistinctId(existingInstallation)
  )
  mainTelemetry.holdUntilBound()
  const resolved = initDeviceId()

  // Boot the experiments cache. Synchronously loads the on-disk flag values
  // for `getFlag()`; the background refresh lands on disk for the NEXT boot.
  void initExperiments(
    resolved.then(() => ({
      distinctId: getDeviceId(),
      personProperties: {
        platform: process.platform,
        arch: process.arch,
        app_version: opts.appVersion,
        id_class: getIdClass()
      }
    }))
  )

  // Bind the stored staff classification BEFORE any ops flag is fetched. The
  // boot evaluation is the only authoritative one, so a property that arrives
  // after it cannot affect this launch — see `staffFlagTargeting.ts`. Also
  // subscribes to the identity consensus, which is what reclassifies for the
  // NEXT launch; this runs before any view exists, so no outcome is missed.
  initStaffFlagTargeting()

  // This ops-flag path is separate from consent-gated experiments: the
  // first-use picker renders while consent is still `'undecided'`, so the
  // experiments cache would never have a value to give it. See
  // `cloudFreeRuns.ts`.
  const flagDistinctId = deviceIdWithin(FLAG_ID_WAIT_MS)
  void initCloudFreeRuns({ distinctId: flagDistinctId })
  void initCoreBetaGrants({ distinctId: flagDistinctId })

  return resolved.then(({ legacyId }) => {
    clearLegacyIdentityRetryMarker()
    // installation_id is an event/person property, never a PostHog identity.
    mainTelemetry.bindAnonymousId(anonymousDistinctId, getDeviceId(), {
      app_version: opts.appVersion,
      platform: process.platform,
      arch: process.arch,
      id_class: getIdClass()
    })

    // Durable snapshot of the tracked global settings as person properties
    // (issues #1220/#1223), so adoption of every setting is queryable across
    // the whole base. Consent-gated: queued until granted. Re-registered on
    // change in `applySettingSet`.
    mainTelemetry.registerPersonProperties(opts.trackedSettings())

    // Consumed only now, so a quit before the id resolves leaves the guard in
    // place and the next launch fires the event instead of losing it.
    const isFirstLaunch = consumeFirstLaunch()
    if (legacyId) {
      // Historical random installation ids are reconciled directly in
      // PostHog, not by Desktop alias writes. Complete only the local migration.
      markIdentityMigrationCompleted()
    }

    // Desktop-side anchor of the website → download → first-launch
    // acquisition funnel. Fires exactly once per installation, ever (guard
    // file alongside device-id.txt). app_version / app_channel / platform /
    // arch ride in as default event properties; id_class, the id lookup
    // timing and locale are added here.
    //
    // `captureFirstLaunch` (not plain `capture`) because this fires on a
    // fresh install, when consent is still `'undecided'` — a plain capture
    // would be dropped on the consent gate while the once-ever guard stays
    // burned, losing the event forever. The deferred path ships it on the
    // first `undecided → granted` transition and never on a decline.
    if (isFirstLaunch) {
      const timing = getIdLookupTiming()
      mainTelemetry.captureFirstLaunch({
        id_class: getIdClass(),
        id_lookup_ms: timing?.idLookupMs ?? null,
        id_lookup_timed_out: timing?.idLookupTimedOut ?? null,
        boot_to_id_ms: timing?.bootToIdMs ?? null,
        locale: opts.locale
      })
    }
  })
}
