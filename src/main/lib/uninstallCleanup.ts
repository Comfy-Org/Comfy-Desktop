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
import { readFileSafe, readFileWithRetrySync, writeFileSafe } from './safe-file'
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
const INSTALL_LIST_FILES = ['installations.json', 'installations.json.bak']
const PARTIAL_DELETE_STATUS = 'partial-delete'

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
  adoptionMarker: string | null
  recordedPaths: string[]
}

export interface CleanupInputs {
  platform: NodeJS.Platform
  options: CleanupOptions
  folders: CleanupFolders
  appDirEntries: Record<string, string[]>
  appDirLinks: string[]
  tempEntries: string[]
  modelsDirs: string[]
  outputDir: string | null
  storedPaths: string[]
  installations: InstallationOnDisk[]
  desktopOneBasePath: string | null
  configuredCacheEntries: string[]
  unreadableFiles: string[]
}

export interface CleanupEntry {
  path: string
  bucket: CleanupBucket
  reason: string
  onlyIfEmpty?: true
  installId?: string
}

export interface DeletionGuard {
  protectedPaths: string[]
  keptPaths: string[]
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

function windowsAppDataDirs(platform: NodeJS.Platform, folders: CleanupFolders): string[] {
  if (platform !== 'win32' || !folders.localAppData) return []
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

function adoptionMarkerToRetire(inst: InstallationOnDisk): string | null {
  return inst.adoptedBaseDir && inst.adoptionMarker === inst.id
    ? path.join(inst.adoptedBaseDir, INSTALL_MARKER_FILE)
    : null
}

interface KeptCandidate {
  path: string
  installId?: string
}

type KeptSources = Pick<
  CleanupInputs,
  'folders' | 'storedPaths' | 'installations' | 'unreadableFiles'
>

function keptCandidates(sources: KeptSources): KeptCandidate[] {
  const { folders } = sources
  const unowned = presentPaths([
    ...sources.storedPaths,
    folders.models,
    folders.input,
    folders.output,
    sources.unreadableFiles.length > 0 ? folders.installDir : null
  ])
  return [
    ...unowned.map((p) => ({ path: p })),
    ...sources.installations.flatMap((inst) =>
      [inst.installPath, ...inst.recordedPaths].map((p) => ({ path: p, installId: inst.id }))
    )
  ]
}

function keptPaths(
  inputs: CleanupInputs,
  installs: InstallationOnDisk[],
  removedOnPurpose: string[],
  pointerNames: string[]
): string[] {
  const releasedByRemoval = (candidate: KeptCandidate): boolean =>
    installs.some(
      (inst) => inst.id === candidate.installId && isSameOrInside(candidate.path, inst.installPath)
    )
  const kept = keptCandidates(inputs).filter(
    (candidate) =>
      !releasedByRemoval(candidate) &&
      !removedOnPurpose.some((dir) => samePath(dir, candidate.path))
  )
  return [...keptPointerPaths(inputs.folders, pointerNames), ...kept.map((c) => c.path)]
}

function listingOf(listings: Record<string, string[]>, dir: string): string[] {
  const key = Object.keys(listings).find((listed) => samePath(listed, dir))
  return key ? (listings[key] ?? []) : []
}

function buildGuard(
  inputs: CleanupInputs,
  kept: string[],
  installs: InstallationOnDisk[]
): DeletionGuard {
  const { folders } = inputs
  const ownedDirs = appOwnedDirs(folders)
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
    ...inputs.installations.map((inst) => inst.adoptedBaseDir)
  ])

  const allowedRoots = presentPaths([
    ...ownedDirs,
    ...windowsAppDataDirs(inputs.platform, folders),
    folders.temp,
    folders.downloadCache,
    cacheParentDir(folders),
    folders.installDir,
    path.dirname(folders.models),
    path.dirname(folders.benchmarks),
    windowsLocalDataRoot(inputs),
    dataRootFolder(folders),
    ...partialDownloadDirs(inputs),
    ...inputs.configuredCacheEntries,
    ...installs.map((inst) => inst.installPath),
    ...installs.map(adoptionMarkerToRetire)
  ])

  return { protectedPaths, keptPaths: kept, allowedRoots }
}

export function planUninstallCleanup(
  inputs: CleanupInputs,
  policy: CleanupPolicy = DEFAULT_CLEANUP_POLICY,
  keptIds: readonly string[] = []
): CleanupPlan {
  const { folders, options } = inputs
  const ownershipKnown = inputs.unreadableFiles.length === 0
  const entries: CleanupEntry[] = []
  const add = (
    p: string,
    bucket: CleanupBucket,
    reason: string,
    extra: { onlyIfEmpty?: true; installId?: string } = {}
  ): void => {
    if (entries.some((e) => samePath(e.path, p))) return
    entries.push({ path: p, bucket, reason, ...extra })
  }

  const deletingInstances = options.deleteInstances && ownershipKnown
  const deletingModels = options.deleteModels && ownershipKnown
  const deletingSharedInputOutput = deletingInstances && policy.deleteSharedInputOutput
  const installs = deletingInstances
    ? inputs.installations.filter(
        (inst) => hasExactInstallMarker(inst) && !keptIds.includes(inst.id)
      )
    : []
  const keptPointerNames = [
    ...pointerFilesToKeep(options, policy.keepPointerFiles),
    ...(keptIds.length > 0 ? INSTALL_LIST_FILES : []),
    ...(ownershipKnown ? [] : INSTANCE_POINTER_FILES)
  ]
  const removedOnPurpose = presentPaths([
    folders.downloadCache,
    deletingModels ? folders.models : null,
    deletingSharedInputOutput ? folders.input : null,
    deletingSharedInputOutput ? folders.output : null
  ])
  const kept = keptPaths(inputs, installs, removedOnPurpose, keptPointerNames)
  const guard = buildGuard(inputs, kept, installs)

  for (const inst of installs) {
    add(inst.installPath, 'B', `ComfyUI install ${inst.id}`, { installId: inst.id })
  }
  if (deletingModels) add(folders.models, 'C', 'shared models folder')
  for (const inst of installs) {
    const marker = adoptionMarkerToRetire(inst)
    if (marker) add(marker, 'B', `adoption marker of ComfyUI install ${inst.id}`)
  }
  if (deletingSharedInputOutput) {
    add(folders.input, 'B', 'shared input folder')
    add(folders.output, 'B', 'shared output folder')
  }

  const held = [...guard.protectedPaths, ...guard.keptPaths]
  const isLink = (dir: string): boolean => inputs.appDirLinks.some((link) => samePath(link, dir))
  const addAround = (dir: string, reason: string): void => {
    const inner = held.filter((p) => isSameOrInside(p, dir))
    if (inner.length === 0) {
      add(dir, 'A', reason)
    } else if (!isLink(dir) && !inner.some((p) => samePath(p, dir))) {
      for (const name of listingOf(inputs.appDirEntries, dir)) {
        addAround(path.join(dir, name), reason)
      }
    }
  }
  if (ownershipKnown) {
    for (const dir of appOwnedDirs(folders)) addAround(dir, 'app settings, logs and caches')
    for (const dir of windowsAppDataDirs(inputs.platform, folders)) {
      addAround(dir, 'app data under a current or earlier app name')
    }
  }
  add(folders.downloadCache, 'A', 'download cache')
  for (const entry of inputs.configuredCacheEntries) add(entry, 'A', 'download cache entry')
  add(folders.benchmarks, 'A', 'GPU benchmark results')
  for (const dir of partialDownloadDirs(inputs)) add(dir, 'A', 'unfinished downloads')
  for (const name of inputs.tempEntries) {
    if (TEMP_ENTRY_PATTERNS.some((pattern) => pattern.test(name))) {
      add(path.join(folders.temp, name), 'A', 'temporary files')
    }
  }

  const whenEmpty = { onlyIfEmpty: true } as const
  if (deletingInstances) {
    add(folders.installDir, 'B', 'installs folder when empty', whenEmpty)
  }
  if (deletingModels) {
    add(path.dirname(folders.models), 'C', 'shared folder when empty', whenEmpty)
  }
  add(path.dirname(folders.benchmarks), 'A', 'shared folder when empty', whenEmpty)
  const cacheParent = cacheParentDir(folders)
  if (cacheParent) add(cacheParent, 'A', 'cache folder when empty', whenEmpty)
  const dataRoot = dataRootFolder(folders)
  if (dataRoot) add(dataRoot, 'A', 'data folder when empty', whenEmpty)
  const localDataRoot = windowsLocalDataRoot(inputs)
  if (localDataRoot) add(localDataRoot, 'A', 'data folder when empty', whenEmpty)

  return { entries, guard }
}

export function deletionRefusal(
  target: string,
  guard: DeletionGuard,
  onlyIfEmpty = false
): string | null {
  if (!path.isAbsolute(target)) return 'not an absolute path'
  const resolved = path.resolve(target)
  if (resolved === path.parse(resolved).root) return 'drive root'
  const shielded = guard.protectedPaths.find((p) => isSameOrInside(p, resolved))
  if (shielded) return `would remove a protected folder: ${shielded}`
  const kept = onlyIfEmpty ? undefined : guard.keptPaths.find((p) => isSameOrInside(p, resolved))
  if (kept) return `would remove kept data: ${kept}`
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
  writeFile(p: string, content: string): void
}

const nodeCleanupFs: CleanupFs = {
  exists: (p) => fs.existsSync(p),
  remove: (p) => fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 }),
  isEmptyDir: (p) => fs.readdirSync(p).length === 0,
  removeEmptyDir: (p) => fs.rmdirSync(p),
  writeFile: (p, content) => {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content, 'utf-8')
  }
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
    const refusal = deletionRefusal(entry.path, plan.guard, entry.onlyIfEmpty === true)
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
      if (entry.installId) restoreInstallMarker(entry.path, entry.installId, ops)
      return { entry, outcome: 'failed', detail: errorCode(err) }
    }
  })
}

function restoreInstallMarker(installPath: string, id: string, ops: CleanupFs): void {
  try {
    ops.writeFile(path.join(installPath, INSTALL_MARKER_FILE), id)
  } catch {}
}

function removesInstanceOrModelData(entry: CleanupEntry): boolean {
  return entry.installId !== undefined || (entry.bucket === 'C' && !entry.onlyIfEmpty)
}

export function keptInstallIds(results: CleanupResult[]): string[] {
  return results.flatMap(({ entry, outcome }) =>
    entry.installId && (outcome === 'failed' || outcome === 'refused') ? [entry.installId] : []
  )
}

function failedInstallIds(results: CleanupResult[]): string[] {
  return results.flatMap(({ entry, outcome }) =>
    entry.installId && outcome === 'failed' ? [entry.installId] : []
  )
}

function markPartiallyDeleted(dataDirPath: string, ids: readonly string[]): void {
  if (ids.length === 0) return
  const file = path.join(dataDirPath, 'installations.json')
  try {
    const read = readFileSafe(file, { restore: false })
    if (read.kind !== 'data' || read.primaryUnreadable) return
    const parsed: unknown = JSON.parse(read.data)
    if (!Array.isArray(parsed)) return
    const records = parsed.map((value: unknown) => {
      const record = asRecord(value)
      return typeof record.id === 'string' && ids.includes(record.id)
        ? { ...record, status: PARTIAL_DELETE_STATUS }
        : value
    })
    writeFileSafe(file, JSON.stringify(records, null, 2), { backup: true })
  } catch {}
}

export function runCleanup(
  inputs: CleanupInputs,
  policy: CleanupPolicy = DEFAULT_CLEANUP_POLICY,
  ops: CleanupFs = nodeCleanupFs
): CleanupResult[] {
  const first = planUninstallCleanup(inputs, policy)
  const dataEntries = first.entries.filter(removesInstanceOrModelData)
  const dataResults = executeUninstallCleanup({ entries: dataEntries, guard: first.guard }, ops)
  markPartiallyDeleted(inputs.folders.dataDir, failedInstallIds(dataResults))
  const rest = planUninstallCleanup(inputs, policy, keptInstallIds(dataResults))
  const remaining = rest.entries.filter(
    (entry) => !dataEntries.some((done) => samePath(done.path, entry.path))
  )
  const restResults = executeUninstallCleanup({ entries: remaining, guard: rest.guard }, ops)
  return [...dataResults, ...restResults]
}

type StoredJson = { kind: 'value'; value: unknown } | { kind: 'absent' } | { kind: 'unreadable' }

function readStoredJsonFile(file: string, accepts: (value: unknown) => boolean): StoredJson {
  const read = readFileWithRetrySync(file)
  if (read.kind !== 'data') return read
  try {
    const value: unknown = JSON.parse(read.data)
    return accepts(value) ? { kind: 'value', value } : { kind: 'unreadable' }
  } catch {
    return { kind: 'unreadable' }
  }
}

function readStoredJson(file: string, accepts: (value: unknown) => boolean): StoredJson {
  const primary = readStoredJsonFile(file, accepts)
  if (primary.kind === 'value') return primary
  const backup = readStoredJsonFile(`${file}.bak`, accepts)
  if (backup.kind === 'value') return backup
  return primary.kind === 'absent' && backup.kind === 'absent' ? primary : { kind: 'unreadable' }
}

function isObject(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return isObject(value) ? (value as Record<string, unknown>) : {}
}

function absolutePathsIn(value: unknown): string[] {
  if (typeof value === 'string') return path.isAbsolute(value) ? [value] : []
  if (Array.isArray(value)) return value.flatMap(absolutePathsIn)
  return Object.values(asRecord(value)).flatMap(absolutePathsIn)
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

function listAppDir(dir: string): { names: string[]; links: string[] } {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const links = entries.filter((entry) => entry.isSymbolicLink())
    return {
      names: entries.map((entry) => entry.name),
      links: links.map((entry) => path.join(dir, entry.name))
    }
  } catch {
    return { names: [], links: [] }
  }
}

function isSymbolicLink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

function passesThroughLink(dir: string, appDirs: string[]): boolean {
  const root = appDirs.find((appDir) => isSameOrInside(dir, appDir))
  let current = path.resolve(dir)
  while (root && isSameOrInside(current, root) && !samePath(current, root)) {
    if (isSymbolicLink(current)) return true
    current = path.dirname(current)
  }
  return false
}

function listSubdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function readInstallMarker(dir: string): string | null {
  try {
    const marker = fs.readFileSync(path.join(dir, INSTALL_MARKER_FILE), 'utf-8').trim()
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

interface InstallIdentity {
  id: string
  installPath: string
}

function installIdentity(record: Record<string, unknown>): InstallIdentity | null {
  const id = nonEmptyString(record.id)
  const installPath = nonEmptyString(record.installPath)
  return id && installPath && path.isAbsolute(installPath) ? { id, installPath } : null
}

function installationsOnDisk(records: Record<string, unknown>[]): InstallationOnDisk[] {
  return records.flatMap((record): InstallationOnDisk[] => {
    const identity = installIdentity(record)
    if (!identity) return []
    const adoptedBaseDir = nonEmptyString(record.adoptedBaseDir)
    return [
      {
        ...identity,
        marker: readInstallMarker(identity.installPath),
        adoptedBaseDir,
        adoptionMarker: adoptedBaseDir ? readInstallMarker(adoptedBaseDir) : null,
        recordedPaths: absolutePathsIn(record)
      }
    ]
  })
}

function downloadCacheKeys(record: Record<string, unknown>): string[] {
  const version = nonEmptyString(record.version)
  const asset = nonEmptyString(record.asset)
  const releaseTag = nonEmptyString(record.releaseTag)
  const variant = nonEmptyString(record.variant)
  const downloadName = nonEmptyString(nonEmptyString(record.downloadUrl)?.split('/').pop())
  return presentPaths([
    version && asset ? `${version}_${asset}` : null,
    releaseTag && variant ? `${releaseTag}_${variant}` : null,
    releaseTag && downloadName ? `${releaseTag}_${downloadName}` : null
  ])
}

function configuredCacheEntries(
  configured: string | null,
  defaultCache: string,
  records: Record<string, unknown>[]
): string[] {
  if (!configured || !path.isAbsolute(configured) || samePath(configured, defaultCache)) return []
  const keys = new Set(records.flatMap(downloadCacheKeys))
  return listSubdirs(configured)
    .filter((name) => keys.has(name))
    .map((name) => path.join(configured, name))
}

function dirsToList(appDirs: string[], keptCandidates: string[]): string[] {
  const dirs = [...appDirs]
  for (const target of keptCandidates) {
    const appDir = appDirs.find((dir) => isSameOrInside(target, dir))
    if (!appDir) continue
    let dir = path.dirname(path.resolve(target))
    while (isSameOrInside(dir, appDir) && !samePath(dir, appDir)) {
      if (!dirs.some((listed) => samePath(listed, dir))) dirs.push(dir)
      dir = path.dirname(dir)
    }
  }
  return dirs
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
  const settingsFile = readStoredJson(path.join(configDir(), 'settings.json'), isObject)
  const listFile = readStoredJson(path.join(dataDir(), 'installations.json'), Array.isArray)
  const unreadableFiles = [
    ...(settingsFile.kind === 'unreadable' ? ['settings.json'] : []),
    ...(listFile.kind === 'unreadable' ? ['installations.json'] : [])
  ]
  const settings = asRecord(settingsFile.kind === 'value' ? settingsFile.value : null)
  const records =
    listFile.kind === 'value' && Array.isArray(listFile.value) ? listFile.value.map(asRecord) : []
  const installations = installationsOnDisk(records)
  const storedPaths = [
    ...absolutePathsIn(settings),
    ...records.filter((record) => !installIdentity(record)).flatMap(absolutePathsIn)
  ]
  const modelsDirs = stringList(settings.modelsDirs)
  const outputDir = nonEmptyString(settings.outputDir)
  const desktopOneBasePath = readDesktopOneBasePath(appData)
  const folders: CleanupFolders = {
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
  }
  const kept = keptCandidates({ folders, storedPaths, installations, unreadableFiles })
  const roots = [...appOwnedDirs(folders), ...windowsAppDataDirs(platform, folders)]
  const keptOnDisk = presentPaths([...kept.map((c) => c.path), desktopOneBasePath])
  const listings = dirsToList(roots, keptOnDisk)
    .filter((dir) => !passesThroughLink(dir, roots))
    .map((dir) => ({ dir, ...listAppDir(dir) }))

  return {
    platform,
    options,
    folders,
    appDirEntries: Object.fromEntries(listings.map(({ dir, names }) => [dir, names])),
    appDirLinks: listings.flatMap(({ links }) => links),
    tempEntries: listDir(temp),
    modelsDirs,
    outputDir,
    storedPaths,
    installations,
    desktopOneBasePath,
    configuredCacheEntries: configuredCacheEntries(
      nonEmptyString(settings.cacheDir),
      folders.downloadCache,
      records
    ),
    unreadableFiles
  }
}

export function formatCleanupLog(
  options: CleanupOptions,
  results: CleanupResult[],
  startedAt: Date,
  extras: { notes?: string[]; crash?: string } = {}
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
    ...(extras.notes ?? []),
    ...results.map(describe),
    summary
  ]
  const kept = keptInstallIds(results)
  if (kept.length > 0) {
    lines.push(
      `kept in the install list because their folders were not removed: ${kept.join(', ')}`
    )
  }
  if (extras.crash) lines.push(`stopped: ${extras.crash}`)
  return `${lines.join('\n')}\n`
}

function unreadableFileNotes(inputs: CleanupInputs): string[] {
  return inputs.unreadableFiles.map(
    (name) => `${name} and its backup could not be read: kept installs, models and app data`
  )
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
    const inputs = collectUninstallCleanupInputs(options, platform)
    const results = runCleanup(inputs)
    const notes = unreadableFileNotes(inputs)
    writeCleanupLog(formatCleanupLog(options, results, startedAt, { notes }))
    return results.some((r) => r.outcome === 'failed') ? 1 : 0
  } catch (err) {
    writeCleanupLog(formatCleanupLog(options, [], startedAt, { crash: errorCode(err) }))
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

export interface CleanupRelaunchHooks {
  suppressInstallOnQuit: () => void
  quit: () => void
}

export function relaunchIntoUninstallCleanup(
  options: CleanupOptions,
  hooks: CleanupRelaunchHooks
): void {
  hooks.suppressInstallOnQuit()
  const relaunch = cleanupRelaunchOptions(options, {
    argv: process.argv,
    isPackaged: app.isPackaged,
    appImage: process.env.APPIMAGE || undefined
  })
  app.relaunch(relaunch)
  hooks.quit()
}
