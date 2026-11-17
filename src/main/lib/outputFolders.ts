import fsp from 'fs/promises'
import type { Dirent } from 'fs'
import type { FileHandle } from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'
import { ipcMain, nativeImage, net, protocol, shell } from 'electron'
import * as installations from '../installations'
import type { InstallationRecord } from '../installations'
import * as settings from '../settings'
import { assetKind } from './assets'
import { copyImageToClipboard } from './clipboardImage'
import { mediaFactsFromFile } from './mediaFacts'
import {
  outputAssetId,
  outputReference,
  outputRevision,
  readOutputProvenance
} from './outputProvenance'
import { runPool } from '../sources/standalone/templateDownloadCore'
import { installOutputDir } from './models'
import { sourceMap } from './ipc/shared'
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

async function realDir(dir: string): Promise<string | null> {
  const real = await fsp.realpath(dir).catch(() => null)
  if (!real) return null
  const stat = await fsp.stat(real).catch(() => null)
  return stat?.isDirectory() ? real : null
}

interface OutputFolders {
  all: string[]
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
  return { all, ofBuild }
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
  const reference = outputReference(target)
  if (!reference) return null
  const file = await allowedPath(reference.file)
  if (!file) return null
  const stat = await fsp.stat(file, { bigint: true }).catch(() => null)
  if (!stat?.isFile()) return null
  return reference.revision === undefined || outputRevision(stat) === reference.revision
    ? file
    : null
}

export async function openOutputFile(target: string): Promise<FileHandle | null> {
  const reference = outputReference(target)
  if (!reference) return null
  const file = await allowedPath(reference.file)
  if (!file) return null
  const handle = await fsp.open(file, 'r').catch(() => null)
  if (!handle) return null
  const stat = await handle.stat({ bigint: true }).catch(() => null)
  if (
    stat?.isFile() &&
    (reference.revision === undefined || outputRevision(stat) === reference.revision)
  )
    return handle
  await handle.close()
  return null
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
  if (outputReference(target)?.revision && !(await outputFilePath(target))) return false
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

function localSummary(
  file: string,
  sizeBytes: number,
  modifiedMs: number,
  revision?: string
): AssetSummary {
  const kind = assetKind(file)
  const id = revision === undefined ? file : outputAssetId(file, revision)
  return {
    id,
    name: path.basename(file),
    filePath: file,
    kind,
    sizeBytes,
    createdAt: new Date(modifiedMs).toISOString(),
    mimeType: null,
    tags: [],
    previewUrl: kind && SERVED_KINDS.has(kind) ? outputFileUrl(id) : null,
    thumbnailUrl: kind === 'image' ? outputFileUrl(id, modifiedMs) : null,
    width: null,
    height: null,
    durationSeconds: null
  }
}

async function addMediaFacts(asset: AssetSummary): Promise<void> {
  const file = asset.filePath
  if (!file) return
  const facts = await mediaFactsFromFile(file, asset.kind)
  if (!outputReference(asset.id)?.revision || (await outputFilePath(asset.id))) {
    Object.assign(asset, facts)
  }
}

export async function listLocalAssets(installationId?: string): Promise<LocalAssetListing> {
  const folders = await findOutputFolders()
  if (installationId !== undefined && !folders.ofBuild.has(installationId)) {
    return { assets: [], provenanceIncomplete: false }
  }
  const provenance =
    installationId === undefined ? undefined : await readOutputProvenance(installationId)
  const otherBuilds = provenance
    ? await Promise.all(
        [...folders.ofBuild.keys()].filter((id) => id !== installationId).map(readOutputProvenance)
      )
    : []
  const files = provenance
    ? [...provenance.outputs.keys()]
    : [...new Set((await Promise.all(folders.all.map(collectMediaFiles))).flat())]
  const found: AssetSummary[] = []
  await runPool(files, STATS_AT_ONCE, async (file) => {
    if (provenance) {
      if (!assetKind(file)) return
      const real = await allowedPath(file)
      if (!real || path.relative(file, real) !== '') return
      const stat = await fsp.stat(real, { bigint: true }).catch(() => null)
      const revision = stat && outputRevision(stat)
      const recordedOnlyByThisBuild =
        revision &&
        provenance.outputs.get(file)?.has(revision) &&
        !otherBuilds.some((other) => other.outputs.get(file)?.has(revision))
      if (stat && revision && recordedOnlyByThisBuild) {
        found.push(localSummary(real, Number(stat.size), Number(stat.mtimeMs), revision))
      }
      return
    }
    const stat = await fsp.stat(file).catch(() => null)
    if (!stat?.isFile()) return
    const modifiedMs = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0
    found.push(localSummary(file, stat.size, modifiedMs))
  })
  const newest = found
    .sort((a, b) => b.createdAt!.localeCompare(a.createdAt!))
    .slice(0, MAX_LOCAL_ASSETS)
  await runPool(newest, STATS_AT_ONCE, addMediaFacts)
  return { assets: newest, provenanceIncomplete: provenance?.incomplete ?? false }
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
  const stat = await fsp.stat(file, { bigint: true }).catch(() => null)
  const revision = stat && outputRevision(stat)
  if (!stat || !revision) return null
  const key = `${file}\n${revision}`
  const cached = thumbnails.get(key)
  if (cached) return cached
  let making = thumbnailsInFlight.get(key)
  if (!making) {
    making = fewAtATime(() => makeThumbnail(file, Number(stat.size)))
      .then(async (made) => {
        if (made && !(await outputFilePath(outputAssetId(file, revision)))) return null
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
  const reference = target && outputReference(target)
  const kind = reference ? assetKind(reference.file) : null
  if (!target || !kind || !SERVED_KINDS.has(kind)) return notFound()
  const file = await outputFilePath(target)
  if (!file) return notFound()
  const jpeg = url.searchParams.has('thumbnail') ? await thumbnailFor(file) : null
  const response = jpeg
    ? new Response(new Uint8Array(jpeg), {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff'
        }
      })
    : await fetchFile(file, request)
  if (reference && reference.revision && !(await outputFilePath(target))) {
    await response.body?.cancel().catch(() => {})
    return notFound()
  }
  return response
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
