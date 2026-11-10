import { fetchJSON } from '../../lib/fetch'
import type { FieldOption } from '../../types/sources'
import { loadStarterTemplates, _resetStarterTemplatesForTest } from './remoteStarterTemplates'
import {
  INDEX_URL,
  TEMPLATE_MODALITY_ORDER,
  thumbnailUrlFor,
  type TemplateModality,
  type TemplateSnapshot
} from './curatedTemplates'

export interface HydratedTemplate {
  id: string
  modality: TemplateModality
  recommended: boolean
  title: string
  name: string
  task: string
  description: string
  sizeBytes: number
  apiNode: boolean
  thumbnailUrl: string | null
  category: string
}

interface IndexEntry {
  name: string
  title?: unknown
  description?: unknown
  size?: unknown
  mediaSubtype?: unknown
  tags?: unknown
}

interface IndexCategory {
  title?: unknown
  type?: unknown
  templates?: unknown
}

interface IndexLocation {
  entry: IndexEntry
  category: string
  modality: TemplateModality | null
}

function modalityFromType(type: unknown): TemplateModality | null {
  return typeof type === 'string' && (TEMPLATE_MODALITY_ORDER as readonly string[]).includes(type)
    ? (type as TemplateModality)
    : null
}

function indexById(index: unknown): Map<string, IndexLocation> {
  const byId = new Map<string, IndexLocation>()
  if (!Array.isArray(index)) return byId
  for (const rawCategory of index) {
    if (!rawCategory || typeof rawCategory !== 'object') continue
    const category = rawCategory as IndexCategory
    const categoryTitle = typeof category.title === 'string' ? category.title : ''
    const modality = modalityFromType(category.type)
    if (!Array.isArray(category.templates)) continue
    for (const rawEntry of category.templates) {
      if (!rawEntry || typeof rawEntry !== 'object') continue
      const entry = rawEntry as IndexEntry
      if (typeof entry.name !== 'string' || byId.has(entry.name)) continue
      byId.set(entry.name, { entry, category: categoryTitle, modality })
    }
  }
  return byId
}

const NON_TASK_TAGS = new Set(['image', 'video', 'audio', '3d', '3d model', 'api'])

const DEFAULT_TASK: Record<TemplateModality, string> = {
  image: 'Text to Image',
  video: 'Text to Video',
  audio: 'Text to Audio',
  '3d': 'Image to 3D'
}

function taskOf(tags: unknown, modality: TemplateModality): string {
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (typeof tag !== 'string') continue
      const trimmed = tag.trim()
      if (trimmed && !NON_TASK_TAGS.has(trimmed.toLowerCase())) return trimmed
    }
  }
  return DEFAULT_TASK[modality]
}

function nameOf(title: string, task: string): string {
  const beforeColon = title.split(':')[0]!.trim()
  if (task && beforeColon.toLowerCase().endsWith(task.toLowerCase())) {
    const stripped = beforeColon.slice(0, beforeColon.length - task.length).trim()
    if (stripped) return stripped
  }
  return beforeColon || title
}

function hydrateOne(card: {
  id: string
  modality: TemplateModality
  recommended: boolean
  apiNode: boolean
  location: IndexLocation | undefined
  snapshot?: TemplateSnapshot
}): HydratedTemplate {
  const { id, modality, recommended, apiNode, location, snapshot } = card
  const entry = location?.entry

  const title = typeof entry?.title === 'string' ? entry.title : (snapshot?.title ?? id)
  const description =
    typeof entry?.description === 'string' ? entry.description : (snapshot?.description ?? '')
  const sizeBytes =
    typeof entry?.size === 'number' && entry.size > 0 ? entry.size : (snapshot?.sizeBytes ?? 0)
  const mediaSubtype =
    typeof entry?.mediaSubtype === 'string'
      ? entry.mediaSubtype
      : (snapshot?.mediaSubtype ?? 'webp')

  const task = taskOf(entry?.tags, modality)

  return {
    id,
    modality,
    recommended,
    title,
    name: nameOf(title, task),
    task,
    description,
    sizeBytes,
    apiNode,
    thumbnailUrl: thumbnailUrlFor(id, mediaSubtype),
    category: location?.category ?? ''
  }
}

function byModalityOrder(a: HydratedTemplate, b: HydratedTemplate): number {
  return TEMPLATE_MODALITY_ORDER.indexOf(a.modality) - TEMPLATE_MODALITY_ORDER.indexOf(b.modality)
}

const CATALOG_TTL_MS = 60_000
let catalogInFlight: Promise<HydratedTemplate[]> | null = null
let catalogCache: { at: number; value: HydratedTemplate[] } | null = null

export function loadTemplateCatalog(): Promise<HydratedTemplate[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return Promise.resolve(catalogCache.value)
  }
  if (catalogInFlight) return catalogInFlight
  catalogInFlight = loadTemplateCatalogUncached()
    .then((value) => {
      catalogCache = { at: Date.now(), value }
      return value
    })
    .finally(() => {
      catalogInFlight = null
    })
  return catalogInFlight
}

export function resetTemplateCatalogCache(): void {
  catalogInFlight = null
  catalogCache = null
  _resetStarterTemplatesForTest()
}

async function loadTemplateCatalogUncached(): Promise<HydratedTemplate[]> {
  const [starterTemplates, index] = await Promise.all([
    loadStarterTemplates(),
    fetchJSON(INDEX_URL).catch(() => null)
  ])

  const byId = index ? indexById(index) : new Map<string, IndexLocation>()
  const online = byId.size > 0

  const used = new Set<string>()
  const catalog: HydratedTemplate[] = []
  for (const curated of starterTemplates) {
    if (!curated?.id || used.has(curated.id) || !curated.snapshot) continue

    const recommended = curated.recommended === true
    const apiNode = curated.apiNode === true

    const { modality, snapshot } = curated
    const location = byId.get(curated.id)
    if (location || !online) {
      used.add(curated.id)
      catalog.push(
        hydrateOne({ id: curated.id, modality, recommended, apiNode, location, snapshot })
      )
      continue
    }

    const sub = apiNode ? null : firstUnusedOfModality(byId, modality, used)
    if (sub) {
      used.add(sub.entry.name)
      catalog.push(
        hydrateOne({ id: sub.entry.name, modality, recommended, apiNode: false, location: sub })
      )
    } else {
      used.add(curated.id)
      catalog.push(
        hydrateOne({
          id: curated.id,
          modality,
          recommended,
          apiNode,
          location: undefined,
          snapshot
        })
      )
    }
  }
  return catalog.sort(byModalityOrder)
}

export function toTemplateFieldOption(
  template: HydratedTemplate,
  modelsPresent: boolean
): FieldOption {
  return {
    value: template.id,
    label: template.title,
    description: template.description,
    recommended: template.recommended,
    data: {
      modality: template.modality,
      category: template.category,
      name: template.name,
      task: template.task,
      thumbnailUrl: template.thumbnailUrl,
      sizeBytes: template.sizeBytes,
      modelsPresent,
      apiNode: template.apiNode
    }
  }
}

export async function hydrateTemplates(
  templates: ReadonlyArray<{
    id: string
    modality: TemplateModality
    recommended?: boolean
    snapshot: TemplateSnapshot
  }>
): Promise<HydratedTemplate[]> {
  const index = await fetchJSON(INDEX_URL).catch(() => null)
  const byId = index ? indexById(index) : new Map<string, IndexLocation>()
  return templates.map(({ id, modality, recommended, snapshot }) =>
    hydrateOne({
      id,
      modality,
      recommended: recommended === true,
      apiNode: false,
      location: byId.get(id),
      snapshot
    })
  )
}

function firstUnusedOfModality(
  byId: Map<string, IndexLocation>,
  modality: TemplateModality,
  used: Set<string>
): IndexLocation | null {
  for (const location of byId.values()) {
    const { entry } = location
    if (location.modality !== modality || used.has(entry.name)) continue
    if (entry.name.startsWith('api_')) continue
    if (typeof entry.size !== 'number' || entry.size <= 0) continue
    return location
  }
  return null
}
