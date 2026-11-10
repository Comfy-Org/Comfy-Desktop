import { CLOUD_CONFIG } from '../cloud/config'
import type { CatalogApp } from '../../types/ipc'

const DESKTOP_SURFACE = 'desktop_starters'
const CATALOG_MEDIA_ORIGIN = 'https://comfy.org'
const CATALOG_TIMEOUT_MS = 8000
const THUMBNAIL_FIELDS = ['$.static_thumb', '$.hero_poster']
const SLUGS_WITHOUT_PAGE = new Set([
  'make-image',
  'restyle',
  'sticker',
  'motion-to-video',
  'faceless-channel'
])

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
  const url = new URL('/api/v1/catalog/items', CLOUD_CONFIG.issuer)
  url.searchParams.set('type', 'app')
  url.searchParams.set('surface', DESKTOP_SURFACE)
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

export function toCatalogApp(item: CatalogItem, listUrl: string): CatalogApp | null {
  const uid = item.uid
  const title = item.data?.title
  if (typeof uid !== 'string' || typeof title !== 'string' || title.trim() === '') return null
  const slug = item.data?.slug
  if (typeof slug !== 'string' || slug.trim() === '' || SLUGS_WITHOUT_PAGE.has(slug)) return null
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

export async function listCatalogApps(listUrl: string): Promise<CatalogApp[]> {
  const res = await fetch(catalogUrl(), { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Catalog request failed: HTTP ${res.status}`)
  const body = (await res.json()) as { items?: unknown }
  const items = Array.isArray(body.items) ? (body.items as CatalogItem[]) : []
  return [...items]
    .sort((a, b) => sortOrder(a) - sortOrder(b))
    .map((item) => toCatalogApp(item, listUrl))
    .filter((entry): entry is CatalogApp => entry !== null)
}
