import path from 'path'
import fs from 'fs'
import os from 'os'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { app, ipcMain, dialog, shell, BrowserWindow, nativeTheme, session } from 'electron'
import { execFile, spawn, execFileSync } from 'child_process'
import type { ChildProcess } from 'child_process'
import sources from '../../sources/index'
import * as installations from '../../installations'
import type { InstallationRecord } from '../../installations'
import { formatComfyVersion } from '../version'
import type { ComfyVersion } from '../version'
import { resolveLocalVersion, clearVersionCache } from '../version-resolve'
import type { LatestTagOverride } from '../version-resolve'
import {
  readGitHead,
  readGitRemoteUrl,
  fetchTags,
  findLatestVersionTag,
  revParseRef,
  hasGitDir,
  isGitAvailable,
  tryConfigureBootstrapPygit2,
  tryConfigurePygit2Fallback
} from '../git'
import { ensureRemoteUrl } from '../github-mirror'
import { runPool } from '../../sources/standalone/templateDownloadCore'
import * as settings from '../../settings'
import { defaultInstallDir, sanitizeDirName, allocateUniqueDir } from '../paths'
import { download } from '../download'
import { createCache } from '../cache'
import { holdAgentPrefetch } from '../agentRequirementsLaunch'
import { extractNested as extract } from '../extract'
import { deleteDir, formatDeleteStatus } from '../delete'
import { deleteAction, untrackAction } from '../actions'
import { _broadcastToRenderer } from './broadcast'
import { appendLog } from '../logsBroadcast'
import { flushOperationOutput } from '../appLog'
import { stripAnsi } from '../stderrTail'
import type { AcceleratorSnapshot } from '../hardwareTap'
import {
  spawnProcess,
  waitForPort,
  waitForUrl,
  killProcessTree,
  killByPort,
  findPidsByPort,
  getProcessInfo,
  looksLikeComfyUI,
  setPortArg,
  findAvailablePort,
  isPortListening,
  waitForPortFree,
  writePortLock,
  readPortLock,
  removePortLock,
  COMFY_BOOT_TIMEOUT_MS
} from '../process'
import {
  detectGPU,
  detectGPUCached,
  validateHardware,
  checkNvidiaDriver,
  checkAmdDriver,
  selectPrimaryGpu,
  vendorMatches,
  getWindowsGpuDriverVersions
} from '../gpu'
import { detectDesktopInstall } from '../desktopDetect'
import { performLocalMigration, stageLocalSnapshot } from '../localMigration'
import { getDiskSpace, getDirectorySize, validateInstallPath } from '../disk'
import { syncOemSeed } from '../oem'
import type { GpuInfo } from '../gpu'
import { formatTime } from '../util'
import { getActiveDownloads } from '../comfyDownloadManager'
import * as releaseCache from '../release-cache'
import * as i18n from '../i18n'
import {
  syncCustomModelFolders,
  discoverExtraModelFolders,
  instanceModelPathsYaml,
  resolveLauncherModelDirs,
  isSamePath,
  rehomeOwnModelsPrimary
} from '../models'
import { copyDirWithProgress } from '../copy'
import { fetchJSON } from '../fetch'
import { fetchLatestRelease, getLatestStableTag, getStableTags } from '../comfyui-releases'
import {
  captureSnapshotIfChanged,
  getSnapshotCount,
  getSnapshotListData,
  getSnapshotDetailData,
  getSnapshotDiffVsPrevious,
  diffAgainstCurrent,
  loadSnapshot,
  listSnapshots,
  deleteSnapshot,
  diffSnapshots,
  buildExportEnvelope,
  validateExportEnvelope,
  importSnapshots,
  stageSnapshotEnvelope,
  loadStagedSnapshotEnvelope,
  releaseStagedSnapshotEnvelope,
  saveSnapshot,
  statesMatch,
  restoreCustomNodes,
  restorePipPackages,
  restoreComfyUIVersion,
  buildPostRestoreState,
  frozenSnapshotInstallOverrides,
  formatSnapshotVersion,
  resolveSnapshotVersion
} from '../snapshots'
import type { SnapshotExportEnvelope, Snapshot } from '../snapshots'
import { getVariantLabel, buildPinnedVariant } from '../../sources/standalone'
import type { FieldOption, SourcePlugin } from '../../types/sources'
import { REQUIRES_STOPPED } from '../../../types/ipc'
import type { Theme, ResolvedTheme, QuitActiveItem, BetaArgView } from '../../../types/ipc'
import { findLockingProcesses } from '../file-lock-info'
import { markStopRequested } from '../comfyProcessRecord'
import type { LaunchCmd } from '../process'
import { getComfyArgsSchema, filterUnsupportedArgs } from '../comfy-args'
import type { ComfyArgDef } from '../comfy-args'
import { getComfyFeatureFlagRegistry } from '../comfy-feature-flags'
import type { FeatureFlagRegistry } from '../comfy-feature-flags'
import { sessionKindOf, type SessionKind } from '../../../shared/performanceTestSession'

export {
  path,
  fs,
  os,
  app,
  ipcMain,
  dialog,
  shell,
  BrowserWindow,
  nativeTheme,
  execFile,
  spawn,
  execFileSync,
  sources,
  installations,
  settings,
  releaseCache,
  i18n,
  formatComfyVersion,
  resolveLocalVersion,
  clearVersionCache,
  readGitRemoteUrl,
  fetchTags,
  findLatestVersionTag,
  revParseRef,
  hasGitDir,
  isGitAvailable,
  tryConfigureBootstrapPygit2,
  tryConfigurePygit2Fallback,
  ensureRemoteUrl,
  defaultInstallDir,
  sanitizeDirName,
  allocateUniqueDir,
  download,
  createCache,
  extract,
  deleteDir,
  formatDeleteStatus,
  deleteAction,
  untrackAction,
  spawnProcess,
  waitForPort,
  waitForUrl,
  killProcessTree,
  killByPort,
  findPidsByPort,
  getProcessInfo,
  looksLikeComfyUI,
  setPortArg,
  findAvailablePort,
  isPortListening,
  waitForPortFree,
  writePortLock,
  readPortLock,
  removePortLock,
  COMFY_BOOT_TIMEOUT_MS,
  detectGPU,
  detectGPUCached,
  validateHardware,
  checkNvidiaDriver,
  checkAmdDriver,
  selectPrimaryGpu,
  vendorMatches,
  getWindowsGpuDriverVersions,
  detectDesktopInstall,
  performLocalMigration,
  stageLocalSnapshot,
  getDiskSpace,
  getDirectorySize,
  validateInstallPath,
  syncOemSeed,
  formatTime,
  getActiveDownloads,
  syncCustomModelFolders,
  discoverExtraModelFolders,
  instanceModelPathsYaml,
  resolveLauncherModelDirs,
  isSamePath,
  copyDirWithProgress,
  fetchJSON,
  fetchLatestRelease,
  getLatestStableTag,
  getStableTags,
  captureSnapshotIfChanged,
  getSnapshotCount,
  getSnapshotListData,
  getSnapshotDetailData,
  getSnapshotDiffVsPrevious,
  diffAgainstCurrent,
  loadSnapshot,
  listSnapshots,
  diffSnapshots,
  buildExportEnvelope,
  validateExportEnvelope,
  importSnapshots,
  stageSnapshotEnvelope,
  loadStagedSnapshotEnvelope,
  releaseStagedSnapshotEnvelope,
  saveSnapshot,
  statesMatch,
  deleteSnapshot,
  restoreCustomNodes,
  restorePipPackages,
  restoreComfyUIVersion,
  buildPostRestoreState,
  frozenSnapshotInstallOverrides,
  formatSnapshotVersion,
  resolveSnapshotVersion,
  getVariantLabel,
  buildPinnedVariant,
  REQUIRES_STOPPED,
  findLockingProcesses,
  getComfyArgsSchema,
  filterUnsupportedArgs,
  getComfyFeatureFlagRegistry
}
export type {
  ChildProcess,
  InstallationRecord,
  ComfyVersion,
  LatestTagOverride,
  GpuInfo,
  SnapshotExportEnvelope,
  Snapshot,
  FieldOption,
  SourcePlugin,
  Theme,
  ResolvedTheme,
  QuitActiveItem,
  LaunchCmd,
  ComfyArgDef,
  FeatureFlagRegistry
}

export { MSG_CANCELLED } from '../../../shared/operationStatus'

export const MARKER_FILE = '.comfyui-desktop-2'
export const COMFYUI_REPO = 'Comfy-Org/ComfyUI'
export const UPDATE_CHECK_INTERVAL = 10 * 60 * 1000
export const IGNORE_FILES = new Set([MARKER_FILE, '.DS_Store', 'Thumbs.db', 'desktop.ini'])
export const ALL_UPDATE_CHANNELS = ['stable', 'latest']
export const RESERVED_ENV_VARS = new Set([
  'PYTHONIOENCODING',
  'PYTHONFAULTHANDLER',
  '__COMFY_CLI_SESSION__',
  'CM_USE_PYGIT2',
  '__COMFYUI_DESKTOP_VERSION__'
])

const DESKTOP_MANAGED_SOURCES = new Set(['standalone', 'comfybuilder'])
export const SENSITIVE_ARG_RE = /^--(api[-_]?key|token|secret|password|auth)$/i

export interface SessionInfo {
  proc: ChildProcess | null
  port: number
  url?: string
  mode: string
  installationName: string
  sourceInstallationId?: string
  startedAt: number
  flushTelemetry?: () => void
  getAcceleratorInfo?: () => AcceleratorSnapshot | null
  coreBetaArgs?: readonly BetaArgView[]
}

export interface LaunchCallbackInfo {
  port: number
  url?: string
  process: ChildProcess | null
  installation: InstallationRecord
  mode: string
}

export interface StopCallbackInfo {
  installationId?: string
}

export interface ExitCallbackInfo {
  installationId?: string
  crashed?: boolean
}

export interface RestartCallbackInfo {
  installationId?: string
  process?: ChildProcess
}

export interface InstanceStartedCallbackInfo {
  installationId: string
  bootTimeMs?: number
  portRetries: number
  rebootRetries: number
  sessionKind: SessionKind
}

export type LaunchCallback = (info: LaunchCallbackInfo) => void
export type StopCallback = (info: StopCallbackInfo) => void
export type ExitCallback = (info: ExitCallbackInfo) => void
export type InstanceStartedCallback = (info: InstanceStartedCallbackInfo) => void
export type RestartCallback = (info: RestartCallbackInfo) => void
export type ModelFolderRelaunchCallback = (info: { installationId: string }) => void | Promise<void>
export type LocaleCallback = () => void
export type ThemeChangedCallback = () => void

export interface RegisterCallbacks {
  onLaunch?: LaunchCallback
  onStop?: StopCallback
  onComfyExited?: ExitCallback
  onInstanceStarted?: InstanceStartedCallback
  onComfyRestarted?: RestartCallback
  onModelFolderRelaunch?: ModelFolderRelaunchCallback
  onLocaleChanged?: LocaleCallback
  onThemeChanged?: ThemeChangedCallback
}

export type CopyReason = 'copy' | 'copy-update' | 'copy-pytorch'

export const sourceMap: Record<string, SourcePlugin> = Object.fromEntries(
  sources.map((s) => [s.id, s])
)

export let _onLaunch: LaunchCallback | null = null
export let _onStop: StopCallback | null = null
export let _onComfyExited: ExitCallback | null = null
export let _onInstanceStarted: InstanceStartedCallback | null = null
export let _onComfyRestarted: RestartCallback | null = null
export let _onModelFolderRelaunch: ModelFolderRelaunchCallback | null = null
export let _onLocaleChanged: LocaleCallback | null = null
export let _onThemeChanged: ThemeChangedCallback | null = null

export const _operationAborts = new Map<string, AbortController>()
export const _runningSessions = new Map<string, SessionInfo>()
export const _pendingPorts = new Map<number, string>()

const _launchingInstances = new Map<string, { installationName: string }>()

interface ActiveLaunch {
  abort: AbortController
  settled: Promise<void>
  _resolveSettled: () => void
}
const _activeLaunches = new Map<string, ActiveLaunch>()

export function _beginLaunch(installationId: string): { abort: AbortController } {
  let resolveSettled!: () => void
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve
  })
  const launch: ActiveLaunch = {
    abort: new AbortController(),
    settled,
    _resolveSettled: resolveSettled
  }
  _activeLaunches.set(installationId, launch)
  return launch
}

export function _endLaunch(installationId: string, launch: { abort: AbortController }): void {
  const current = _activeLaunches.get(installationId)
  if (current && current.abort === launch.abort) {
    _activeLaunches.delete(installationId)
    current._resolveSettled()
  }
}

export function _hasActiveLaunch(installationId: string): boolean {
  return _activeLaunches.has(installationId)
}

export function _getActiveLaunchIds(): string[] {
  return Array.from(_activeLaunches.keys())
}

export const sessionLifecycleEvents = new EventEmitter()

export function snapshotRestoreFailureResult(
  installationId: string,
  restoreError: string
): { ok: false; message: string } {
  const message = i18n.t('standalone.snapshotRestoreAfterInstallFailed', { message: restoreError })
  try {
    appendLog(installationId, `\n${message}\n`)
  } catch (err) {
    console.warn('Failed to append snapshot restore failure to app log:', err)
  }
  return { ok: false, message }
}

export function _getLaunchingInstallationIds(): string[] {
  return Array.from(_launchingInstances.keys())
}

export function _getLaunchingInstances(): { installationId: string; installationName: string }[] {
  return Array.from(_launchingInstances.entries()).map(
    ([installationId, { installationName }]) => ({
      installationId,
      installationName
    })
  )
}

export function _markLaunching(installationId: string, installationName: string): void {
  const wasNew = !_launchingInstances.has(installationId)
  _launchingInstances.set(installationId, { installationName })
  _broadcastToRenderer('instance-launching', { installationId, installationName })
  if (wasNew) sessionLifecycleEvents.emit('changed')
}

export function _clearLaunchingFailed(installationId: string): void {
  const had = _launchingInstances.delete(installationId)
  _broadcastToRenderer('instance-launch-failed', { installationId })
  if (had) sessionLifecycleEvents.emit('changed')
}

export const _stoppingInstallationIds = new Set<string>()

export function _getStoppingInstallationIds(): string[] {
  return Array.from(_stoppingInstallationIds)
}

export function _isStopping(installationId: string): boolean {
  return _stoppingInstallationIds.has(installationId)
}

export interface PickerOperationStatus {
  status: string
  percent: number
  speedBytesPerSec?: number | null
  done: boolean
  ok: boolean | null
  error: string | null
  cancellable: boolean
  title: string
  actionId: string
  actionData?: Record<string, unknown>
}

export const _activeOperationStatus = new Map<string, PickerOperationStatus>()

export function setCallbacks(callbacks: RegisterCallbacks): void {
  _onLaunch = callbacks.onLaunch ?? null
  _onStop = callbacks.onStop ?? null
  _onComfyExited = callbacks.onComfyExited ?? null
  _onInstanceStarted = callbacks.onInstanceStarted ?? null
  _onComfyRestarted = callbacks.onComfyRestarted ?? null
  _onModelFolderRelaunch = callbacks.onModelFolderRelaunch ?? null
  _onLocaleChanged = callbacks.onLocaleChanged ?? null
  _onThemeChanged = callbacks.onThemeChanged ?? null
}

export async function syncOemSeedBestEffort(): Promise<void> {
  try {
    await syncOemSeed()
  } catch (err) {
    console.warn('OEM sync failed:', err)
  }
}

export type InstallDirState = 'missing' | 'no-permission' | 'inaccessible' | 'empty' | 'populated'

function classifyReadableEntries(entries: string[]): 'empty' | 'populated' {
  return entries.every((name) => IGNORE_FILES.has(name)) ? 'empty' : 'populated'
}

function classifyDirError(e: unknown): 'missing' | 'no-permission' | 'inaccessible' {
  const code = (e as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOENT') return 'missing'
  if (code === 'EACCES' || code === 'EPERM') return 'no-permission'
  return 'inaccessible'
}

export function installDirState(dirPath: string): InstallDirState {
  if (!dirPath) return 'missing'
  try {
    return classifyReadableEntries(fs.readdirSync(dirPath))
  } catch (e) {
    return classifyDirError(e)
  }
}

export function isEffectivelyEmptyInstallDir(dirPath: string): boolean {
  const state = installDirState(dirPath)
  return state === 'missing' || state === 'empty'
}

export function isInstallDirUnavailable(state: InstallDirState | undefined): boolean {
  return state === 'missing' || state === 'inaccessible' || state === 'no-permission'
}

export type InstallDirDashboardKind = 'available' | 'not-found' | 'no-permission'
export function installDirDashboardKind(
  state: InstallDirState | undefined
): InstallDirDashboardKind {
  if (state === 'no-permission') return 'no-permission'
  if (state === 'missing' || state === 'inaccessible') return 'not-found'
  return 'available'
}

const _DIR_STATE_PROBE_TIMEOUT_MS = 8000
export async function installDirStateAsync(dirPath: string): Promise<InstallDirState> {
  if (!dirPath) return 'missing'
  const probe = (async (): Promise<InstallDirState> => {
    try {
      return classifyReadableEntries(await fs.promises.readdir(dirPath))
    } catch (e) {
      return classifyDirError(e)
    }
  })()
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<InstallDirState>((resolve) => {
    timer = setTimeout(() => resolve('inaccessible'), _DIR_STATE_PROBE_TIMEOUT_MS)
  })
  try {
    return await Promise.race([probe, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const _installDirStateCache = new Map<string, InstallDirState>()

export function getCachedInstallDirState(id: string): InstallDirState | undefined {
  return _installDirStateCache.get(id)
}

let _refreshInstallDirStatesInFlight: Promise<void> | null = null
export function refreshInstallDirStates(): Promise<void> {
  if (_refreshInstallDirStatesInFlight) return _refreshInstallDirStatesInFlight
  _refreshInstallDirStatesInFlight = (async (): Promise<void> => {
    let changed = false
    try {
      const all = await installations.list()
      const local = all.filter((inst) => {
        const source = sourceMap[inst.sourceId]
        return (
          source && !source.skipInstall && typeof inst.installPath === 'string' && inst.installPath
        )
      })
      const probed = await Promise.all(
        local.map(async (inst) => ({
          id: inst.id,
          state: await installDirStateAsync(inst.installPath)
        }))
      )
      const tracked = new Set<string>()
      for (const { id, state } of probed) {
        tracked.add(id)
        const prev = _installDirStateCache.get(id)
        _installDirStateCache.set(id, state)
        if (installDirDashboardKind(prev) !== installDirDashboardKind(state)) changed = true
      }
      for (const id of [..._installDirStateCache.keys()]) {
        if (!tracked.has(id)) _installDirStateCache.delete(id)
      }
    } catch (err) {
      console.warn('refreshInstallDirStates failed:', err)
    }
    if (changed) _broadcastToRenderer('installations-changed', {})
  })().finally(() => {
    _refreshInstallDirStatesInFlight = null
  })
  return _refreshInstallDirStatesInFlight
}

export function openPath(targetPath: string): Promise<string> {
  if (process.env['E2E'] === '1') return Promise.resolve('')
  if (process.platform === 'linux') {
    return new Promise((resolve) => {
      execFile(
        'dbus-send',
        [
          '--session',
          '--print-reply',
          '--type=method_call',
          '--dest=org.freedesktop.FileManager1',
          '/org/freedesktop/FileManager1',
          'org.freedesktop.FileManager1.ShowFolders',
          `array:string:file://${targetPath}`,
          'string:'
        ],
        (err) => {
          if (!err) return resolve('')
          const child = spawn('xdg-open', [targetPath], { stdio: 'ignore', detached: true })
          child.unref()
          resolve('')
        }
      )
    })
  }
  return shell.openPath(targetPath)
}

let _appVersion: string | null = null

export function getAppVersion(): string {
  if (_appVersion !== null) return _appVersion
  let version = app.getVersion()
  if (!app.isPackaged) {
    try {
      version =
        execFileSync('git', ['describe', '--tags', '--always', '--match', 'v[0-9]*'], {
          cwd: __dirname,
          encoding: 'utf8'
        }).trim() || version
    } catch {}
  }
  _appVersion = version.replace(/^v/, '')
  return _appVersion
}

export async function findDuplicatePath(installPath: string): Promise<InstallationRecord | null> {
  const normalized = path.resolve(installPath)
  return (
    (await installations.list()).find(
      (i) => i.installPath && path.resolve(i.installPath) === normalized
    ) ?? null
  )
}

export async function uniqueName(baseName: string): Promise<string> {
  const all = await installations.list()
  return installations.uniqueName(baseName, all)
}

export async function copyBrowserPartition(
  sourceId: string,
  destId: string,
  sourceBrowserPartition?: string
): Promise<void> {
  if (sourceBrowserPartition !== 'unique') return
  const partitionsDir = path.join(app.getPath('userData'), 'Partitions')
  const srcPartition = path.join(partitionsDir, sourceId)
  const destPartition = path.join(partitionsDir, destId)
  try {
    if (fs.existsSync(srcPartition)) {
      await fs.promises.cp(srcPartition, destPartition, { recursive: true })
    }
  } catch (err) {
    console.warn('Failed to copy browser partition:', (err as Error).message)
  }
}

export async function deleteBrowserPartition(id: string, browserPartition?: string): Promise<void> {
  if (id === 'shared') return
  const partitionDir = path.join(app.getPath('userData'), 'Partitions', id)
  if (browserPartition !== 'unique' && !fs.existsSync(partitionDir)) return
  try {
    const cleared = session.fromPartition(`persist:${id}`).clearStorageData()
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000))
    await Promise.race([cleared, timeout])
  } catch (err) {
    console.warn('Failed to clear browser partition storage:', (err as Error).message)
  }
  try {
    await fs.promises.rm(partitionDir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100
    })
  } catch (err) {
    console.warn('Failed to delete browser partition:', (err as Error).message)
  }
}

export function sweepOrphanPartitions(knownIds: ReadonlySet<string>): void {
  const partitionsDir = path.join(app.getPath('userData'), 'Partitions')
  let names: string[]
  try {
    names = fs.readdirSync(partitionsDir)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.startsWith('inst-')) continue
    if (knownIds.has(name)) continue
    try {
      fs.rmSync(path.join(partitionsDir, name), {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100
      })
    } catch (err) {
      console.warn('Failed to sweep orphan browser partition:', name, (err as Error).message)
    }
  }
}

export async function performCopy(
  inst: InstallationRecord,
  name: string,
  sendProgress: (phase: string, detail: Record<string, unknown>) => void,
  signal?: AbortSignal,
  copyReason: CopyReason = 'copy'
): Promise<{ entry: InstallationRecord; destPath: string }> {
  const parentDir = path.dirname(inst.installPath)
  const dirName = sanitizeDirName(name)
  const destPath = allocateUniqueDir(parentDir, dirName)

  const duplicate = await findDuplicatePath(destPath)
  if (duplicate) {
    throw new Error(`That directory is already used by "${duplicate.name}".`)
  }

  try {
    sendProgress('copy', { percent: 0, status: i18n.t('actions.copyingFiles') })
    const release = await holdAgentPrefetch(inst.installPath)
    try {
      await copyDirWithProgress(
        inst.installPath,
        destPath,
        (copied, total, elapsedSecs, etaSecs) => {
          const percent = Math.round((copied / total) * 100)
          const elapsed = formatTime(elapsedSecs)
          const eta = etaSecs >= 0 ? formatTime(etaSecs) : '—'
          sendProgress('copy', {
            percent,
            status: `${i18n.t('actions.copyingFiles')}  ${copied} / ${total}  ·  ${elapsed} elapsed  ·  ${eta} remaining`
          })
        },
        { signal }
      )
    } finally {
      release()
    }

    const source = sourceMap[inst.sourceId]
    if (source?.fixupCopy) {
      await source.fixupCopy(inst, destPath, sendProgress, signal)
    }

    const adopted = inst.adopted === true && typeof inst.adoptedBaseDir === 'string'

    const {
      id: _id,
      name: _name,
      installPath: _path,
      createdAt: _created,
      seen: _seen,
      status: _status,
      copiedFrom: _copiedFrom,
      copiedAt: _copiedAt,
      copiedFromName: _copiedFromName,
      copyReason: _copyReason,
      ...inherited
    } = inst

    let recordData: Record<string, unknown> = {
      ...inherited,
      name: '',
      installPath: destPath,
      status: 'installed',
      seen: false,
      browserPartition: 'unique',
      copiedFrom: inst.id,
      copiedFromName: inst.name,
      copiedAt: new Date().toISOString(),
      copyReason
    }

    if (typeof recordData.modelDirsPrimary === 'string') {
      recordData.modelDirsPrimary = rehomeOwnModelsPrimary(
        recordData.modelDirsPrimary,
        inst.installPath,
        destPath
      )
    }

    if (adopted) {
      const newComfyUI = path.join(destPath, 'ComfyUI')
      const newAdoptedPython = path.join(
        newComfyUI,
        '.venv',
        process.platform === 'win32' ? 'Scripts' : 'bin',
        process.platform === 'win32' ? 'python.exe' : 'python3'
      )
      const {
        adoptedFromLegacyVersion: _afv,
        adoptedFromGpu: _afg,
        adoptedSelectedDevice: _asd,
        adoptedComfyTagAtMigration: _act,
        adoptedSourceMode: _asm,
        inputDir: _idn,
        outputDir: _odn,
        ...adoptInherited
      } = recordData as Record<string, unknown>
      recordData = {
        ...adoptInherited,
        adopted: true,
        adoptedAt: new Date().toISOString(),
        adoptedBaseDir: newComfyUI,
        adoptedPythonPath: newAdoptedPython,
        useSharedInput: false,
        useSharedOutput: false
      }
    }

    const finalName = await uniqueName(name)
    recordData.name = finalName
    const entry = await installations.add(recordData)

    try {
      fs.writeFileSync(path.join(destPath, MARKER_FILE), entry.id)
    } catch {}

    await copyBrowserPartition(inst.id, entry.id, inst.browserPartition as string | undefined)

    return { entry, destPath }
  } catch (err) {
    try {
      await fs.promises.rm(destPath, { recursive: true, force: true })
    } catch {}
    throw err
  }
}

export function createSessionPath(): string {
  return path.join(os.tmpdir(), `comfyui-desktop-2-${Date.now()}-${randomUUID()}`)
}

export function sanitizeEnvVars(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k).trim()
    if (!key || typeof v !== 'string') continue
    if (RESERVED_ENV_VARS.has(key.toUpperCase())) continue
    result[key] = v
  }
  return result
}

export function buildLaunchEnv(
  inst: InstallationRecord,
  sessionPath?: string
): Record<string, string | undefined> {
  const userEnvVars = sanitizeEnvVars(inst.envVars)
  const desktopManaged = DESKTOP_MANAGED_SOURCES.has(inst.sourceId)
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...userEnvVars,
    PYTHONIOENCODING: 'utf-8',
    PYTHONFAULTHANDLER: '1',
    ...(sessionPath ? { __COMFY_CLI_SESSION__: sessionPath } : {}),
    ...(desktopManaged ? { __COMFYUI_DESKTOP_VERSION__: getAppVersion() } : {}),
    ...(inst.sourceId === 'standalone' && process.env.COMFY_FORCE_PYGIT2 === '1'
      ? { CM_USE_PYGIT2: '1' }
      : {})
  }
  if (!desktopManaged) delete env.__COMFYUI_DESKTOP_VERSION__
  return env
}

export function checkRebootMarker(sessionPath: string): boolean {
  const marker = sessionPath + '.reboot'
  if (fs.existsSync(marker)) {
    try {
      fs.unlinkSync(marker)
    } catch {}
    return true
  }
  return false
}

export function _reservePort(port: number, installationName: string): void {
  _pendingPorts.set(port, installationName)
}

export function _releasePort(port: number): void {
  _pendingPorts.delete(port)
}

export {
  _registerExtraBroadcastTarget,
  _unregisterExtraBroadcastTarget,
  _broadcastToRenderer
} from './broadcast'

export function _addSession(
  installationId: string,
  {
    proc,
    port,
    url,
    mode,
    installationName,
    flushTelemetry,
    getAcceleratorInfo,
    coreBetaArgs
  }: Omit<SessionInfo, 'startedAt'>,
  bootTimeMs?: number,
  retries?: { portRetries: number; rebootRetries: number },
  sourceInstallationId: string = installationId
): void {
  _runningSessions.set(installationId, {
    proc,
    port,
    url,
    mode,
    installationName,
    sourceInstallationId,
    flushTelemetry,
    getAcceleratorInfo,
    coreBetaArgs,
    startedAt: Date.now()
  })
  _launchingInstances.delete(installationId)
  _broadcastToRenderer('instance-started', {
    installationId,
    port,
    url,
    mode,
    installationName,
    bootTimeMs,
    portRetries: retries?.portRetries ?? 0,
    rebootRetries: retries?.rebootRetries ?? 0
  })
  sessionLifecycleEvents.emit('changed')
  if (_onInstanceStarted) {
    _onInstanceStarted({
      installationId: sourceInstallationId,
      bootTimeMs,
      portRetries: retries?.portRetries ?? 0,
      rebootRetries: retries?.rebootRetries ?? 0,
      sessionKind: sessionKindOf(installationId)
    })
  }
  installations
    .markLaunched(sourceInstallationId, (inst) => sourceMap[inst.sourceId]?.category)
    .then(() => _broadcastToRenderer('installations-changed', {}))
    .catch((err) => {
      console.error('Failed to mark installation launched:', err)
    })
}

export function _removeSession(installationId: string): void {
  const session = _runningSessions.get(installationId)
  if (!session) return
  flushOperationOutput(installationId)
  if (session.port) removePortLock(session.port)
  _runningSessions.delete(installationId)
  _broadcastToRenderer('instance-stopped', { installationId })
  sessionLifecycleEvents.emit('changed')
}

export function _getPublicSessions(): Record<string, unknown>[] {
  return Array.from(_runningSessions.entries()).map(([id, s]) => ({
    installationId: id,
    port: s.port,
    url: s.url,
    mode: s.mode,
    installationName: s.installationName,
    startedAt: s.startedAt
  }))
}

export function hasRunningSessionForInstallation(installationId: string): boolean {
  return Array.from(
    _runningSessions,
    ([sessionId, session]) =>
      sessionId === installationId || session.sourceInstallationId === installationId
  ).some(Boolean)
}

export async function buildInstallationDdContext(installationId: string) {
  const MAX_CONTEXT_BYTES = 200 * 1024
  const inst = await installations.get(installationId)
  if (!inst || !inst.installPath) return null

  const entries = await listSnapshots(inst.installPath)
  const latest = entries.length > 0 ? entries[0]!.snapshot : null

  const copiedFrom = inst.copiedFrom as string | undefined
  const copyReason = inst.copyReason as string | undefined

  let diskFreeGb: number | null = null
  let diskTotalGb: number | null = null
  try {
    const disk = await getDiskSpace(inst.installPath)
    diskFreeGb = Math.round(disk.free / 1073741824)
    diskTotalGb = Math.round(disk.total / 1073741824)
  } catch {}

  const result = {
    installation_id: inst.id,
    variant: (inst.variant as string) || '',
    source_id: (inst.sourceId as string) || '',
    update_channel: (inst.updateChannel as string) || 'stable',
    comfyui_version: (inst.comfyuiVersion as string) || '',
    ...(copiedFrom ? { copied_from: copiedFrom } : {}),
    ...(copyReason ? { copy_reason: copyReason } : {}),
    snapshot_count: entries.length,
    disk_free_gb: diskFreeGb,
    disk_total_gb: diskTotalGb,
    latest_snapshot: latest
      ? {
          createdAt: latest.createdAt,
          trigger: latest.trigger,
          label: latest.label,
          comfyui: {
            ref: latest.comfyui.ref,
            commit: latest.comfyui.commit,
            releaseTag: latest.comfyui.releaseTag,
            variant: latest.comfyui.variant,
            baseTag: latest.comfyui.baseTag ?? null,
            commitsAhead: latest.comfyui.commitsAhead ?? null,
            formattedVersion: formatSnapshotVersion(latest.comfyui, 'detail')
          },
          customNodes: latest.customNodes.map((n) => ({
            id: n.id,
            type: n.type,
            dirName: n.dirName,
            enabled: n.enabled,
            version: n.version,
            commit: n.commit
          })),
          pipPackages: latest.pipPackages,
          pythonVersion: latest.pythonVersion,
          updateChannel: latest.updateChannel
        }
      : null,
    snapshot_diffs: [] as Array<Record<string, unknown>>
  }

  let runningSize = JSON.stringify(result).length
  for (let i = 0; i < entries.length - 1; i++) {
    const newer = entries[i]!.snapshot
    const older = entries[i + 1]!.snapshot
    const diff = diffSnapshots(older, newer)
    const entry: Record<string, unknown> = {
      createdAt: newer.createdAt,
      trigger: newer.trigger,
      label: newer.label,
      nodesAdded: diff.nodesAdded.map((n) => ({
        id: n.id,
        type: n.type,
        dirName: n.dirName,
        enabled: n.enabled,
        version: n.version,
        commit: n.commit
      })),
      nodesRemoved: diff.nodesRemoved.map((n) => ({
        id: n.id,
        type: n.type,
        dirName: n.dirName,
        enabled: n.enabled,
        version: n.version,
        commit: n.commit
      })),
      nodesChanged: diff.nodesChanged.map((n) => ({ id: n.id, from: n.from, to: n.to })),
      pipsAdded: diff.pipsAdded,
      pipsRemoved: diff.pipsRemoved,
      pipsChanged: diff.pipsChanged,
      comfyuiChanged: diff.comfyuiChanged,
      updateChannelChanged: diff.updateChannelChanged
    }
    if (diff.comfyui) {
      entry.comfyui = {
        from: {
          ref: diff.comfyui.from.ref,
          commit: diff.comfyui.from.commit,
          baseTag: diff.comfyui.from.baseTag ?? null,
          commitsAhead: diff.comfyui.from.commitsAhead ?? null,
          formattedVersion: diff.comfyui.from.formattedVersion
        },
        to: {
          ref: diff.comfyui.to.ref,
          commit: diff.comfyui.to.commit,
          baseTag: diff.comfyui.to.baseTag ?? null,
          commitsAhead: diff.comfyui.to.commitsAhead ?? null,
          formattedVersion: diff.comfyui.to.formattedVersion
        }
      }
    }
    if (diff.updateChannel) {
      entry.updateChannel = diff.updateChannel
    }
    const entrySize = JSON.stringify(entry).length + 1
    if (runningSize + entrySize > MAX_CONTEXT_BYTES) break
    result.snapshot_diffs.push(entry)
    runningSize += entrySize
  }

  return result
}

const GIT_RESOLVE_CONCURRENCY = 1

export async function _fetchAndResolveLatestTags(
  installs: Array<{ comfyuiDir: string }>
): Promise<Map<string, LatestTagOverride>> {
  const mirrorEnabled = settings.get('useChineseMirrors') === true
  await runPool(installs, GIT_RESOLVE_CONCURRENCY, async ({ comfyuiDir }) => {
    try {
      await ensureRemoteUrl(comfyuiDir, mirrorEnabled)
    } catch {}
  })

  const originGroups = new Map<string, string[]>()
  for (const { comfyuiDir } of installs) {
    const origin = readGitRemoteUrl(comfyuiDir)
    if (!origin) continue
    const group = originGroups.get(origin) ?? []
    group.push(comfyuiDir)
    originGroups.set(origin, group)
  }

  const result = new Map<string, LatestTagOverride>()
  await runPool([...originGroups.entries()], GIT_RESOLVE_CONCURRENCY, async ([origin, dirs]) => {
    try {
      for (const d of dirs) await fetchTags(d)
      const representative = dirs[0]!
      const tagName = await findLatestVersionTag(representative)
      if (!tagName) return
      const sha = await revParseRef(representative, tagName)
      if (!sha) return
      result.set(origin, { name: tagName, sha })
    } catch {}
  })
  return result
}

let _resolveVersionsInFlight: Promise<void> | null = null
let _lastResolveVersionsAt = 0
const RESOLVE_VERSIONS_TTL_MS = 10 * 60 * 1000

export function scheduleResolveAndBroadcastVersions(list: InstallationRecord[]): void {
  if (_resolveVersionsInFlight) return
  if (Date.now() - _lastResolveVersionsAt < RESOLVE_VERSIONS_TTL_MS) return
  _lastResolveVersionsAt = Date.now()
  _resolveVersionsInFlight = _resolveAndBroadcastVersions(list)
    .catch(() => {})
    .finally(() => {
      _resolveVersionsInFlight = null
    })
}

export async function _resolveAndBroadcastVersions(list: InstallationRecord[]): Promise<void> {
  const candidates = list.flatMap((inst) => {
    const cv = inst.comfyVersion as ComfyVersion | undefined
    if (!cv?.commit || !inst.installPath) return []
    const comfyuiDir = path.join(inst.installPath, 'ComfyUI')
    if (!hasGitDir(comfyuiDir)) return []
    return [{ inst, cv, comfyuiDir }]
  })
  if (candidates.length === 0) return

  const tagOverrides = await _fetchAndResolveLatestTags(candidates)
  clearVersionCache()

  const updates: { id: string; version: string }[] = []
  await runPool(candidates, GIT_RESOLVE_CONCURRENCY, async ({ inst, cv, comfyuiDir }) => {
    const origin = readGitRemoteUrl(comfyuiDir)
    const override = origin ? tagOverrides.get(origin) : undefined
    try {
      const actualHead = readGitHead(comfyuiDir) || cv.commit

      const resolved = await resolveLocalVersion(comfyuiDir, actualHead, undefined, override)

      if (cv?.baseTag && !resolved.baseTag && resolved.commit === cv.commit) {
        return
      }
      const resolvedStr = formatComfyVersion(resolved, 'short')
      const storedStr = formatComfyVersion(cv, 'short')
      const versionChanged =
        resolvedStr !== storedStr ||
        resolved.baseTagVerified !== cv.baseTagVerified ||
        resolved.ancestorTag !== cv.ancestorTag

      const existing = inst.updateInfoByChannel as
        | Record<string, Record<string, unknown>>
        | undefined
      let reconciledChannels: Record<string, Record<string, unknown>> | undefined
      if (existing) {
        let changed = false
        const reconciled: Record<string, Record<string, unknown>> = {}
        for (const [ch, info] of Object.entries(existing)) {
          if (info?.installedTag && info.installedTag !== resolvedStr) {
            reconciled[ch] = { ...info, installedTag: resolvedStr }
            changed = true
          } else {
            reconciled[ch] = info
          }
        }
        if (changed) reconciledChannels = reconciled
      }

      if (versionChanged || reconciledChannels) {
        const patch: Record<string, unknown> = {}
        if (versionChanged) patch.comfyVersion = resolved
        if (reconciledChannels) patch.updateInfoByChannel = reconciledChannels
        await installations.update(inst.id, patch)
        updates.push({ id: inst.id, version: resolvedStr })
      }
    } catch {}
  })
  if (updates.length > 0) {
    _broadcastToRenderer('installations-versions-updated', { updates })
  }
}

export async function migrateDefaults(): Promise<void> {
  const all = await installations.list()
  let changed = false
  for (const inst of all) {
    const source = sourceMap[inst.sourceId]
    if (!source || !source.getDefaults) continue
    const defaults = source.getDefaults()
    for (const [key, value] of Object.entries(defaults)) {
      if (!(key in inst)) {
        inst[key] = value
        changed = true
      }
    }
    if (inst.updateInfoByChannel) {
      const repo = 'Comfy-Org/ComfyUI'
      const channelMap = inst.updateInfoByChannel as Record<string, Record<string, unknown>>
      for (const [channel, info] of Object.entries(channelMap)) {
        if (info.latestTag && !releaseCache.get(repo, channel)) {
          const { installedTag: _it, available: _av, ...releaseFields } = info
          releaseCache.set(repo, channel, releaseFields)
        }
        if (info.latestTag || info.releaseName || info.releaseNotes) {
          channelMap[channel] = { installedTag: info.installedTag }
          changed = true
        }
      }
    }
  }
  if (changed) {
    for (const inst of all) await installations.update(inst.id, inst)
  }
}

export function resolveTheme(): ResolvedTheme {
  return 'dark'
}

let _checkInstallationUpdatesInFlight: Promise<void> | null = null

export function checkInstallationUpdates(): Promise<void> {
  if (_checkInstallationUpdatesInFlight) return _checkInstallationUpdatesInFlight
  _checkInstallationUpdatesInFlight = (async (): Promise<void> => {
    try {
      await Promise.allSettled(
        ALL_UPDATE_CHANNELS.map((channel) =>
          releaseCache.getOrFetch(
            COMFYUI_REPO,
            channel,
            async () => {
              const release = await fetchLatestRelease(channel)
              if (!release) return null
              return releaseCache.buildCacheEntry(release)
            },
            true
          )
        )
      )
      await _enrichLatestCommitsAhead()
      _broadcastToRenderer('installations-changed', {})
    } catch {}
  })().finally(() => {
    _checkInstallationUpdatesInFlight = null
  })
  return _checkInstallationUpdatesInFlight
}

async function _enrichLatestCommitsAhead(): Promise<void> {
  const all = await installations.list()
  for (const inst of all) {
    if (!inst.installPath) continue
    const comfyuiDir = path.join(inst.installPath, 'ComfyUI')
    if (!hasGitDir(comfyuiDir)) continue
    await releaseCache.enrichCommitsAhead(COMFYUI_REPO, comfyuiDir)
    if (releaseCache.get(COMFYUI_REPO, 'latest')?.commitsAhead !== undefined) return
  }
}

export function makeSendProgress(
  sender: Electron.WebContents,
  installationId: string
): (phase: string, detail: Record<string, unknown>) => void {
  return (phase: string, detail: Record<string, unknown>): void => {
    if (!sender.isDestroyed()) {
      sender.send('install-progress', { installationId, phase, ...detail })
    }
  }
}

export function makeSendOutput(
  sender: Electron.WebContents,
  installationId: string
): (text: string) => void {
  return (text: string): void => {
    const clean = stripAnsi(text)
    try {
      if (!sender.isDestroyed()) sender.send('comfy-output', { installationId, text: clean })
    } catch {}
    appendLog(installationId, clean)
  }
}

export async function stopRunning(
  installationId?: string,
  onEnterStopping?: (info: { installationId: string }) => void
): Promise<void> {
  if (installationId) {
    const session = _runningSessions.get(installationId)
    if (!session) return
    _stoppingInstallationIds.add(installationId)
    _broadcastToRenderer('instance-stopping', { installationId })
    onEnterStopping?.({ installationId })
    if (session.port) removePortLock(session.port)
    markStopRequested(installationId)
    _runningSessions.delete(installationId)
    if (session.proc && !session.proc.killed) {
      await killProcessTree(session.proc)
    }
    flushOperationOutput(installationId)
    _stoppingInstallationIds.delete(installationId)
    _broadcastToRenderer('instance-stopped', { installationId })
    sessionLifecycleEvents.emit('changed')
  } else {
    const sessions = [..._runningSessions.entries()]
    for (const [id] of sessions) {
      _stoppingInstallationIds.add(id)
      _broadcastToRenderer('instance-stopping', { installationId: id })
      onEnterStopping?.({ installationId: id })
    }
    for (const [id, session] of sessions) {
      if (session.port) removePortLock(session.port)
      markStopRequested(id)
    }
    _runningSessions.clear()
    const kills: Promise<unknown>[] = []
    for (const [, session] of sessions) {
      if (session.proc && !session.proc.killed) {
        kills.push(killProcessTree(session.proc))
      }
    }
    await Promise.all(kills)
    for (const [id] of sessions) {
      flushOperationOutput(id)
    }
    for (const [id] of sessions) {
      _stoppingInstallationIds.delete(id)
      _broadcastToRenderer('instance-stopped', { installationId: id })
    }
    if (sessions.length > 0) sessionLifecycleEvents.emit('changed')
  }
}

export async function cancelLaunching(
  installationId: string,
  timeoutMs = 60_000
): Promise<boolean> {
  const launch = _activeLaunches.get(installationId)
  if (!launch || _runningSessions.has(installationId)) return false
  launch.abort.abort()
  const timedOut = Symbol('timeout')
  let timer: ReturnType<typeof setTimeout> | undefined
  const outcome = await Promise.race([
    launch.settled,
    new Promise<typeof timedOut>((resolve) => {
      timer = setTimeout(() => resolve(timedOut), timeoutMs)
    })
  ]).finally(() => clearTimeout(timer))
  if (outcome === timedOut) {
    throw new Error(`Timed out waiting for the cancelled launch of ${installationId} to wind down`)
  }
  return true
}

export function hasRunningSessions(): boolean {
  return _runningSessions.size > 0
}

export function getSessionProcess(installationId: string): ChildProcess | null {
  return _runningSessions.get(installationId)?.proc ?? null
}

export function getSessionStartedAt(installationId: string): number | null {
  return _runningSessions.get(installationId)?.startedAt ?? null
}

export function hasActiveOperations(): boolean {
  return _runningSessions.size > 0 || _operationAborts.size > 0 || getActiveDownloads().length > 0
}

export async function getActiveDetails(): Promise<QuitActiveItem[]> {
  const items: QuitActiveItem[] = []
  for (const [, session] of _runningSessions) {
    items.push({ name: session.installationName, type: 'session' })
  }
  const operationIds = [..._operationAborts.keys()].filter((id) => !_runningSessions.has(id))
  if (operationIds.length > 0) {
    const all = await installations.list()
    const byId = new Map(all.map((inst) => [inst.id, inst]))
    for (const id of operationIds) {
      items.push({ name: byId.get(id)?.name || id, type: 'operation' })
    }
  }
  for (const dl of getActiveDownloads()) {
    items.push({ name: dl.filename, type: 'download' })
  }
  return items
}

export function _test_addRunningSession(
  installationId: string,
  installationName: string,
  flushTelemetry?: () => void,
  coreBetaArgs?: readonly BetaArgView[]
): void {
  _runningSessions.set(installationId, {
    proc: null,
    port: 0,
    url: undefined,
    mode: 'window',
    installationName,
    flushTelemetry,
    coreBetaArgs,
    startedAt: Date.now()
  })
  _broadcastToRenderer('instance-started', {
    installationId,
    port: 0,
    url: undefined,
    mode: 'window',
    installationName
  })
}

export function _test_clearRunningSessions(): void {
  const ids = Array.from(_runningSessions.keys())
  _runningSessions.clear()
  for (const id of ids) {
    _broadcastToRenderer('instance-stopped', { installationId: id })
  }
}

export function cancelAll(): void {
  for (const [id, abort] of _operationAborts) {
    markStopRequested(id)
    abort.abort()
  }
  _operationAborts.clear()
  for (const session of _runningSessions.values()) {
    try {
      session.flushTelemetry?.()
    } catch {}
  }
  void stopRunning()
}
