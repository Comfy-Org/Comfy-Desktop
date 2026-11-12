import { ipcMain } from 'electron'
import { CLOUD_CONFIG } from '../cloud/config'
import { getCloudSession } from '../devplatform/session'
import * as installations from '../installations'
import { _runningSessions, sourceMap } from './ipc/shared'
import { runPool } from '../sources/standalone/templateDownloadCore'
import type { AssetKind, AssetSummary } from '../../types/ipc'

const ASSETS_LIST_CHANNEL = 'assets:list'

const LIST_QUERY = 'tags_any=output&sort=created_at&order=desc&limit=100'
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

type AssetSource = { kind: 'cloud'; accessToken: string } | { kind: 'local'; origin: string }
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

function localPreviewUrl(row: AssetRow, origin: string): string {
  const fallback = new URL(contentPath(row.id, 'inline'), origin)
  const preview = row.preview_url ? URL.parse(row.preview_url, origin) : null
  return (
    preview?.origin === fallback.origin && preview.pathname.startsWith('/api/') ? preview : fallback
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

export function registerAssetsHandlers(): void {
  ipcMain.handle(ASSETS_LIST_CHANNEL, (_event, installationId: unknown) =>
    typeof installationId === 'string' ? listAssets(installationId) : []
  )
}
