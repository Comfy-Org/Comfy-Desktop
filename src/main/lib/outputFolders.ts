import fsp from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'
import { ipcMain, nativeImage, net, protocol } from 'electron'
import * as installations from '../installations'
import type { InstallationRecord } from '../installations'
import * as settings from '../settings'
import { isInside } from '../apps/guards'
import { assetKind } from './assets'
import { installOutputDir } from './models'
import { sourceMap } from './ipc/shared'
import type { OutputFolder, OutputFolderListing } from '../../types/ipc'

export const OUTPUT_FILES_SCHEME = 'comfy-output'

const LIST_FOLDERS_CHANNEL = 'assets:output-folders'
const LIST_FOLDER_CHANNEL = 'assets:output-folder'
export const MAX_FILES = 2000
const THUMBNAIL_SIZE = 480
const MAX_CACHED_THUMBNAILS = 400
const THUMBNAILS_AT_ONCE = 2

const thumbnails = new Map<string, Buffer>()
const thumbnailQueue: (() => void)[] = []
let thumbnailsRunning = 0
let allowedRoots: string[] = []

export function sharedOutputDir(): string {
  return (settings.get('outputDir') as string | undefined) || settings.defaults.outputDir
}

export function outputDirOverride(inst: InstallationRecord, sharedDir: string): string | null {
  if ((inst.useSharedOutput as boolean | undefined) !== false) return sharedDir
  return (inst.outputDir as string | undefined) || null
}

function outputDirFor(inst: InstallationRecord, sharedDir: string): string | null {
  const source = sourceMap[inst.sourceId]
  if (source?.category !== 'local' || source.getLaunchCommand(inst)?.skipSharedPaths) return null
  return outputDirOverride(inst, sharedDir) ?? installOutputDir(inst.installPath)
}

async function realDir(dir: string): Promise<string | null> {
  const real = await fsp.realpath(dir).catch(() => null)
  if (!real) return null
  const stat = await fsp.stat(real).catch(() => null)
  return stat?.isDirectory() ? real : null
}

export async function listOutputFolders(): Promise<OutputFolder[]> {
  const shared = sharedOutputDir()
  const sharedReal = await realDir(shared)
  const byPath = new Map<string, OutputFolder>()
  if (sharedReal) byPath.set(sharedReal, { path: sharedReal, shared: true, builds: [] })
  for (const inst of await installations.list()) {
    const dir = outputDirFor(inst, shared)
    const real = dir ? await realDir(dir) : null
    if (!real) continue
    const folder = byPath.get(real) ?? { path: real, shared: false, builds: [] }
    folder.builds.push(inst.name)
    byPath.set(real, folder)
  }
  allowedRoots = [...byPath.keys()]
  return [...byPath.values()]
}

async function allowedPath(target: string): Promise<string | null> {
  if (!path.isAbsolute(target)) return null
  if (allowedRoots.length === 0) await listOutputFolders()
  const real = await fsp.realpath(target).catch(() => null)
  if (!real) return null
  return allowedRoots.some((root) => real === root || isInside(real, root, path.sep)) ? real : null
}

export function outputFileUrl(file: string, thumbnailOf?: number): string {
  const url = `${OUTPUT_FILES_SCHEME}://file/${encodeURIComponent(file)}`
  return thumbnailOf === undefined ? url : `${url}?thumbnail=${Math.round(thumbnailOf)}`
}

export async function listOutputFolder(target: unknown): Promise<OutputFolderListing | null> {
  if (typeof target !== 'string') return null
  const dir = await allowedPath(target)
  if (!dir) return null
  const names = await fsp.readdir(dir, { withFileTypes: true }).catch(() => null)
  if (!names) return null
  const entries = await Promise.all(
    names
      .filter((dirent) => !dirent.name.startsWith('.'))
      .map(async (dirent) => {
        const full = path.join(dir, dirent.name)
        const stat = await fsp.stat(full).catch(() => null)
        if (!stat) return null
        const isFolder = stat.isDirectory()
        const kind = isFolder ? null : assetKind(dirent.name)
        if (!isFolder && !kind) return null
        const previewable = kind === 'image' || kind === 'video' || kind === 'audio'
        return {
          name: dirent.name,
          path: full,
          isFolder,
          kind,
          sizeBytes: isFolder ? null : stat.size,
          modifiedAt: stat.mtime.toISOString(),
          previewUrl: previewable ? outputFileUrl(full) : null,
          thumbnailUrl:
            kind === 'image' || kind === 'video' ? outputFileUrl(full, stat.mtimeMs) : null
        }
      })
  )
  const found = entries.filter((entry) => entry !== null)
  const files = found
    .filter((entry) => !entry.isFolder)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  return {
    entries: [...found.filter((entry) => entry.isFolder), ...files.slice(0, MAX_FILES)],
    truncated: files.length > MAX_FILES
  }
}

async function makeThumbnail(file: string): Promise<Buffer | null> {
  const size = { width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }
  const image =
    process.platform === 'linux'
      ? nativeImage.createFromPath(file)
      : await nativeImage.createThumbnailFromPath(file, size).catch(() => null)
  if (!image || image.isEmpty()) return null
  const { width } = image.getSize()
  const scaled = width > THUMBNAIL_SIZE ? image.resize({ width: THUMBNAIL_SIZE }) : image
  return scaled.toJPEG(82)
}

async function fewAtATime<T>(work: () => Promise<T>): Promise<T> {
  if (thumbnailsRunning >= THUMBNAILS_AT_ONCE)
    await new Promise<void>((resolve) => thumbnailQueue.push(resolve))
  thumbnailsRunning++
  try {
    return await work()
  } finally {
    thumbnailsRunning--
    thumbnailQueue.shift()?.()
  }
}

async function thumbnailFor(file: string): Promise<Buffer | null> {
  const stat = await fsp.stat(file).catch(() => null)
  if (!stat) return null
  const key = `${file}\n${stat.mtimeMs}`
  const cached = thumbnails.get(key)
  if (cached) return cached
  const made = await fewAtATime(() => makeThumbnail(file))
  if (!made) return null
  thumbnails.set(key, made)
  if (thumbnails.size > MAX_CACHED_THUMBNAILS) thumbnails.delete(thumbnails.keys().next().value!)
  return made
}

export async function serveOutputFile(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const file =
    url.host === 'file' ? await allowedPath(decodeURIComponent(url.pathname.slice(1))) : null
  if (!file) return new Response(null, { status: 404 })
  if (!url.searchParams.has('thumbnail')) {
    return net.fetch(pathToFileURL(file).toString(), { headers: request.headers })
  }
  const jpeg = await thumbnailFor(file)
  return jpeg
    ? new Response(new Uint8Array(jpeg), {
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' }
      })
    : new Response(null, { status: 404 })
}

export function registerOutputFilesScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: OUTPUT_FILES_SCHEME,
      privileges: { standard: true, secure: true, stream: true }
    }
  ])
}

export function registerOutputFolderHandlers(): void {
  protocol.handle(OUTPUT_FILES_SCHEME, serveOutputFile)
  ipcMain.handle(LIST_FOLDERS_CHANNEL, () => listOutputFolders())
  ipcMain.handle(LIST_FOLDER_CHANNEL, (_event, target: unknown) => listOutputFolder(target))
}
