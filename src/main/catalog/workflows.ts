import { CLOUD_CONFIG } from '../cloud/config'
import { fetchJSON } from '../lib/fetch'
import type { CatalogWorkflow } from '../../types/ipc'

export const HUB_ORIGIN = 'https://comfy.org'
export const HUB_WORKFLOWS_URL = `${HUB_ORIGIN}/hub/workflows`
export const HOME_WORKFLOW_LIMIT = 12

const HUB_WORKFLOW_PATH_PREFIX = '/hub/workflows/'
const CATALOG_MEDIA_PATH_PREFIX = '/catalog-media/'
const DESKTOP_SURFACE = 'desktop_starters'
const FETCH_TIMEOUT_MS = 8000
const CACHE_TTL_MS = 10 * 60 * 1000
const MAX_TEXT_LENGTH = 4096
const THUMBNAIL_KEYS = ['$.static_thumb', '$.thumbnail', '$.hero'] as const
const IMAGE_TYPE_PREFIX = 'image/'

interface ResolvedWorkflow {
  card: CatalogWorkflow
  hubUrl: string
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) return null
  return value.trim() || null
}

export function catalogWorkflowsUrl(surface: string | null): string {
  const url = new URL('/api/v1/catalog/items', CLOUD_CONFIG.issuer)
  url.searchParams.set('type', 'workflow')
  if (surface) url.searchParams.set('surface', surface)
  url.searchParams.set('limit', String(HOME_WORKFLOW_LIMIT))
  return url.toString()
}

function translationFor(data: JsonRecord, locale: string): JsonRecord | null {
  const translations = asRecord(data.translations)
  if (!translations) return null
  const exact = asRecord(translations[locale])
  if (exact) return exact
  const language = locale.split('-')[0]
  const sameLanguage = Object.keys(translations).find((key) => key.split('-')[0] === language)
  return sameLanguage ? asRecord(translations[sameLanguage]) : null
}

function hubUrlFor(slug: unknown): string | null {
  if (typeof slug !== 'string') return null
  let url: URL
  try {
    url = new URL(slug, HUB_ORIGIN)
  } catch {
    return null
  }
  if (url.origin !== HUB_ORIGIN) return null
  if (!url.pathname.startsWith(HUB_WORKFLOW_PATH_PREFIX)) return null
  if (url.pathname.length === HUB_WORKFLOW_PATH_PREFIX.length) return null
  return `${HUB_ORIGIN}${url.pathname}`
}

function thumbnailUrlFor(data: JsonRecord): string | null {
  const media = asRecord(data.website_media)
  const mediaTypes = asRecord(data.website_media_types)
  if (!media) return null
  for (const key of THUMBNAIL_KEYS) {
    const mediaPath = media[key]
    if (typeof mediaPath !== 'string' || !mediaPath.startsWith(CATALOG_MEDIA_PATH_PREFIX)) continue
    const mediaType = mediaTypes?.[key]
    if (typeof mediaType !== 'string' || !mediaType.startsWith(IMAGE_TYPE_PREFIX)) continue
    const url = new URL(mediaPath, HUB_ORIGIN)
    if (url.origin === HUB_ORIGIN) return url.toString()
  }
  return null
}

export function toCatalogWorkflow(item: unknown, locale: string): ResolvedWorkflow | null {
  const record = asRecord(item)
  const data = asRecord(record?.data)
  if (!record || !data) return null
  const id = text(record.uid)
  const hubUrl = hubUrlFor(record.slug)
  const translation = locale.startsWith('en') ? null : translationFor(data, locale)
  const title = text(translation?.title) ?? text(data.title)
  if (!id || !hubUrl || !title) return null
  return {
    hubUrl,
    card: {
      id,
      title,
      description: text(translation?.description) ?? text(data.description) ?? '',
      thumbnailUrl: thumbnailUrlFor(data)
    }
  }
}

export function parseCatalogWorkflows(raw: unknown, locale: string): ResolvedWorkflow[] {
  const items = asRecord(raw)?.items
  if (!Array.isArray(items)) throw new Error('Catalog response has no items list')
  const seen = new Set<string>()
  const workflows: ResolvedWorkflow[] = []
  for (const item of items) {
    const workflow = toCatalogWorkflow(item, locale)
    if (!workflow || seen.has(workflow.card.id)) continue
    seen.add(workflow.card.id)
    workflows.push(workflow)
  }
  return workflows.slice(0, HOME_WORKFLOW_LIMIT)
}

function fetchPage(surface: string | null): Promise<unknown> {
  return Promise.race([
    fetchJSON(catalogWorkflowsUrl(surface), { refresh: true }),
    new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error('Catalog workflows request timed out')),
        FETCH_TIMEOUT_MS
      ).unref?.()
    })
  ])
}

async function fetchHomeWorkflows(locale: string): Promise<ResolvedWorkflow[]> {
  const forDesktop = parseCatalogWorkflows(await fetchPage(DESKTOP_SURFACE), locale)
  if (forDesktop.length > 0) return forDesktop
  return parseCatalogWorkflows(await fetchPage(null), locale)
}

interface CacheEntry {
  locale: string
  loadedAt: number
  workflows: ResolvedWorkflow[]
}

let cache: CacheEntry | null = null
let inFlight: { locale: string; request: Promise<ResolvedWorkflow[]> } | null = null

function loadHomeWorkflows(locale: string): Promise<ResolvedWorkflow[]> {
  if (cache && cache.locale === locale && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return Promise.resolve(cache.workflows)
  }
  if (inFlight?.locale === locale) return inFlight.request
  const request = fetchHomeWorkflows(locale)
    .then((workflows) => {
      cache = { locale, loadedAt: Date.now(), workflows }
      return workflows
    })
    .catch((err: unknown) => {
      if (cache?.locale === locale) return cache.workflows
      throw err
    })
    .finally(() => {
      if (inFlight?.request === request) inFlight = null
    })
  inFlight = { locale, request }
  return request
}

export async function listHomeWorkflows(locale: string): Promise<CatalogWorkflow[]> {
  return (await loadHomeWorkflows(locale)).map((workflow) => workflow.card)
}

export function hubUrlForListedWorkflow(id: string): string | null {
  return cache?.workflows.find((workflow) => workflow.card.id === id)?.hubUrl ?? null
}

export function _resetCatalogWorkflowsForTest(): void {
  cache = null
  inFlight = null
}
