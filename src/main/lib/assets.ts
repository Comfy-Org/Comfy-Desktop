import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as WebReadableStream } from 'stream/web'
import { app, BrowserWindow, dialog, ipcMain, nativeImage } from 'electron'
import { CLOUD_CONFIG } from '../cloud/config'
import { getCloudSession } from '../devplatform/session'
import { findHostWindowByPanelSender, isPanelSender } from '../host/registry'
import * as installations from '../installations'
import * as settings from '../settings'
import { buildSaveDialogFilters, startFileSave } from './comfyDownloadManager'
import type { FileSaveTransfer } from './comfyDownloadManager'
import { sourceMap } from './ipc/shared'
import { copyImageToClipboard } from './clipboardImage'
import { copyOutputImage, outputFilePath, revealOutputFile, trashOutputFile } from './outputFolders'
import type { CloudAssetLookup } from '../../types/ipc'
import { runPool } from '../sources/standalone/templateDownloadCore'
import { mediaFactsFromBytes } from './mediaFacts'
import { LOCAL_ASSETS_SOURCE } from '../../types/ipc'
import type { AssetKind, AssetSummary } from '../../types/ipc'

const ASSETS_LIST_CHANNEL = 'assets:list'
const ASSETS_DOWNLOAD_CHANNEL = 'assets:download'
const ASSETS_REVEAL_CHANNEL = 'assets:reveal'
const ASSETS_COPY_CHANNEL = 'assets:copy'
const ASSETS_TRASH_CHANNEL = 'assets:trash'

const PAGE_SIZE = 100
const LIST_QUERY = `tags_any=output&sort=created_at&order=desc&limit=${PAGE_SIZE}`
const REQUEST_TIMEOUT_MS = 20_000
const PREVIEW_BATCH_TIMEOUT_MS = 30_000
const SIGNED_URL_CONCURRENCY = 6
const SIGNED_STORAGE_HOST = 'storage.googleapis.com'
const HEADER_BYTES: Partial<Record<AssetKind, number>> = {
  image: 64 * 1024,
  video: 512 * 1024
}

const KIND_BY_EXTENSION = new Map<string, AssetKind>([
  ...['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'tif', 'tiff', 'svg'].map(
    (ext) => [ext, 'image'] as const
  ),
  ...['mp4', 'm4v', 'webm', 'mov', 'avi', 'mkv'].map((ext) => [ext, 'video'] as const),
  ...['mp3', 'wav', 'ogg', 'flac', 'opus', 'm4a'].map((ext) => [ext, 'audio'] as const),
  ...['obj', 'fbx', 'gltf', 'glb', 'stl', 'usdz', 'ply', 'spz', 'splat', 'ksplat'].map(
    (ext) => [ext, '3d'] as const
  )
])

interface AssetRow {
  id: string
  name: string
  size?: number | null
  mime_type?: string | null
  created_at?: string | null
  preview_url?: string | null
  tags?: unknown
}

type ContentDisposition = 'inline' | 'attachment'

function isOptional(value: unknown, type: 'string' | 'number'): boolean {
  return value === undefined || value === null || typeof value === type
}

function isAssetRow(value: unknown): value is AssetRow {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<keyof AssetRow, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    isOptional(row.size, 'number') &&
    isOptional(row.mime_type, 'string') &&
    isOptional(row.created_at, 'string') &&
    isOptional(row.preview_url, 'string')
  )
}

export function assetKind(name: string, mimeType?: string | null): AssetKind | null {
  const mimeKind = mimeType?.split('/')[0]
  if (mimeKind === 'image' || mimeKind === 'video' || mimeKind === 'audio') return mimeKind
  if (mimeType?.startsWith('model/')) return '3d'
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  return KIND_BY_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? null
}

function fileNameOf(row: AssetRow): string {
  return row.name.slice(row.name.lastIndexOf('/') + 1)
}

function toSummary(row: AssetRow, previewUrl: string | null): AssetSummary {
  return {
    id: row.id,
    name: fileNameOf(row),
    kind: assetKind(row.name, row.mime_type),
    sizeBytes: typeof row.size === 'number' ? row.size : null,
    createdAt: row.created_at ?? null,
    mimeType: row.mime_type ?? null,
    tags: Array.isArray(row.tags)
      ? row.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    previewUrl,
    thumbnailUrl: null,
    width: null,
    height: null,
    durationSeconds: null
  }
}

async function fetchAssetRows(url: string, headers: Record<string, string>): Promise<AssetRow[]> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`List assets failed: HTTP ${res.status}`)
  const body: unknown = await res.json().catch(() => null)
  const rows = body && typeof body === 'object' ? (body as { assets?: unknown }).assets : undefined
  if (!Array.isArray(rows)) throw new Error('List assets returned an invalid page')
  return rows.filter(isAssetRow).slice(0, PAGE_SIZE)
}

export function signedStorageUrl(location: string | null): string | null {
  if (!location) return null
  try {
    const url = new URL(location)
    return url.protocol === 'https:' && url.hostname.toLowerCase() === SIGNED_STORAGE_HOST
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function contentPath(assetId: string, disposition: ContentDisposition): string {
  return `/api/assets/${encodeURIComponent(assetId)}/content?disposition=${disposition}`
}

async function resolveCloudContentUrl(
  assetId: string,
  accessToken: string,
  disposition: ContentDisposition,
  deadline: AbortSignal
): Promise<string | null> {
  try {
    const res = await fetch(`${CLOUD_CONFIG.issuer}${contentPath(assetId, disposition)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'manual',
      signal: AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), deadline])
    })
    return signedStorageUrl(res.headers.get('location'))
  } catch {
    return null
  }
}

async function firstBytes(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let length = 0
  while (length < limit) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    length += value.length
  }
  await reader.cancel().catch(() => {})
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes.subarray(0, limit)
}

async function addMediaFacts(summary: AssetSummary, deadline: AbortSignal): Promise<void> {
  const limit = summary.kind ? HEADER_BYTES[summary.kind] : undefined
  if (!summary.previewUrl || !limit) return
  try {
    const res = await fetch(summary.previewUrl, {
      headers: { Range: `bytes=0-${limit - 1}` },
      signal: AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), deadline])
    })
    if (!res.ok) return
    const bytes = await firstBytes(res, limit)
    Object.assign(summary, await mediaFactsFromBytes(bytes, summary.kind, summary.mimeType))
  } catch {
    return
  }
}

const ASSETS_FIND_CHANNEL = 'assets:find'
const LOOKUP_PAGE_SIZE = 100
const MAX_LOOKUP_PAGES = 10
const LOOKUP_INCOMPLETE: CloudAssetLookup = { status: 'incomplete' }

interface LookupPage {
  rows: unknown[]
  hasMore: boolean
  nextCursor: string | null
}

function lookupUrl(name: string, after: string | null): string {
  const query = new URLSearchParams({
    tags_any: 'output',
    name_contains: name,
    sort: 'created_at',
    order: 'desc',
    limit: String(LOOKUP_PAGE_SIZE),
    include_public: 'false'
  })
  if (after !== null) query.set('after', after)
  return `${CLOUD_CONFIG.apiBase}/assets?${query}`
}

async function fetchLookupPage(url: string, accessToken: string): Promise<LookupPage | null> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!res.ok) return null
  const body: unknown = await res.json().catch(() => null)
  if (!body || typeof body !== 'object') return null
  const { assets, has_more: hasMore, next_cursor: nextCursor } = body as Record<string, unknown>
  if (!Array.isArray(assets) || typeof hasMore !== 'boolean') return null
  if (nextCursor !== undefined && nextCursor !== null && typeof nextCursor !== 'string') return null
  return { rows: assets, hasMore, nextCursor: nextCursor ?? null }
}

async function withPreview(row: AssetRow, accessToken: string): Promise<AssetSummary> {
  const summary = toSummary(row, null)
  if (summary.kind === null || summary.kind === '3d') return summary
  const deadline = AbortSignal.timeout(PREVIEW_BATCH_TIMEOUT_MS)
  summary.previewUrl = await resolveCloudContentUrl(summary.id, accessToken, 'inline', deadline)
  await addMediaFacts(summary, deadline)
  return summary
}

async function lookUpCloudAsset(accessToken: string, name: string): Promise<CloudAssetLookup> {
  let after: string | null = null
  let unreadable = false
  for (let page = 0; page < MAX_LOOKUP_PAGES; page++) {
    const result = await fetchLookupPage(lookupUrl(name, after), accessToken)
    if (!result) return LOOKUP_INCOMPLETE
    const readable = result.rows.filter(isAssetRow)
    unreadable ||= readable.length !== result.rows.length
    const found = readable.find((row) => fileNameOf(row) === name)
    if (found) return { status: 'found', asset: await withPreview(found, accessToken) }
    if (!result.hasMore) return unreadable ? LOOKUP_INCOMPLETE : { status: 'absent' }
    if (result.nextCursor === null || result.nextCursor === after) return LOOKUP_INCOMPLETE
    after = result.nextCursor
  }
  return LOOKUP_INCOMPLETE
}

export async function findCloudAsset(
  installationId: string,
  name: string
): Promise<CloudAssetLookup> {
  const accessToken = name ? await cloudAccessToken(installationId) : null
  if (!accessToken) return LOOKUP_INCOMPLETE
  return lookUpCloudAsset(accessToken, name).catch(() => LOOKUP_INCOMPLETE)
}

async function cloudAccessToken(installationId: string): Promise<string | null> {
  const inst = await installations.get(installationId)
  if (!inst || sourceMap[inst.sourceId]?.category !== 'cloud') return null
  return getCloudSession().getAccessToken()
}

async function listCloudAssets(accessToken: string): Promise<AssetSummary[]> {
  const rows = await fetchAssetRows(
    `${CLOUD_CONFIG.apiBase}/assets?${LIST_QUERY}&include_public=false`,
    { Authorization: `Bearer ${accessToken}` }
  )
  const summaries = rows.map((row) => toSummary(row, null))
  const deadline = AbortSignal.timeout(PREVIEW_BATCH_TIMEOUT_MS)
  await runPool(
    summaries,
    SIGNED_URL_CONCURRENCY,
    async (summary) => {
      if (summary.kind === null || summary.kind === '3d') return
      summary.previewUrl = await resolveCloudContentUrl(summary.id, accessToken, 'inline', deadline)
      await addMediaFacts(summary, deadline)
    },
    deadline
  )
  return summaries
}

export async function listAssets(installationId: string): Promise<AssetSummary[]> {
  const accessToken = await cloudAccessToken(installationId)
  return accessToken ? listCloudAssets(accessToken) : []
}

type SaveTo = (filePath: string, job: FileSaveTransfer) => Promise<void>

async function writeThroughPartFile(
  filePath: string,
  signal: AbortSignal,
  write: (partPath: string) => Promise<void>
): Promise<void> {
  const partPath = `${filePath}.${randomUUID()}.part`
  try {
    await write(partPath)
    signal.throwIfAborted()
    await fs.promises.rename(partPath, filePath)
  } catch (error) {
    await fs.promises.rm(partPath, { force: true }).catch(() => {})
    throw error
  }
}

function trackBytes(stream: Readable, total: number, job: FileSaveTransfer): void {
  let received = 0
  stream.on('data', (chunk: Buffer) => {
    received += chunk.length
    job.progress(received, total)
  })
}

function contentLength(res: Response): number {
  const length = Number(res.headers.get('content-length'))
  return Number.isFinite(length) && length > 0 ? length : 0
}

async function saveDownload(url: string, filePath: string, job: FileSaveTransfer): Promise<void> {
  const controller = new AbortController()
  const cancel = (): void => controller.abort()
  job.signal.addEventListener('abort', cancel, { once: true })
  const stall = (): void => controller.abort(new Error('The download stopped sending data.'))
  let timer = setTimeout(stall, REQUEST_TIMEOUT_MS)
  const keepAlive = (): void => {
    clearTimeout(timer)
    timer = setTimeout(stall, REQUEST_TIMEOUT_MS)
  }
  try {
    const res = await fetch(url, { redirect: 'error', signal: controller.signal })
    if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
    const body = Readable.fromWeb(res.body as WebReadableStream)
    body.on('data', keepAlive)
    trackBytes(body, contentLength(res), job)
    body.on('pause', () => clearTimeout(timer))
    await writeThroughPartFile(filePath, job.signal, (partPath) => {
      const file = fs.createWriteStream(partPath, { flags: 'wx' })
      file.on('drain', keepAlive)
      return pipeline(body, file, { signal: job.signal })
    })
  } finally {
    clearTimeout(timer)
    job.signal.removeEventListener('abort', cancel)
    controller.abort()
  }
}

async function cloudSaveTo(installationId: string, assetId: string): Promise<SaveTo | null> {
  if (!(await cloudAccessToken(installationId))) return null
  return async (filePath, job) => {
    const accessToken = await cloudAccessToken(installationId)
    if (!accessToken) throw new Error('Log in to Comfy Cloud to download this asset.')
    const url = await resolveCloudContentUrl(
      assetId,
      accessToken,
      'attachment',
      AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), job.signal])
    )
    if (!url) throw new Error('Could not get a download link from Comfy Cloud.')
    await saveDownload(url, filePath, job)
  }
}

async function localSaveTo(assetId: string): Promise<SaveTo | null> {
  const file = await outputFilePath(assetId)
  if (!file) return null
  return (filePath, job) =>
    writeThroughPartFile(filePath, job.signal, async (partPath) => {
      const { size } = await fs.promises.stat(file)
      const source = fs.createReadStream(file)
      trackBytes(source, size, job)
      await pipeline(source, fs.createWriteStream(partPath, { flags: 'wx' }), {
        signal: job.signal
      })
    })
}

function isUsableFileName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..'
}

function safeFileName(fileName: string, assetId: string): string {
  return [fileName, assetId].map((name) => path.basename(name)).find(isUsableFileName) ?? 'download'
}

export async function downloadAsset(
  win: BrowserWindow,
  source: string,
  assetId: string,
  fileName: string
): Promise<boolean> {
  const saveTo =
    source === LOCAL_ASSETS_SOURCE ? await localSaveTo(assetId) : await cloudSaveTo(source, assetId)
  if (!saveTo) throw new Error('This asset is not available.')
  const name = safeFileName(fileName, assetId)
  const remembered = settings.get('lastSaveDialogDir')
  const startDir = remembered && fs.existsSync(remembered) ? remembered : app.getPath('downloads')
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(startDir, name),
    filters: buildSaveDialogFilters(name)
  })
  if (canceled || !filePath) return false
  startFileSave({
    window: win,
    savePath: filePath,
    transfer: async (job) => {
      await saveTo(filePath, job)
      settings.set('lastSaveDialogDir', path.dirname(filePath))
    }
  })
  return true
}

async function copyCloudImage(installationId: string, assetId: string): Promise<boolean> {
  const accessToken = await cloudAccessToken(installationId)
  if (!accessToken) return false
  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const url = await resolveCloudContentUrl(assetId, accessToken, 'inline', deadline)
  if (!url) return false
  const res = await fetch(url, { redirect: 'error', signal: deadline })
  if (!res.ok) return false
  const image = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()))
  if (image.isEmpty()) return false
  await copyImageToClipboard(image)
  return true
}

export function copyAsset(source: string, assetId: string): Promise<boolean> {
  return source === LOCAL_ASSETS_SOURCE ? copyOutputImage(assetId) : copyCloudImage(source, assetId)
}

function localFileAction(
  action: (assetId: string) => Promise<boolean>
): (event: Electron.IpcMainInvokeEvent, source: unknown, assetId: unknown) => Promise<boolean> {
  return async (event, source, assetId) =>
    isPanelSender(event.sender) && source === LOCAL_ASSETS_SOURCE && typeof assetId === 'string'
      ? action(assetId)
      : false
}

export function registerAssetsHandlers(): void {
  ipcMain.handle(ASSETS_LIST_CHANNEL, (_event, installationId: unknown) =>
    typeof installationId === 'string' ? listAssets(installationId) : []
  )
  ipcMain.handle(
    ASSETS_DOWNLOAD_CHANNEL,
    (event, source: unknown, assetId: unknown, fileName: unknown) => {
      const win =
        findHostWindowByPanelSender(event.sender) ??
        BrowserWindow.fromWebContents(event.sender) ??
        BrowserWindow.getFocusedWindow()
      if (!win || typeof source !== 'string' || typeof assetId !== 'string') return false
      return downloadAsset(win, source, assetId, typeof fileName === 'string' ? fileName : assetId)
    }
  )
  ipcMain.handle(ASSETS_REVEAL_CHANNEL, localFileAction(revealOutputFile))
  ipcMain.handle(ASSETS_TRASH_CHANNEL, localFileAction(trashOutputFile))
  ipcMain.handle(ASSETS_COPY_CHANNEL, (event, source: unknown, assetId: unknown) =>
    isPanelSender(event.sender) && typeof source === 'string' && typeof assetId === 'string'
      ? copyAsset(source, assetId)
      : false
  )
  ipcMain.handle(ASSETS_FIND_CHANNEL, (_event, installationId: unknown, name: unknown) =>
    typeof installationId === 'string' && typeof name === 'string'
      ? findCloudAsset(installationId, name)
      : LOOKUP_INCOMPLETE
  )
}
