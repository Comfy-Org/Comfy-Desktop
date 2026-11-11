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
import { _runningSessions, sourceMap } from './ipc/shared'
import { runPool } from '../sources/standalone/templateDownloadCore'
import type { AssetKind, AssetSummary } from '../../types/ipc'

const ASSETS_LIST_CHANNEL = 'assets:list'
const ASSETS_DOWNLOAD_CHANNEL = 'assets:download'

const LIST_QUERY = 'tags_any=output&sort=created_at&order=desc&limit=100'
const REQUEST_TIMEOUT_MS = 20_000
const SIGNED_URL_CONCURRENCY = 6
const SIGNED_STORAGE_HOST = 'storage.googleapis.com'

const KIND_BY_EXTENSION: Record<string, AssetKind> = Object.fromEntries([
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
  size?: number
  mime_type?: string
  created_at?: string
  preview_url?: string
  tags?: unknown
}

type AssetSource = { kind: 'cloud'; accessToken: string } | { kind: 'local'; origin: string }
type ContentDisposition = 'inline' | 'attachment'

function isAssetRow(value: unknown): value is AssetRow {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<AssetRow>
  return typeof row.id === 'string' && typeof row.name === 'string'
}

export function assetKind(name: string, mimeType?: string): AssetKind | null {
  const mimeKind = mimeType?.split('/')[0]
  if (mimeKind === 'image' || mimeKind === 'video' || mimeKind === 'audio') return mimeKind
  if (mimeType?.startsWith('model/')) return '3d'
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  return KIND_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null
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
    previewUrl
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
  return rows.filter(isAssetRow)
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
  disposition: ContentDisposition
): Promise<string | null> {
  try {
    const res = await fetch(`${CLOUD_CONFIG.issuer}${contentPath(assetId, disposition)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    return signedStorageUrl(res.headers.get('location'))
  } catch {
    return null
  }
}

async function resolveSource(installationId: string): Promise<AssetSource | null> {
  const inst = await installations.get(installationId)
  if (!inst) return null
  const category = sourceMap[inst.sourceId]?.category
  if (category === 'cloud') {
    const accessToken = await getCloudSession().getAccessToken()
    return accessToken ? { kind: 'cloud', accessToken } : null
  }
  if (category !== 'local') return null
  const port = _runningSessions.get(installationId)?.port
  return port ? { kind: 'local', origin: `http://127.0.0.1:${port}` } : null
}

async function listCloudAssets(accessToken: string): Promise<AssetSummary[]> {
  const rows = await fetchAssetRows(
    `${CLOUD_CONFIG.apiBase}/assets?${LIST_QUERY}&include_public=false`,
    { Authorization: `Bearer ${accessToken}` }
  )
  const summaries = rows.map((row) => toSummary(row, null))
  await runPool(summaries, SIGNED_URL_CONCURRENCY, async (summary) => {
    if (summary.kind === null || summary.kind === '3d') return
    summary.previewUrl = await resolveCloudContentUrl(summary.id, accessToken, 'inline')
  })
  return summaries
}

function localPreviewUrl(row: AssetRow, origin: string): string {
  const fallback = new URL(contentPath(row.id, 'inline'), origin)
  if (!row.preview_url) return fallback.toString()
  const preview = new URL(row.preview_url, origin)
  return (
    preview.origin === origin && preview.pathname.startsWith('/api/') ? preview : fallback
  ).toString()
}

async function listLocalAssets(origin: string): Promise<AssetSummary[]> {
  const rows = await fetchAssetRows(`${origin}/api/assets?${LIST_QUERY}`, {})
  return rows.map((row) => toSummary(row, localPreviewUrl(row, origin)))
}

export async function listAssets(installationId: string): Promise<AssetSummary[]> {
  const source = await resolveSource(installationId)
  if (!source) return []
  return source.kind === 'cloud'
    ? listCloudAssets(source.accessToken)
    : listLocalAssets(source.origin)
}

async function downloadUrl(source: AssetSource, assetId: string): Promise<string | null> {
  return source.kind === 'cloud'
    ? resolveCloudContentUrl(assetId, source.accessToken, 'attachment')
    : `${source.origin}${contentPath(assetId, 'attachment')}`
}

async function saveDownload(url: string, filePath: string): Promise<void> {
  const controller = new AbortController()
  let timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const keepAlive = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  }
  const partPath = `${filePath}.part`
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
    const body = Readable.fromWeb(res.body as WebReadableStream)
    body.on('data', keepAlive)
    try {
      await pipeline(body, fs.createWriteStream(partPath))
      await fs.promises.rename(partPath, filePath)
    } catch (error) {
      await fs.promises.rm(partPath, { force: true }).catch(() => {})
      throw error
    }
  } finally {
    clearTimeout(timer)
  }
}

function safeFileName(fileName: string, assetId: string): string {
  const base = path.basename(fileName)
  return base === '' || base === '.' || base === '..' ? assetId : base
}

export async function downloadAsset(
  win: BrowserWindow,
  installationId: string,
  assetId: string,
  fileName: string
): Promise<boolean> {
  const source = await resolveSource(installationId)
  if (!source) throw new Error('This build is not running.')
  const name = safeFileName(fileName, assetId)
  const remembered = settings.get('lastSaveDialogDir')
  const startDir = remembered && fs.existsSync(remembered) ? remembered : app.getPath('downloads')
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(startDir, name),
    filters: buildSaveDialogFilters(name)
  })
  if (canceled || !filePath) return false
  settings.set('lastSaveDialogDir', path.dirname(filePath))
  const url = await downloadUrl(source, assetId)
  if (!url) throw new Error('The asset has no download link.')
  await saveDownload(url, filePath)
  return true
}

export function registerAssetsHandlers(): void {
  ipcMain.handle(ASSETS_LIST_CHANNEL, (_event, installationId: unknown) =>
    typeof installationId === 'string' ? listAssets(installationId) : []
  )
  ipcMain.handle(
    ASSETS_DOWNLOAD_CHANNEL,
    (event, installationId: unknown, assetId: unknown, fileName: unknown) => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
      if (!win || typeof installationId !== 'string' || typeof assetId !== 'string') return false
      return downloadAsset(
        win,
        installationId,
        assetId,
        typeof fileName === 'string' ? fileName : assetId
      )
    }
  )
}
