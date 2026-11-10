import { net } from 'electron'

import { CLOUD_ISSUER } from '../cloud/config'
import { fetchJSON } from '../lib/fetch'
import type { AppCard, AppExample, AppExampleKind, AppRunsOn, AppsListing } from '../../types/ipc'
import { examplePage, isAppsPath, isExampleId } from './appsPage'
import { appsOrigin, appsUrl } from './guards'

export interface CatalogExample {
  id: string
  title: string
  kind: AppExampleKind
  thumbUrl: string
}

export interface CatalogApp extends Omit<AppCard, 'hasCover'> {
  coverUrl: string | null
  examples: CatalogExample[]
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
const MAX_EXAMPLE_THUMB_BYTES = 2 * 1024 * 1024
const MAX_EXAMPLE_TITLE = 300
const MAX_EXAMPLES_PER_APP = 100
const MAX_GALLERY_EXAMPLES = 1000
const COVER_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'image/avif'])
const RUNS_ON: readonly AppRunsOn[] = ['cloud', 'local']
const EXAMPLE_KINDS: readonly AppExampleKind[] = ['image', 'video', 'audio']

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

function isImageType(type: unknown): boolean {
  return typeof type === 'string' && type.startsWith('image/')
}

function catalogCover(origin: string, data: Json): string | null {
  const heroType = record(data.website_media_types)?.['$.hero']
  return (
    mediaUrl(origin, data.static_thumb) ??
    mediaUrl(origin, data.hero_poster) ??
    (isImageType(heroType) ? mediaUrl(origin, data.hero) : null)
  )
}

function exampleKind(value: unknown): AppExampleKind {
  return EXAMPLE_KINDS.find((kind) => kind === value) ?? 'image'
}

function kindOfType(type: unknown): AppExampleKind | null {
  if (typeof type !== 'string') return null
  return EXAMPLE_KINDS.find((kind) => type.startsWith(`${kind}/`)) ?? null
}

function examplesOf(
  value: unknown,
  read: (example: unknown, index: number) => CatalogExample | null
): CatalogExample[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const kept: CatalogExample[] = []
  for (const [index, example] of value.slice(0, MAX_EXAMPLES_PER_APP).entries()) {
    const found = read(example, index)
    if (!found || seen.has(found.id)) continue
    seen.add(found.id)
    kept.push(found)
  }
  return kept
}

function catalogExample(
  origin: string,
  data: Json,
  value: unknown,
  index: number
): CatalogExample | null {
  const example = record(value)
  const id = record(example?.values)?.id
  if (!example || !isExampleId(id)) return null
  const title = text(example.title, MAX_EXAMPLE_TITLE) ?? text(example.name, MAX_EXAMPLE_TITLE)
  const mediaType = record(data.website_media_types)?.[`$.examples[${index}].media`]
  const thumbUrl =
    mediaUrl(origin, example.static_thumb) ??
    (isImageType(mediaType) ? mediaUrl(origin, example.media) : null)
  if (!title || !thumbUrl) return null
  const shown = record(example.presentation)?.kind
  return { id, title, kind: kindOfType(mediaType) ?? exampleKind(shown), thumbUrl }
}

function isFromAnotherService(example: Json): boolean {
  return typeof example.source === 'string' && example.source.trim() !== ''
}

function websiteExample(origin: string, value: unknown): CatalogExample | null {
  const example = record(value)
  const id = example?.id
  if (!example || !isExampleId(id) || isFromAnotherService(example)) return null
  const title = text(example.title, MAX_EXAMPLE_TITLE)
  const kind = exampleKind(example.kind)
  const poster = isAppsPath(example.poster) ? example.poster : null
  const picture = poster ?? (kind === 'image' ? example.src : null)
  if (!title || !isAppsPath(picture)) return null
  return { id, title, kind, thumbUrl: `${origin}${picture}` }
}

export type DesktopFields = Pick<CatalogApp, 'page' | 'runsOn' | 'accent' | 'examples'>

function catalogApp(
  origin: string,
  item: unknown,
  known: ReadonlyMap<string, DesktopFields>
): CatalogApp | null {
  const data = record(record(item)?.data)
  if (!data || (data.type !== undefined && data.type !== 'app')) return null
  const desktop = record(record(data.compatibility)?.desktop)
  const id = typeof data.slug === 'string' && SLUG.test(data.slug) ? data.slug : null
  const title = text(data.title, MAX_TITLE)
  if (!id || !title) return null
  const fromWebsite = known.get(id)
  const fields: DesktopFields | null =
    desktop && isAppsPath(desktop.page)
      ? {
          page: desktop.page,
          runsOn: runsOn(desktop.runs_on),
          accent: accent(desktop.accent),
          examples: fromWebsite?.examples ?? []
        }
      : (fromWebsite ?? null)
  if (!fields) return null
  const own = examplesOf(data.examples, (example, index) =>
    catalogExample(origin, data, example, index)
  )
  return {
    id,
    title,
    description: text(data.description, MAX_DESCRIPTION) ?? '',
    ...fields,
    sortOrder: sortOrder(data.sort_order),
    coverUrl: catalogCover(origin, data),
    examples: own.length ? own : fields.examples
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
    coverUrl: isAppsPath(app.cover) ? `${origin}${app.cover}` : null,
    examples: examplesOf(app.examples, (example) => websiteExample(origin, example))
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

export function catalogApps(
  raw: unknown,
  catalogOrigin: string,
  known: ReadonlyMap<string, DesktopFields> = new Map()
): CatalogApp[] {
  const items = record(raw)?.items
  if (!Array.isArray(items)) return []
  return ordered(items.map((item) => catalogApp(catalogOrigin, item, known)))
}

export function desktopFields(apps: readonly CatalogApp[]): Map<string, DesktopFields> {
  return new Map(
    apps.map((app) => [
      app.id,
      { page: app.page, runsOn: app.runsOn, accent: app.accent, examples: app.examples }
    ])
  )
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
  const appsOrigin = sources.appsOrigin
  const [items, fromWebsite] = await Promise.all([
    readCatalogItems(sources.catalogOrigin).catch(() => []),
    appsOrigin
      ? withTimeout(fetchJSON(`${appsOrigin}/apps/apps.json`), FETCH_TIMEOUT_MS).then(
          (raw) => websiteApps(raw, appsOrigin),
          () => [] as CatalogApp[]
        )
      : Promise.resolve([] as CatalogApp[])
  ])
  const fromCatalog = catalogApps({ items }, sources.catalogOrigin, desktopFields(fromWebsite))
  if (fromCatalog.length) return { source: 'catalog', apps: fromCatalog }
  if (!appsOrigin) throw new Error('No apps address is set.')
  if (!fromWebsite.length) throw new Error('No apps are listed yet.')
  return { source: 'website', apps: fromWebsite }
}

const coverUrls = new Map<string, string>()
const exampleThumbUrls = new Map<string, string>()
const images = new Map<string, Promise<string | null>>()

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

interface GalleryEntry {
  example: AppExample
  thumbUrl: string
}

function appGallery(app: CatalogApp): GalleryEntry[] {
  return app.examples.flatMap((found) => {
    const page = examplePage(app.page, found.id)
    if (!page) return []
    const example: AppExample = {
      key: `${app.id}/${found.id}`,
      appId: app.id,
      appTitle: app.title,
      title: found.title,
      kind: found.kind,
      page
    }
    return [{ example, thumbUrl: found.thumbUrl }]
  })
}

function gallery(apps: readonly CatalogApp[]): GalleryEntry[] {
  const lists = apps.map(appGallery)
  const longest = Math.max(0, ...lists.map((list) => list.length))
  const mixed: GalleryEntry[] = []
  for (let round = 0; round < longest; round++) {
    for (const list of lists) {
      const entry = list[round]
      if (entry && mixed.length < MAX_GALLERY_EXAMPLES) mixed.push(entry)
    }
  }
  return mixed
}

export function toListing(loaded: {
  source: AppsListing['source']
  apps: CatalogApp[]
}): AppsListing {
  coverUrls.clear()
  exampleThumbUrls.clear()
  for (const app of loaded.apps) if (app.coverUrl) coverUrls.set(app.id, app.coverUrl)
  const examples = gallery(loaded.apps)
  for (const { example, thumbUrl } of examples) exampleThumbUrls.set(example.key, thumbUrl)
  return {
    source: loaded.source,
    apps: loaded.apps.map(toCard),
    examples: examples.map((entry) => entry.example)
  }
}

export async function listApps(): Promise<AppsListing> {
  return toListing(await loadApps())
}

async function readImage(url: string, maxBytes: number): Promise<string | null> {
  const res = await withTimeout(net.fetch(url), COVER_TIMEOUT_MS)
  const type = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  const announced = Number(res.headers.get('content-length'))
  if (!res.ok || !COVER_TYPES.has(type) || announced > maxBytes) {
    await res.body?.cancel().catch(() => {})
    return null
  }
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.byteLength > maxBytes) return null
  return `data:${type};base64,${bytes.toString('base64')}`
}

function cachedImage(url: string | undefined, maxBytes: number): Promise<string | null> {
  if (!url) return Promise.resolve(null)
  let image = images.get(url)
  if (!image) {
    image = readImage(url, maxBytes).catch(() => null)
    images.set(url, image)
    void image.then((found) => {
      if (!found) images.delete(url)
    })
  }
  return image
}

export function appCover(appId: unknown): Promise<string | null> {
  const url = typeof appId === 'string' ? coverUrls.get(appId) : undefined
  return cachedImage(url, MAX_COVER_BYTES)
}

export function appExampleThumb(key: unknown): Promise<string | null> {
  const url = typeof key === 'string' ? exampleThumbUrls.get(key) : undefined
  return cachedImage(url, MAX_EXAMPLE_THUMB_BYTES)
}

export function _resetAppsCatalogForTest(): void {
  coverUrls.clear()
  exampleThumbUrls.clear()
  images.clear()
}
