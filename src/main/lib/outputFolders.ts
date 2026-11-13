import fsp from 'fs/promises'
import type { Dirent } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { ipcMain, nativeImage, net, protocol } from 'electron'
import { imageSizeFromFile } from 'image-size/fromFile'
import * as installations from '../installations'
import type { InstallationRecord } from '../installations'
import * as settings from '../settings'
import { assetKind } from './assets'
import { runPool } from '../sources/standalone/templateDownloadCore'
import { installOutputDir } from './models'
import { sourceMap } from './ipc/shared'
import type { AssetSummary } from '../../types/ipc'

export const OUTPUT_FILES_SCHEME = 'comfy-output'

const LIST_LOCAL_CHANNEL = 'assets:list-local'
export const MAX_LOCAL_ASSETS = 500
export const MAX_FOLDER_DEPTH = 6
const THUMBNAIL_SIZE = 480
const MAX_CACHED_THUMBNAILS = 400
const THUMBNAILS_AT_ONCE = 2
export const THUMBNAIL_WAIT_MS = 1500
const STATS_AT_ONCE = 32
const ROOTS_FRESH_MS = 5000
const MAX_LINUX_THUMBNAIL_SOURCE_BYTES = 40 * 1024 * 1024
const SERVED_KINDS = new Set(['image', 'video', 'audio'])
const FIRST_SIDEWAYS_EXIF_ORIENTATION = 5

const thumbnails = new Map<string, Buffer>()
const thumbnailsInFlight = new Map<string, Promise<Buffer | null>>()
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

export async function listOutputFolders(): Promise<string[]> {
  const shared = sharedOutputDir()
  const folders = new Set<string>()
  const sharedReal = await realDir(shared)
  if (sharedReal) folders.add(sharedReal)
  for (const inst of await installations.list()) {
    const dir = outputDirFor(inst, shared)
    const real = dir ? await realDir(dir) : null
    if (real) folders.add(real)
  }
  allowedRoots = [...folders]
  allowedRootsAt = Date.now()
  return allowedRoots
}

function isInsideRoot(target: string, root: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function allowedPath(target: string): Promise<string | null> {
  if (!path.isAbsolute(target)) return null
  if (Date.now() - allowedRootsAt > ROOTS_FRESH_MS) await listOutputFolders()
  const real = await fsp.realpath(target).catch(() => null)
  if (!real) return null
  return allowedRoots.some((root) => isInsideRoot(real, root)) ? real : null
}

export async function outputFilePath(target: string): Promise<string | null> {
  const file = await allowedPath(target)
  if (!file) return null
  const stat = await fsp.stat(file).catch(() => null)
  return stat?.isFile() ? file : null
}

export function outputFileUrl(file: string, thumbnailOf?: number): string {
  const url = `${OUTPUT_FILES_SCHEME}://file/${encodeURIComponent(file)}`
  return thumbnailOf === undefined ? url : `${url}?thumbnail=${Math.round(thumbnailOf)}`
}

async function collectMediaFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    const dirents: Dirent[] = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
    const subfolders: string[] = []
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.')) continue
      const full = path.join(dir, dirent.name)
      if (dirent.isDirectory()) subfolders.push(full)
      else if (dirent.isFile() && assetKind(dirent.name) !== null) files.push(full)
    }
    if (depth < MAX_FOLDER_DEPTH) {
      for (const sub of subfolders) await walk(sub, depth + 1)
    }
  }
  await walk(root, 0)
  return files
}

function localSummary(file: string, sizeBytes: number, modifiedMs: number): AssetSummary {
  const kind = assetKind(file)
  return {
    id: file,
    name: path.basename(file),
    kind,
    sizeBytes,
    createdAt: new Date(modifiedMs).toISOString(),
    mimeType: null,
    tags: ['output'],
    previewUrl: kind && SERVED_KINDS.has(kind) ? outputFileUrl(file) : null,
    thumbnailUrl: kind === 'image' ? outputFileUrl(file, modifiedMs) : null,
    width: null,
    height: null
  }
}

async function addPixelSize(asset: AssetSummary): Promise<void> {
  if (asset.kind !== 'image') return
  const size = await imageSizeFromFile(asset.id).catch(() => null)
  if (!size?.width || !size.height) return
  const sideways = (size.orientation ?? 0) >= FIRST_SIDEWAYS_EXIF_ORIENTATION
  asset.width = sideways ? size.height : size.width
  asset.height = sideways ? size.width : size.height
}

export async function listLocalAssets(): Promise<AssetSummary[]> {
  const folders = await listOutputFolders()
  const files = [...new Set((await Promise.all(folders.map(collectMediaFiles))).flat())]
  const found: AssetSummary[] = []
  await runPool(files, STATS_AT_ONCE, async (file) => {
    const stat = await fsp.stat(file).catch(() => null)
    if (!stat?.isFile()) return
    const modifiedMs = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0
    found.push(localSummary(file, stat.size, modifiedMs))
  })
  const newest = found
    .sort((a, b) => b.createdAt!.localeCompare(a.createdAt!))
    .slice(0, MAX_LOCAL_ASSETS)
  await runPool(newest, STATS_AT_ONCE, addPixelSize)
  return newest
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
  let making = thumbnailsInFlight.get(key)
  if (!making) {
    making = fewAtATime(() => makeThumbnail(file, stat.size))
      .then((made) => {
        if (made) {
          thumbnails.set(key, made)
          if (thumbnails.size > MAX_CACHED_THUMBNAILS)
            thumbnails.delete(thumbnails.keys().next().value!)
        }
        return made
      })
      .catch(() => null)
      .finally(() => thumbnailsInFlight.delete(key))
    thumbnailsInFlight.set(key, making)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const tooSlow = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), THUMBNAIL_WAIT_MS)
  })
  try {
    return await Promise.race([making, tooSlow])
  } finally {
    clearTimeout(timer)
  }
}

function decodedPath(url: URL): string | null {
  if (url.host !== 'file') return null
  try {
    return decodeURIComponent(url.pathname.slice(1))
  } catch {
    return null
  }
}

function notFound(): Response {
  return new Response(null, { status: 404 })
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

export async function serveOutputFile(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const target = decodedPath(url)
  const kind = target ? assetKind(target) : null
  const file = target && kind && SERVED_KINDS.has(kind) ? await allowedPath(target) : null
  if (!file) return notFound()
  if (!url.searchParams.has('thumbnail')) return fetchFile(file, request)
  const jpeg = await thumbnailFor(file)
  if (!jpeg) return fetchFile(file, request)
  return new Response(new Uint8Array(jpeg), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    }
  })
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
  ipcMain.handle(LIST_LOCAL_CHANNEL, () => listLocalAssets())
}
