// Boot never waits for the id: every consumer awaits initDeviceId()'s one promise, with no timeout or fallback of its own.
import {
  clearLegacyIdentityRetryMarker,
  consumeFirstLaunch,
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

export interface BootIdentityOptions {
  appVersion: string
  locale: string | undefined
  trackedSettings: () => Record<string, TelemetryValue>
}

export function startBootIdentity(opts: BootIdentityOptions): Promise<void> {
  const launchedAt = new Date()
  // Read before anything can write device-id.txt or the first-launch guard.
  const existingInstallation = hasCompletedFirstLaunch() || hasPersistedDeviceId()
  // A denial during the id wait drops first_launch, as it dropped the one base staged at boot.
  const consentDenialsAtLaunch = mainTelemetry.getConsentDenials()
  const anonymousDistinctId = recoverPendingIdentityRotation(
    getInitialAnonymousDistinctId(existingInstallation)
  )
  // installation_id is an event/person property, never a PostHog identity.
  mainTelemetry.bindAnonymousId(anonymousDistinctId, null)
  const resolved = initDeviceId()

  // Without consent the fetch returns nothing, so skip it rather than make readers wait for the id.
  void initExperiments(
    mainTelemetry.getConsentState() === 'granted'
      ? resolved.then(() => ({
          distinctId: getDeviceId(),
          personProperties: {
            platform: process.platform,
            arch: process.arch,
            app_version: opts.appVersion,
            id_class: getIdClass()
          }
        }))
      : null
  )

  // Before any ops flag fetch: the boot evaluation is the only authoritative one (see staffFlagTargeting.ts).
  initStaffFlagTargeting()

  const flagId = { distinctId: resolved.then(() => getDeviceId()) }
  // An ops flag, not an experiment: the picker renders before consent, when experiments have no value (cloudFreeRuns.ts).
  void initCloudFreeRuns(flagId)
  void initCoreBetaGrants(flagId)

  return resolved.then(({ legacyId }) => {
    clearLegacyIdentityRetryMarker()
    if (!mainTelemetry.hasShutDown()) {
      mainTelemetry.setInstallationId(getDeviceId(), {
        app_version: opts.appVersion,
        platform: process.platform,
        arch: process.arch,
        id_class: getIdClass()
      })

      // Re-registered on change in applySettingSet (#1220/#1223).
      mainTelemetry.registerPersonProperties(opts.trackedSettings())
    }

    // Consumed only once the id resolves, so a quit first leaves first_launch for the next launch.
    const isFirstLaunch = !mainTelemetry.hasShutDown() && consumeFirstLaunch()
    if (legacyId) {
      // Historical random ids are reconciled in PostHog, not by Desktop alias writes.
      markIdentityMigrationCompleted()
    }

    // captureFirstLaunch, not capture: consent may still be undecided, and the once-ever guard is already burned.
    if (isFirstLaunch && mainTelemetry.getConsentDenials() === consentDenialsAtLaunch) {
      const timing = getIdLookupTiming()
      mainTelemetry.captureFirstLaunch(
        {
          id_class: getIdClass(),
          id_lookup_ms: timing?.idLookupMs ?? null,
          id_lookup_timed_out: timing?.idLookupTimedOut ?? null,
          boot_to_id_ms: timing?.bootToIdMs ?? null,
          locale: opts.locale
        },
        launchedAt
      )
    }
  })
}
