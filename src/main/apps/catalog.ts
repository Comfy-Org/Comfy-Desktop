import type { CatalogApp } from '../../types/ipc'
import { isTemporaryLaunchApp } from './temporaryLaunchApps'

const DESKTOP_SURFACE = 'desktop_starters'
const CATALOG_ORIGIN = 'https://cloud.comfy.org'
const CATALOG_MEDIA_ORIGIN = 'https://comfy.org'
const CATALOG_MEDIA_PATH = '/catalog-media/'
const CATALOG_TIMEOUT_MS = 8000
const THUMBNAIL_FIELDS = ['$.static_thumb', '$.hero_poster']

interface CatalogItem {
  uid?: unknown
  data?: {
    title?: unknown
    description?: unknown
    slug?: unknown
    sort_order?: unknown
    website_media?: Record<string, unknown> | null
  } | null
}

export function catalogUrl(): string {
  const url = new URL('/api/v1/catalog/items', CATALOG_ORIGIN)
  url.searchParams.set('type', 'app')
  url.searchParams.set('surface', DESKTOP_SURFACE)
  url.searchParams.set('limit', '100')
  return url.href
}

function thumbnailUrl(media: Record<string, unknown> | null | undefined): string | null {
  for (const field of THUMBNAIL_FIELDS) {
    const path = media?.[field]
    if (typeof path !== 'string' || !path.startsWith(CATALOG_MEDIA_PATH)) continue
    const url = new URL(path, CATALOG_MEDIA_ORIGIN)
    if (url.origin === CATALOG_MEDIA_ORIGIN && url.pathname.startsWith(CATALOG_MEDIA_PATH))
      return url.href
  }
  return null
}

export function toCatalogApp(item: CatalogItem, listUrl: string): CatalogApp | null {
  const uid = item.uid
  const title = item.data?.title
  if (typeof uid !== 'string' || typeof title !== 'string' || title.trim() === '') return null
  const slug = item.data?.slug
  if (typeof slug !== 'string' || slug.trim() === '') return null
  const url = new URL(`#/${encodeURIComponent(slug)}`, listUrl).href
  const description = item.data?.description
  return {
    id: uid,
    title,
    description: typeof description === 'string' ? description : '',
    thumbnailUrl: thumbnailUrl(item.data?.website_media),
    url
  }
}

function sortOrder(item: CatalogItem): number {
  const order = item.data?.sort_order
  return typeof order === 'number' && isFinite(order) ? order : Number.MAX_SAFE_INTEGER
}

function isCatalogItem(item: unknown): item is CatalogItem {
  return typeof item === 'object' && item !== null
}

export async function listCatalogApps(listUrl: string): Promise<CatalogApp[]> {
  const res = await fetch(catalogUrl(), { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Catalog request failed: HTTP ${res.status}`)
  const body = (await res.json()) as { items?: unknown } | null
  if (!Array.isArray(body?.items)) throw new Error('Catalog response has no item list')
  const seen = new Set<string>()
  return body.items
    .filter(isCatalogItem)
    .filter((item) => isTemporaryLaunchApp(item.data?.slug))
    .sort((a, b) => sortOrder(a) - sortOrder(b))
    .map((item) => toCatalogApp(item, listUrl))
    .filter((entry): entry is CatalogApp => {
      if (entry === null || seen.has(entry.id)) return false
      seen.add(entry.id)
      return true
    })
}
