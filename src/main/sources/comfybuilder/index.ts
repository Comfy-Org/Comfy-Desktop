/**
 * ComfyBuilder install source: main process only.
 *
 * A thin SourcePlugin over the comfy-builder functionality library. The catalog
 * / host-matching / sign-in all happen in the dev-platform IPC layer; by the
 * time an install record reaches here it already carries the chosen artifact's
 * identity (id + os/gpu/accel + sha256). `install()` hands that artifact to the
 * library's `installArtifact` (download, verify sha, extract into the install
 * dir), and `getLaunchCommand()` drives the extracted `venv/` via
 * `buildLaunchSpec`. There is no adopt/probe path: a ComfyBuilder install is
 * only ever created by the dev-platform flow, never discovered on disk.
 *
 * Launch parity matters as much as install: the renderer discovers whether an
 * install can run from `getListActions`, so omitting it silently downgrades a
 * distribution to "not launchable" and bounces a tile click into the
 * new-install wizard. That is why `getListActions` below exists even though it
 * looks like boilerplate.
 */
import { promises as fs } from 'fs'
import path from 'path'
import {
  installArtifact,
  buildLaunchSpec,
  stageModels,
  resolveModelManifest,
  normalizeSha256
} from '../../comfybuilder'
import type {
  Artifact,
  ArtifactGpu,
  ArtifactOs,
  InstallProgress,
  StageProgress
} from '../../comfybuilder'
import { getBuilderClient } from '../../devplatform/session'
import {
  listCompleteVersions,
  resolveHost,
  resolveHostArtifactForVersion
} from '../../devplatform/distributions'
import {
  getAvailableUpdate,
  getVersionCacheGeneration,
  setCachedVersions
} from '../../devplatform/versionCache'
import { launchAction } from '../../lib/actions'
import { defaultDownloadCacheDir } from '../../lib/paths'
import { t } from '../../lib/i18n'
import type { InstallationRecord } from '../../installations'
import type {
  SourcePlugin,
  LaunchCommand,
  ActionResult,
  ActionTools,
  InstallTools,
  StatusTag
} from '../../types/sources'

import { DEFAULT_LAUNCH_ARGS } from './constants'
import { getDetailSections } from './detailSections'

const READY_MARKER = '.comfybuilder-environment-ready'
const ROLLBACK_FIELD = 'comfybuilderRollback'

interface EnvironmentRollback {
  version?: string
  artifactId?: string
  artifactOs?: string
  artifactGpu?: string
  artifactAccelVariant?: string
  artifactSha256?: string
  status?: string
}

export type ComfyBuilderRecovery =
  | { action: 'none' }
  | { action: 'update'; data: Record<string, unknown> }

function environmentPaths(installPath: string) {
  const venv = path.join(installPath, 'venv')
  const comfy = path.join(installPath, 'ComfyUI')
  return {
    venv,
    comfy,
    previousVenv: `${venv}.previous`,
    previousComfy: `${comfy}.previous`,
    models: path.join(comfy, 'models'),
    preservedModels: path.join(installPath, '.comfybuilder-models-preserved'),
    readyMarker: path.join(installPath, READY_MARKER)
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

async function renameIfExists(from: string, to: string): Promise<boolean> {
  try {
    await fs.rename(from, to)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

async function isRunnableEnvironment(installPath: string): Promise<boolean> {
  return Promise.all([
    fs.stat(path.join(installPath, 'venv')),
    fs.stat(path.join(installPath, 'ComfyUI', 'main.py'))
  ]).then(
    () => true,
    () => false
  )
}

async function hasEnvironmentBackups(installPath: string): Promise<boolean> {
  const paths = environmentPaths(installPath)
  return (
    (await pathExists(paths.previousVenv)) ||
    (await pathExists(paths.previousComfy)) ||
    (await pathExists(paths.preservedModels))
  )
}

async function restoreEnvironmentBackups(installPath: string): Promise<void> {
  const paths = environmentPaths(installPath)
  const hasPreviousComfy = await pathExists(paths.previousComfy)
  let hasPreservedModels = await pathExists(paths.preservedModels)

  if (hasPreviousComfy && !hasPreservedModels) {
    hasPreservedModels = await renameIfExists(paths.models, paths.preservedModels)
  }
  if (hasPreviousComfy) {
    await fs.rm(paths.comfy, { recursive: true, force: true })
    await fs.rename(paths.previousComfy, paths.comfy)
  }
  if (hasPreservedModels) {
    await fs.mkdir(paths.comfy, { recursive: true })
    await fs.rm(paths.models, { recursive: true, force: true })
    await fs.rename(paths.preservedModels, paths.models)
  }
  if (await pathExists(paths.previousVenv)) {
    await fs.rm(paths.venv, { recursive: true, force: true })
    await fs.rename(paths.previousVenv, paths.venv)
  }
}

/** Remove committed transaction debris, deleting the marker last so startup
 * recovery still knows the active environment is authoritative on failure. */
async function finalizeEnvironmentTransaction(installPath: string): Promise<void> {
  const paths = environmentPaths(installPath)
  await fs.rm(paths.previousVenv, { recursive: true, force: true })
  await fs.rm(paths.previousComfy, { recursive: true, force: true })
  await fs.rm(paths.preservedModels, { recursive: true, force: true })
  await fs.rm(paths.readyMarker, { force: true })
}

export async function finalizeComfyBuilderRecovery(installPath: string): Promise<void> {
  await finalizeEnvironmentTransaction(installPath)
}

/** Recover or finish a ComfyBuilder filesystem transaction interrupted by an
 * app or machine shutdown. The caller applies the returned record mutation. */
export async function recoverComfyBuilderInstallation(
  installation: InstallationRecord
): Promise<ComfyBuilderRecovery> {
  const paths = environmentPaths(installation.installPath)
  const ready = await pathExists(paths.readyMarker)
  const hasBackups = await hasEnvironmentBackups(installation.installPath)
  const rollback = installation[ROLLBACK_FIELD] as EnvironmentRollback | undefined

  if (ready) {
    if (installation.status === 'installing' || rollback) {
      return { action: 'update', data: { status: 'installed', [ROLLBACK_FIELD]: undefined } }
    }
    await finalizeEnvironmentTransaction(installation.installPath)
    return { action: 'none' }
  }

  if (hasBackups) {
    await restoreEnvironmentBackups(installation.installPath)
    if (rollback) {
      const runnable = await isRunnableEnvironment(installation.installPath)
      return {
        action: 'update',
        data: {
          ...rollback,
          status: runnable ? (rollback.status ?? 'installed') : 'failed',
          [ROLLBACK_FIELD]: undefined
        }
      }
    }
    return installation.status === 'installing'
      ? { action: 'update', data: { status: 'failed' } }
      : { action: 'none' }
  }

  if (rollback) {
    const runnable = await isRunnableEnvironment(installation.installPath)
    return {
      action: 'update',
      data: {
        ...rollback,
        status: runnable ? (rollback.status ?? 'installed') : 'failed',
        [ROLLBACK_FIELD]: undefined
      }
    }
  }

  return installation.status === 'installing'
    ? { action: 'update', data: { status: 'failed' } }
    : { action: 'none' }
}

/** Reconstruct the library Artifact from the fields the install record carries. */
function artifactFromRecord(inst: InstallationRecord): Artifact {
  return {
    id: (inst.artifactId as string) ?? '',
    os: (inst.artifactOs as ArtifactOs) ?? 'linux',
    gpu: (inst.artifactGpu as ArtifactGpu) ?? 'cpu',
    accelVariant: (inst.artifactAccelVariant as string) ?? '',
    status: 'ready',
    ...(inst.artifactSha256 ? { archiveSha256: inst.artifactSha256 as string } : {})
  }
}

/**
 * Pin the accelerator args the installed artifact implies.
 *
 * A CPU artifact ships a CPU-only torch, and ComfyUI defaults to probing CUDA:
 * without `--cpu` it dies at import with "Torch not compiled with CUDA enabled".
 * Which artifact got installed is a property of the machine, not a user
 * preference, so it is pinned here rather than baked into the editable launch
 * args. Skipped when the user already passed `--cpu` themselves. nvidia/amd/mps
 * need no flag: torch and ComfyUI detect those on their own.
 */
export function withAccelArgs(installation: InstallationRecord, launchArgs: string): string {
  const isCpu = installation.artifactGpu === 'cpu' || installation.artifactAccelVariant === 'cpu'
  if (!isCpu || /(?:^|\s)--cpu(?:\s|$)/.test(launchArgs)) return launchArgs
  return `${launchArgs} --cpu`.trim()
}

/**
 * Lay down the environment for whatever artifact the record currently points
 * at. Shared by the first install and by an in-place version change, so the two
 * can't diverge on venv handling or model staging.
 *
 * Takes only what both callers have: progress + an abort signal.
 */
async function installEnvironment(
  installation: InstallationRecord,
  // Narrower than `ActionTools.sendProgress` on purpose: a handler that accepts
  // `Record<string, unknown>` satisfies this, but not the reverse.
  tools: {
    sendProgress: (step: string, data: { percent: number; status: string }) => void
    signal?: AbortSignal
  },
  onTransactionStarted?: () => Promise<void>
): Promise<void> {
  const artifact = artifactFromRecord(installation)
  const client = getBuilderClient()
  const paths = environmentPaths(installation.installPath)

  let hadPreviousVenv = false
  let hadPreviousComfy = false
  let modelsDetached = false

  /** Restore both executable halves of the previous distribution. Models are
   *  moved out and back rather than copied because they can be hundreds of GB. */
  async function restorePreviousEnvironment(): Promise<void> {
    if (hadPreviousComfy && !modelsDetached) {
      modelsDetached = await renameIfExists(paths.models, paths.preservedModels)
    }
    if (hadPreviousComfy) {
      await fs.rm(paths.comfy, { recursive: true, force: true }).catch(() => {})
      await fs.rename(paths.previousComfy, paths.comfy)
    }
    if (modelsDetached) {
      await fs.mkdir(paths.comfy, { recursive: true })
      await fs.rename(paths.preservedModels, paths.models)
      modelsDetached = false
    }
    if (hadPreviousVenv) {
      await fs.rm(paths.venv, { recursive: true, force: true }).catch(() => {})
      await fs.rename(paths.previousVenv, paths.venv)
    }
  }

  // Neither executable tree can be overlaid: stale packages or source files can
  // make the resulting version incoherent. Move both aside until archive and
  // model staging finish. Keep models in the active tree so updates preserve
  // existing weights and stage only what the new manifest adds.
  const interrupted = await hasEnvironmentBackups(installation.installPath)
  if (interrupted) throw new Error('An interrupted ComfyBuilder update must be recovered first.')
  await fs.rm(paths.readyMarker, { force: true }).catch(() => {})

  try {
    // Persist the non-runnable status and rollback metadata before moving either
    // executable tree, so another window cannot launch through the swap.
    await onTransactionStarted?.()
    hadPreviousVenv = await renameIfExists(paths.venv, paths.previousVenv)
    modelsDetached = await renameIfExists(paths.models, paths.preservedModels)
    hadPreviousComfy = await renameIfExists(paths.comfy, paths.previousComfy)
    if (modelsDetached) {
      await fs.mkdir(paths.comfy, { recursive: true })
      await fs.rename(paths.preservedModels, paths.models)
      modelsDetached = false
    }
    // Phase 1: archive (code + environment). `installArtifact` verifies the
    // sha256 and fails on a missing hash or byte mismatch.
    await installArtifact({
      artifact,
      client,
      installPath: installation.installPath,
      cacheDir: defaultDownloadCacheDir(),
      onProgress: (p: InstallProgress) => {
        // The library's `resolve` phase has no labeled step; fold it into the
        // download step at 0% so the stepper still shows forward motion.
        const phase = p.phase === 'resolve' ? 'download' : p.phase
        tools.sendProgress(phase, { percent: p.percent, status: p.detail ?? '' })
      },
      ...(tools.signal ? { signal: tools.signal } : {})
    })

    // Phase 2: models. The archive carries no weights, so stage the
    // distribution's declared models into the install's ComfyUI model tree
    // before launch, the way comfy-deploy provisions a volume before boot. An
    // empty manifest stages nothing and the step completes immediately.
    const manifest = await resolveModelManifest(
      client,
      installation.distributionId as string,
      installation.version as string
    )
    await stageModels({
      models: manifest.models,
      installPath: installation.installPath,
      onProgress: (p: StageProgress) =>
        tools.sendProgress('models', {
          percent: p.percent,
          status: `${p.filename} (${p.index}/${p.total})`
        }),
      ...(tools.signal ? { signal: tools.signal } : {})
    })
    tools.sendProgress('models', { percent: 100, status: '' })
    await fs.writeFile(paths.readyMarker, '')
  } catch (err) {
    // Put the complete working environment back before surfacing the failure.
    await restorePreviousEnvironment().catch(() => {})
    await fs.rm(paths.readyMarker, { force: true }).catch(() => {})
    throw err
  }

  await fs.rm(paths.previousVenv, { recursive: true, force: true }).catch(() => {})
  await fs.rm(paths.previousComfy, { recursive: true, force: true }).catch(() => {})
}

export const comfybuilder: SourcePlugin = {
  id: 'comfybuilder',
  label: 'ComfyBuilder',
  description: 'Install a ComfyUI distribution built with ComfyBuilder.',
  category: 'local',
  // Never a "New Install" wizard source: records are created by the dev-platform
  // distribution flow, so it must not appear in the generic source picker.
  hidden: true,
  fields: [],
  defaultLaunchArgs: DEFAULT_LAUNCH_ARGS,

  get installSteps() {
    return [
      { phase: 'download', label: t('common.download') },
      { phase: 'extract', label: t('common.extract') },
      { phase: 'models', label: t('comfybuilder.stageModels') }
    ]
  },

  getDefaults() {
    return { launchArgs: DEFAULT_LAUNCH_ARGS, launchMode: 'window', browserPartition: 'unique' }
  },

  buildInstallation(): Record<string, unknown> {
    // Records are assembled by `installDistribution` (which already knows the
    // resolved artifact), not the generic build-installation chain.
    return { launchArgs: DEFAULT_LAUNCH_ARGS, launchMode: 'window', browserPartition: 'unique' }
  },

  // The tile prefers this over the source label, and the install is named after
  // the distribution, so returning the name here would echo the tile title and
  // hide the one label marking this as a distribution. Surface it only once a
  // rename has made the two differ.
  getListPreview(installation: InstallationRecord): string | null {
    const distributionName = (installation.distributionName as string) || ''
    return distributionName && distributionName !== installation.name ? distributionName : null
  },

  getStatusTag(installation: InstallationRecord): StatusTag | undefined {
    const distributionId = installation.distributionId as string | undefined
    const currentVersion = (installation.version as string | undefined) ?? ''
    if (!distributionId) return undefined
    const latest = getAvailableUpdate(distributionId, currentVersion)
    if (latest === undefined) return undefined
    const version = `v${latest}`
    return {
      style: 'update',
      version,
      label: t('comfybuilder.updateToVersion', { version: latest })
    }
  },

  getLaunchCommand(installation: InstallationRecord): LaunchCommand | null {
    const spec = buildLaunchSpec(installation.installPath, {
      launchArgs: withAccelArgs(
        installation,
        (installation.launchArgs as string | undefined) ?? DEFAULT_LAUNCH_ARGS
      )
    })
    if (!spec) return null
    return { cmd: spec.cmd, args: spec.args, cwd: spec.cwd, port: spec.port }
  },

  // Launch is discovered through this list, not through `getLaunchCommand`: a
  // plugin without it hands the renderer an empty action array, which reads as
  // "this install cannot launch" and bounces a tile click into the new-install
  // wizard. Distributions launch like any other local install.
  getListActions(installation: InstallationRecord): Record<string, unknown>[] {
    const installed = installation.status === 'installed'
    return [launchAction(installed, !installed ? t('errors.installNotReady') : undefined)]
  },

  getDetailSections,

  // A ComfyBuilder install is never discovered on disk: only the dev-platform
  // flow creates one: so there is nothing to probe/adopt.
  probeInstallation(): Record<string, unknown> | null {
    return null
  },

  async install(installation: InstallationRecord, tools: InstallTools): Promise<void> {
    await installEnvironment(installation, tools)
  },

  // Launch / rename / open-folder / remove / delete never reach here — the
  // generic session-action dispatch (`sessionActions/index.ts`) handles those
  // before a plugin is consulted.
  async handleAction(
    actionId: string,
    installation: InstallationRecord,
    actionData: Record<string, unknown> | undefined,
    tools: ActionTools
  ): Promise<ActionResult> {
    const distributionId = installation.distributionId as string | undefined
    if (!distributionId) return { ok: false, message: t('comfybuilder.errorNoDistribution') }

    if (actionId === 'check-update') {
      try {
        const cacheGeneration = getVersionCacheGeneration()
        setCachedVersions(
          distributionId,
          await listCompleteVersions(getBuilderClient(), distributionId),
          cacheGeneration
        )
        return { ok: true }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    }

    if (actionId === 'update-comfyui') {
      return updateDistributionVersion(installation, distributionId, actionData, tools)
    }

    return { ok: false, message: `Action "${actionId}" not yet implemented.` }
  }
}

/**
 * Move this install to another published version of its own distribution.
 *
 * Re-installs in place: the record is re-pointed at the target artifact, then
 * the same `installEnvironment` a first install runs lays the new environment
 * down over it. Done here rather than through the `install-instance` chain
 * because that chain is bound to its IPC sender — but the pieces it owns are
 * only needed for a FRESH install. The directory and the record already exist,
 * so what remains is the status arc, which is handled explicitly below.
 *
 * Targets the INSTALLATION, never the distribution id: several installs of one
 * distribution are allowed, so distribution-keyed lookup would pick arbitrarily.
 */
async function updateDistributionVersion(
  installation: InstallationRecord,
  distributionId: string,
  actionData: Record<string, unknown> | undefined,
  tools: ActionTools
): Promise<ActionResult> {
  const target = Number(actionData?.version)
  if (!Number.isFinite(target)) return { ok: false, message: t('comfybuilder.errorNoVersion') }

  // The section only offers this on a ready install, but an action id is
  // reachable on its own — re-check rather than trust the caller, since the
  // rollback below can only restore a state that was coherent to begin with.
  const previousStatus = installation.status as string | undefined
  if (previousStatus !== 'installed') return { ok: false, message: t('errors.installNotReady') }

  const previous = {
    version: installation.version as string | undefined,
    artifactId: installation.artifactId as string | undefined,
    artifactOs: installation.artifactOs as string | undefined,
    artifactGpu: installation.artifactGpu as string | undefined,
    artifactAccelVariant: installation.artifactAccelVariant as string | undefined,
    artifactSha256: installation.artifactSha256 as string | undefined
  }
  let environmentReady = false

  try {
    const resolved = await resolveHostArtifactForVersion(
      getBuilderClient(),
      await resolveHost(),
      distributionId,
      target
    )
    if (!resolved) {
      return { ok: false, message: t('comfybuilder.errorVersionUnavailable', { version: target }) }
    }

    const { artifact } = resolved
    if (!normalizeSha256(artifact.archiveSha256)) {
      return { ok: false, message: 'This build has no SHA-256 integrity value.' }
    }
    const next: Record<string, unknown> = {
      version: String(resolved.version),
      artifactId: artifact.id,
      artifactOs: artifact.os,
      artifactGpu: artifact.gpu,
      artifactAccelVariant: artifact.accelVariant,
      artifactSha256: artifact.archiveSha256
    }

    await installEnvironment({ ...installation, ...next } as InstallationRecord, tools, () =>
      tools.update({ ...next, status: 'installing', [ROLLBACK_FIELD]: previous })
    )
    environmentReady = true

    await tools.update({ status: 'installed', [ROLLBACK_FIELD]: undefined })
    await finalizeEnvironmentTransaction(installation.installPath).catch(() => {})
    return { ok: true, navigate: 'detail' }
  } catch (err) {
    // Put the record back where it was. Leaving it pointed at a version whose
    // environment never landed would report a version the install doesn't have.
    //
    // `installEnvironment` restores the previous environment on failure. If it
    // did not survive, report the install failed rather than advertise it as working.
    if (environmentReady) {
      if (tools.signal?.aborted) return { ok: false, cancelled: true }
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }

    // Any remaining backup means the rollback did not complete. Even if both
    // active paths exist, they may belong to different distribution versions.
    const runnable =
      !(await hasEnvironmentBackups(installation.installPath)) &&
      (await isRunnableEnvironment(installation.installPath))
    await tools
      .update({
        ...previous,
        status: runnable ? previousStatus : 'failed',
        [ROLLBACK_FIELD]: runnable ? undefined : previous
      })
      .catch(() => {})
    if (tools.signal?.aborted) return { ok: false, cancelled: true }
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
