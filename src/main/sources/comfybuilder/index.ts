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
import { installArtifact, buildLaunchSpec, stageModels, resolveModelManifest } from '../../comfybuilder'
import type { Artifact, ArtifactGpu, ArtifactOs, InstallProgress, StageProgress } from '../../comfybuilder'
import { getBuilderClient } from '../../devplatform/session'
import { listCompleteVersions, resolveHost, resolveHostArtifactForVersion } from '../../devplatform/distributions'
import { setCachedVersions } from '../../devplatform/versionCache'
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
} from '../../types/sources'

import { DEFAULT_LAUNCH_ARGS } from './constants'
import { getDetailSections } from './detailSections'

/** Reconstruct the library Artifact from the fields the install record carries. */
function artifactFromRecord(inst: InstallationRecord): Artifact {
  return {
    id: (inst.artifactId as string) ?? '',
    os: (inst.artifactOs as ArtifactOs) ?? 'linux',
    gpu: (inst.artifactGpu as ArtifactGpu) ?? 'cpu',
    accelVariant: (inst.artifactAccelVariant as string) ?? '',
    status: 'ready',
    ...(inst.artifactSha256 ? { archiveSha256: inst.artifactSha256 as string } : {}),
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
): Promise<void> {
  const artifact = artifactFromRecord(installation)
  const client = getBuilderClient()

  // A venv can't be overlaid (leftover site-packages from the old version break
  // Python), so remove it before extracting. No-op on a first install; on an
  // update/retry it guarantees a clean environment. The archive lays down a
  // fresh venv; staged models under ComfyUI/models are left untouched.
  await fs.rm(path.join(installation.installPath, 'venv'), { recursive: true, force: true })

  // Phase 1: archive (code + environment). `installArtifact` verifies the
  // sha256 when the artifact carries one and fails on a byte mismatch. A
  // missing hash is skipped for the initial rollout (see the TODO there).
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
    ...(tools.signal ? { signal: tools.signal } : {}),
  })

  // Phase 2: models. The archive carries no weights, so stage the
  // distribution's declared models into the install's ComfyUI model tree
  // before launch, the way comfy-deploy provisions a volume before boot. An
  // empty manifest stages nothing and the step completes immediately.
  const manifest = await resolveModelManifest(
    client,
    installation.distributionId as string,
    installation.version as string,
  )
  await stageModels({
    models: manifest.models,
    installPath: installation.installPath,
    onProgress: (p: StageProgress) =>
      tools.sendProgress('models', { percent: p.percent, status: `${p.filename} (${p.index}/${p.total})` }),
    ...(tools.signal ? { signal: tools.signal } : {}),
  })
  tools.sendProgress('models', { percent: 100, status: '' })
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
      { phase: 'models', label: t('comfybuilder.stageModels') },
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

  getLaunchCommand(installation: InstallationRecord): LaunchCommand | null {
    const spec = buildLaunchSpec(installation.installPath, {
      launchArgs: withAccelArgs(installation, (installation.launchArgs as string | undefined) ?? DEFAULT_LAUNCH_ARGS),
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
    tools: ActionTools,
  ): Promise<ActionResult> {
    const distributionId = installation.distributionId as string | undefined
    if (!distributionId) return { ok: false, message: t('comfybuilder.errorNoDistribution') }

    if (actionId === 'check-update') {
      try {
        setCachedVersions(
          distributionId,
          await listCompleteVersions(getBuilderClient(), distributionId),
        )
        return { ok: true }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    }

    if (actionId === 'update-distribution') {
      return updateDistributionVersion(installation, distributionId, actionData, tools)
    }

    return { ok: false, message: `Action "${actionId}" not yet implemented.` }
  },
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
  tools: ActionTools,
): Promise<ActionResult> {
  const target = Number(actionData?.version)
  if (!Number.isFinite(target)) return { ok: false, message: t('comfybuilder.errorNoVersion') }

  const previous = {
    version: installation.version as string | undefined,
    artifactId: installation.artifactId as string | undefined,
    artifactOs: installation.artifactOs as string | undefined,
    artifactGpu: installation.artifactGpu as string | undefined,
    artifactAccelVariant: installation.artifactAccelVariant as string | undefined,
    artifactSha256: installation.artifactSha256 as string | undefined,
  }

  try {
    const resolved = await resolveHostArtifactForVersion(
      getBuilderClient(),
      await resolveHost(),
      distributionId,
      target,
    )
    if (!resolved) {
      return { ok: false, message: t('comfybuilder.errorVersionUnavailable', { version: target }) }
    }

    const { artifact } = resolved
    const next: Record<string, unknown> = {
      version: String(resolved.version),
      artifactId: artifact.id,
      artifactOs: artifact.os,
      artifactGpu: artifact.gpu,
      artifactAccelVariant: artifact.accelVariant,
      ...(artifact.archiveSha256 ? { artifactSha256: artifact.archiveSha256 } : {}),
    }
    await tools.update({ ...next, status: 'installing' })

    await installEnvironment({ ...installation, ...next } as InstallationRecord, tools)

    await tools.update({ status: 'installed' })
    return { ok: true, navigate: 'detail' }
  } catch (err) {
    // Put the record back where it was. Leaving it pointed at a version whose
    // environment never landed would report a version the install doesn't have.
    await tools.update({ ...previous, status: 'installed' }).catch(() => {})
    if (tools.signal?.aborted) return { ok: false, cancelled: true }
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
