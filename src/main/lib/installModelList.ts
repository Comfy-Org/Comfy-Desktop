import fs from 'fs'
import path from 'path'
import {
  TEMP_DIR_NAME,
  isNonModelFolder,
  modelFolderKind,
  resolveInstallModelSearchPaths
} from './models'
import type { InstallModelSearch } from './models'
import type { InstallationRecord } from '../installations'

export interface InstallModelEntry {
  folder: string
  name: string
  size: number
}

export const MAX_INSTALL_MODELS = 2000
export const MAX_SCANNED_MODEL_FILES = 50_000
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

const FOLDER_KIND = /^[A-Za-z0-9_.-]{1,64}$/

interface FolderSource {
  folder: string
  dir: string
}

function isControlCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0
  return code < 0x20 || code === 0x7f
}

function isModelFile(name: string): boolean {
  return MODEL_FILE_EXTENSIONS.has(path.extname(name).toLowerCase())
}

function isSendableFolder(folder: string): boolean {
  return FOLDER_KIND.test(folder) && folder !== '.' && folder !== '..'
}

function isSendableName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_MODEL_NAME_LENGTH &&
    ![...name].some(isControlCharacter) &&
    !name.includes('\\') &&
    !name.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  )
}

function isSkippedEntry(name: string): boolean {
  return name.startsWith('.') || name === TEMP_DIR_NAME
}

async function statOrNull(target: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(target)
  } catch {
    return null
  }
}

async function readDirOrEmpty(dir: string): Promise<fs.Dirent[]> {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function folderSourcesInRoot(root: string): Promise<FolderSource[]> {
  const sources: FolderSource[] = []
  for (const entry of await readDirOrEmpty(root)) {
    if (isSkippedEntry(entry.name) || isNonModelFolder(entry.name)) continue
    const dir = path.join(root, entry.name)
    const isDir =
      entry.isDirectory() || (entry.isSymbolicLink() && (await statOrNull(dir))?.isDirectory())
    if (!isDir) continue
    sources.push({ folder: modelFolderKind(entry.name), dir })
  }
  return sources
}

function folderSourcesFromExtraPaths(search: InstallModelSearch): FolderSource[] {
  return search.extraPaths
    .filter((extra) => !isNonModelFolder(extra.type))
    .map((extra) => ({ folder: modelFolderKind(extra.type), dir: extra.dir }))
}

class ModelCollector {
  private readonly byKey = new Map<string, InstallModelEntry>()
  private readonly visitedDirs = new Set<string>()
  private scanned = 0

  get full(): boolean {
    return this.scanned >= MAX_SCANNED_MODEL_FILES
  }

  async collect(source: FolderSource): Promise<void> {
    if (!isSendableFolder(source.folder)) return
    await this.walk(source.folder, source.dir, [], 0)
  }

  entries(): InstallModelEntry[] {
    return [...this.byKey.values()]
      .sort((a, b) =>
        a.folder === b.folder ? compareText(a.name, b.name) : compareText(a.folder, b.folder)
      )
      .slice(0, MAX_INSTALL_MODELS)
  }

  private async walk(
    folder: string,
    dir: string,
    segments: string[],
    depth: number
  ): Promise<void> {
    if (this.full || depth > MAX_MODEL_DIR_DEPTH) return
    let real: string
    try {
      real = await fs.promises.realpath(dir)
    } catch {
      return
    }
    const visitKey = `${folder}\u0000${real}`
    if (this.visitedDirs.has(visitKey)) return
    this.visitedDirs.add(visitKey)

    const entries = await readDirOrEmpty(dir)
    entries.sort((a, b) => compareText(a.name, b.name))
    for (const entry of entries) {
      if (this.full) return
      if (isSkippedEntry(entry.name)) continue
      const target = path.join(dir, entry.name)
      const childSegments = [...segments, entry.name]
      const stats = entry.isFile() || entry.isDirectory() ? null : await statOrNull(target)
      const isDir = entry.isDirectory() || stats?.isDirectory() === true
      if (isDir) {
        await this.walk(folder, target, childSegments, depth + 1)
        continue
      }
      if (!isModelFile(entry.name)) continue
      const fileStats = stats ?? (await statOrNull(target))
      if (!fileStats?.isFile()) continue
      this.scanned += 1
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

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export async function listModelsInSearch(search: InstallModelSearch): Promise<InstallModelEntry[]> {
  const collector = new ModelCollector()
  for (const root of search.modelRoots) {
    for (const source of await folderSourcesInRoot(root)) {
      await collector.collect(source)
    }
  }
  for (const source of folderSourcesFromExtraPaths(search)) {
    await collector.collect(source)
  }
  return collector.entries()
}

export async function listInstallModels(
  inst: InstallationRecord,
  sharedModelsDirs: string[]
): Promise<InstallModelEntry[]> {
  try {
    return await listModelsInSearch(resolveInstallModelSearchPaths(inst, sharedModelsDirs))
  } catch {
    return []
  }
}
