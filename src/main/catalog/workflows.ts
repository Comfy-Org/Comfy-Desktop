import semver from 'semver'
import { readOpenRequest } from '../apps/openRequest'
import { CLOUD_CONFIG } from '../cloud/config'
import { fetchJSON } from '../lib/fetch'
import { isTrustedCloudUrl } from '../lib/trustedCloudUrl'
import type { CatalogWorkflow } from '../../types/ipc'

export const HUB_ORIGIN = 'https://comfy.org'
export const HOME_WORKFLOW_LIMIT = 12

const HUB_WORKFLOW_PATH_PREFIX = '/hub/workflows/'
const CATALOG_PAGE_SIZE = 100
const MAX_CATALOG_PAGES = 100
const WORKFLOW_FILE_KEYS = ['$.workflow_files[0].file', '$.workflow_versions[0].download'] as const
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
  editorGraphUrl: string | null
  cloudPrompt: Record<string, unknown> | null
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) return null
  return value.trim() || null
}

export function catalogWorkflowsUrl(
  surface: string | null,
  limit = HOME_WORKFLOW_LIMIT,
  cursor?: string
): string {
  const url = new URL('/api/v1/catalog/items', CLOUD_CONFIG.issuer)
  url.searchParams.set('type', 'workflow')
  if (surface) url.searchParams.set('surface', surface)
  url.searchParams.set('limit', String(limit))
  if (cursor) url.searchParams.set('cursor', cursor)
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

function editorGraphUrlFor(data: JsonRecord): string | null {
  const media = asRecord(data.website_media)
  const mediaTypes = asRecord(data.website_media_types)
  for (const key of WORKFLOW_FILE_KEYS) {
    const mediaPath = media?.[key]
    if (typeof mediaPath !== 'string' || mediaTypes?.[key] !== 'application/json') continue
    const match = /^\/catalog-media\/([a-z0-9_-]+\/[a-z0-9_-]+)$/i.exec(mediaPath)
    if (match) return new URL(`/api/v1/catalog/media/${match[1]}`, CLOUD_CONFIG.issuer).href
  }
  return null
}

function hasCloudShare(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    isTrustedCloudUrl(value) &&
    Boolean(new URL(value).searchParams.get('share'))
  )
}

export function toCatalogWorkflow(item: unknown, locale: string): ResolvedWorkflow | null {
  const record = asRecord(item)
  const data = asRecord(record?.data)
  if (!record || !data || record.deleted === true || record.enabled === false) return null
  const id = text(record.uid)
  const hubUrl = hubUrlFor(record.slug)
  const translation = locale.startsWith('en') ? null : translationFor(data, locale)
  const title = text(translation?.title) ?? text(data.title)
  if (!id || !hubUrl || !title) return null
  const website = asRecord(asRecord(data.compatibility)?.website)
  const cloud = asRecord(asRecord(website?.workflow)?.cloud)
  const minimum = text(data.min_comfyui_version)
  const editorGraphUrl = editorGraphUrlFor(data)
  const openRequest = readOpenRequest({ prompt: cloud?.workflow, where: 'cloud', name: title })
  const cloudPrompt = typeof openRequest === 'string' ? null : openRequest.prompt
  return {
    hubUrl,
    editorGraphUrl,
    cloudPrompt,
    card: {
      id,
      title,
      description: text(translation?.description) ?? text(data.description) ?? '',
      thumbnailUrl: thumbnailUrlFor(data),
      minComfyUIVersion: minimum ? semver.valid(minimum) : null,
      canOpenLocal: editorGraphUrl !== null,
      canOpenCloud:
        cloudPrompt !== null ||
        (editorGraphUrl !== null &&
          (website?.type === 'CLOUD' || hasCloudShare(data.cloud_share_url)))
    }
  }
}

function parseCatalogPage(
  raw: unknown,
  locale: string
): { workflows: ResolvedWorkflow[]; nextCursor: string | null } {
  const page = asRecord(raw)
  if (!page || !Array.isArray(page.items)) throw new Error('Catalog response has no items list')
  const workflows = page.items.flatMap((item) => {
    const workflow = toCatalogWorkflow(item, locale)
    return workflow === null ? [] : [workflow]
  })
  const nextCursor = page.has_more === true ? text(page.next_cursor) : null
  if (page.has_more === true && nextCursor === null) {
    throw new Error('Catalog response is missing the next cursor')
  }
  return { workflows, nextCursor }
}

function uniqueWorkflows(workflows: ResolvedWorkflow[]): ResolvedWorkflow[] {
  const seen = new Set<string>()
  return workflows.filter(({ card }) => {
    if (seen.has(card.id)) return false
    seen.add(card.id)
    return true
  })
}

async function fetchPage(url: string): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fetchJSON(url, { refresh: true }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Catalog workflows request timed out')),
          FETCH_TIMEOUT_MS
        )
        timer.unref?.()
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function homePage(surface: string | null, locale: string): Promise<ResolvedWorkflow[]> {
  const { workflows } = parseCatalogPage(await fetchPage(catalogWorkflowsUrl(surface)), locale)
  return uniqueWorkflows(workflows).slice(0, HOME_WORKFLOW_LIMIT)
}

async function fetchHomeWorkflows(locale: string): Promise<ResolvedWorkflow[]> {
  const forDesktop = await homePage(DESKTOP_SURFACE, locale)
  return forDesktop.length > 0 ? forDesktop : homePage(null, locale)
}

async function fetchCatalogWorkflows(locale: string): Promise<ResolvedWorkflow[]> {
  const workflows: ResolvedWorkflow[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  do {
    const url = catalogWorkflowsUrl(null, CATALOG_PAGE_SIZE, cursor)
    const page = parseCatalogPage(await fetchPage(url), locale)
    workflows.push(...page.workflows)
    cursor = page.nextCursor ?? undefined
    if (cursor) {
      if (seen.size >= MAX_CATALOG_PAGES || seen.has(cursor)) {
        throw new Error('Catalog workflow pagination did not finish')
      }
      seen.add(cursor)
    }
  } while (cursor)
  return uniqueWorkflows(workflows)
}

interface CacheEntry {
  locale: string
  loadedAt: number
  workflows: ResolvedWorkflow[]
}

function workflowCache(fetchWorkflows: (locale: string) => Promise<ResolvedWorkflow[]>) {
  let cache: CacheEntry | null = null
  let inFlight: { locale: string; request: Promise<ResolvedWorkflow[]> } | null = null
  return {
    async cards(locale: string): Promise<CatalogWorkflow[]> {
      if (cache?.locale === locale && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
        return cache.workflows.map(({ card }) => card)
      }
      if (inFlight?.locale === locale) {
        return (await inFlight.request).map(({ card }) => card)
      }
      const request = fetchWorkflows(locale)
        .then((workflows) => {
          if (inFlight?.request === request) cache = { locale, loadedAt: Date.now(), workflows }
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
      return (await request).map(({ card }) => card)
    },
    get entry(): CacheEntry | null {
      return cache
    },
    reset(): void {
      cache = null
      inFlight = null
    }
  }
}

const home = workflowCache(fetchHomeWorkflows)
const catalog = workflowCache(fetchCatalogWorkflows)

export function listHomeWorkflows(locale: string): Promise<CatalogWorkflow[]> {
  return home.cards(locale)
}

export function listCatalogWorkflows(locale: string): Promise<CatalogWorkflow[]> {
  return catalog.cards(locale)
}

export function listedWorkflow(id: string): ResolvedWorkflow | undefined {
  const entries = [home.entry, catalog.entry].filter((entry) => entry !== null)
  entries.sort((a, b) => b.loadedAt - a.loadedAt)
  return entries.flatMap(({ workflows }) => workflows).find(({ card }) => card.id === id)
}

export function hubUrlForListedWorkflow(id: string): string | null {
  return listedWorkflow(id)?.hubUrl ?? null
}

export function _resetCatalogWorkflowsForTest(): void {
  home.reset()
  catalog.reset()
}
