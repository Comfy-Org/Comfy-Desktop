import { CLOUD_CONFIG } from '../cloud/config'
import type { CatalogApp } from '../../types/ipc'
import { appsOrigin, isAppsFrameUrl } from './guards'

const CATALOG_SURFACE = process.env['COMFY_APPS_CATALOG_SURFACE'] || 'desktop_starters'
const CATALOG_MEDIA_ORIGIN = 'https://comfy.org'
const CATALOG_TIMEOUT_MS = 8000
const THUMBNAIL_FIELDS = ['$.static_thumb', '$.hero_poster']

interface CatalogItem {
  uid?: unknown
  data?: {
    title?: unknown
    description?: unknown
    sort_order?: unknown
    implementation_ref?: unknown
    website_media?: Record<string, unknown> | null
    compatibility?: { desktop?: { page?: unknown } | null } | null
  } | null
}

export function catalogUrl(surface = CATALOG_SURFACE): string {
  const url = new URL('/api/v1/catalog/items', CLOUD_CONFIG.issuer)
  url.searchParams.set('type', 'app')
  url.searchParams.set('surface', surface)
  url.searchParams.set('limit', '100')
  return url.href
}

function thumbnailUrl(media: Record<string, unknown> | null | undefined): string | null {
  for (const field of THUMBNAIL_FIELDS) {
    const path = media?.[field]
    if (typeof path === 'string' && path.startsWith('/catalog-media/'))
      return `${CATALOG_MEDIA_ORIGIN}${path}`
  }
  return null
}

function appPageUrl(item: CatalogItem, uid: string, listUrl: string): string | null {
  const page = item.data?.compatibility?.desktop?.page
  if (typeof page === 'string') {
    let url: string
    try {
      url = new URL(page, listUrl).href
    } catch {
      return null
    }
    return isAppsFrameUrl(url, appsOrigin(listUrl)) ? url : null
  }
  if (item.data?.implementation_ref === 'steps')
    return new URL(`#/${encodeURIComponent(uid)}`, listUrl).href
  return null
}

export function toCatalogApp(item: CatalogItem, listUrl: string): CatalogApp | null {
  const uid = item.uid
  const title = item.data?.title
  if (typeof uid !== 'string' || typeof title !== 'string' || title.trim() === '') return null
  const url = appPageUrl(item, uid, listUrl)
  if (!url) return null
  const description = item.data?.description
  const order = item.data?.sort_order
  return {
    id: uid,
    title,
    description: typeof description === 'string' ? description : '',
    thumbnailUrl: thumbnailUrl(item.data?.website_media),
    url,
    order: typeof order === 'number' && isFinite(order) ? order : Number.MAX_SAFE_INTEGER
  }
}

export async function listCatalogApps(listUrl: string): Promise<CatalogApp[]> {
  const res = await fetch(catalogUrl(), { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Catalog request failed: HTTP ${res.status}`)
  const body = (await res.json()) as { items?: unknown }
  const items = Array.isArray(body.items) ? (body.items as CatalogItem[]) : []
  return items
    .map((item) => toCatalogApp(item, listUrl))
    .filter((app): app is CatalogApp => app !== null)
    .sort((a, b) => a.order - b.order)
}
