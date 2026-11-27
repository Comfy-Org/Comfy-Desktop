import fs from 'fs'
import path from 'path'
import {
  TEMP_DIR_NAME,
  isNonModelFolder,
  modelFolderKind,
  resolveExtraModelPaths,
  resolveInstallModelSearchPaths
} from './models'
import { comfyStartDir, lastArgValue, resolveFolderArg } from './startupArgFolders'
import { parseArgs } from './util'
import type { InstallModelSearch } from './models'
import type { InstallationRecord } from '../installations'

export interface InstallModelEntry {
  folder: string
  name: string
  size: number
}

export interface InstallModelList {
  models: InstallModelEntry[]
  truncated: boolean
}

export const MAX_INSTALL_MODELS = 2000
export const MAX_INSTALL_MODELS_BYTES = 400_000
export const MAX_SCANNED_ENTRIES = 200_000
export const MODEL_LIST_TIME_BUDGET_MS = 15_000
const MODEL_LIST_GRACE_MS = 5_000
export const MAX_MODEL_DIR_DEPTH = 8
export const MAX_MODEL_NAME_LENGTH = 255

export const MODEL_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.safetensors',
  '.sft',
  '.ckpt',
  '.pt',
  '.pt2',
  '.pth',
  '.bin',
  '.pkl',
  '.gguf',
  '.onnx'
])

const FOLDER_SEGMENT = /^[A-Za-z0-9_.-]+$/
const MAX_FOLDER_LENGTH = 64

interface FolderSource {
  folder: string
  dir: string
}

function isControlCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  )
}

function isNestedNonModelFolder(name: string): boolean {
  return name !== 'models' && isNonModelFolder(name)
}

function isModelFile(name: string): boolean {
  return MODEL_FILE_EXTENSIONS.has(path.extname(name).toLowerCase())
}

function isSendableFolder(folder: string): boolean {
  return (
    folder.length > 0 &&
    folder.length <= MAX_FOLDER_LENGTH &&
    folder
      .split('/')
      .every((segment) => FOLDER_SEGMENT.test(segment) && segment !== '.' && segment !== '..')
  )
}

function isSendableName(name: string): boolean {
  const characters = [...name]
  return (
    characters.length > 0 &&
    characters.length <= MAX_MODEL_NAME_LENGTH &&
    !characters.some(isControlCharacter) &&
    !name.includes('\\') &&
    !name.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  )
}

function isSkippedEntry(name: string): boolean {
  return name.startsWith('.') || name === TEMP_DIR_NAME
}

interface ScanState {
  unreadable: boolean
}

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function noteFailure(state: ScanState, err: unknown): void {
  if (!isMissing(err)) state.unreadable = true
}

async function statOrNull(target: string, state: ScanState): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(target)
  } catch (err) {
    noteFailure(state, err)
    return null
  }
}

async function realpathOrNull(target: string, state: ScanState): Promise<string | null> {
  try {
    return await fs.promises.realpath(target)
  } catch (err) {
    noteFailure(state, err)
    return null
  }
}

async function readDirOrEmpty(dir: string, state: ScanState): Promise<fs.Dirent[]> {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true })
  } catch (err) {
    noteFailure(state, err)
    return []
  }
}

function folderSourcesFromExtraPaths(search: InstallModelSearch): FolderSource[] {
  return search.extraPaths
    .filter((extra) => !isNonModelFolder(extra.type))
    .map((extra) => ({ folder: modelFolderKind(extra.type), dir: extra.dir }))
}

class ModelCollector {
  private readonly byKey = new Map<string, InstallModelEntry>()
  private readonly visitedDepth = new Map<string, number>()
  private scanned = 0
  private stoppedEarly = false

  constructor(
    private readonly deadline: number,
    readonly state: ScanState
  ) {}

  get full(): boolean {
    return this.scanned >= MAX_SCANNED_ENTRIES || Date.now() >= this.deadline
  }

  async sourcesInRoot(root: string): Promise<FolderSource[]> {
    const sources: FolderSource[] = []
    if (this.stopIfFull()) return sources
    const entries = await readDirOrEmpty(root, this.state)
    entries.sort((a, b) => compareText(a.name, b.name))
    for (const entry of entries) {
      if (this.stopIfFull()) return sources
      this.scanned += 1
      if (isSkippedEntry(entry.name) || isNonModelFolder(entry.name)) continue
      const dir = path.join(root, entry.name)
      const isDir =
        entry.isDirectory() ||
        (!entry.isFile() && (await statOrNull(dir, this.state))?.isDirectory() === true)
      if (!isDir) continue
      sources.push({ folder: modelFolderKind(entry.name), dir })
    }
    return sources
  }

  async collect(source: FolderSource): Promise<void> {
    if (!isSendableFolder(source.folder)) return
    await this.walk(source.folder, source.dir, [], 0)
  }

  result(): InstallModelList {
    const all = [...this.byKey.values()].sort(compareEntries)
    const models = takeAcrossFolders(all).sort(compareEntries)
    return {
      models,
      truncated: this.stoppedEarly || this.state.unreadable || models.length < all.length
    }
  }

  private stopIfFull(): boolean {
    if (!this.full) return false
    this.stoppedEarly = true
    return true
  }

  private async walk(
    folder: string,
    dir: string,
    segments: string[],
    depth: number
  ): Promise<void> {
    if (this.full) {
      this.stoppedEarly = true
      return
    }
    if (depth > MAX_MODEL_DIR_DEPTH) {
      this.stoppedEarly = true
      return
    }
    const real = await realpathOrNull(dir, this.state)
    if (real === null) return
    const visitKey = `${folder}\u0000${real}`
    const visitedAt = this.visitedDepth.get(visitKey)
    if (visitedAt !== undefined && visitedAt <= depth) return
    this.visitedDepth.set(visitKey, depth)

    const entries = await readDirOrEmpty(dir, this.state)
    entries.sort((a, b) => compareText(a.name, b.name))
    for (const entry of entries) {
      if (this.full) {
        this.stoppedEarly = true
        return
      }
      this.scanned += 1
      if (isSkippedEntry(entry.name)) continue
      const target = path.join(dir, entry.name)
      const childSegments = [...segments, entry.name]
      const stats =
        entry.isFile() || entry.isDirectory() ? null : await statOrNull(target, this.state)
      const isDir = entry.isDirectory() || stats?.isDirectory() === true
      if (isDir) {
        if (isNestedNonModelFolder(entry.name)) continue
        await this.walk(folder, target, childSegments, depth + 1)
        continue
      }
      if (!isModelFile(entry.name)) continue
      const fileStats = stats ?? (await statOrNull(target, this.state))
      if (!fileStats?.isFile()) continue
      this.add({ folder, name: childSegments.join('/'), size: fileStats.size })
    }
  }

  private add(entry: InstallModelEntry): void {
    if (!isSendableName(entry.name)) return
    const key = `${entry.folder}\u0000${entry.name}`
    if (this.byKey.has(key)) return
    this.byKey.set(key, entry)
  }
}

function compareEntries(a: InstallModelEntry, b: InstallModelEntry): number {
  return a.folder === b.folder ? compareText(a.name, b.name) : compareText(a.folder, b.folder)
}

function takeAcrossFolders(sorted: InstallModelEntry[]): InstallModelEntry[] {
  const byFolder = new Map<string, InstallModelEntry[]>()
  for (const entry of sorted) {
    const list = byFolder.get(entry.folder)
    if (list) list.push(entry)
    else byFolder.set(entry.folder, [entry])
  }
  const queues = [...byFolder.values()]
  const taken: InstallModelEntry[] = []
  let bytes = 0
  for (let round = 0; queues.some((queue) => round < queue.length); round++) {
    for (const queue of queues) {
      const entry = queue[round]
      if (!entry) continue
      const size = Buffer.byteLength(JSON.stringify(entry)) + 1
      if (taken.length >= MAX_INSTALL_MODELS || bytes + size > MAX_INSTALL_MODELS_BYTES) {
        return taken
      }
      taken.push(entry)
      bytes += size
    }
  }
  return taken
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function allArgValues(args: readonly string[], flag: string): string[] {
  const values: string[] = []
  for (const [i, arg] of args.entries()) {
    if (arg === flag) {
      for (let j = i + 1; j < args.length && !args[j]!.startsWith('--'); j++) values.push(args[j]!)
    } else if (arg.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1))
    }
  }
  return values.filter(Boolean)
}

export function withLaunchArgPaths(
  inst: InstallationRecord,
  search: InstallModelSearch
): InstallModelSearch {
  const args = parseArgs(typeof inst.launchArgs === 'string' ? inst.launchArgs : '')
  const resolve = (value: string): string => resolveFolderArg(value, () => comfyStartDir(inst))
  const baseDirectory = lastArgValue(args, '--base-directory')
  const modelsDirectory = lastArgValue(args, '--models-directory')
  const extraRoots = [
    ...(baseDirectory ? [path.join(resolve(baseDirectory), 'models')] : []),
    ...(modelsDirectory ? [resolve(modelsDirectory)] : [])
  ]
  const extraConfigs = allArgValues(args, '--extra-model-paths-config').map(resolve)
  return {
    ...search,
    modelRoots: [...search.modelRoots, ...extraRoots],
    extraPaths: [
      ...search.extraPaths,
      ...extraConfigs.flatMap((config) => resolveExtraModelPaths(config))
    ]
  }
}

const UNKNOWN_MODEL_LIST: InstallModelList = { models: [], truncated: true }

export async function listModelsInSearch(
  search: InstallModelSearch,
  timeBudgetMs = MODEL_LIST_TIME_BUDGET_MS
): Promise<InstallModelList> {
  const state: ScanState = { unreadable: false }
  const collector = new ModelCollector(Date.now() + timeBudgetMs, state)
  for (const root of search.modelRoots) {
    for (const source of await collector.sourcesInRoot(root)) {
      await collector.collect(source)
    }
  }
  for (const source of folderSourcesFromExtraPaths(search)) {
    await collector.collect(source)
  }
  if (state.unreadable) {
    console.warn(
      '[dev-platform] Some model folders could not be read; the models list is incomplete.'
    )
  }
  return collector.result()
}

export async function listInstallModels(
  inst: InstallationRecord,
  sharedModelsDirs: string[],
  timeBudgetMs = MODEL_LIST_TIME_BUDGET_MS
): Promise<InstallModelList> {
  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<InstallModelList>((resolve) => {
    timer = setTimeout(() => {
      console.warn('[dev-platform] Listing install models took too long; sending none.')
      resolve(UNKNOWN_MODEL_LIST)
    }, timeBudgetMs + MODEL_LIST_GRACE_MS)
  })
  try {
    const search = withLaunchArgPaths(inst, resolveInstallModelSearchPaths(inst, sharedModelsDirs))
    return await Promise.race([listModelsInSearch(search, timeBudgetMs), timedOut])
  } catch (err) {
    console.warn('[dev-platform] Could not list install models; sending none:', err)
    return UNKNOWN_MODEL_LIST
  } finally {
    clearTimeout(timer)
  }
}
