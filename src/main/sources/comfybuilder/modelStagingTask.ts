import { installModelsRoot, resolveModelManifest, stageModels } from '../../comfybuilder'
import type { ModelDescriptor } from '../../comfybuilder'
import { getBuilderClient } from '../../devplatform/session'
import * as installations from '../../installations'
import type { InstallationRecord } from '../../installations'

const _stagingAborts = new Map<string, AbortController>()

export function abortModelStaging(installationId: string): void {
  const ctrl = _stagingAborts.get(installationId)
  if (ctrl) {
    ctrl.abort()
    _stagingAborts.delete(installationId)
  }
}

export function startModelStaging(
  installation: InstallationRecord,
  models: readonly ModelDescriptor[]
): void {
  const installationId = installation.id
  if (_stagingAborts.has(installationId)) return
  const abort = new AbortController()
  _stagingAborts.set(installationId, abort)

  void runModelStagingTask(installation, models, abort.signal)
    .catch((err) => {
      console.warn(
        `[buildModels:${installationId}] staging failed: ${err instanceof Error ? err.message : String(err)}`
      )
    })
    .finally(() => {
      if (_stagingAborts.get(installationId) === abort) _stagingAborts.delete(installationId)
    })
}

export type ModelStagingOutcome = 'staged' | 'busy' | 'aborted'

export async function runModelStagingTask(
  installation: InstallationRecord,
  models: readonly ModelDescriptor[],
  signal: AbortSignal
): Promise<ModelStagingOutcome> {
  const installationId = installation.id
  if (models.length === 0) {
    await installations.update(installationId, { modelsStaged: true }).catch(() => {})
    return 'staged'
  }

  const downloadManager = await import('../../lib/comfyDownloadManager')
  const modelsRoot = installModelsRoot(installation.installPath)
  downloadManager.releaseParkedModelJobsUnder(modelsRoot)
  const releaseModelRoot = downloadManager.acquireModelDownloadRootLock(modelsRoot)
  if (!releaseModelRoot) {
    console.warn(
      `[buildModels:${installationId}] model directory is busy; staging retries at the next launch`
    )
    return 'busy'
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
  if (signal.aborted) return 'aborted'
  await installations.update(installationId, { modelsStaged: true }).catch(() => {})
  console.log(`[buildModels:${installationId}] all build models staged`)
  return 'staged'
}

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
