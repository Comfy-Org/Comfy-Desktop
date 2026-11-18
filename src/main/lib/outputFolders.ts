import fs from 'fs'
import fsp from 'fs/promises'
import type { Dirent } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { ipcMain, nativeImage, net, protocol, shell } from 'electron'
import * as installations from '../installations'
import type { InstallationRecord } from '../installations'
import * as settings from '../settings'
import type { ComfyOutputFile } from '../apps/outputRequest'
import { assetKind } from './assets'
import { copyImageToClipboard } from './clipboardImage'
import { mediaFactsFromFile } from './mediaFacts'
import { runPool } from '../sources/standalone/templateDownloadCore'
import { installInputDir, installOutputDir } from './models'
import { _runningSessions, sourceMap } from './ipc/shared'
import type { AssetSummary, LocalAssetListing } from '../../types/ipc'

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
const READ_WITHOUT_FOLLOWING =
  fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)

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

export function hasOutputFolder(inst: InstallationRecord): boolean {
  const source = sourceMap[inst.sourceId]
  return source?.category === 'local' && !source.managesOwnPaths
}

function outputDirFor(inst: InstallationRecord, sharedDir: string): string | null {
  if (!hasOutputFolder(inst)) return null
  return outputDirOverride(inst, sharedDir) ?? installOutputDir(inst.installPath)
}

export function sharedInputDir(): string {
  return (settings.get('inputDir') as string | undefined) || settings.defaults.inputDir
}

function inputDirFor(inst: InstallationRecord): string | null {
  if (!hasOutputFolder(inst)) return null
  if ((inst.useSharedInput as boolean | undefined) !== false) return sharedInputDir()
  return (inst.inputDir as string | undefined) || installInputDir(inst.installPath)
}

export interface ComfyFolders {
  output: string | null
  input: string | null
}

const NO_FOLDERS: ComfyFolders = { output: null, input: null }

function lastArgValue(args: readonly string[], flag: string): string | null {
  let value: string | undefined
  for (const [i, arg] of args.entries()) {
    if (arg === flag) value = args[i + 1]
    else if (arg.startsWith(`${flag}=`)) value = arg.slice(flag.length + 1)
  }
  return value || null
}

export function launchFoldersOf(
  inst: InstallationRecord,
  launch: { args?: readonly string[]; skipSharedPaths?: boolean }
): ComfyFolders {
  if (launch.skipSharedPaths || !launch.args || !hasOutputFolder(inst)) return NO_FOLDERS
  return {
    output: lastArgValue(launch.args, '--output-directory') ?? installOutputDir(inst.installPath),
    input: lastArgValue(launch.args, '--input-directory') ?? installInputDir(inst.installPath)
  }
}

export function comfyFoldersOf(inst: InstallationRecord | null): ComfyFolders {
  if (!inst) return { output: sharedOutputDir(), input: sharedInputDir() }
  const running = _runningSessions.get(inst.id)
  if (running) return running.launchFolders ?? NO_FOLDERS
  return { output: outputDirFor(inst, sharedOutputDir()), input: inputDirFor(inst) }
}

async function realDir(dir: string): Promise<string | null> {
  const real = await fsp.realpath(dir).catch(() => null)
  if (!real) return null
  const stat = await fsp.stat(real).catch(() => null)
  return stat?.isDirectory() ? real : null
}

interface OutputFolders {
  all: string[]
  shared: string | null
  ofBuild: Map<string, string>
}

async function findOutputFolders(): Promise<OutputFolders> {
  const sharedDir = sharedOutputDir()
  const shared = await realDir(sharedDir)
  const ofBuild = new Map<string, string>()
  for (const inst of await installations.list()) {
    const dir = outputDirFor(inst, sharedDir)
    const real = dir ? await realDir(dir) : null
    if (real) ofBuild.set(inst.id, real)
  }
  const all = [...new Set([...(shared ? [shared] : []), ...ofBuild.values()])]
  allowedRoots = all
  allowedRootsAt = Date.now()
  return { all, shared, ofBuild }
}

export async function listOutputFolders(): Promise<string[]> {
  return (await findOutputFolders()).all
}

function isInsideRoot(target: string, root: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function allowedPath(target: string): Promise<string | null> {
  if (!path.isAbsolute(target)) return null
  if (Date.now() - allowedRootsAt > ROOTS_FRESH_MS) await findOutputFolders()
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

async function hasSameBytes(file: string, bytes: Uint8Array): Promise<boolean> {
  const stat = await fsp.stat(file).catch(() => null)
  if (!stat?.isFile() || stat.size !== bytes.byteLength) return false
  const handle = await fsp.open(file, READ_WITHOUT_FOLLOWING).catch(() => null)
  if (!handle) return false
  try {
    const content = Buffer.alloc(bytes.byteLength + 1)
    const { bytesRead } = await handle.read(content, 0, content.length, 0)
    const expected = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return bytesRead === bytes.byteLength && expected.equals(content.subarray(0, bytesRead))
  } catch {
    return false
  } finally {
    await handle.close().catch(() => {})
  }
}

export async function comfyOutputPath(
  inst: InstallationRecord,
  file: ComfyOutputFile,
  bytes: Uint8Array
): Promise<string | null> {
  const dir = outputDirFor(inst, sharedOutputDir())
  const root = dir ? await realDir(dir) : null
  if (!root) return null
  const real = await allowedPath(path.join(root, file.subfolder, file.filename))
  if (!real || !isInsideRoot(real, root)) return null
  return (await hasSameBytes(real, bytes)) ? real : null
}

export async function revealOutputFile(target: string): Promise<boolean> {
  const file = await outputFilePath(target)
  if (!file) return false
  shell.showItemInFolder(file)
  return true
}

export async function trashOutputFile(target: string): Promise<boolean> {
  const file = await outputFilePath(target)
  if (!file) return false
  await shell.trashItem(file)
  return true
}

export async function copyOutputImage(target: string): Promise<boolean> {
  const file = await outputFilePath(target)
  if (!file || assetKind(file) !== 'image') return false
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) return false
  await copyImageToClipboard(image)
  return true
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
    height: null,
    durationSeconds: null
  }
}

async function addMediaFacts(asset: AssetSummary): Promise<void> {
  Object.assign(asset, await mediaFactsFromFile(asset.id, asset.kind))
}

export async function listLocalAssets(installationId?: string): Promise<LocalAssetListing> {
  const folders = await findOutputFolders()
  const folder = installationId === undefined ? folders.shared : folders.ofBuild.get(installationId)
  const files = folder ? await collectMediaFiles(folder) : []
  const found: AssetSummary[] = []
  await runPool(files, STATS_AT_ONCE, async (file) => {
    const stat = await fsp.lstat(file).catch(() => null)
    if (!stat?.isFile()) return
    const modifiedMs = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0
    found.push(localSummary(file, stat.size, modifiedMs))
  })
  const newest = found
    .sort((a, b) => b.createdAt!.localeCompare(a.createdAt!))
    .slice(0, MAX_LOCAL_ASSETS)
  await runPool(newest, STATS_AT_ONCE, addMediaFacts)
  return {
    assets: newest,
    truncated: found.length > MAX_LOCAL_ASSETS
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

async function makeThumbnail(
  file: string,
  sizeBytes: number,
  longSide: number
): Promise<Buffer | null> {
  const size = { width: longSide, height: longSide }
  const image =
    process.platform === 'linux'
      ? linuxThumbnailSource(file, sizeBytes)
      : await nativeImage.createThumbnailFromPath(file, size).catch(() => null)
  return image ? scaledJpeg(image, longSide) : null
}

function scaledJpeg(image: Electron.NativeImage, longSide: number): Buffer | null {
  if (image.isEmpty()) return null
  const { width, height } = image.getSize()
  const scale = Math.min(1, longSide / Math.max(width, height))
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

async function thumbnailFor(file: string, longSide = THUMBNAIL_SIZE): Promise<Buffer | null> {
  const stat = await fsp.stat(file).catch(() => null)
  if (!stat) return null
  const key = `${file}\n${stat.mtimeMs}\n${longSide}`
  const cached = thumbnails.get(key)
  if (cached) return cached
  let making = thumbnailsInFlight.get(key)
  if (!making) {
    making = fewAtATime(() => makeThumbnail(file, stat.size, longSide))
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

function jpegDataUrl(jpeg: Buffer | null): string | null {
  return jpeg ? `data:image/jpeg;base64,${jpeg.toString('base64')}` : null
}

export async function thumbnailDataUrl(file: string, longSide: number): Promise<string | null> {
  return jpegDataUrl(await thumbnailFor(file, longSide))
}

export function thumbnailDataUrlFromBytes(bytes: Uint8Array, longSide: number): string | null {
  try {
    return jpegDataUrl(scaledJpeg(nativeImage.createFromBuffer(Buffer.from(bytes)), longSide))
  } catch {
    return null
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
  ipcMain.handle(LIST_LOCAL_CHANNEL, (_event, installationId: unknown) =>
    listLocalAssets(typeof installationId === 'string' ? installationId : undefined)
  )
}
