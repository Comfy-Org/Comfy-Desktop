import { net } from 'electron'

import { CLOUD_ISSUER } from '../cloud/config'
import { fetchJSON } from '../lib/fetch'
import type { AppCard, AppRunsOn, AppsListing } from '../../types/ipc'
import { isAppsPath } from './appsPage'
import { appsOrigin, appsUrl } from './guards'

export interface CatalogApp extends Omit<AppCard, 'hasCover'> {
  coverUrl: string | null
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i
const MAX_TITLE = 200
const MAX_DESCRIPTION = 1000
const MAX_APPS = 200
const MAX_CATALOG_PAGES = 3
const LAST_SORT_ORDER = 999
const FETCH_TIMEOUT_MS = 8000
const COVER_TIMEOUT_MS = 15_000
const MAX_COVER_BYTES = 4 * 1024 * 1024
const COVER_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'image/avif'])
const RUNS_ON: readonly AppRunsOn[] = ['cloud', 'local']

type Json = Record<string, unknown>

function record(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

function runsOn(value: unknown): AppRunsOn[] {
  if (!Array.isArray(value)) return ['cloud']
  const picked = RUNS_ON.filter((where) => value.includes(where))
  return picked.length ? picked : ['cloud']
}

function accent(value: unknown): [string, string] | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const [a, b] = value
  return typeof a === 'string' && typeof b === 'string' && HEX_COLOR.test(a) && HEX_COLOR.test(b)
    ? [a, b]
    : null
}

function sortOrder(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : LAST_SORT_ORDER
}

function mediaUrl(origin: string, ref: unknown): string | null {
  const r = record(ref)
  if (!r || (r.src !== 'media' && r.src !== 'r2')) return null
  const { id, file_version_uid: version } = r
  if (typeof id !== 'string' || typeof version !== 'string') return null
  if (!MEDIA_ID.test(id) || !MEDIA_ID.test(version)) return null
  return `${origin}/api/v1/catalog/media/${id}/${version}`
}

function catalogCover(origin: string, data: Json): string | null {
  const heroType = record(data.website_media_types)?.['$.hero']
  const heroIsImage = typeof heroType === 'string' && heroType.startsWith('image/')
  return (
    mediaUrl(origin, data.static_thumb) ??
    mediaUrl(origin, data.hero_poster) ??
    (heroIsImage ? mediaUrl(origin, data.hero) : null)
  )
}

function catalogApp(origin: string, item: unknown): CatalogApp | null {
  const data = record(record(item)?.data)
  if (!data || (data.type !== undefined && data.type !== 'app')) return null
  const desktop = record(record(data.compatibility)?.desktop)
  const id = typeof data.slug === 'string' && SLUG.test(data.slug) ? data.slug : null
  const title = text(data.title, MAX_TITLE)
  if (!desktop || !id || !title || !isAppsPath(desktop.page)) return null
  return {
    id,
    title,
    description: text(data.description, MAX_DESCRIPTION) ?? '',
    page: desktop.page,
    runsOn: runsOn(desktop.runs_on),
    accent: accent(desktop.accent),
    sortOrder: sortOrder(data.sort_order),
    coverUrl: catalogCover(origin, data)
  }
}

function websitePage(app: Json, id: string): string | null {
  if (isAppsPath(app.page)) return app.page
  return Array.isArray(app.steps) ? `/apps/#/${id}` : null
}

function websiteApp(origin: string, value: unknown): CatalogApp | null {
  const app = record(value)
  if (!app) return null
  const id = typeof app.id === 'string' && SLUG.test(app.id) ? app.id : null
  const title = text(app.title, MAX_TITLE)
  const page = id && websitePage(app, id)
  if (!id || !title || !page) return null
  return {
    id,
    title,
    description: text(app.blurb, MAX_DESCRIPTION) ?? '',
    page,
    runsOn: runsOn(app.runs_on),
    accent: accent(app.accent),
    sortOrder: sortOrder(app.order),
    coverUrl: isAppsPath(app.cover) ? `${origin}${app.cover}` : null
  }
}

function ordered(apps: Array<CatalogApp | null>): CatalogApp[] {
  const seen = new Set<string>()
  const kept: CatalogApp[] = []
  for (const app of apps) {
    if (!app || seen.has(app.id)) continue
    seen.add(app.id)
    kept.push(app)
  }
  return kept
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
    .slice(0, MAX_APPS)
}

export function catalogApps(raw: unknown, catalogOrigin: string): CatalogApp[] {
  const items = record(raw)?.items
  if (!Array.isArray(items)) return []
  return ordered(items.map((item) => catalogApp(catalogOrigin, item)))
}

export function websiteApps(raw: unknown, origin: string): CatalogApp[] {
  if (!Array.isArray(raw)) return []
  return ordered(raw.map((app) => websiteApp(origin, app)))
}

export function catalogListUrl(catalogOrigin: string, cursor?: string): string {
  const url = new URL('/api/v1/catalog/items', catalogOrigin)
  url.searchParams.set('type', 'app')
  url.searchParams.set('surface', 'desktop_starters')
  url.searchParams.set('limit', '100')
  if (cursor) url.searchParams.set('cursor', cursor)
  return url.href
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('timed out')), ms).unref?.()
    })
  ])
}

async function readCatalogItems(catalogOrigin: string): Promise<unknown[]> {
  const items: unknown[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_CATALOG_PAGES; page++) {
    const body = record(
      await withTimeout(fetchJSON(catalogListUrl(catalogOrigin, cursor)), FETCH_TIMEOUT_MS)
    )
    if (Array.isArray(body?.items)) items.push(...body.items)
    const next = body?.next_cursor
    if (body?.has_more !== true || typeof next !== 'string' || !next) break
    cursor = next
  }
  return items
}

export interface AppsSources {
  catalogOrigin: string
  appsOrigin: string | null
}

function defaultSources(): AppsSources {
  return { catalogOrigin: new URL(CLOUD_ISSUER).origin, appsOrigin: appsOrigin(appsUrl()) }
}

export async function loadApps(
  sources: AppsSources = defaultSources()
): Promise<{ source: AppsListing['source']; apps: CatalogApp[] }> {
  const items = await readCatalogItems(sources.catalogOrigin).catch(() => [])
  const fromCatalog = catalogApps({ items }, sources.catalogOrigin)
  if (fromCatalog.length) return { source: 'catalog', apps: fromCatalog }
  if (!sources.appsOrigin) throw new Error('No apps address is set.')
  const raw = await withTimeout(fetchJSON(`${sources.appsOrigin}/apps/apps.json`), FETCH_TIMEOUT_MS)
  const fromWebsite = websiteApps(raw, sources.appsOrigin)
  if (!fromWebsite.length) throw new Error('No apps are listed yet.')
  return { source: 'website', apps: fromWebsite }
}

const coverUrls = new Map<string, string>()
const covers = new Map<string, Promise<string | null>>()

function toCard(app: CatalogApp): AppCard {
  return {
    id: app.id,
    title: app.title,
    description: app.description,
    page: app.page,
    runsOn: app.runsOn,
    accent: app.accent,
    sortOrder: app.sortOrder,
    hasCover: app.coverUrl !== null
  }
}

export function toListing(loaded: {
  source: AppsListing['source']
  apps: CatalogApp[]
}): AppsListing {
  coverUrls.clear()
  for (const app of loaded.apps) if (app.coverUrl) coverUrls.set(app.id, app.coverUrl)
  return { source: loaded.source, apps: loaded.apps.map(toCard) }
}

export async function listApps(): Promise<AppsListing> {
  return toListing(await loadApps())
}

async function readCover(url: string): Promise<string | null> {
  const res = await withTimeout(net.fetch(url), COVER_TIMEOUT_MS)
  const type = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!res.ok || !COVER_TYPES.has(type)) {
    await res.body?.cancel().catch(() => {})
    return null
  }
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.byteLength > MAX_COVER_BYTES) return null
  return `data:${type};base64,${bytes.toString('base64')}`
}

export function appCover(appId: unknown): Promise<string | null> {
  const url = typeof appId === 'string' ? coverUrls.get(appId) : undefined
  if (!url) return Promise.resolve(null)
  let cover = covers.get(url)
  if (!cover) {
    cover = readCover(url).catch(() => null)
    covers.set(url, cover)
    void cover.then((found) => {
      if (!found) covers.delete(url)
    })
  }
  return cover
}

export function _resetAppsCatalogForTest(): void {
  coverUrls.clear()
  covers.clear()
}
