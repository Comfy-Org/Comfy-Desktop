import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as WebReadableStream } from 'stream/web'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { CLOUD_CONFIG } from '../cloud/config'
import { getCloudSession } from '../devplatform/session'
import * as installations from '../installations'
import * as settings from '../settings'
import { buildSaveDialogFilters } from './comfyDownloadManager'
import { sourceMap } from './ipc/shared'
import { outputFilePath } from './outputFolders'
import { runPool } from '../sources/standalone/templateDownloadCore'
import { LOCAL_ASSETS_SOURCE } from '../../types/ipc'
import type { AssetKind, AssetSummary } from '../../types/ipc'

const ASSETS_LIST_CHANNEL = 'assets:list'
const ASSETS_DOWNLOAD_CHANNEL = 'assets:download'

const PAGE_SIZE = 100
const LIST_QUERY = `tags_any=output&sort=created_at&order=desc&limit=${PAGE_SIZE}`
const REQUEST_TIMEOUT_MS = 20_000
const PREVIEW_BATCH_TIMEOUT_MS = 30_000
const SIGNED_URL_CONCURRENCY = 6
const SIGNED_STORAGE_HOST = 'storage.googleapis.com'

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

function toSummary(row: AssetRow, previewUrl: string | null): AssetSummary {
  return {
    id: row.id,
    name: row.name.slice(row.name.lastIndexOf('/') + 1),
    kind: assetKind(row.name, row.mime_type),
    sizeBytes: typeof row.size === 'number' ? row.size : null,
    createdAt: row.created_at ?? null,
    mimeType: row.mime_type ?? null,
    tags: Array.isArray(row.tags)
      ? row.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    previewUrl,
    thumbnailUrl: null
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
    },
    deadline
  )
  return summaries
}

export async function listAssets(installationId: string): Promise<AssetSummary[]> {
  const accessToken = await cloudAccessToken(installationId)
  return accessToken ? listCloudAssets(accessToken) : []
}

type SaveTo = (filePath: string) => Promise<void>

async function writeThroughPartFile(
  filePath: string,
  write: (partPath: string) => Promise<void>
): Promise<void> {
  const partPath = `${filePath}.${randomUUID()}.part`
  try {
    await write(partPath)
    await fs.promises.rename(partPath, filePath)
  } catch (error) {
    await fs.promises.rm(partPath, { force: true }).catch(() => {})
    throw error
  }
}

async function saveDownload(url: string, filePath: string): Promise<void> {
  const controller = new AbortController()
  let timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const keepAlive = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  }
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
    const body = Readable.fromWeb(res.body as WebReadableStream)
    body.on('data', keepAlive)
    await writeThroughPartFile(filePath, (partPath) =>
      pipeline(body, fs.createWriteStream(partPath, { flags: 'wx' }))
    )
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

async function cloudSaveTo(installationId: string, assetId: string): Promise<SaveTo | null> {
  const accessToken = await cloudAccessToken(installationId)
  if (!accessToken) return null
  return async (filePath) => {
    const url = await resolveCloudContentUrl(
      assetId,
      accessToken,
      'attachment',
      AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    )
    if (!url) throw new Error('The asset has no download link.')
    await saveDownload(url, filePath)
  }
}

async function localSaveTo(assetId: string): Promise<SaveTo | null> {
  const file = await outputFilePath(assetId)
  if (!file) return null
  return (filePath) =>
    writeThroughPartFile(filePath, (partPath) =>
      fs.promises.copyFile(file, partPath, fs.constants.COPYFILE_EXCL)
    )
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
  settings.set('lastSaveDialogDir', path.dirname(filePath))
  await saveTo(filePath)
  return true
}

export function registerAssetsHandlers(): void {
  ipcMain.handle(ASSETS_LIST_CHANNEL, (_event, installationId: unknown) =>
    typeof installationId === 'string' ? listAssets(installationId) : []
  )
  ipcMain.handle(
    ASSETS_DOWNLOAD_CHANNEL,
    (event, source: unknown, assetId: unknown, fileName: unknown) => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
      if (!win || typeof source !== 'string' || typeof assetId !== 'string') return false
      return downloadAsset(win, source, assetId, typeof fileName === 'string' ? fileName : assetId)
    }
  )
}
