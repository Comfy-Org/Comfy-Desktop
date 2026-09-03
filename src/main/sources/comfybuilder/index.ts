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
 * build to "not launchable" and bounces a tile click into the
 * new-install wizard. That is why `getListActions` below exists even though it
 * looks like boilerplate.
 */
import { promises as fs } from 'fs'
import path from 'path'
import {
  installArtifact,
  buildLaunchSpec,
  venvPython,
  resolveModelManifest,
  normalizeSha256
} from '../../comfybuilder'
import type {
  Artifact,
  ArtifactGpu,
  ArtifactOs,
  InstallProgress,
  ModelDescriptor
} from '../../comfybuilder'
import { getBuilderClient } from '../../devplatform/session'
import {
  listCompleteVersions,
  resolveHost,
  resolveHostArtifactForVersion
} from '../../devplatform/builds'
import {
  getAvailableUpdate,
  getVersionCacheGeneration,
  setCachedVersions
} from '../../devplatform/versionCache'
import { launchAction } from '../../lib/actions'
import { renameWithLockRetry } from '../../lib/fsRetry'
import { defaultDownloadCacheDir } from '../../lib/paths'
import { releaseInstallTerminalForFsOp } from '../../lib/popoutWindows'
import { t } from '../../lib/i18n'
import type { InstallationRecord } from '../../installations'
import type {
  SourcePlugin,
  LaunchCommand,
  ActionResult,
  ActionTools,
  InstallTools,
  StatusTag,
  TerminalEnv
} from '../../types/sources'

import { COMFYBUILDER_INSTALL_DEFAULTS, DEFAULT_LAUNCH_ARGS } from './constants'
import { getDetailSections } from './detailSections'
import { abortModelStaging, startModelStaging } from './modelStagingTask'

const READY_MARKER = '.comfybuilder-environment-ready'
const ENTRY_SWAP_MARKER = '.comfybuilder-entry-swap'
const ACTIVE_CODE_MARKER = '.comfybuilder-active-code'
const ROLLBACK_FIELD = 'comfybuilderRollback'
const PRESERVED_COMFY_ENTRIES = new Set(['models', 'user'])

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

function recoveryResult(
  installation: InstallationRecord,
  data: Record<string, unknown> = {}
): ComfyBuilderRecovery {
  const needsModelIsolation = installation.useSharedModels !== false
  if (!needsModelIsolation && Object.keys(data).length === 0) return { action: 'none' }
  return {
    action: 'update',
    data: { ...data, ...(needsModelIsolation ? { useSharedModels: false } : {}) }
  }
}

function environmentPaths(installPath: string) {
  const venv = path.join(installPath, 'venv')
  const comfy = path.join(installPath, 'ComfyUI')
  const nextEnvironment = path.join(installPath, '.comfybuilder-next')
  return {
    venv,
    comfy,
    previousVenv: `${venv}.previous`,
    previousComfy: `${comfy}.previous`,
    models: path.join(comfy, 'models'),
    user: path.join(comfy, 'user'),
    preservedModels: path.join(installPath, '.comfybuilder-models-preserved'),
    preservedUser: path.join(installPath, '.comfybuilder-user-preserved'),
    nextEnvironment,
    nextVenv: path.join(nextEnvironment, 'venv'),
    nextComfy: path.join(nextEnvironment, 'ComfyUI'),
    entrySwapMarker: path.join(installPath, ENTRY_SWAP_MARKER),
    entrySwapMarkerTemp: path.join(installPath, `${ENTRY_SWAP_MARKER}.tmp`),
    activeCodeMarker: path.join(installPath, ACTIVE_CODE_MARKER),
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

async function renameIfExists(from: string, to: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await renameWithLockRetry(from, to, signal)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

async function directoryEntries(target: string): Promise<string[]> {
  try {
    return await fs.readdir(target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

function isPreservedComfyEntry(entry: string): boolean {
  return PRESERVED_COMFY_ENTRIES.has(entry.toLowerCase())
}

async function comfyCodeEntries(target: string): Promise<string[]> {
  return (await directoryEntries(target)).filter((entry) => !isPreservedComfyEntry(entry))
}

async function moveComfyCode(
  from: string,
  to: string,
  signal?: AbortSignal,
  entries?: string[]
): Promise<void> {
  entries ??= await comfyCodeEntries(from)
  if (entries.length === 0) return
  await fs.mkdir(to, { recursive: true })
  for (const entry of entries) {
    await renameWithLockRetry(path.join(from, entry), path.join(to, entry), signal)
  }
}

async function readEntrySwapManifest(marker: string): Promise<Set<string>> {
  const value: unknown = JSON.parse(await fs.readFile(marker, 'utf8'))
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error('The ComfyBuilder update recovery manifest is invalid.')
  }
  return new Set(value.map((entry) => entry.toLowerCase()))
}

async function removeReplacedComfyCode(
  target: string,
  previous: string,
  previousEntryNames: ReadonlySet<string>
): Promise<void> {
  const backupEntries = new Set(
    (await comfyCodeEntries(previous)).map((entry) => entry.toLowerCase())
  )
  const entries = (await comfyCodeEntries(target)).filter((entry) => {
    const normalized = entry.toLowerCase()
    return backupEntries.has(normalized) || !previousEntryNames.has(normalized)
  })
  await Promise.all(
    entries.map((entry) => fs.rm(path.join(target, entry), { recursive: true, force: true }))
  )
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
    (await pathExists(paths.preservedModels)) ||
    (await pathExists(paths.preservedUser)) ||
    (await pathExists(paths.nextEnvironment)) ||
    (await pathExists(paths.entrySwapMarker)) ||
    (await pathExists(paths.entrySwapMarkerTemp))
  )
}

async function restoreEnvironmentBackups(installPath: string): Promise<void> {
  const paths = environmentPaths(installPath)
  const usesEntrySwap = await pathExists(paths.entrySwapMarker)
  const hasPreviousComfy = await pathExists(paths.previousComfy)
  let hasPreservedModels = await pathExists(paths.preservedModels)
  let hasPreservedUser = await pathExists(paths.preservedUser)

  if (usesEntrySwap) {
    await fs.mkdir(paths.comfy, { recursive: true })
    if (await pathExists(paths.activeCodeMarker)) {
      await removeReplacedComfyCode(
        paths.comfy,
        paths.previousComfy,
        await readEntrySwapManifest(paths.entrySwapMarker)
      )
    }
    if (hasPreviousComfy) {
      await moveComfyCode(paths.previousComfy, paths.comfy)
      await fs.rm(paths.previousComfy, { recursive: true, force: true })
    }
  } else {
    // Recover transactions created by versions that moved the whole ComfyUI tree.
    if (hasPreviousComfy && !hasPreservedModels) {
      hasPreservedModels = await renameIfExists(paths.models, paths.preservedModels)
    }
    if (hasPreviousComfy && !hasPreservedUser) {
      hasPreservedUser = await renameIfExists(paths.user, paths.preservedUser)
    }
    if (hasPreviousComfy) {
      await fs.rm(paths.comfy, { recursive: true, force: true })
      await renameWithLockRetry(paths.previousComfy, paths.comfy)
    }
    if (hasPreservedModels) {
      await fs.mkdir(paths.comfy, { recursive: true })
      await fs.rm(paths.models, { recursive: true, force: true })
      await renameWithLockRetry(paths.preservedModels, paths.models)
    }
    if (hasPreservedUser) {
      await fs.mkdir(paths.comfy, { recursive: true })
      await fs.rm(paths.user, { recursive: true, force: true })
      await renameWithLockRetry(paths.preservedUser, paths.user)
    }
  }
  if (await pathExists(paths.previousVenv)) {
    await fs.rm(paths.venv, { recursive: true, force: true })
    await renameWithLockRetry(paths.previousVenv, paths.venv)
  }
  await fs.rm(paths.nextEnvironment, { recursive: true, force: true })
  await fs.rm(paths.activeCodeMarker, { force: true })
  await fs.rm(paths.entrySwapMarker, { force: true })
  await fs.rm(paths.entrySwapMarkerTemp, { force: true })
}

/** Remove committed transaction debris, deleting the marker last so startup
 * recovery still knows the active environment is authoritative on failure. */
async function finalizeEnvironmentTransaction(installPath: string): Promise<void> {
  const paths = environmentPaths(installPath)
  await fs.rm(paths.previousVenv, { recursive: true, force: true })
  await fs.rm(paths.previousComfy, { recursive: true, force: true })
  await fs.rm(paths.preservedModels, { recursive: true, force: true })
  await fs.rm(paths.preservedUser, { recursive: true, force: true })
  await fs.rm(paths.nextEnvironment, { recursive: true, force: true })
  await fs.rm(paths.activeCodeMarker, { force: true })
  await fs.rm(paths.entrySwapMarker, { force: true })
  await fs.rm(paths.entrySwapMarkerTemp, { force: true })
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
  // Both statuses mark an unfinished environment transaction: 'installing'
  // for a fresh install, 'updating' for an in-place update.
  const midTransaction = installation.status === 'installing' || installation.status === 'updating'

  if (ready) {
    if (midTransaction || rollback) {
      return recoveryResult(installation, {
        status: 'installed',
        [ROLLBACK_FIELD]: undefined
      })
    }
    await finalizeEnvironmentTransaction(installation.installPath)
    return recoveryResult(installation)
  }

  if (hasBackups) {
    await restoreEnvironmentBackups(installation.installPath)
    if (rollback) {
      const runnable = await isRunnableEnvironment(installation.installPath)
      return recoveryResult(installation, {
        ...rollback,
        status: runnable ? (rollback.status ?? 'installed') : 'failed',
        [ROLLBACK_FIELD]: undefined
      })
    }
    return midTransaction
      ? recoveryResult(installation, { status: 'failed' })
      : recoveryResult(installation)
  }

  if (rollback) {
    const runnable = await isRunnableEnvironment(installation.installPath)
    return recoveryResult(installation, {
      ...rollback,
      status: runnable ? (rollback.status ?? 'installed') : 'failed',
      [ROLLBACK_FIELD]: undefined
    })
  }

  return midTransaction
    ? recoveryResult(installation, { status: 'failed' })
    : recoveryResult(installation)
}

/** Reconstruct the library Artifact from the fields the install record carries.
 *  Every ComfyBuilder record is written with these fields, so a missing one
 *  means a corrupt record: reject it here with a clear message rather than
 *  defaulting to a build target the record never chose. */
function artifactFromRecord(inst: InstallationRecord): Artifact {
  const id = inst.artifactId as string | undefined
  const os = inst.artifactOs as ArtifactOs | undefined
  const gpu = inst.artifactGpu as ArtifactGpu | undefined
  if (!id || !os || !gpu) {
    throw new Error(
      'This installation record is missing its build identity (artifact id, OS, or GPU) and cannot be installed. Remove it and install the build again.'
    )
  }
  return {
    id,
    os,
    gpu,
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
 * can't diverge on venv handling.
 *
 * Returns the build's declared models. Downloading them is NOT part of the
 * environment transaction: the caller hands them to `startModelStaging`, which
 * runs in the background so the install is launchable as soon as the
 * environment is on disk. Resolving the manifest still happens inside the
 * transaction, so a build whose model list cannot be fetched fails (and rolls
 * back) rather than landing without its models.
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
): Promise<readonly ModelDescriptor[]> {
  releaseInstallTerminalForFsOp(installation.id)
  const artifact = artifactFromRecord(installation)
  const client = getBuilderClient()
  const paths = environmentPaths(installation.installPath)
  const interrupted = await hasEnvironmentBackups(installation.installPath)
  if (interrupted) throw new Error('An interrupted ComfyBuilder update must be recovered first.')
  await fs.rm(paths.readyMarker, { force: true }).catch(() => {})
  const hasExistingEnvironment = (await pathExists(paths.venv)) || (await pathExists(paths.comfy))

  try {
    // Download and validate updates in a staging directory so the installed
    // environment stays runnable until the filesystem swap begins.
    const artifactInstallPath = hasExistingEnvironment
      ? paths.nextEnvironment
      : installation.installPath
    await installArtifact({
      artifact,
      client,
      installPath: artifactInstallPath,
      cacheDir: defaultDownloadCacheDir(),
      onProgress: (p: InstallProgress) => {
        // The library's `resolve` phase has no labeled step; fold it into the
        // download step at 0% so the stepper still shows forward motion.
        const phase = p.phase === 'resolve' ? 'download' : p.phase
        tools.sendProgress(phase, { percent: p.percent, status: p.detail ?? '' })
      },
      ...(tools.signal ? { signal: tools.signal } : {})
    })

    if (hasExistingEnvironment) {
      // Models and user data can be locked by Windows after an instance has run.
      // Keep both directories at their stable paths and swap only executable
      // entries. The staged archive copies are build debris, not user state.
      await fs.rm(path.join(paths.nextComfy, 'models'), { recursive: true, force: true })
      await fs.rm(path.join(paths.nextComfy, 'user'), { recursive: true, force: true })

      // Persist the non-runnable status and rollback metadata before moving
      // executable files, so another window cannot launch through the swap.
      await onTransactionStarted?.()
      const previousCodeEntries = await comfyCodeEntries(paths.comfy)
      await fs.writeFile(paths.entrySwapMarkerTemp, JSON.stringify(previousCodeEntries))
      await renameWithLockRetry(paths.entrySwapMarkerTemp, paths.entrySwapMarker, tools.signal)
      await renameIfExists(paths.venv, paths.previousVenv, tools.signal)
      await fs.mkdir(paths.previousComfy, { recursive: true })
      await moveComfyCode(paths.comfy, paths.previousComfy, tools.signal, previousCodeEntries)
      await fs.writeFile(paths.activeCodeMarker, '')

      await renameWithLockRetry(paths.nextVenv, paths.venv, tools.signal)
      await fs.mkdir(paths.comfy, { recursive: true })
      await moveComfyCode(paths.nextComfy, paths.comfy, tools.signal)
      await fs.rm(paths.nextEnvironment, { recursive: true, force: true })
    } else {
      await onTransactionStarted?.()
    }

    // Resolve the build's declared models while a failure can still roll the
    // environment back cleanly; the actual downloads run in the background
    // task the caller starts, so launch is not gated on model bytes.
    const manifest = await resolveModelManifest(
      client,
      installation.distributionId as string,
      installation.version as string
    )
    await fs.writeFile(paths.readyMarker, '')

    await fs.rm(paths.previousVenv, { recursive: true, force: true }).catch(() => {})
    await fs.rm(paths.previousComfy, { recursive: true, force: true }).catch(() => {})
    return manifest.models
  } catch (err) {
    // Put the complete working environment back before surfacing the failure.
    if (hasExistingEnvironment) {
      await restoreEnvironmentBackups(installation.installPath).catch(() => {})
    }
    await fs.rm(paths.readyMarker, { force: true }).catch(() => {})
    throw err
  }
}

export const comfybuilder: SourcePlugin = {
  id: 'comfybuilder',
  label: 'ComfyBuilder',
  description: 'Install a ComfyUI build created with ComfyBuilder.',
  category: 'local',
  // Never a "New Install" wizard source: records are created by the dev-platform
  // build flow, so it must not appear in the generic source picker.
  hidden: true,
  fields: [],
  defaultLaunchArgs: DEFAULT_LAUNCH_ARGS,

  get installSteps() {
    return [
      { phase: 'download', label: t('common.download') },
      { phase: 'extract', label: t('common.extract') }
    ]
  },

  getDefaults() {
    return { ...COMFYBUILDER_INSTALL_DEFAULTS }
  },

  buildInstallation(): Record<string, unknown> {
    // Records are assembled by the build install handler (which already knows the
    // resolved artifact), not the generic build-installation chain.
    return { ...COMFYBUILDER_INSTALL_DEFAULTS }
  },

  // The tile prefers this over the source label, and the install is named after
  // the build, so returning the name here would echo the tile title and hide
  // the one label marking this as a build. Surface it only once a
  // rename has made the two differ.
  getListPreview(installation: InstallationRecord): string | null {
    const buildName = (installation.distributionName as string) || ''
    return buildName && buildName !== installation.name ? buildName : null
  },

  getStatusTag(installation: InstallationRecord): StatusTag | undefined {
    const buildId = installation.distributionId as string | undefined
    const currentVersion = (installation.version as string | undefined) ?? ''
    if (!buildId) return undefined
    const latest = getAvailableUpdate(buildId, currentVersion)
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

  getTerminalEnv(installation: InstallationRecord): TerminalEnv {
    const venvDir = path.join(installation.installPath, 'venv')
    const python = venvPython(installation.installPath)
    return {
      cwd: path.join(installation.installPath, 'ComfyUI'),
      venvDir,
      ...(process.platform === 'win32' ? { pathPrepends: [path.dirname(python)] } : {}),
      promptName: 'venv',
      pip: { exe: python, args: ['-s', '-m', 'pip'] }
    }
  },

  // Launch is discovered through this list, not through `getLaunchCommand`: a
  // plugin without it hands the renderer an empty action array, which reads as
  // "this install cannot launch" and bounces a tile click into the new-install
  // wizard. Builds launch like any other local install.
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
    const models = await installEnvironment(installation, tools)
    // Models download in the background; the install is launchable as soon as
    // the environment is on disk. Completion is recorded as `modelsStaged`,
    // and an unfinished staging re-runs at the next launch.
    startModelStaging(installation, models)
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
    const buildId = installation.distributionId as string | undefined
    if (!buildId) return { ok: false, message: t('comfybuilder.errorNoBuild') }

    if (actionId === 'check-update') {
      try {
        const cacheGeneration = getVersionCacheGeneration()
        setCachedVersions(
          buildId,
          await listCompleteVersions(getBuilderClient(), buildId),
          cacheGeneration
        )
        return { ok: true }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    }

    if (actionId === 'update-comfyui') {
      return updateBuildVersion(installation, buildId, actionData, tools)
    }

    return { ok: false, message: `Action "${actionId}" not yet implemented.` }
  }
}

/**
 * Move this install to another published version of its own build.
 *
 * Re-installs in place: the record is re-pointed at the target artifact, then
 * the same `installEnvironment` a first install runs lays the new environment
 * down over it. Done here rather than through the `install-instance` chain
 * because that chain is bound to its IPC sender — but the pieces it owns are
 * only needed for a FRESH install. The directory and the record already exist,
 * so what remains is the status arc, which is handled explicitly below.
 *
 * Targets the INSTALLATION, never the persisted Builder id: several installs
 * of one build are allowed, so an id-keyed lookup would pick arbitrarily.
 */
async function updateBuildVersion(
  installation: InstallationRecord,
  buildId: string,
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

  // A still-running background staging holds the model-root download lock and
  // writes into the tree about to be swapped; stop it first. The re-stage
  // below (or the next launch) picks up whatever it had not finished.
  abortModelStaging(installation.id)

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
      buildId,
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

    const updated = { ...installation, ...next } as InstallationRecord
    const models = await installEnvironment(updated, tools, () =>
      tools.update({ ...next, status: 'updating', [ROLLBACK_FIELD]: previous })
    )
    environmentReady = true

    // The new version's models are not staged yet; clear the flag so a launch
    // before the background task finishes knows to re-stage.
    await tools.update({ status: 'installed', modelsStaged: false, [ROLLBACK_FIELD]: undefined })
    await finalizeEnvironmentTransaction(installation.installPath).catch(() => {})
    startModelStaging(updated, models)
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
    // active paths exist, they may belong to different build versions.
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
