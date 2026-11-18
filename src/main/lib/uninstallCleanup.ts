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
import { readFileWithRetrySync, writeFileSafe } from './safe-file'
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
const KEPT_PATHS_FILE = 'uninstall-kept-paths.json'
const PARTIAL_DELETE_STATUS = 'partial-delete'

const PATH_ROLES_BY_KEY = new Map<string, PathRole>([
  ['modelsDirs', 'models'],
  ['modelDirs', 'models'],
  ['modelDirsPrimary', 'models'],
  ['inputDir', 'input'],
  ['outputDir', 'output'],
  ['cacheDir', 'cache']
])

const MAC_LIBRARY_FOLDERS = ['Caches', 'Logs', 'Preferences', 'Application Support']

const TEMP_ENTRY_PATTERNS = [
  /^comfy-focus-\d+\.vbs$/,
  /^comfyui-desktop-2-snapshots$/,
  /^comfyui-desktop-2-staged-restores-[\w.-]+$/,
  /^comfyui-desktop-2-\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  /^cnr-.+-\d{13}(\.zip)?$/
]

const APP_LOG_FILE_PATTERNS = [
  /^app\.log$/,
  /^app\.log_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.log$/
]

const UPDATER_PENDING_DIR = 'pending'
const UPDATER_FILE_PATTERNS = [
  /^(installer\.exe|package\.7z|current\.blockmap|update\.zip)$/,
  /^pending[\\/](update-info\.json|temp-[^\\/]+|[^\\/]+\.(exe|7z|zip|dmg|AppImage|blockmap))$/
]

const TRANSIENT_DELETE_ERRORS = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'])
const DELETE_RETRY_DELAYS_MS = [50, 100, 200]

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

export type PathRole = 'models' | 'input' | 'output' | 'cache' | 'other'

export interface NamedPath {
  path: string
  role: PathRole
  source?: string
}

export interface InstallationOnDisk {
  id: string
  installPath: string
  marker: string | null
  adoptedBaseDir: string | null
  adoptionMarker: string | null
  recordedPaths: NamedPath[]
}

export interface CleanupSources {
  platform: NodeJS.Platform
  options: CleanupOptions
  folders: CleanupFolders
  logFiles: string[]
  updaterFiles: string[]
  tempEntries: string[]
  modelsDirs: string[]
  outputDir: string | null
  storedPaths: NamedPath[]
  installations: InstallationOnDisk[]
  desktopOneBasePath: string | null
  configuredCacheEntries: string[]
  unreadableFiles: string[]
  unidentifiedInstallRecords: number
}

export interface TargetKind {
  path: string
  kind: EntryKind
}

export interface CleanupInputs extends CleanupSources {
  targetKinds: TargetKind[]
}

export interface OwnerMarker {
  file: string
  id: string
}

export interface CleanupEntry {
  path: string
  bucket: CleanupBucket
  reason: string
  seen: EntryKind
  onlyIfEmpty?: true
  onlyFile?: true
  installId?: string
  marker?: OwnerMarker
}

type PlannedTarget = Omit<CleanupEntry, 'seen'>

type TargetOptions = Pick<CleanupEntry, 'onlyIfEmpty' | 'onlyFile' | 'installId' | 'marker'>

export interface DeletionGuard {
  protectedPaths: string[]
  keptPaths: string[]
  allowedRoots: string[]
  linksAllowedAtOrAbove: string[]
}

export interface CleanupPlan {
  entries: CleanupEntry[]
  guard: DeletionGuard
  namedKeptPaths: string[]
}

export type CleanupOutcome = 'removed' | 'emptied' | 'absent' | 'not-empty' | 'refused' | 'failed'

export type DeletionScope = 'whole' | 'around-kept' | 'if-empty'

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

function distinct(paths: string[]): string[] {
  return paths.filter((p, i) => paths.findIndex((q) => samePath(p, q)) === i)
}

function outermost(paths: string[]): string[] {
  const unique = distinct(paths)
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

function windowsLocalDataRoot(inputs: Pick<CleanupSources, 'platform' | 'folders'>): string | null {
  const { localAppData } = inputs.folders
  return inputs.platform === 'win32' && localAppData
    ? path.join(localAppData, DATA_ROOT_DIR_NAME)
    : null
}

function partialDownloadDirs(
  inputs: Pick<CleanupSources, 'folders' | 'modelsDirs' | 'outputDir'>
): string[] {
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

function withRoles(paths: [PathRole, string | null][]): NamedPath[] {
  return paths.flatMap(([role, p]) => (p ? [{ path: p, role }] : []))
}

function tempEntriesToRemove(temp: string, names: string[]): string[] {
  return names
    .filter((name) => TEMP_ENTRY_PATTERNS.some((pattern) => pattern.test(name)))
    .map((name) => path.join(temp, name))
}

type WalkedRootSources = Pick<
  CleanupSources,
  'platform' | 'folders' | 'modelsDirs' | 'outputDir' | 'configuredCacheEntries' | 'tempEntries'
>

function walkedRoots(inputs: WalkedRootSources, installPaths: string[]): string[] {
  const { folders } = inputs
  return [
    ...appOwnedDirs(folders),
    ...windowsAppDataDirs(inputs.platform, folders),
    folders.downloadCache,
    folders.benchmarks,
    folders.models,
    ...partialDownloadDirs(inputs),
    ...inputs.configuredCacheEntries,
    ...tempEntriesToRemove(folders.temp, inputs.tempEntries),
    ...installPaths
  ]
}

function adoptionMarkerToRetire(inst: InstallationOnDisk): string | null {
  return inst.adoptedBaseDir && inst.adoptionMarker === inst.id
    ? path.join(inst.adoptedBaseDir, INSTALL_MARKER_FILE)
    : null
}

interface KeptCandidate extends NamedPath {
  installId?: string
}

type KeptSources = Pick<
  CleanupSources,
  'folders' | 'storedPaths' | 'installations' | 'unreadableFiles'
>

function keptCandidates(sources: KeptSources): KeptCandidate[] {
  const { folders } = sources
  const defaults = withRoles([
    ['models', folders.models],
    ['input', folders.input],
    ['output', folders.output],
    ['other', sources.unreadableFiles.length > 0 ? folders.installDir : null]
  ])
  return [
    ...sources.storedPaths,
    ...defaults,
    ...sources.installations.flatMap((inst) => {
      const named = [...withRoles([['other', inst.installPath]]), ...inst.recordedPaths]
      return named.map((p) => ({ ...p, installId: inst.id }))
    })
  ]
}

function sourceFiles(source: string): string[] {
  const dir = path.dirname(source)
  return INSTALL_LIST_FILES.includes(path.basename(source))
    ? INSTALL_LIST_FILES.map((name) => path.join(dir, name))
    : [source]
}

interface KeptPaths {
  paths: string[]
  named: string[]
}

function keptPaths(
  inputs: CleanupSources,
  installs: InstallationOnDisk[],
  removedOnPurpose: NamedPath[],
  pointerNames: string[]
): KeptPaths {
  const releasedByRemoval = (candidate: KeptCandidate): boolean =>
    installs.some(
      (inst) => inst.id === candidate.installId && isSameOrInside(candidate.path, inst.installPath)
    )
  const releasedOnPurpose = (candidate: KeptCandidate): boolean =>
    removedOnPurpose.some(
      (target) => target.role === candidate.role && samePath(target.path, candidate.path)
    )
  const kept = keptCandidates(inputs).filter(
    (candidate) => !releasedByRemoval(candidate) && !releasedOnPurpose(candidate)
  )
  const named = kept.flatMap((c) => (c.source ? [{ path: c.path, source: c.source }] : []))
  return {
    paths: [
      ...keptPointerPaths(inputs.folders, pointerNames),
      ...named.flatMap((c) => sourceFiles(c.source)),
      ...kept.map((c) => c.path)
    ],
    named: named.map((c) => c.path)
  }
}

function buildGuard(
  inputs: CleanupSources,
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

  const linksAllowedAtOrAbove = presentPaths([folders.home, folders.temp])
  return { protectedPaths, keptPaths: kept, allowedRoots, linksAllowedAtOrAbove }
}

interface PlannedTargets {
  entries: PlannedTarget[]
  guard: DeletionGuard
  namedKeptPaths: string[]
}

function installMarker(inst: InstallationOnDisk): OwnerMarker {
  return { file: path.join(inst.installPath, INSTALL_MARKER_FILE), id: inst.id }
}

function planTargets(
  inputs: CleanupSources,
  policy: CleanupPolicy,
  keptIds: readonly string[]
): PlannedTargets {
  const { folders, options } = inputs
  const ownershipKnown = inputs.unreadableFiles.length === 0
  const entries: PlannedTarget[] = []
  const add = (
    p: string,
    bucket: CleanupBucket,
    reason: string,
    extra: TargetOptions = {}
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
  const recordsSurvive =
    inputs.unidentifiedInstallRecords > 0 ||
    inputs.installations.some((inst) => !installs.includes(inst))
  const keptPointerNames = [
    ...pointerFilesToKeep(options, policy.keepPointerFiles),
    ...(recordsSurvive ? INSTALL_LIST_FILES : []),
    ...(ownershipKnown ? [] : INSTANCE_POINTER_FILES)
  ]
  const removedOnPurpose = withRoles([
    ['cache', folders.downloadCache],
    ['models', deletingModels ? folders.models : null],
    ['input', deletingSharedInputOutput ? folders.input : null],
    ['output', deletingSharedInputOutput ? folders.output : null]
  ])
  const kept = keptPaths(inputs, installs, removedOnPurpose, keptPointerNames)
  const guard = buildGuard(inputs, kept.paths, installs)

  for (const inst of installs) {
    const marker = installMarker(inst)
    add(inst.installPath, 'B', `ComfyUI install ${inst.id}`, { installId: inst.id, marker })
  }
  if (deletingModels) add(folders.models, 'C', 'shared models folder')
  for (const inst of installs) {
    const file = adoptionMarkerToRetire(inst)
    const reason = `adoption marker of ComfyUI install ${inst.id}`
    if (file) add(file, 'B', reason, { marker: { file, id: inst.id } })
  }
  if (deletingSharedInputOutput) {
    add(folders.input, 'B', 'shared input folder')
    add(folders.output, 'B', 'shared output folder')
  }

  const addFiles = (dir: string, names: string[], patterns: RegExp[], reason: string): void => {
    for (const name of names.filter((n) => patterns.some((pattern) => pattern.test(n)))) {
      add(path.join(dir, name), 'A', reason, { onlyFile: true })
    }
  }
  const addWhenEmpty = (dir: string, bucket: CleanupBucket, name: string): void => {
    add(dir, bucket, `${name} when empty`, { onlyIfEmpty: true })
  }
  if (ownershipKnown) {
    for (const dir of appOwnedDirs(folders)) add(dir, 'A', 'app settings, logs and caches')
    for (const dir of windowsAppDataDirs(inputs.platform, folders)) {
      add(dir, 'A', 'app data under a current or earlier app name')
    }
    add(folders.downloadCache, 'A', 'download cache')
    for (const entry of inputs.configuredCacheEntries) add(entry, 'A', 'download cache entry')
    add(folders.benchmarks, 'A', 'GPU benchmark results')
    for (const dir of partialDownloadDirs(inputs)) add(dir, 'A', 'unfinished downloads')
  } else {
    addFiles(folders.logs, inputs.logFiles, APP_LOG_FILE_PATTERNS, 'app log file')
    addFiles(
      folders.updaterCache,
      inputs.updaterFiles,
      UPDATER_FILE_PATTERNS,
      'downloaded app update file'
    )
  }
  for (const entry of tempEntriesToRemove(folders.temp, inputs.tempEntries)) {
    add(entry, 'A', 'temporary files')
  }

  if (deletingInstances) addWhenEmpty(folders.installDir, 'B', 'installs folder')
  if (deletingModels) addWhenEmpty(path.dirname(folders.models), 'C', 'shared folder')
  if (ownershipKnown) {
    addWhenEmpty(path.dirname(folders.benchmarks), 'A', 'shared folder')
    const cacheParent = cacheParentDir(folders)
    if (cacheParent) addWhenEmpty(cacheParent, 'A', 'cache folder')
    const dataRoot = dataRootFolder(folders)
    if (dataRoot) addWhenEmpty(dataRoot, 'A', 'data folder')
    const localDataRoot = windowsLocalDataRoot(inputs)
    if (localDataRoot) addWhenEmpty(localDataRoot, 'A', 'data folder')
  }

  return { entries, guard, namedKeptPaths: kept.named }
}

export function planUninstallCleanup(
  inputs: CleanupInputs,
  policy: CleanupPolicy = DEFAULT_CLEANUP_POLICY,
  keptIds: readonly string[] = []
): CleanupPlan {
  const planned = planTargets(inputs, policy, keptIds)
  const entries = planned.entries.flatMap((target): CleanupEntry[] => {
    const collected = inputs.targetKinds.find((t) => samePath(t.path, target.path))
    return collected ? [{ ...target, seen: collected.kind }] : []
  })
  return { ...planned, entries }
}

const EVERY_TARGET_POLICY: CleanupPolicy = {
  keepPointerFiles: false,
  deleteSharedInputOutput: true
}

function everyTarget(sources: CleanupSources): string[] {
  const everything = { ...sources, options: { deleteInstances: true, deleteModels: true } }
  return planTargets(everything, EVERY_TARGET_POLICY, []).entries.map((target) => target.path)
}

function removesKept(kept: string, target: string, scope: DeletionScope): boolean {
  if (scope === 'whole') return isSameOrInside(kept, target)
  return scope === 'around-kept' && samePath(kept, target)
}

export function deletionRefusal(
  target: string,
  guard: DeletionGuard,
  scope: DeletionScope = 'whole'
): string | null {
  if (!path.isAbsolute(target)) return 'not an absolute path'
  const resolved = path.resolve(target)
  if (resolved === path.parse(resolved).root) return 'drive root'
  const shielded = guard.protectedPaths.find((p) => isSameOrInside(p, resolved))
  if (shielded) return `would remove a protected folder: ${shielded}`
  const kept = guard.keptPaths.find((p) => removesKept(p, resolved, scope))
  if (kept) return `would remove kept data: ${kept}`
  if (!guard.allowedRoots.some((root) => isSameOrInside(resolved, root))) {
    return 'outside the folders Comfy Desktop writes'
  }
  return null
}

function scopeOf(entry: CleanupEntry): DeletionScope {
  if (entry.onlyIfEmpty) return 'if-empty'
  return entry.installId ? 'whole' : 'around-kept'
}

export type EntryKind = 'absent' | 'link' | 'dir' | 'file'

export interface EntryInfo {
  kind: EntryKind
  device: number
}

export interface CleanupFs {
  entryInfo(p: string): EntryInfo
  realPath(p: string): string
  list(dir: string): string[]
  readText(p: string): string | null
  removeFile(p: string): void
  removeLink(p: string): void
  removeEmptyDir(p: string): void
  writeFile(p: string, content: string): void
}

function entryKind(stat: fs.Stats): EntryKind {
  if (stat.isSymbolicLink()) return 'link'
  return stat.isDirectory() ? 'dir' : 'file'
}

function realPathOf(p: string): string {
  const resolved = path.resolve(p)
  try {
    return fs.realpathSync(resolved)
  } catch {
    const parent = path.dirname(resolved)
    return parent === resolved ? resolved : path.join(realPathOf(parent), path.basename(resolved))
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function withRetries(op: () => void): void {
  for (const delay of [...DELETE_RETRY_DELAYS_MS, null]) {
    try {
      op()
      return
    } catch (err) {
      if (delay === null || !TRANSIENT_DELETE_ERRORS.has(errorCode(err))) throw err
      sleepSync(delay)
    }
  }
}

export const nodeCleanupFs: CleanupFs = {
  entryInfo: (p) => {
    const stat = fs.lstatSync(p, { throwIfNoEntry: false })
    return stat ? { kind: entryKind(stat), device: stat.dev } : { kind: 'absent', device: 0 }
  },
  realPath: realPathOf,
  list: (dir) => fs.readdirSync(dir),
  readText: (p) => {
    try {
      return fs.readFileSync(p, 'utf-8')
    } catch {
      return null
    }
  },
  removeFile: (p) => withRetries(() => fs.unlinkSync(p)),
  removeLink: (p) => withRetries(() => fs.unlinkSync(p)),
  removeEmptyDir: (p) => withRetries(() => fs.rmdirSync(p)),
  writeFile: (p, content) => {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content, 'utf-8')
  }
}

function errorCode(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' ? code : 'error'
}

function ancestorsOf(p: string): string[] {
  const parent = path.dirname(p)
  return parent === p ? [] : [parent, ...ancestorsOf(parent)]
}

function linkedAncestor(target: string, guard: DeletionGuard, ops: CleanupFs): string | undefined {
  const systemLink = (dir: string): boolean =>
    guard.linksAllowedAtOrAbove.some((base) => isSameOrInside(base, dir))
  return ancestorsOf(path.resolve(target)).find(
    (dir) => !systemLink(dir) && ops.entryInfo(dir).kind === 'link'
  )
}

function heldInside(target: string, guard: DeletionGuard, ops: CleanupFs): string[] {
  const realTarget = ops.realPath(target)
  const inTarget = (real: string): string[] =>
    isSameOrInside(real, realTarget) ? [path.join(target, path.relative(realTarget, real))] : []
  const held = [...guard.protectedPaths, ...guard.keptPaths].flatMap((p) => [
    ...(isSameOrInside(p, target) ? [p] : []),
    ...inTarget(ops.realPath(p))
  ])
  return distinct(held)
}

interface Walk {
  held: string[]
  ops: CleanupFs
  problems: string[]
}

function removeWalking(p: string, parentDevice: number | null, walk: Walk): boolean {
  const { held, ops } = walk
  if (held.some((h) => samePath(h, p))) return false
  try {
    const info = ops.entryInfo(p)
    if (info.kind === 'absent') return true
    if (parentDevice !== null && info.device !== parentDevice) {
      walk.problems.push(`another drive is mounted at ${p}`)
      return false
    }
    if (info.kind === 'link') {
      if (held.some((h) => isSameOrInside(h, p))) return false
      ops.removeLink(p)
    } else if (info.kind === 'file') {
      ops.removeFile(p)
    } else {
      const child = (name: string): boolean => removeWalking(path.join(p, name), info.device, walk)
      if (ops.list(p).map(child).includes(false)) return false
      ops.removeEmptyDir(p)
    }
    return true
  } catch (err) {
    walk.problems.push(errorCode(err))
    return false
  }
}

const KIND_WORDS: Record<EntryKind, string> = {
  absent: 'missing',
  link: 'a link',
  dir: 'a folder',
  file: 'a file'
}

function markerMatches(marker: OwnerMarker, ops: CleanupFs): boolean {
  return ops.readText(marker.file)?.trim() === marker.id
}

function removeEntry(entry: CleanupEntry, guard: DeletionGuard, ops: CleanupFs): CleanupResult {
  const refused = (detail: string): CleanupResult => ({ entry, outcome: 'refused', detail })
  const info = ops.entryInfo(entry.path)
  if (info.kind === 'absent') return { entry, outcome: 'absent' }
  if (info.kind !== entry.seen) {
    return refused(
      `was ${KIND_WORDS[entry.seen]} when cleanup started, now ${KIND_WORDS[info.kind]}`
    )
  }
  const linked = linkedAncestor(entry.path, guard, ops)
  if (linked) return refused(`inside a linked folder: ${linked}`)
  if (entry.onlyFile && info.kind !== 'file') return refused('not a file')
  if (entry.marker && !markerMatches(entry.marker, ops)) {
    return refused(`its Desktop marker no longer reads ${entry.marker.id}`)
  }
  const held = heldInside(entry.path, guard, ops)
  if (info.kind === 'link') {
    if (entry.installId) return refused('a link, not followed')
    if (held.length > 0) return refused(`a link to kept data: ${held.join(', ')}`)
    ops.removeLink(entry.path)
    return { entry, outcome: 'removed' }
  }
  if (entry.onlyIfEmpty) {
    if (info.kind !== 'dir') return refused('not a folder')
    if (ops.list(entry.path).length > 0) return { entry, outcome: 'not-empty' }
    ops.removeEmptyDir(entry.path)
    return { entry, outcome: 'removed' }
  }
  const whole = held.find((p) => entry.installId !== undefined || samePath(p, entry.path))
  if (whole) return refused(`would remove kept data: ${whole}`)
  const walk: Walk = { held, ops, problems: [] }
  if (removeWalking(entry.path, null, walk)) return { entry, outcome: 'removed' }
  const [problem] = walk.problems
  if (problem) return { entry, outcome: 'failed', detail: problem }
  return { entry, outcome: 'emptied', detail: `kept ${held.join(', ')}` }
}

function removeOrFail(entry: CleanupEntry, guard: DeletionGuard, ops: CleanupFs): CleanupResult {
  try {
    return removeEntry(entry, guard, ops)
  } catch (err) {
    return { entry, outcome: 'failed', detail: errorCode(err) }
  }
}

export function executeUninstallCleanup(
  plan: Pick<CleanupPlan, 'entries' | 'guard'>,
  ops: CleanupFs = nodeCleanupFs
): CleanupResult[] {
  return plan.entries.map((entry): CleanupResult => {
    const refusal = deletionRefusal(entry.path, plan.guard, scopeOf(entry))
    if (refusal) return { entry, outcome: 'refused', detail: refusal }
    const result = removeOrFail(entry, plan.guard, ops)
    if (!entry.installId || result.outcome !== 'failed') return result
    const notRestored = restoreInstallMarker(entry.path, entry.installId, ops)
    if (!notRestored) return result
    return { ...result, detail: `${result.detail ?? 'error'}; marker not restored: ${notRestored}` }
  })
}

function restoreInstallMarker(installPath: string, id: string, ops: CleanupFs): string | null {
  try {
    ops.writeFile(path.join(installPath, INSTALL_MARKER_FILE), id)
    return null
  } catch (err) {
    return errorCode(err)
  }
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

function removedInstalls(results: CleanupResult[]): InstallIdentity[] {
  return results.flatMap(({ entry, outcome }) =>
    entry.installId && (outcome === 'removed' || outcome === 'absent')
      ? [{ id: entry.installId, installPath: entry.path }]
      : []
  )
}

function namesPath(value: unknown, p: string): boolean {
  return absolutePathsIn(value).some((named) => samePath(named, p))
}

interface ListUpdate {
  results: CleanupResult[]
  namedByCleanup: string[]
}

function storedList(stored: StoredJson): unknown[][] {
  return stored.kind === 'value' && Array.isArray(stored.value) ? [stored.value] : []
}

function listText(records: unknown[]): string {
  return JSON.stringify(records, null, 2)
}

function cleanupNamedPaths(paths: string[], source: string): NamedPath[] {
  return paths.map((p): NamedPath => ({ path: p, role: 'other', source }))
}

function recordKeptPaths(dataDirPath: string, paths: string[]): string[] | null {
  const file = path.join(dataDirPath, KEPT_PATHS_FILE)
  const earlier = readStoredJsonFile(file, Array.isArray)
  if (earlier.kind === 'unreadable') return null
  const listed = earlier.kind === 'value' ? stringList(earlier.value) : []
  const all = distinct([...listed, ...paths])
  writeFileSafe(file, JSON.stringify(all, null, 2))
  return all
}

function installListEntry(file: string): CleanupEntry {
  return { path: file, bucket: 'B', reason: 'install list update', seen: 'file' }
}

function updateInstallList(
  dataDirPath: string,
  removed: readonly InstallIdentity[],
  failedIds: readonly string[],
  namedKept: readonly string[]
): ListUpdate {
  const file = path.join(dataDirPath, 'installations.json')
  const backupFile = `${file}.bak`
  let namedByCleanup: string[] = []
  const failed = (detail: string): ListUpdate => ({
    results: [{ entry: installListEntry(file), outcome: 'failed', detail }],
    namedByCleanup
  })
  if (removed.length === 0 && failedIds.length === 0) return { results: [], namedByCleanup }
  const wasRemoved = (value: unknown): boolean => {
    const identity = installIdentity(asRecord(value))
    if (!identity) return false
    return removed.some(
      (inst) => inst.id === identity.id && samePath(inst.installPath, identity.installPath)
    )
  }
  const isFailed = (value: unknown): boolean => {
    const id = asRecord(value).id
    return typeof id === 'string' && failedIds.includes(id)
  }
  const changes = (list: unknown[]): boolean => list.some((v) => wasRemoved(v) || isFailed(v))
  const markFailed = (value: unknown): unknown =>
    isFailed(value) ? { ...asRecord(value), status: PARTIAL_DELETE_STATUS } : value
  const updated = (list: unknown[]): unknown[] =>
    list.filter((value) => !wasRemoved(value)).map(markFailed)
  try {
    const [primary] = storedList(readStoredJsonFile(file, Array.isArray))
    const [backup] = storedList(readStoredJsonFile(backupFile, Array.isArray))
    const lists = [primary, backup].filter((list): list is unknown[] => list !== undefined)
    const [base] = lists
    if (!base) return failed('neither copy of the install list could be read')
    const stillNamed = (p: string): boolean => namesPath(lists.map(updated), p)
    const orphaned = namedKept.filter((p) => namesPath(lists, p) && !stillNamed(p))
    if (orphaned.length > 0) {
      const recorded = recordKeptPaths(dataDirPath, orphaned)
      if (!recorded) return failed(`${KEPT_PATHS_FILE} could not be read`)
      namedByCleanup = recorded
    }
    writeFileSafe(file, listText(updated(base)))
    if (backup && changes(backup)) writeFileSafe(backupFile, listText(updated(backup)))
    return { results: [], namedByCleanup }
  } catch (err) {
    return failed(errorCode(err))
  }
}

function withCleanupNames(inputs: CleanupInputs, paths: string[]): CleanupInputs {
  const source = path.join(inputs.folders.dataDir, KEPT_PATHS_FILE)
  return { ...inputs, storedPaths: [...inputs.storedPaths, ...cleanupNamedPaths(paths, source)] }
}

export function runCleanup(
  inputs: CleanupInputs,
  policy: CleanupPolicy = DEFAULT_CLEANUP_POLICY,
  ops: CleanupFs = nodeCleanupFs
): CleanupResult[] {
  const first = planUninstallCleanup(inputs, policy)
  const dataEntries = first.entries.filter(removesInstanceOrModelData)
  const dataResults = executeUninstallCleanup({ entries: dataEntries, guard: first.guard }, ops)
  const listUpdate = updateInstallList(
    inputs.folders.dataDir,
    removedInstalls(dataResults),
    failedInstallIds(dataResults),
    first.namedKeptPaths
  )
  const named = withCleanupNames(inputs, listUpdate.namedByCleanup)
  const rest = planUninstallCleanup(named, policy, keptInstallIds(dataResults))
  const remaining = rest.entries.filter(
    (entry) => !dataEntries.some((done) => samePath(done.path, entry.path))
  )
  const restResults = executeUninstallCleanup({ entries: remaining, guard: rest.guard }, ops)
  return [...dataResults, ...listUpdate.results, ...restResults]
}

type StoredJson =
  | { kind: 'value'; value: unknown; file: string }
  | { kind: 'absent' }
  | { kind: 'unreadable' }

function readStoredJsonFile(file: string, accepts: (value: unknown) => boolean): StoredJson {
  const read = readFileWithRetrySync(file)
  if (read.kind !== 'data') return read
  try {
    const value: unknown = JSON.parse(read.data)
    return accepts(value) ? { kind: 'value', value, file } : { kind: 'unreadable' }
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

function backupValue(file: string, accepts: (value: unknown) => boolean): unknown {
  const backup = readStoredJsonFile(`${file}.bak`, accepts)
  return backup.kind === 'value' ? backup.value : null
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

function namedPathsIn(record: Record<string, unknown>): NamedPath[] {
  return Object.entries(record).flatMap(([key, value]) => {
    const role: PathRole = PATH_ROLES_BY_KEY.get(key) ?? 'other'
    return absolutePathsIn(value).map((p) => ({ path: p, role }))
  })
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
        recordedPaths: namedPathsIn(record)
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

function earlierRecordPaths(records: Record<string, unknown>[], earlier: unknown): NamedPath[] {
  if (!Array.isArray(earlier)) return []
  return earlier.map(asRecord).flatMap((record) => {
    const id = nonEmptyString(record.id)
    const current = records.find((listed) => id !== null && nonEmptyString(listed.id) === id)
    const currentPath = current ? installIdentity(current)?.installPath : undefined
    return namedPathsIn(record).filter((p) => !currentPath || !isSameOrInside(p.path, currentPath))
  })
}

function isJsonContainer(value: unknown): boolean {
  return value !== null && typeof value === 'object'
}

function earlierAppDataPaths(dirs: string[]): NamedPath[] {
  return dirs.flatMap((dir): NamedPath[] => {
    const files = ['settings.json', 'installations.json'].map((name) =>
      readStoredJson(path.join(dir, name), isJsonContainer)
    )
    if (files.some((file) => file.kind === 'unreadable')) return [{ path: dir, role: 'other' }]
    return files.flatMap((file) =>
      file.kind === 'value'
        ? absolutePathsIn(file.value)
            .filter((p) => dirs.some((earlierDir) => isSameOrInside(p, earlierDir)))
            .map((p): NamedPath => ({ path: p, role: 'other', source: file.file }))
        : []
    )
  })
}

function reachedBy(roots: string[]): (p: string) => boolean {
  const realRoots = roots.map(realPathOf)
  return (p) =>
    roots.some((root) => isSameOrInside(p, root)) ||
    realRoots.some((root) => isSameOrInside(realPathOf(p), root))
}

function namedBy(
  source: string,
  paths: NamedPath[],
  inWalkedRoot: (p: string) => boolean
): NamedPath[] {
  return paths.map((p) => (inWalkedRoot(p.path) ? { ...p, source } : p))
}

function updaterFileNames(updaterCache: string): string[] {
  const pending = listDir(path.join(updaterCache, UPDATER_PENDING_DIR))
  const pendingNames = pending.map((name) => path.join(UPDATER_PENDING_DIR, name))
  return [...listDir(updaterCache), ...pendingNames]
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

function pathsNamedByCleanup(stored: StoredJson): NamedPath[] {
  if (stored.kind !== 'value') return []
  const paths = stringList(stored.value).filter((p) => path.isAbsolute(p))
  return cleanupNamedPaths(paths, stored.file)
}

function targetKind(p: string): TargetKind[] {
  try {
    return [{ path: p, kind: nodeCleanupFs.entryInfo(p).kind }]
  } catch {
    return []
  }
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
  const settingsPath = path.join(configDir(), 'settings.json')
  const listPath = path.join(dataDir(), 'installations.json')
  const settingsFile = readStoredJson(settingsPath, isObject)
  const listFile = readStoredJson(listPath, Array.isArray)
  const keptPathsFile = readStoredJson(path.join(dataDir(), KEPT_PATHS_FILE), Array.isArray)
  const unreadableFiles = [
    ...(settingsFile.kind === 'unreadable' ? ['settings.json'] : []),
    ...(listFile.kind === 'unreadable' ? ['installations.json'] : []),
    ...(keptPathsFile.kind === 'unreadable' ? [KEPT_PATHS_FILE] : [])
  ]
  const settings = asRecord(settingsFile.kind === 'value' ? settingsFile.value : null)
  const records =
    listFile.kind === 'value' && Array.isArray(listFile.value) ? listFile.value.map(asRecord) : []
  const listedInstalls = installationsOnDisk(records)
  const unidentifiedRecords = records.filter((record) => !installIdentity(record))
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
  const cacheEntries = configuredCacheEntries(
    nonEmptyString(settings.cacheDir),
    folders.downloadCache,
    records
  )
  const tempEntries = listDir(temp)
  const roots = walkedRoots(
    { platform, folders, modelsDirs, outputDir, configuredCacheEntries: cacheEntries, tempEntries },
    listedInstalls.map((inst) => inst.installPath)
  )
  const inWalkedRoot = reachedBy(roots)
  const settingsSource = settingsFile.kind === 'value' ? settingsFile.file : settingsPath
  const listSource = listFile.kind === 'value' ? listFile.file : listPath
  const installations = listedInstalls.map((inst) => ({
    ...inst,
    recordedPaths: namedBy(listSource, inst.recordedPaths, inWalkedRoot)
  }))
  const settingsBackup = asRecord(backupValue(settingsPath, isObject))
  const earlierRecords = earlierRecordPaths(records, backupValue(listPath, Array.isArray))
  const storedPaths = [
    ...namedBy(settingsSource, namedPathsIn(settings), inWalkedRoot),
    ...namedBy(`${settingsPath}.bak`, namedPathsIn(settingsBackup), inWalkedRoot),
    ...namedBy(listSource, unidentifiedRecords.flatMap(namedPathsIn), inWalkedRoot),
    ...namedBy(`${listPath}.bak`, earlierRecords, inWalkedRoot),
    ...earlierAppDataPaths(windowsAppDataDirs(platform, folders)),
    ...pathsNamedByCleanup(keptPathsFile)
  ]

  const sources: CleanupSources = {
    platform,
    options,
    folders,
    logFiles: listDir(folders.logs),
    updaterFiles: updaterFileNames(folders.updaterCache),
    tempEntries,
    modelsDirs,
    outputDir,
    storedPaths,
    installations,
    desktopOneBasePath,
    configuredCacheEntries: cacheEntries,
    unreadableFiles,
    unidentifiedInstallRecords: unidentifiedRecords.length
  }
  return { ...sources, targetKinds: everyTarget(sources).flatMap(targetKind) }
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
  const outcomes = ['removed', 'emptied', 'absent', 'not-empty', 'refused', 'failed'] as const
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
    (name) =>
      `${name} and its backup could not be read: removed only app log files, downloaded app update files and temporary files, and kept everything else`
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
