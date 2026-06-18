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
  type CuratedTemplate,
  type TemplateModality,
} from './curatedTemplates'

/** A curated template merged with its (optional) live index metadata, ready to
 *  render as a picker card. */
export interface HydratedTemplate {
  id: string
  modality: TemplateModality
  recommended: boolean
  title: string
  description: string
  /** Coarse total download estimate (bytes); 0 when unknown. */
  sizeBytes: number
  /** Card preview image URL, or `null` for non-image previews (audio → glyph). */
  thumbnailUrl: string | null
  /** Index `title` (e.g. "Image", "Video") of the category the template lives
   *  in upstream — carried for telemetry/sub-grouping, not the tab grouping. */
  category: string
  previewKind: 'animated' | 'static'
}

/** The fields we read off a live index template entry. Everything is optional —
 *  upstream coverage varies — so hydration always tolerates a missing field. */
interface IndexEntry {
  name: string
  title?: unknown
  description?: unknown
  size?: unknown
  mediaSubtype?: unknown
  thumbnail?: unknown
}

/** A live index category: `{ title, type, templates: [...] }`. */
interface IndexCategory {
  title?: unknown
  templates?: unknown
}

interface IndexLocation {
  entry: IndexEntry
  category: string
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

/** Animated when the live entry's thumbnail is a video file; otherwise still. */
function previewKindOf(entry: IndexEntry | undefined): 'animated' | 'static' {
  const thumbs = entry?.thumbnail
  if (Array.isArray(thumbs) && thumbs.some((t) => typeof t === 'string' && t.endsWith('.mp4'))) {
    return 'animated'
  }
  return 'static'
}

/** Merge one curated template with its live index location (when present),
 *  preferring live metadata and falling back to the offline snapshot. */
function hydrateOne(curated: CuratedTemplate, location: IndexLocation | undefined): HydratedTemplate {
  const entry = location?.entry
  const { snapshot } = curated

  const title = typeof entry?.title === 'string' ? entry.title : snapshot.title
  const description =
    typeof entry?.description === 'string' ? entry.description : snapshot.description
  const sizeBytes =
    typeof entry?.size === 'number' && entry.size > 0 ? entry.size : snapshot.sizeBytes
  const mediaSubtype =
    typeof entry?.mediaSubtype === 'string' ? entry.mediaSubtype : snapshot.mediaSubtype

  return {
    id: curated.id,
    modality: curated.modality,
    recommended: curated.recommended === true,
    title,
    description,
    sizeBytes,
    thumbnailUrl: thumbnailUrlFor(curated.id, mediaSubtype),
    category: location?.category ?? '',
    previewKind: previewKindOf(entry),
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
export async function loadTemplateCatalog(): Promise<HydratedTemplate[]> {
  let byId: Map<string, IndexLocation>
  try {
    byId = indexById(await fetchJSON(INDEX_URL))
  } catch {
    byId = new Map()
  }

  const seen = new Set<string>()
  const catalog: HydratedTemplate[] = []
  for (const curated of CURATED_TEMPLATES) {
    if (!curated?.id || seen.has(curated.id) || !curated.snapshot) continue
    seen.add(curated.id)
    catalog.push(hydrateOne(curated, byId.get(curated.id)))
  }
  return catalog.sort(byModalityOrder)
}
