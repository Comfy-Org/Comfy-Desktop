/**
 * Hydrates the curated starter-template manifest against the live
 * `comfyui_workflow_templates` index, so card metadata (title, description,
 * size, thumbnail) tracks upstream automatically instead of being hand-kept.
 *
 * One ETag-cached fetch per picker open (`fetchJSON` handles caching, R2-mirror
 * retry, and last-cached fallback on network failure); the index is flattened
 * once into a `Map` for O(1) lookup per curated id rather than rescanning its
 * ~500 entries. When the index can't be reached at all (cold cache, offline),
 * every template falls back to its inline `snapshot`, so the catalog is always
 * non-empty and the picker always renders.
 */
import { fetchJSON } from '../../lib/fetch'
import {
  CURATED_TEMPLATES,
  INDEX_URL,
  TEMPLATE_MODALITY_ORDER,
  thumbnailUrlFor,
  type TemplateModality,
  type TemplateSnapshot,
} from './curatedTemplates'

/** A curated template merged with its (optional) live index metadata, ready to
 *  render as a picker card. */
export interface HydratedTemplate {
  id: string
  modality: TemplateModality
  recommended: boolean
  title: string
  /** Short model name for the card (e.g. "Z-Image-Turbo") — the title minus its
   *  task suffix. */
  name: string
  /** Task descriptor for the card subtitle (e.g. "Text to Image", "Image Edit"),
   *  or '' when none. */
  task: string
  description: string
  /** Coarse total download estimate (bytes); 0 when unknown. */
  sizeBytes: number
  /** Card preview image URL, or `null` for non-image previews (audio → glyph). */
  thumbnailUrl: string | null
  /** Index `title` (e.g. "Image", "Video") of the category the template lives
   *  in upstream — carried for telemetry/sub-grouping, not the tab grouping. */
  category: string
}

/** The fields we read off a live index template entry. Everything is optional —
 *  upstream coverage varies — so hydration always tolerates a missing field. */
interface IndexEntry {
  name: string
  title?: unknown
  description?: unknown
  size?: unknown
  mediaSubtype?: unknown
  tags?: unknown
}

/** A live index category: `{ title, type, templates: [...] }`. */
interface IndexCategory {
  title?: unknown
  type?: unknown
  templates?: unknown
}

interface IndexLocation {
  entry: IndexEntry
  category: string
  /** The category's `type`, when it's one of our modalities — used to pick a
   *  same-category substitute for a curated id that's vanished upstream. */
  modality: TemplateModality | null
}

function modalityFromType(type: unknown): TemplateModality | null {
  return typeof type === 'string' && (TEMPLATE_MODALITY_ORDER as readonly string[]).includes(type)
    ? (type as TemplateModality)
    : null
}

/**
 * Flatten the index (an array of categories) into `id → { entry, category }`.
 * First occurrence of an id wins, matching the upstream gallery's de-dup. Any
 * structurally-unexpected element is skipped rather than throwing, so a single
 * malformed entry can't sink the whole catalog.
 */
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

/** Bare modality labels that aren't a task — dropped when picking the task tag. */
const MODALITY_TAGS = new Set(['image', 'video', 'audio', '3d'])

/** Subtitle shown when a template's `tags` carry no specific task, so a card is
 *  never left with a blank descriptor (e.g. Wan Fun Camera, tags: ['Video']). */
const DEFAULT_TASK: Record<TemplateModality, string> = {
  image: 'Text to Image',
  video: 'Text to Video',
  audio: 'Text to Audio',
  '3d': 'Image to 3D',
}

/** The template's task (e.g. "Text to Image", "Image Edit") from its `tags`,
 *  skipping the bare modality label; falls back to the modality default. */
function taskOf(tags: unknown, modality: TemplateModality): string {
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (typeof tag !== 'string') continue
      const trimmed = tag.trim()
      if (trimmed && !MODALITY_TAGS.has(trimmed.toLowerCase())) return trimmed
    }
  }
  return DEFAULT_TASK[modality]
}

/** Short card name: the title up to its `:` separator, then with a trailing task
 *  phrase stripped ("Z-Image-Turbo Text to Image" → "Z-Image-Turbo"). Falls back
 *  to the whole title when nothing is strippable. */
function nameOf(title: string, task: string): string {
  const beforeColon = title.split(':')[0]!.trim()
  if (task && beforeColon.toLowerCase().endsWith(task.toLowerCase())) {
    const stripped = beforeColon.slice(0, beforeColon.length - task.length).trim()
    if (stripped) return stripped
  }
  return beforeColon || title
}

/** Build a card from a template `id` + its live index location (when present),
 *  preferring live metadata and falling back to the offline `snapshot` (which a
 *  substituted, non-curated id won't have). */
function hydrateOne(
  id: string,
  modality: TemplateModality,
  recommended: boolean,
  location: IndexLocation | undefined,
  snapshot?: TemplateSnapshot,
): HydratedTemplate {
  const entry = location?.entry

  const title =
    typeof entry?.title === 'string' ? entry.title : (snapshot?.title ?? id)
  const description =
    typeof entry?.description === 'string' ? entry.description : (snapshot?.description ?? '')
  const sizeBytes =
    typeof entry?.size === 'number' && entry.size > 0 ? entry.size : (snapshot?.sizeBytes ?? 0)
  const mediaSubtype =
    typeof entry?.mediaSubtype === 'string' ? entry.mediaSubtype : (snapshot?.mediaSubtype ?? 'webp')

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
    thumbnailUrl: thumbnailUrlFor(id, mediaSubtype),
    category: location?.category ?? '',
  }
}

/** Stable ordering for the picker: modality tab order, then curated order
 *  within a modality. */
function byModalityOrder(a: HydratedTemplate, b: HydratedTemplate): number {
  return TEMPLATE_MODALITY_ORDER.indexOf(a.modality) - TEMPLATE_MODALITY_ORDER.indexOf(b.modality)
}

/**
 * Resolve the curated manifest into renderable cards, hydrated from the live
 * index where reachable. Defensive by contract: never throws and never returns
 * a card the picker can't render —
 *   - a failed/garbage index fetch yields a snapshot-only catalog,
 *   - a duplicate curated id (dev typo) is collapsed to its first occurrence,
 *   - a curated entry missing its required snapshot (dev edit) is dropped, not
 *     surfaced as a broken card.
 * So renaming/removing a template upstream, or fat-fingering the manifest, can
 * only ever shrink the offering — it can't crash the picker.
 */
/** Coalesces the wizard's field-options read and the thumbnail warm-up — which
 *  fire together at picker open — into one index fetch; a later open refetches. */
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

/** Drops the memoized catalog so the next read refetches. Test-only. */
export function resetTemplateCatalogCache(): void {
  catalogInFlight = null
  catalogCache = null
}

async function loadTemplateCatalogUncached(): Promise<HydratedTemplate[]> {
  let byId: Map<string, IndexLocation>
  try {
    byId = indexById(await fetchJSON(INDEX_URL))
  } catch {
    byId = new Map()
  }
  // Only substitute when we actually have a live index to substitute FROM —
  // an empty map means offline, where the curated snapshot is the right fallback.
  const online = byId.size > 0

  const used = new Set<string>()
  const catalog: HydratedTemplate[] = []
  for (const curated of CURATED_TEMPLATES) {
    if (!curated?.id || used.has(curated.id) || !curated.snapshot) continue

    const location = byId.get(curated.id)
    if (location || !online) {
      used.add(curated.id)
      catalog.push(
        hydrateOne(curated.id, curated.modality, curated.recommended === true, location, curated.snapshot)
      )
      continue
    }

    // Curated id has vanished upstream: show the first live template of the same
    // modality we haven't already used, so the slot still offers a real,
    // installable pick rather than a stale snapshot card.
    const sub = firstUnusedOfModality(byId, curated.modality, used)
    if (sub) {
      used.add(sub.entry.name)
      catalog.push(hydrateOne(sub.entry.name, curated.modality, curated.recommended === true, sub))
    } else {
      used.add(curated.id)
      catalog.push(
        hydrateOne(curated.id, curated.modality, curated.recommended === true, undefined, curated.snapshot)
      )
    }
  }
  return catalog.sort(byModalityOrder)
}

/** First unused, locally-installable index template of `modality` — skips
 *  API/cloud entries (`api_*`) and size-less ones, since a substitute fills a
 *  local download slot the disk-space gate sizes off `sizeBytes`. */
function firstUnusedOfModality(
  byId: Map<string, IndexLocation>,
  modality: TemplateModality,
  used: Set<string>,
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
