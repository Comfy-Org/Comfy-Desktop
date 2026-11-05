import { promises as fs } from 'fs'
import path from 'path'
import {
  installArtifact,
  buildLaunchSpec,
  launchArgsForManagerAnswer,
  managerAllowedByPolicy,
  venvPython,
  resolveModelManifest,
  normalizeSha256
} from '../../comfybuilder'
import type {
  Artifact,
  ArtifactGpu,
  ArtifactOs,
  InstallProgress,
  ModelManifest
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
import * as installations from '../../installations'
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
const MANAGER_ALLOWED_FIELD = 'comfybuilderManagerAllowed'

function managerAnswerFields(
  installation: InstallationRecord,
  manifest: ModelManifest
): Record<string, unknown> {
  const allowed = managerAllowedByPolicy(manifest.customNodePolicy)
  return {
    [MANAGER_ALLOWED_FIELD]: allowed,
    launchArgs: launchArgsForManagerAnswer(
      (installation.launchArgs as string | undefined) ?? DEFAULT_LAUNCH_ARGS,
      allowed,
      installation[MANAGER_ALLOWED_FIELD] as boolean | undefined
    )
  }
}
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

export async function recoverComfyBuilderInstallation(
  installation: InstallationRecord
): Promise<ComfyBuilderRecovery> {
  const paths = environmentPaths(installation.installPath)
  const ready = await pathExists(paths.readyMarker)
  const hasBackups = await hasEnvironmentBackups(installation.installPath)
  const rollback = installation[ROLLBACK_FIELD] as EnvironmentRollback | undefined
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

export function withAccelArgs(installation: InstallationRecord, launchArgs: string): string {
  const isCpu = installation.artifactGpu === 'cpu' || installation.artifactAccelVariant === 'cpu'
  if (!isCpu || /(?:^|\s)--cpu(?:\s|$)/.test(launchArgs)) return launchArgs
  return `${launchArgs} --cpu`.trim()
}

async function installEnvironment(
  installation: InstallationRecord,
  tools: {
    sendProgress: (step: string, data: { percent: number; status: string }) => void
    signal?: AbortSignal
  },
  onTransactionStarted?: () => Promise<void>
): Promise<ModelManifest> {
  releaseInstallTerminalForFsOp(installation.id)
  const artifact = artifactFromRecord(installation)
  const client = getBuilderClient()
  const paths = environmentPaths(installation.installPath)
  const interrupted = await hasEnvironmentBackups(installation.installPath)
  if (interrupted) throw new Error('An interrupted ComfyBuilder update must be recovered first.')
  await fs.rm(paths.readyMarker, { force: true }).catch(() => {})
  const hasExistingEnvironment = (await pathExists(paths.venv)) || (await pathExists(paths.comfy))

  try {
    const artifactInstallPath = hasExistingEnvironment
      ? paths.nextEnvironment
      : installation.installPath
    await installArtifact({
      artifact,
      client,
      installPath: artifactInstallPath,
      cacheDir: defaultDownloadCacheDir(),
      onProgress: (p: InstallProgress) => {
        const phase = p.phase === 'resolve' ? 'download' : p.phase
        tools.sendProgress(phase, { percent: p.percent, status: p.detail ?? '' })
      },
      ...(tools.signal ? { signal: tools.signal } : {})
    })

    if (hasExistingEnvironment) {
      await fs.rm(path.join(paths.nextComfy, 'models'), { recursive: true, force: true })
      await fs.rm(path.join(paths.nextComfy, 'user'), { recursive: true, force: true })

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

    const manifest = await resolveModelManifest(
      client,
      installation.distributionId as string,
      installation.version as string
    )
    await fs.writeFile(paths.readyMarker, '')

    await fs.rm(paths.previousVenv, { recursive: true, force: true }).catch(() => {})
    await fs.rm(paths.previousComfy, { recursive: true, force: true }).catch(() => {})
    return manifest
  } catch (err) {
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
    return { ...COMFYBUILDER_INSTALL_DEFAULTS }
  },

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
      ),
      managerAllowed: installation[MANAGER_ALLOWED_FIELD] !== false
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

  getListActions(installation: InstallationRecord): Record<string, unknown>[] {
    const installed = installation.status === 'installed'
    return [launchAction(installed, !installed ? t('errors.installNotReady') : undefined)]
  },

  getDetailSections,

  probeInstallation(): Record<string, unknown> | null {
    return null
  },

  async install(installation: InstallationRecord, tools: InstallTools): Promise<void> {
    const manifest = await installEnvironment(installation, tools)
    await installations.update(installation.id, managerAnswerFields(installation, manifest))
    startModelStaging(installation, manifest.models)
  },

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

async function updateBuildVersion(
  installation: InstallationRecord,
  buildId: string,
  actionData: Record<string, unknown> | undefined,
  tools: ActionTools
): Promise<ActionResult> {
  const target = Number(actionData?.version)
  if (!Number.isFinite(target)) return { ok: false, message: t('comfybuilder.errorNoVersion') }

  const previousStatus = installation.status as string | undefined
  if (previousStatus !== 'installed') return { ok: false, message: t('errors.installNotReady') }

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
    const manifest = await installEnvironment(updated, tools, () =>
      tools.update({ ...next, status: 'updating', [ROLLBACK_FIELD]: previous })
    )
    environmentReady = true

    await tools.update({
      status: 'installed',
      modelsStaged: false,
      ...managerAnswerFields(installation, manifest),
      [ROLLBACK_FIELD]: undefined
    })
    await finalizeEnvironmentTransaction(installation.installPath).catch(() => {})
    startModelStaging(updated, manifest.models)
    return { ok: true, navigate: 'detail' }
  } catch (err) {
    if (environmentReady) {
      if (tools.signal?.aborted) return { ok: false, cancelled: true }
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }

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
