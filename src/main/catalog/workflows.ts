import semver from 'semver'
import { readOpenRequest } from '../apps/openRequest'
import { CLOUD_CONFIG } from '../cloud/config'
import { fetchJSON } from '../lib/fetch'
import { isTrustedCloudUrl } from '../lib/trustedCloudUrl'
import type { CatalogWorkflow, CatalogWorkflowLicense, CatalogWorkflowMedia } from '../../types/ipc'

export const HUB_ORIGIN = 'https://comfy.org'
export const HOME_WORKFLOW_LIMIT = 12

const HUB_WORKFLOW_PATH_PREFIX = '/hub/workflows/'
const CATALOG_PAGE_SIZE = 100
const MAX_CATALOG_PAGES = 100
const MAX_HOME_CATALOG_PAGES = 3
const TEMPLATE_INDEX_PATH = '/templates/index.json'
const WORKFLOW_FILE_KEYS = ['$.workflow_files[0].file', '$.workflow_versions[0].download'] as const
const CATALOG_MEDIA_PATH_PREFIX = '/catalog-media/'
const DESKTOP_SURFACE = 'desktop_starters'
const FETCH_TIMEOUT_MS = 8000
const CACHE_TTL_MS = 10 * 60 * 1000
const MAX_TEXT_LENGTH = 4096
const THUMBNAIL_KEYS = ['$.static_thumb', '$.thumbnail', '$.hero'] as const
const IMAGE_TYPE_PREFIX = 'image/'
const VIDEO_TYPE_PREFIX = 'video/'
const MAX_MEDIA = 6
const MAX_LIST_ITEMS = 24
const TUTORIAL_HOSTS = new Set(['docs.comfy.org', 'comfy.org', 'www.comfy.org'])

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

function templateIndexUrl(): string {
  return new URL(TEMPLATE_INDEX_PATH, CLOUD_CONFIG.issuer).toString()
}

interface TemplateIndex {
  nativeByName: Map<string, boolean>
  nativeByTitle: Map<string, boolean>
}

function listsCustomNodes(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false
  return !Array.isArray(value) || value.length > 0
}

function titleKey(title: string): string {
  return title.toLowerCase()
}

function noteTemplate(byKey: Map<string, boolean>, key: string, native: boolean): void {
  byKey.set(key, (byKey.get(key) ?? true) && native)
}

function parseTemplateIndex(raw: unknown): TemplateIndex {
  if (!Array.isArray(raw)) throw new Error('Template index is not a list of categories')
  const index: TemplateIndex = { nativeByName: new Map(), nativeByTitle: new Map() }
  for (const category of raw) {
    const templates = asRecord(category)?.templates
    if (!Array.isArray(templates)) continue
    for (const entry of templates) {
      const template = asRecord(entry)
      if (!template) continue
      const native = !listsCustomNodes(template.requiresCustomNodes)
      const name = text(template.name)
      const title = text(template.title)
      if (name) noteTemplate(index.nativeByName, name, native)
      if (title) noteTemplate(index.nativeByTitle, titleKey(title), native)
    }
  }
  return index
}

function isNativeTemplate(item: unknown, index: TemplateIndex): boolean {
  const data = asRecord(asRecord(item)?.data)
  if (!data || listsCustomNodes(data.requires_custom_nodes)) return false
  const name = text(data.template_name)
  const byName = name ? index.nativeByName.get(name) : undefined
  if (byName !== undefined) return byName
  const title = text(data.title)
  return title !== null && index.nativeByTitle.get(titleKey(title)) === true
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

function catalogMediaUrl(mediaPath: unknown): string | null {
  if (typeof mediaPath !== 'string' || !mediaPath.startsWith(CATALOG_MEDIA_PATH_PREFIX)) return null
  const url = new URL(mediaPath, HUB_ORIGIN)
  return url.origin === HUB_ORIGIN ? url.toString() : null
}

function mediaSize(value: unknown): [number | null, number | null] {
  if (!Array.isArray(value) || value.length !== 2) return [null, null]
  const [width, height] = value
  return typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0
    ? [width, height]
    : [null, null]
}

function mediaFor(data: JsonRecord): CatalogWorkflowMedia[] {
  const media = asRecord(data.website_media)
  const mediaTypes = asRecord(data.website_media_types)
  const sizes = asRecord(data.website_media_sizes)
  if (!media) return []
  const exampleKeys = Object.keys(media)
    .filter((key) => /^\$\.examples\[\d+\]\.media$/.test(key))
    .sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]))
  const found: CatalogWorkflowMedia[] = []
  for (const key of [...exampleKeys, '$.hero']) {
    const url = catalogMediaUrl(media[key])
    const type = mediaTypes?.[key]
    if (!url || typeof type !== 'string') continue
    const kind = type.startsWith(IMAGE_TYPE_PREFIX)
      ? 'image'
      : type.startsWith(VIDEO_TYPE_PREFIX)
        ? 'video'
        : null
    if (!kind) continue
    const [width, height] = mediaSize(sizes?.[key])
    found.push({ url, kind, width, height })
    if (found.length >= MAX_MEDIA) break
  }
  return found
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const items = value.flatMap((entry) => {
    const item = text(entry)
    return item && item.length <= 80 ? [item] : []
  })
  return [...new Set(items)].slice(0, MAX_LIST_ITEMS)
}

function modelsFor(data: JsonRecord, website: JsonRecord | null): string[] {
  const named = textList(website?.models)
  if (named.length > 0) return named
  const labels = Array.isArray(data.model_labels) ? data.model_labels : []
  return textList(labels.map((label) => asRecord(label)?.display_name)).slice(0, 1)
}

function licenseFor(data: JsonRecord): CatalogWorkflowLicense | null {
  if (data.open_source === true) return 'open-source'
  if (data.open_source === false) return 'partner'
  return textList(data.tags).includes('API') ? 'partner' : null
}

function countFor(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function dateFor(value: unknown): string | null {
  const date = text(value)
  return date && /^\d{4}-\d{2}-\d{2}/.test(date) && !Number.isNaN(Date.parse(date))
    ? date.slice(0, 10)
    : null
}

function tutorialUrlFor(value: unknown): string | null {
  const href = text(value)
  if (!href) return null
  try {
    const url = new URL(href)
    return url.protocol === 'https:' && TUTORIAL_HOSTS.has(url.hostname) ? url.toString() : null
  } catch {
    return null
  }
}

function authorFor(data: JsonRecord, website: JsonRecord | null): string | null {
  const author = text(asRecord(data.website_author)?.name) ?? text(website?.author)
  return author && author.length <= 80 ? author : null
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
      hubUrl,
      longDescription: text(translation?.long_description) ?? text(data.long_description),
      author: authorFor(data, website),
      generationType: text(data.generation_type) ?? text(website?.modality),
      useCases: textList(website?.categories),
      models: modelsFor(data, website),
      uses: countFor(data.usage),
      license: licenseFor(data),
      publishedAt: dateFor(data.date),
      media: mediaFor(data),
      tutorialUrl: tutorialUrlFor(data.documentation_url),
      canOpenLocal: editorGraphUrl !== null,
      canOpenCloud:
        (cloudPrompt !== null || editorGraphUrl !== null) &&
        (typeof data.works_on_cloud === 'boolean'
          ? data.works_on_cloud
          : cloudPrompt !== null ||
            website?.type === 'CLOUD' ||
            hasCloudShare(data.cloud_share_url))
    }
  }
}

function parseCatalogPage(
  raw: unknown,
  locale: string,
  keep: (item: unknown) => boolean = () => true
): { workflows: ResolvedWorkflow[]; nextCursor: string | null } {
  const page = asRecord(raw)
  if (!page || !Array.isArray(page.items)) throw new Error('Catalog response has no items list')
  const workflows = page.items.flatMap((item) => {
    if (!keep(item)) return []
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

async function withinTimeout<T>(request: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} request timed out`)), FETCH_TIMEOUT_MS)
        timer.unref?.()
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

function fetchPage(url: string): Promise<unknown> {
  return withinTimeout(fetchJSON(url, { refresh: true }), 'Catalog workflows')
}

async function fetchTemplateIndex(): Promise<TemplateIndex> {
  return parseTemplateIndex(await withinTimeout(fetchJSON(templateIndexUrl()), 'Template index'))
}

async function homeTemplates(
  surface: string | null,
  locale: string,
  templates: TemplateIndex
): Promise<ResolvedWorkflow[]> {
  const found: ResolvedWorkflow[] = []
  let cursor: string | undefined
  for (let pages = 0; pages < MAX_HOME_CATALOG_PAGES; pages++) {
    const url = catalogWorkflowsUrl(surface, CATALOG_PAGE_SIZE, cursor)
    const page = parseCatalogPage(await fetchPage(url), locale, (item) =>
      isNativeTemplate(item, templates)
    )
    found.push(...page.workflows)
    if (page.nextCursor === null || uniqueWorkflows(found).length >= HOME_WORKFLOW_LIMIT) break
    cursor = page.nextCursor
  }
  return uniqueWorkflows(found).slice(0, HOME_WORKFLOW_LIMIT)
}

async function fetchHomeWorkflows(locale: string): Promise<ResolvedWorkflow[]> {
  const templates = await fetchTemplateIndex()
  const forDesktop = await homeTemplates(DESKTOP_SURFACE, locale, templates)
  return forDesktop.length > 0 ? forDesktop : homeTemplates(null, locale, templates)
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

const listedById = new Map<string, ResolvedWorkflow>()

function rememberListed(workflows: ResolvedWorkflow[]): void {
  for (const workflow of workflows) listedById.set(workflow.card.id, workflow)
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
          rememberListed(workflows)
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
  return listedById.get(id)
}

export function hubUrlForListedWorkflow(id: string): string | null {
  return listedWorkflow(id)?.hubUrl ?? null
}

export function _resetCatalogWorkflowsForTest(): void {
  home.reset()
  catalog.reset()
  listedById.clear()
}
