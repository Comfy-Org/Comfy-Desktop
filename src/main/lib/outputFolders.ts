import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'
import { ipcMain, nativeImage, net, protocol } from 'electron'
import * as installations from '../installations'
import type { InstallationRecord } from '../installations'
import * as settings from '../settings'
import { isInside } from '../apps/guards'
import type { ComfyOutputFile } from '../apps/outputs'
import { assetKind } from './assets'
import { runPool } from '../sources/standalone/templateDownloadCore'
import { installOutputDir } from './models'
import { sourceMap } from './ipc/shared'
import type { OutputEntry, OutputFolder, OutputFolderListing } from '../../types/ipc'

export const OUTPUT_FILES_SCHEME = 'comfy-output'

const LIST_FOLDERS_CHANNEL = 'assets:output-folders'
const LIST_FOLDER_CHANNEL = 'assets:output-folder'
export const MAX_FILES = 2000
const THUMBNAIL_SIZE = 480
const MAX_CACHED_THUMBNAILS = 400
const THUMBNAILS_AT_ONCE = 2
const STATS_AT_ONCE = 32
const ROOTS_FRESH_MS = 5000
const MAX_LINUX_THUMBNAIL_SOURCE_BYTES = 40 * 1024 * 1024
const SERVED_KINDS = new Set(['image', 'video', 'audio'])
const MAX_MATCH_ENTRIES = 5000
const MAX_MATCH_DEPTH = 4
const APPS_OUTPUT_FOLDER = 'apps'
const MAX_SAME_SIZE_FILES = 4

const thumbnails = new Map<string, Buffer>()
const thumbnailQueue: (() => void)[] = []
let thumbnailsRunning = 0
let allowedRoots: string[] = []
let allowedRootsAt = 0

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
  allowedRootsAt = Date.now()
  return [...byPath.values()]
}

export async function allowedPath(target: string): Promise<string | null> {
  if (!path.isAbsolute(target)) return null
  if (Date.now() - allowedRootsAt > ROOTS_FRESH_MS) await listOutputFolders()
  const real = await fsp.realpath(target).catch(() => null)
  if (!real) return null
  return allowedRoots.some((root) => real === root || isInside(real, root, path.sep)) ? real : null
}

async function buildOutputRoot(inst: InstallationRecord): Promise<string | null> {
  const dir = outputDirFor(inst, sharedOutputDir())
  return dir ? realDir(dir) : null
}

const READ_SAFELY =
  fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)

async function hasBytes(file: string, wanted: Buffer): Promise<boolean> {
  const handle = await fsp.open(file, READ_SAFELY).catch(() => null)
  if (!handle) return false
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size !== wanted.byteLength) return false
    const content = Buffer.alloc(wanted.byteLength)
    let read = 0
    while (read < content.byteLength) {
      const { bytesRead } = await handle.read(content, read, content.byteLength - read, read)
      if (bytesRead === 0) return false
      read += bytesRead
    }
    return content.equals(wanted)
  } catch {
    return false
  } finally {
    await handle.close().catch(() => {})
  }
}

async function checkedOutput(root: string, file: string, wanted: Buffer): Promise<string | null> {
  const real = await allowedPath(file)
  if (!real || !isInside(real, root, path.sep)) return null
  return (await hasBytes(real, wanted)) ? real : null
}

const asBuffer = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

export async function comfyOutputPath(
  inst: InstallationRecord,
  file: ComfyOutputFile,
  bytes: Uint8Array
): Promise<string | null> {
  const root = await buildOutputRoot(inst)
  if (!root) return null
  return checkedOutput(root, path.join(root, file.subfolder, file.filename), asBuffer(bytes))
}

async function filesBySize(
  root: string,
  stillWanted: () => boolean
): Promise<Map<number, string[]>> {
  const bySize = new Map<number, string[]>()
  const appsDir = path.join(root, APPS_OUTPUT_FOLDER)
  const walk = async (start: string, startDepth: number): Promise<void> => {
    const queue = [{ dir: start, depth: startDepth }]
    let seen = 0
    while (queue.length > 0 && seen < MAX_MATCH_ENTRIES && stillWanted()) {
      const { dir, depth } = queue.shift()!
      const dirents = (await fsp.readdir(dir, { withFileTypes: true }).catch(() => []))
        .filter((dirent) => !dirent.name.startsWith('.'))
        .slice(0, MAX_MATCH_ENTRIES - seen)
      seen += dirents.length
      for (const dirent of dirents) {
        const full = path.join(dir, dirent.name)
        if (dirent.isDirectory() && depth < MAX_MATCH_DEPTH && full !== appsDir)
          queue.push({ dir: full, depth: depth + 1 })
      }
      const files = dirents.filter((dirent) => dirent.isFile())
      await runPool(files, STATS_AT_ONCE, async (dirent) => {
        const full = path.join(dir, dirent.name)
        const stat = await fsp.stat(full).catch(() => null)
        if (stat) bySize.set(stat.size, [...(bySize.get(stat.size) ?? []), full])
      })
    }
  }
  const appsStat = await fsp.lstat(appsDir).catch(() => null)
  if (appsStat?.isDirectory()) await walk(appsDir, 1)
  await walk(root, 0)
  return bySize
}

function outputMatcher(
  inst: InstallationRecord,
  stillWanted: () => boolean
): (bytes: Uint8Array) => Promise<string | null> {
  let scan: Promise<{ root: string; bySize: Map<number, string[]> } | null> | null = null
  return async (bytes) => {
    if (bytes.byteLength === 0 || !stillWanted()) return null
    scan ??= buildOutputRoot(inst).then(async (root) =>
      root ? { root, bySize: await filesBySize(root, stillWanted) } : null
    )
    const found = await scan
    if (!found) return null
    const wanted = asBuffer(bytes)
    const candidates = (found.bySize.get(bytes.byteLength) ?? []).slice(0, MAX_SAME_SIZE_FILES)
    for (const file of candidates) {
      if (!stillWanted()) return null
      const real = await checkedOutput(found.root, file, wanted)
      if (real) return real
    }
    return null
  }
}

export function outputLocator(
  inst: InstallationRecord,
  stillWanted: () => boolean = () => true
): (file: ComfyOutputFile | null, bytes: Uint8Array) => Promise<string | null> {
  const sameBytes = outputMatcher(inst, stillWanted)
  return async (file, bytes) =>
    (file ? await comfyOutputPath(inst, file, bytes) : null) ?? sameBytes(bytes)
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
  const candidates = names.filter(
    (dirent) =>
      !dirent.name.startsWith('.') &&
      (dirent.isDirectory() || dirent.isSymbolicLink() || assetKind(dirent.name) !== null)
  )
  const found: OutputEntry[] = []
  await runPool(candidates, STATS_AT_ONCE, async (dirent) => {
    const full = path.join(dir, dirent.name)
    const stat = await fsp.stat(full).catch(() => null)
    if (!stat) return
    const isFolder = stat.isDirectory()
    const kind = isFolder ? null : assetKind(dirent.name)
    if (!isFolder && !kind) return
    const modifiedMs = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0
    found.push({
      name: dirent.name,
      path: full,
      isFolder,
      kind,
      sizeBytes: isFolder ? null : stat.size,
      modifiedAt: new Date(modifiedMs).toISOString(),
      previewUrl: kind && SERVED_KINDS.has(kind) ? outputFileUrl(full) : null,
      thumbnailUrl: kind === 'image' || kind === 'video' ? outputFileUrl(full, modifiedMs) : null
    })
  })
  const files = found
    .filter((entry) => !entry.isFolder)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  return {
    entries: [...found.filter((entry) => entry.isFolder), ...files.slice(0, MAX_FILES)],
    truncated: files.length > MAX_FILES
  }
}

function linuxThumbnailSource(file: string, sizeBytes: number): Electron.NativeImage | null {
  if (assetKind(file) !== 'image' || sizeBytes > MAX_LINUX_THUMBNAIL_SOURCE_BYTES) return null
  try {
    return nativeImage.createFromPath(file)
  } catch {
    return null
  }
}

async function makeThumbnail(file: string, sizeBytes: number): Promise<Buffer | null> {
  const size = { width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }
  const image =
    process.platform === 'linux'
      ? linuxThumbnailSource(file, sizeBytes)
      : await nativeImage.createThumbnailFromPath(file, size).catch(() => null)
  if (!image || image.isEmpty()) return null
  const { width, height } = image.getSize()
  const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(width, height))
  const scaled =
    scale < 1
      ? image.resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale))
        })
      : image
  const jpeg = scaled.toJPEG(82)
  return jpeg.length > 0 ? jpeg : null
}

async function fewAtATime<T>(work: () => Promise<T>): Promise<T> {
  while (thumbnailsRunning >= THUMBNAILS_AT_ONCE)
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
  const made = await fewAtATime(() => makeThumbnail(file, stat.size))
  if (!made) return null
  thumbnails.set(key, made)
  if (thumbnails.size > MAX_CACHED_THUMBNAILS) thumbnails.delete(thumbnails.keys().next().value!)
  return made
}

function decodedPath(url: URL): string | null {
  if (url.host !== 'file') return null
  try {
    return decodeURIComponent(url.pathname.slice(1))
  } catch {
    return null
  }
}

async function fetchFile(file: string, request: Request): Promise<Response> {
  const res = await net
    .fetch(pathToFileURL(file).toString(), { headers: request.headers })
    .catch(() => null)
  if (!res) return notFound()
  const headers = new Headers(res.headers)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Content-Security-Policy', 'sandbox')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

function notFound(): Response {
  return new Response(null, { status: 404 })
}

export async function serveOutputFile(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const target = decodedPath(url)
  const kind = target ? assetKind(target) : null
  const file = target && kind && SERVED_KINDS.has(kind) ? await allowedPath(target) : null
  if (!file) return notFound()
  if (!url.searchParams.has('thumbnail')) return fetchFile(file, request)
  const jpeg = await thumbnailFor(file)
  return jpeg
    ? new Response(new Uint8Array(jpeg), {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff'
        }
      })
    : notFound()
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
