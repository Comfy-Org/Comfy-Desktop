import { ipcMain } from 'electron'
import { CLOUD_CONFIG } from '../cloud/config'
import { getCloudSession } from '../devplatform/session'
import * as installations from '../installations'
import { _runningSessions, sourceMap } from './ipc/shared'
import { runPool } from '../sources/standalone/templateDownloadCore'
import type { AssetKind, AssetSummary } from '../../types/ipc'

export const ASSETS_LIST_CHANNEL = 'assets:list'

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
}

function isAssetRow(value: unknown): value is AssetRow {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<AssetRow>
  return typeof row.id === 'string' && typeof row.name === 'string'
}

export function assetKind(name: string, mimeType?: string): AssetKind | null {
  const mimeKind = mimeType?.split('/')[0]
  if (mimeKind === 'image' || mimeKind === 'video' || mimeKind === 'audio') return mimeKind
  if (mimeType?.startsWith('model/')) return '3d'
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return KIND_BY_EXTENSION[extension] ?? null
}

function toSummary(row: AssetRow, previewUrl: string | null): AssetSummary {
  return {
    id: row.id,
    name: row.name.slice(row.name.lastIndexOf('/') + 1),
    kind: assetKind(row.name, row.mime_type),
    sizeBytes: row.size ? row.size : null,
    createdAt: row.created_at ?? null,
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
    const host = url.hostname.toLowerCase()
    const trusted = host === SIGNED_STORAGE_HOST || host.endsWith(`.${SIGNED_STORAGE_HOST}`)
    return url.protocol === 'https:' && trusted ? url.toString() : null
  } catch {
    return null
  }
}

async function resolveCloudContentUrl(
  assetId: string,
  accessToken: string
): Promise<string | null> {
  const url = `${CLOUD_CONFIG.apiBase}/assets/${encodeURIComponent(assetId)}/content?disposition=inline`
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    return signedStorageUrl(res.headers.get('location'))
  } catch {
    return null
  }
}

async function listCloudAssets(): Promise<AssetSummary[]> {
  const accessToken = await getCloudSession().getAccessToken()
  if (!accessToken) return []
  const rows = await fetchAssetRows(
    `${CLOUD_CONFIG.apiBase}/assets?${LIST_QUERY}&include_public=false`,
    { Authorization: `Bearer ${accessToken}` }
  )
  const summaries = rows.map((row) => toSummary(row, null))
  await runPool(summaries, SIGNED_URL_CONCURRENCY, async (summary) => {
    if (summary.kind !== 'image' && summary.kind !== 'video') return
    summary.previewUrl = await resolveCloudContentUrl(summary.id, accessToken)
  })
  return summaries
}

async function listLocalAssets(port: number): Promise<AssetSummary[]> {
  const origin = `http://127.0.0.1:${port}`
  const rows = await fetchAssetRows(`${origin}/api/assets?${LIST_QUERY}`, {})
  return rows.map((row) => {
    const path =
      row.preview_url ?? `/api/assets/${encodeURIComponent(row.id)}/content?disposition=inline`
    return toSummary(row, new URL(path, origin).toString())
  })
}

export async function listAssets(installationId: string): Promise<AssetSummary[]> {
  const inst = await installations.get(installationId)
  if (!inst) return []
  if (sourceMap[inst.sourceId]?.category === 'cloud') return listCloudAssets()
  const port = _runningSessions.get(installationId)?.port
  return port ? listLocalAssets(port) : []
}

export function registerAssetsHandlers(): void {
  ipcMain.handle(ASSETS_LIST_CHANNEL, (_event, installationId: unknown) =>
    typeof installationId === 'string' ? listAssets(installationId) : []
  )
}
