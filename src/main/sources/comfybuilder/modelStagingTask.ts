import { installModelsRoot, resolveModelManifest, stageModels } from '../../comfybuilder'
import type { ModelDescriptor } from '../../comfybuilder'
import { getBuilderClient } from '../../devplatform/session'
import * as installations from '../../installations'
import type { InstallationRecord } from '../../installations'

/**
 * Background model staging for a ComfyBuilder build install.
 *
 * The environment install (archive download + extract) is what gates launch;
 * the build's declared models download in the background afterwards, the same
 * way standalone installs fetch starter-template models. Every transfer is a
 * REAL managed job in `comfyDownloadManager`, so it shows in the Downloads
 * tray with working pause/resume/cancel and survives app restarts.
 *
 * Completion is recorded on the install record as `modelsStaged: true`. A
 * record without that flag (crash, abort, staging failure, or a record written
 * before the flag existed) is re-staged at its next launch via
 * {@link restageBuildModelsIfNeeded}; models already on disk with a matching
 * hash are skipped by `stageModels`, so a re-stage only fetches what is
 * missing.
 *
 * Aborting is destructive for the in-flight file only: `stageModels` cancels
 * its current managed job (staged bytes removed) so a teardown never races an
 * open download stream inside a tree that is about to be deleted. Completed
 * models keep their bytes and are skipped on the next re-stage.
 */

const _stagingAborts = new Map<string, AbortController>()

/** Stop this install's background staging (no-op when none is running). */
export function abortModelStaging(installationId: string): void {
  const ctrl = _stagingAborts.get(installationId)
  if (ctrl) {
    ctrl.abort()
    _stagingAborts.delete(installationId)
  }
}

/**
 * Kick off background staging of `models` into the install's own model tree.
 * Synchronous + fire-and-forget; no-op if a task is already running for this
 * install. Failures are logged, never thrown: the launch-time re-stage is the
 * retry path.
 */
export function startModelStaging(
  installation: InstallationRecord,
  models: readonly ModelDescriptor[]
): void {
  const installationId = installation.id
  if (_stagingAborts.has(installationId)) return
  const abort = new AbortController()
  _stagingAborts.set(installationId, abort)

  void runTask(installation, models, abort.signal)
    .catch((err) => {
      console.warn(
        `[buildModels:${installationId}] staging failed: ${err instanceof Error ? err.message : String(err)}`
      )
    })
    .finally(() => {
      // Identity-guarded cleanup: abortModelStaging (or a newer task started
      // for this install) may already have removed or replaced this entry -
      // never delete a successor's controller.
      if (_stagingAborts.get(installationId) === abort) _stagingAborts.delete(installationId)
    })
}

async function runTask(
  installation: InstallationRecord,
  models: readonly ModelDescriptor[],
  signal: AbortSignal
): Promise<void> {
  const installationId = installation.id
  if (models.length === 0) {
    await installations.update(installationId, { modelsStaged: true }).catch(() => {})
    return
  }

  // Load this lazily: the download manager imports the source registry, which
  // includes the ComfyBuilder plugin this task belongs to.
  const downloadManager = await import('../../lib/comfyDownloadManager')
  const modelsRoot = installModelsRoot(installation.installPath)
  // Parked rows inside this root (hydrated from a previous interrupted run)
  // would block the lock forever, and their presigned URLs are stale anyway.
  // Retire the rows; their staged bytes stay on disk and the re-staged
  // downloads below resume them by source URL or sha256.
  downloadManager.releaseParkedModelJobsUnder(modelsRoot)
  const releaseModelRoot = downloadManager.acquireModelDownloadRootLock(modelsRoot)
  if (!releaseModelRoot) {
    console.warn(
      `[buildModels:${installationId}] model directory is busy; staging retries at the next launch`
    )
    return
  }
  try {
    await stageModels({
      models,
      installPath: installation.installPath,
      installationId,
      jobs: {
        start: downloadManager.startManagedModelJob,
        cancel: downloadManager.cancelModelDownload
      },
      signal
    })
  } finally {
    releaseModelRoot()
  }
  if (signal.aborted) return
  // The record may be gone by now (install deleted mid-download) - that's fine.
  await installations.update(installationId, { modelsStaged: true }).catch(() => {})
  console.log(`[buildModels:${installationId}] all build models staged`)
}

/**
 * Re-stage a build install's models when a prior staging never finished.
 * Fire-and-forget; resolving the manifest needs the signed-in Builder client,
 * so a signed-out or offline launch silently skips and a later launch retries.
 */
export function restageBuildModelsIfNeeded(installation: InstallationRecord): void {
  if (installation.modelsStaged === true) return
  if (_stagingAborts.has(installation.id)) return
  const distributionId = installation.distributionId as string | undefined
  const version = installation.version as string | undefined
  if (!distributionId || !version) return
  void (async () => {
    const manifest = await resolveModelManifest(getBuilderClient(), distributionId, version)
    startModelStaging(installation, manifest.models)
  })().catch((err) => {
    console.warn(
      `[buildModels:${installation.id}] model manifest unavailable (${err instanceof Error ? err.message : String(err)}); staging retries at the next launch`
    )
  })
}
