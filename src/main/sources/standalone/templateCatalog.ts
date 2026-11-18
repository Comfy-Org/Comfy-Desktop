import { fetchJSON } from '../../lib/fetch'
import type { FieldOption } from '../../types/sources'
import {
  INDEX_URL,
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
  templates?: unknown
}

interface IndexLocation {
  entry: IndexEntry
  category: string
}

function indexById(index: unknown): Map<string, IndexLocation> {
  const byId = new Map<string, IndexLocation>()
  if (!Array.isArray(index)) return byId
  for (const rawCategory of index) {
    if (!rawCategory || typeof rawCategory !== 'object') continue
    const category = rawCategory as IndexCategory
    const categoryTitle = typeof category.title === 'string' ? category.title : ''
    if (!Array.isArray(category.templates)) continue
    for (const rawEntry of category.templates) {
      if (!rawEntry || typeof rawEntry !== 'object') continue
      const entry = rawEntry as IndexEntry
      if (typeof entry.name !== 'string' || byId.has(entry.name)) continue
      byId.set(entry.name, { entry, category: categoryTitle })
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
  location: IndexLocation | undefined
  snapshot: TemplateSnapshot
}): HydratedTemplate {
  const { id, modality, recommended, location, snapshot } = card
  const entry = location?.entry

  const title = typeof entry?.title === 'string' ? entry.title : snapshot.title
  const description =
    typeof entry?.description === 'string' ? entry.description : snapshot.description
  const sizeBytes =
    typeof entry?.size === 'number' && entry.size > 0 ? entry.size : snapshot.sizeBytes
  const mediaSubtype =
    typeof entry?.mediaSubtype === 'string' ? entry.mediaSubtype : snapshot.mediaSubtype

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
    apiNode: false,
    thumbnailUrl: thumbnailUrlFor(id, mediaSubtype),
    category: location?.category ?? ''
  }
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
      location: byId.get(id),
      snapshot
    })
  )
}
