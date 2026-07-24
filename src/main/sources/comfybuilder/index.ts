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
import { installArtifact, buildLaunchSpec } from '../../comfybuilder'
import type { Artifact, ArtifactGpu, ArtifactOs, InstallProgress } from '../../comfybuilder'
import { getBuilderClient } from '../../devplatform/session'
import { launchAction } from '../../lib/actions'
import { defaultDownloadCacheDir } from '../../lib/paths'
import { t } from '../../lib/i18n'
import type { InstallationRecord } from '../../installations'
import type {
  SourcePlugin,
  LaunchCommand,
  ActionResult,
  InstallTools,
} from '../../types/sources'

const DEFAULT_LAUNCH_ARGS = '--enable-manager'

/** Reconstruct the library Artifact from the fields the install record carries. */
function artifactFromRecord(inst: InstallationRecord): Artifact {
  return {
    id: (inst.artifactId as string) ?? '',
    os: (inst.artifactOs as ArtifactOs) ?? 'linux',
    gpu: (inst.artifactGpu as ArtifactGpu) ?? 'cpu',
    accelVariant: (inst.artifactAccelVariant as string) ?? '',
    status: 'ready',
    ...(inst.artifactSha256 ? { outputSha256: inst.artifactSha256 as string } : {}),
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

  getDetailSections(installation: InstallationRecord): Record<string, unknown>[] {
    return [
      {
        tab: 'status',
        title: 'Installation Info',
        fields: [
          { label: 'Install method', value: (installation.sourceLabel as string) || 'ComfyBuilder' },
          { label: 'Distribution', value: (installation.distributionName as string) || '-' },
          { label: 'Version', value: (installation.version as string) || '-' },
        ],
      },
    ]
  },

  // A ComfyBuilder install is never discovered on disk: only the dev-platform
  // flow creates one: so there is nothing to probe/adopt.
  probeInstallation(): Record<string, unknown> | null {
    return null
  },

  async install(installation: InstallationRecord, tools: InstallTools): Promise<void> {
    const artifact = artifactFromRecord(installation)
    // `installArtifact` verifies the sha256 when the artifact carries one and
    // fails on a byte mismatch. A missing hash is skipped for the initial rollout
    // (see the TODO there) until the builder populates it.
    await installArtifact({
      artifact,
      client: getBuilderClient(),
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
  },

  async handleAction(actionId: string): Promise<ActionResult> {
    return { ok: false, message: `Action "${actionId}" not yet implemented.` }
  },
}
