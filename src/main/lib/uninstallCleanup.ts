import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import {
  builtinDefaultInstallDir,
  cacheDir,
  configDir,
  dataDir,
  defaultBenchmarksDir,
  defaultDataRoot,
  defaultDownloadCacheDir,
  homeDir,
  stateDir
} from './paths'
import { readFileSafe } from './safe-file'
import { TEMP_DIR_NAME } from './models'
import { defaults as settingsDefaults } from '../settings'

export const UNINSTALL_CLEANUP_FLAG = '--uninstall-cleanup'
export const DELETE_INSTANCES_FLAG = '--delete-instances'
export const DELETE_MODELS_FLAG = '--delete-models'
const CLEANUP_FLAGS = [UNINSTALL_CLEANUP_FLAG, DELETE_INSTANCES_FLAG, DELETE_MODELS_FLAG]

export const KEEP_POINTER_FILES_FOR_KEPT_DATA = true
export const DELETE_SHARED_INPUT_OUTPUT_WITH_INSTANCES = false

export const UNINSTALL_CLEANUP_LOG_FILE = 'comfy-desktop-uninstall-cleanup.log'

const SUPPORTED_PLATFORMS: readonly NodeJS.Platform[] = ['win32', 'darwin', 'linux']

const INSTALL_MARKER_FILE = '.comfyui-desktop-2'
const TRACKED_MARKER = 'tracked'
const UPDATER_DIR_NAME = 'comfyui-desktop-2-updater'
const DATA_ROOT_DIR_NAME = 'Comfy-Desktop'
const CACHE_PARENT_DIR_NAME = 'ComfyUI-Cache'
const DESKTOP_ONE_CONFIG_DIR_NAME = 'ComfyUI'

const WINDOWS_APP_DATA_DIR_NAMES = [
  'Comfy Desktop',
  'ComfyUI Desktop 2.0',
  'ComfyUI Launcher',
  'comfyui-desktop-2',
  'comfyui-launcher'
]

const INSTANCE_POINTER_FILES = [
  'installations.json',
  'installations.json.bak',
  'settings.json',
  'settings.json.bak',
  'data-location.json'
]
const MODEL_POINTER_FILES = ['settings.json', 'settings.json.bak', 'data-location.json']

const MAC_LIBRARY_FOLDERS = ['Caches', 'Logs', 'Preferences', 'Application Support']

const TEMP_ENTRY_PATTERNS = [
  /^comfy-focus-\d+\.vbs$/,
  /^comfyui-desktop-2-snapshots$/,
  /^comfyui-desktop-2-staged-restores-[\w.-]+$/,
  /^comfyui-desktop-2-\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  /^cnr-.+-\d{13}(\.zip)?$/
]

export type CleanupBucket = 'A' | 'B' | 'C'

export interface CleanupOptions {
  deleteInstances: boolean
  deleteModels: boolean
}

export interface CleanupPolicy {
  keepPointerFiles: boolean
  deleteSharedInputOutput: boolean
}

export const DEFAULT_CLEANUP_POLICY: CleanupPolicy = {
  keepPointerFiles: KEEP_POINTER_FILES_FOR_KEPT_DATA,
  deleteSharedInputOutput: DELETE_SHARED_INPUT_OUTPUT_WITH_INSTANCES
}

export interface CleanupFolders {
  userData: string
  configDir: string
  dataDir: string
  stateDir: string
  cacheDir: string
  logs: string
  updaterCache: string
  appData: string
  localAppData: string | null
  temp: string
  home: string
  documents: string
  desktop: string
  downloads: string
  systemFolders: string[]
  dataRoot: string
  downloadCache: string
  benchmarks: string
  installDir: string
  models: string
  input: string
  output: string
}

export interface InstallationOnDisk {
  id: string
  installPath: string
  marker: string | null
  adoptedBaseDir: string | null
}

export interface CleanupInputs {
  platform: NodeJS.Platform
  options: CleanupOptions
  folders: CleanupFolders
  appDirEntries: Record<string, string[]>
  tempEntries: string[]
  modelsDirs: string[]
  oemManagedModelDirs: string[]
  inputDir: string | null
  outputDir: string | null
  installations: InstallationOnDisk[]
  desktopOneBasePath: string | null
}

export interface CleanupEntry {
  path: string
  bucket: CleanupBucket
  reason: string
  onlyIfEmpty?: true
}

export interface DeletionGuard {
  protectedPaths: string[]
  allowedRoots: string[]
}

export interface CleanupPlan {
  entries: CleanupEntry[]
  guard: DeletionGuard
}

export type CleanupOutcome = 'removed' | 'absent' | 'not-empty' | 'refused' | 'failed'

export interface CleanupResult {
  entry: CleanupEntry
  outcome: CleanupOutcome
  detail?: string
}

export function parseCleanupOptions(argv: readonly string[]): CleanupOptions {
  return {
    deleteInstances: argv.includes(DELETE_INSTANCES_FLAG),
    deleteModels: argv.includes(DELETE_MODELS_FLAG)
  }
}

export function pointerFilesToKeep(
  options: CleanupOptions,
  keepPointerFiles: boolean = KEEP_POINTER_FILES_FOR_KEPT_DATA
): string[] {
  if (!keepPointerFiles) return []
  const keep = new Set<string>()
  if (!options.deleteInstances) INSTANCE_POINTER_FILES.forEach((name) => keep.add(name))
  if (!options.deleteModels) MODEL_POINTER_FILES.forEach((name) => keep.add(name))
  return [...keep]
}

function keptPointerPaths(folders: CleanupFolders, names: string[]): string[] {
  return names.map((name) =>
    path.join(name.startsWith('settings.json') ? folders.configDir : folders.dataDir, name)
  )
}

function comparable(p: string): string {
  return path.resolve(p).toLowerCase()
}

export function isSameOrInside(child: string, parent: string): boolean {
  const rel = path.relative(comparable(parent), comparable(child))
  if (rel === '') return true
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

function samePath(a: string, b: string): boolean {
  return comparable(a) === comparable(b)
}

function outermost(paths: string[]): string[] {
  const unique = paths.filter((p, i) => paths.findIndex((q) => samePath(p, q)) === i)
  return unique.filter((p) => !unique.some((q) => !samePath(p, q) && isSameOrInside(p, q)))
}

export function hasExactInstallMarker(inst: InstallationOnDisk): boolean {
  return (
    inst.id.trim() !== '' &&
    inst.id !== TRACKED_MARKER &&
    inst.marker !== null &&
    inst.marker === inst.id
  )
}

function appOwnedDirs(folders: CleanupFolders): string[] {
  return outermost([
    folders.userData,
    folders.configDir,
    folders.dataDir,
    folders.stateDir,
    folders.cacheDir,
    folders.logs,
    folders.updaterCache
  ])
}

function windowsAppDataDirs(inputs: CleanupInputs): string[] {
  const { folders } = inputs
  if (inputs.platform !== 'win32' || !folders.localAppData) return []
  const localAppData = folders.localAppData
  const dirs = WINDOWS_APP_DATA_DIR_NAMES.flatMap((name) => [
    path.join(folders.appData, name),
    path.join(localAppData, name),
    path.join(localAppData, `${name}-updater`)
  ])
  return dirs.filter((dir) => !isSameOrInside(folders.userData, dir))
}

function windowsLocalDataRoot(inputs: CleanupInputs): string | null {
  const { localAppData } = inputs.folders
  return inputs.platform === 'win32' && localAppData
    ? path.join(localAppData, DATA_ROOT_DIR_NAME)
    : null
}

function partialDownloadDirs(inputs: CleanupInputs): string[] {
  const { folders } = inputs
  return [
    path.join(inputs.modelsDirs[0] ?? folders.models, TEMP_DIR_NAME),
    path.join(path.dirname(inputs.outputDir ?? folders.output), TEMP_DIR_NAME)
  ]
}

function cacheParentDir(folders: CleanupFolders): string | null {
  const parent = path.dirname(folders.downloadCache)
  return path.basename(parent) === CACHE_PARENT_DIR_NAME ? parent : null
}

function dataRootFolder(folders: CleanupFolders): string | null {
  return samePath(folders.dataRoot, folders.home) ? null : folders.dataRoot
}

function presentPaths(paths: (string | null | undefined)[]): string[] {
  return paths.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
}

function buildGuard(
  inputs: CleanupInputs,
  keptPaths: string[],
  installs: InstallationOnDisk[]
): DeletionGuard {
  const { folders } = inputs
  const ownedDirs = appOwnedDirs(folders)
  const addedModelsDirs = [...inputs.modelsDirs, ...inputs.oemManagedModelDirs].filter(
    (dir) => !samePath(dir, folders.models)
  )
  const customInputOutput = [
    inputs.inputDir && !samePath(inputs.inputDir, folders.input) ? inputs.inputDir : null,
    inputs.outputDir && !samePath(inputs.outputDir, folders.output) ? inputs.outputDir : null
  ]
  const protectedPaths = presentPaths([
    folders.home,
    folders.appData,
    folders.localAppData,
    folders.temp,
    folders.documents,
    folders.desktop,
    folders.downloads,
    ...folders.systemFolders,
    ...ownedDirs.map((dir) => path.dirname(dir)),
    path.join(folders.appData, DESKTOP_ONE_CONFIG_DIR_NAME),
    inputs.desktopOneBasePath,
    ...inputs.installations.map((inst) => inst.adoptedBaseDir),
    ...addedModelsDirs,
    ...customInputOutput,
    ...keptPaths
  ])

  const allowedRoots = presentPaths([
    ...ownedDirs,
    ...windowsAppDataDirs(inputs),
    folders.temp,
    folders.downloadCache,
    cacheParentDir(folders),
    folders.installDir,
    path.dirname(folders.models),
    path.dirname(folders.benchmarks),
    windowsLocalDataRoot(inputs),
    dataRootFolder(folders),
    ...partialDownloadDirs(inputs),
    ...installs.map((inst) => inst.installPath)
  ])

  return { protectedPaths, allowedRoots }
}

export function planUninstallCleanup(
  inputs: CleanupInputs,
  policy: CleanupPolicy = DEFAULT_CLEANUP_POLICY
): CleanupPlan {
  const { folders, options } = inputs
  const entries: CleanupEntry[] = []
  const add = (p: string, bucket: CleanupBucket, reason: string, onlyIfEmpty = false): void => {
    if (entries.some((e) => samePath(e.path, p))) return
    entries.push(
      onlyIfEmpty ? { path: p, bucket, reason, onlyIfEmpty: true } : { path: p, bucket, reason }
    )
  }

  const keptPaths = keptPointerPaths(folders, pointerFilesToKeep(options, policy.keepPointerFiles))
  for (const dir of appOwnedDirs(folders)) {
    if (!keptPaths.some((kept) => isSameOrInside(kept, dir))) {
      add(dir, 'A', 'app settings, logs and caches')
      continue
    }
    for (const name of inputs.appDirEntries[dir] ?? []) {
      const child = path.join(dir, name)
      if (!keptPaths.some((kept) => samePath(kept, child))) {
        add(child, 'A', 'app settings, logs and caches')
      }
    }
  }

  for (const dir of windowsAppDataDirs(inputs)) {
    add(dir, 'A', 'app data under a current or earlier app name')
  }
  add(folders.downloadCache, 'A', 'download cache')
  add(folders.benchmarks, 'A', 'GPU benchmark results')
  for (const dir of partialDownloadDirs(inputs)) add(dir, 'A', 'unfinished downloads')
  for (const name of inputs.tempEntries) {
    if (TEMP_ENTRY_PATTERNS.some((pattern) => pattern.test(name))) {
      add(path.join(folders.temp, name), 'A', 'temporary files')
    }
  }

  const installs = options.deleteInstances ? inputs.installations.filter(hasExactInstallMarker) : []
  for (const inst of installs) add(inst.installPath, 'B', `ComfyUI install ${inst.id}`)
  if (options.deleteInstances && policy.deleteSharedInputOutput) {
    add(folders.input, 'B', 'shared input folder')
    add(folders.output, 'B', 'shared output folder')
  }
  if (options.deleteModels) add(folders.models, 'C', 'shared models folder')

  if (options.deleteInstances) add(folders.installDir, 'B', 'installs folder when empty', true)
  if (options.deleteModels) {
    add(path.dirname(folders.models), 'C', 'shared folder when empty', true)
  }
  add(path.dirname(folders.benchmarks), 'A', 'shared folder when empty', true)
  const cacheParent = cacheParentDir(folders)
  if (cacheParent) add(cacheParent, 'A', 'cache folder when empty', true)
  const dataRoot = dataRootFolder(folders)
  if (dataRoot) add(dataRoot, 'A', 'data folder when empty', true)
  const localDataRoot = windowsLocalDataRoot(inputs)
  if (localDataRoot) add(localDataRoot, 'A', 'data folder when empty', true)

  return { entries, guard: buildGuard(inputs, keptPaths, installs) }
}

export function deletionRefusal(target: string, guard: DeletionGuard): string | null {
  if (!path.isAbsolute(target)) return 'not an absolute path'
  const resolved = path.resolve(target)
  if (resolved === path.parse(resolved).root) return 'drive root'
  const shielded = guard.protectedPaths.find((p) => isSameOrInside(p, resolved))
  if (shielded) return `would remove a protected folder: ${shielded}`
  if (!guard.allowedRoots.some((root) => isSameOrInside(resolved, root))) {
    return 'outside the folders Comfy Desktop writes'
  }
  return null
}

export interface CleanupFs {
  exists(p: string): boolean
  remove(p: string): void
  isEmptyDir(p: string): boolean
  removeEmptyDir(p: string): void
}

const nodeCleanupFs: CleanupFs = {
  exists: (p) => fs.existsSync(p),
  remove: (p) => fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 }),
  isEmptyDir: (p) => fs.readdirSync(p).length === 0,
  removeEmptyDir: (p) => fs.rmdirSync(p)
}

function errorCode(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' ? code : 'error'
}

export function executeUninstallCleanup(
  plan: CleanupPlan,
  ops: CleanupFs = nodeCleanupFs
): CleanupResult[] {
  return plan.entries.map((entry): CleanupResult => {
    const refusal = deletionRefusal(entry.path, plan.guard)
    if (refusal) return { entry, outcome: 'refused', detail: refusal }
    try {
      if (!ops.exists(entry.path)) return { entry, outcome: 'absent' }
      if (entry.onlyIfEmpty) {
        if (!ops.isEmptyDir(entry.path)) return { entry, outcome: 'not-empty' }
        ops.removeEmptyDir(entry.path)
      } else {
        ops.remove(entry.path)
      }
      return { entry, outcome: 'removed' }
    } catch (err) {
      return { entry, outcome: 'failed', detail: errorCode(err) }
    }
  })
}

function readJson(file: string): unknown {
  const read = readFileSafe(file, { restore: false })
  if (read.kind !== 'data') return null
  try {
    return JSON.parse(read.data) as unknown
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(nonEmptyString).filter((v): v is string => v !== null)
    : []
}

function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

function readInstallMarker(installPath: string): string | null {
  try {
    const marker = fs.readFileSync(path.join(installPath, INSTALL_MARKER_FILE), 'utf-8').trim()
    return marker || null
  } catch {
    return null
  }
}

function readDesktopOneBasePath(appData: string): string | null {
  const configDirPath = path.join(appData, DESKTOP_ONE_CONFIG_DIR_NAME)
  try {
    const raw = fs.readFileSync(path.join(configDirPath, 'config.json'), 'utf-8')
    const basePath = nonEmptyString(asRecord(JSON.parse(raw)).basePath)
    return basePath ? path.resolve(configDirPath, basePath) : null
  } catch {
    return null
  }
}

type ElectronFolder = 'documents' | 'desktop' | 'downloads' | 'logs'

function electronPath(name: ElectronFolder, fallback: string): string {
  try {
    return app.getPath(name)
  } catch {
    return fallback
  }
}

function readInstallations(): InstallationOnDisk[] {
  const parsed = readJson(path.join(dataDir(), 'installations.json'))
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((raw): InstallationOnDisk[] => {
    const record = asRecord(raw)
    const id = nonEmptyString(record.id)
    const installPath = nonEmptyString(record.installPath)
    if (!id || !installPath || !path.isAbsolute(installPath)) return []
    return [
      {
        id,
        installPath,
        marker: readInstallMarker(installPath),
        adoptedBaseDir: nonEmptyString(record.adoptedBaseDir)
      }
    ]
  })
}

function updaterCacheRoot(
  platform: NodeJS.Platform,
  home: string,
  localAppData: string | null
): string {
  if (platform === 'win32' && localAppData) return localAppData
  if (platform === 'darwin') return path.join(home, 'Library', 'Caches')
  return process.env.XDG_CACHE_HOME || path.join(home, '.cache')
}

function defaultLogsDir(platform: NodeJS.Platform, home: string, userData: string): string {
  return platform === 'darwin'
    ? path.join(home, 'Library', 'Logs', path.basename(userData))
    : path.join(userData, 'logs')
}

function systemFoldersFor(platform: NodeJS.Platform, home: string): string[] {
  if (platform === 'darwin') {
    const library = path.join(home, 'Library')
    return [library, ...MAC_LIBRARY_FOLDERS.map((name) => path.join(library, name))]
  }
  if (platform === 'linux') {
    return presentPaths([
      path.join(home, '.config'),
      path.join(home, '.cache'),
      path.join(home, '.local'),
      path.join(home, '.local', 'share'),
      path.join(home, '.local', 'state'),
      process.env.XDG_CONFIG_HOME,
      process.env.XDG_CACHE_HOME,
      process.env.XDG_DATA_HOME,
      process.env.XDG_STATE_HOME
    ])
  }
  return []
}

export function collectUninstallCleanupInputs(
  options: CleanupOptions,
  platform: NodeJS.Platform = process.platform
): CleanupInputs {
  const home = homeDir()
  const appData = app.getPath('appData')
  const userData = app.getPath('userData')
  const temp = app.getPath('temp')
  const localAppData =
    platform === 'win32' ? process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local') : null
  const appDirs = [userData, configDir(), dataDir()]
  const settings = asRecord(readJson(path.join(configDir(), 'settings.json')))

  return {
    platform,
    options,
    folders: {
      userData,
      configDir: configDir(),
      dataDir: dataDir(),
      stateDir: stateDir(),
      cacheDir: cacheDir(),
      logs: electronPath('logs', defaultLogsDir(platform, home, userData)),
      updaterCache: path.join(updaterCacheRoot(platform, home, localAppData), UPDATER_DIR_NAME),
      appData,
      localAppData,
      temp,
      home,
      documents: electronPath('documents', path.join(home, 'Documents')),
      desktop: electronPath('desktop', path.join(home, 'Desktop')),
      downloads: electronPath('downloads', path.join(home, 'Downloads')),
      systemFolders: systemFoldersFor(platform, home),
      dataRoot: defaultDataRoot(),
      downloadCache: defaultDownloadCacheDir(),
      benchmarks: defaultBenchmarksDir(),
      installDir: builtinDefaultInstallDir(),
      models: settingsDefaults.modelsDirs[0]!,
      input: settingsDefaults.inputDir,
      output: settingsDefaults.outputDir
    },
    appDirEntries: Object.fromEntries(appDirs.map((dir) => [dir, listDir(dir)])),
    tempEntries: listDir(temp),
    modelsDirs: stringList(settings.modelsDirs),
    oemManagedModelDirs: stringList(settings.oemManagedModelDirs),
    inputDir: nonEmptyString(settings.inputDir),
    outputDir: nonEmptyString(settings.outputDir),
    installations: readInstallations(),
    desktopOneBasePath: readDesktopOneBasePath(appData)
  }
}

export function formatCleanupLog(
  options: CleanupOptions,
  results: CleanupResult[],
  startedAt: Date,
  crash?: string
): string {
  const count = (outcome: CleanupOutcome): number =>
    results.filter((r) => r.outcome === outcome).length
  const describe = (r: CleanupResult): string => {
    const detail = r.detail ? `: ${r.detail}` : ''
    return `${r.outcome} [${r.entry.bucket}] ${r.entry.path} (${r.entry.reason})${detail}`
  }
  const outcomes = ['removed', 'absent', 'not-empty', 'refused', 'failed'] as const
  const summary = outcomes.map((outcome) => `${outcome}=${count(outcome)}`).join(' ')
  const lines = [
    `Comfy Desktop uninstall cleanup ${startedAt.toISOString()}`,
    `delete-instances=${options.deleteInstances} delete-models=${options.deleteModels}`,
    ...results.map(describe),
    summary
  ]
  if (crash) lines.push(`stopped: ${crash}`)
  return `${lines.join('\n')}\n`
}

function writeCleanupLog(text: string): void {
  try {
    fs.writeFileSync(path.join(app.getPath('temp'), UNINSTALL_CLEANUP_LOG_FILE), text, 'utf-8')
  } catch {}
}

export function runUninstallCleanup(
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform
): number {
  if (!SUPPORTED_PLATFORMS.includes(platform)) return 0
  const options = parseCleanupOptions(argv)
  const startedAt = new Date()
  try {
    const results = executeUninstallCleanup(
      planUninstallCleanup(collectUninstallCleanupInputs(options, platform))
    )
    writeCleanupLog(formatCleanupLog(options, results, startedAt))
    return results.some((r) => r.outcome === 'failed') ? 1 : 0
  } catch (err) {
    writeCleanupLog(formatCleanupLog(options, [], startedAt, errorCode(err)))
    return 2
  }
}

export function exitIfUninstallCleanupRequested(argv: readonly string[] = process.argv): void {
  if (!argv.includes(UNINSTALL_CLEANUP_FLAG)) return
  process.exit(runUninstallCleanup(argv))
}

export interface CleanupRelaunchContext {
  argv: readonly string[]
  isPackaged: boolean
  appImage?: string
}

export function cleanupRelaunchOptions(
  options: CleanupOptions,
  context: CleanupRelaunchContext
): { execPath?: string; args: string[] } {
  const passthrough = context.isPackaged
    ? []
    : context.argv.slice(1).filter((arg) => !CLEANUP_FLAGS.includes(arg))
  const args = [
    ...passthrough,
    UNINSTALL_CLEANUP_FLAG,
    ...(options.deleteInstances ? [DELETE_INSTANCES_FLAG] : []),
    ...(options.deleteModels ? [DELETE_MODELS_FLAG] : [])
  ]
  return context.appImage ? { execPath: context.appImage, args } : { args }
}

export function relaunchIntoUninstallCleanup(options: CleanupOptions, quit: () => void): void {
  const relaunch = cleanupRelaunchOptions(options, {
    argv: process.argv,
    isPackaged: app.isPackaged,
    appImage: process.env.APPIMAGE || undefined
  })
  app.relaunch(relaunch)
  quit()
}
