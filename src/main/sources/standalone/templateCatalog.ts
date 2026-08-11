/**
 * Resolves the starter-template manifest into picker cards, hydrated against the
 * index the target ComfyUI pins rather than `main`.
 *
 * Invariant: 4 cards per modality in all 4 modalities, at most one recommended
 * and never an API-node card.
 */
import { fetchJSON } from '../../lib/fetch'
import {
  CURATED_TEMPLATES,
  TEMPLATE_MODALITY_ORDER,
  thumbnailUrlFor,
  type CuratedTemplate,
  type TemplateModality,
  type TemplateSnapshot
} from './curatedTemplates'
import { getStarterTemplatesAsync } from './starterTemplateManifest'
import {
  resolveTemplatePackageVersion,
  templateAssetBaseFor,
  templateIndexUrlFor
} from './templatePin'

const SLOTS_PER_MODALITY = 4

/** The wizard blocks on this, and failing open costs only card metadata. */
const INDEX_TIMEOUT_MS = 8000

/** Substitutes only; a named id is always honoured. `type: "image"` also spans
 *  Utility/LLM/Node Basics, which are not starter material. */
const SUBSTITUTABLE_CATEGORIES = new Set(['Image', 'Video', 'Audio', '3D Model', 'Use Cases'])

const BAKED_IN_IDS = new Set(CURATED_TEMPLATES.map((t) => t.id))

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
  /** Runs on API nodes — nothing to download, but each run spends credits. */
  apiNode: boolean
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
  /** Node packs the workflow needs; the frontend hides these on non-cloud. */
  requiresCustomNodes?: unknown
  /** `local` / `cloud`. Absent means "everywhere". */
  includeOnDistributions?: unknown
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

/** The frontend hides custom-node workflows on non-cloud, so offering one
 *  produces a card that silently disappears. */
function isRunnableLocally(entry: IndexEntry): boolean {
  const { requiresCustomNodes, includeOnDistributions } = entry
  if (Array.isArray(requiresCustomNodes) && requiresCustomNodes.length > 0) return false
  if (Array.isArray(includeOnDistributions) && !includeOnDistributions.includes('local')) {
    return false
  }
  return true
}

/** Rendered as itself, replaced by an index pick, or dropped for backfill. */
type Disposition =
  | { kind: 'place'; location: IndexLocation | undefined }
  | { kind: 'substitute'; location: IndexLocation }
  | { kind: 'drop' }

/** Reads `used` but never mutates it, so the caller owns placement. */
function disposeOf(
  template: CuratedTemplate,
  byId: Map<string, IndexLocation>,
  used: Set<string>,
  online: boolean,
  now: number
): Disposition {
  if (!isWithinWindow(template, now)) return { kind: 'drop' }

  const location = byId.get(template.id)
  if (location && !isRunnableLocally(location.entry)) return { kind: 'drop' }

  if (location || !online) {
    if (!location && !template.snapshot) return { kind: 'drop' }
    return { kind: 'place', location }
  }

  // Runs server-side, so index membership says nothing about whether it works.
  if (template.apiNode === true) {
    return template.snapshot ? { kind: 'place', location: undefined } : { kind: 'drop' }
  }

  // Absent from this install's index, so it can't open. Both paths are silent.
  const sub = firstUnusedOfModality(byId, template.modality, used)
  console.warn(
    `[templates] "${template.id}" is not in this install's template index; ` +
      (sub ? `substituting "${sub.entry.name}"` : 'falling back to the built-in list')
  )
  return sub ? { kind: 'substitute', location: sub } : { kind: 'drop' }
}

/** Availability window, so content can stage a launch ahead of time. */
function isWithinWindow(template: CuratedTemplate, now: number): boolean {
  const { availableFrom, availableUntil } = template
  if (availableFrom) {
    const from = Date.parse(availableFrom)
    if (!Number.isNaN(from) && now < from) return false
  }
  if (availableUntil) {
    const until = Date.parse(availableUntil)
    if (!Number.isNaN(until) && now >= until) return false
  }
  return true
}

const NON_TASK_TAGS = new Set(['image', 'video', 'audio', '3d', '3d model', 'api'])

/** Fallback so a card is never left with a blank descriptor. */
const DEFAULT_TASK: Record<TemplateModality, string> = {
  image: 'Text to Image',
  video: 'Text to Video',
  audio: 'Text to Audio',
  '3d': 'Image to 3D'
}

/** Task from `tags`, skipping kind labels; falls back to the modality default. */
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

/** "Z-Image-Turbo Text to Image" → "Z-Image-Turbo". */
function nameOf(title: string, task: string): string {
  const beforeColon = title.split(':')[0]!.trim()
  if (task && beforeColon.toLowerCase().endsWith(task.toLowerCase())) {
    const stripped = beforeColon.slice(0, beforeColon.length - task.length).trim()
    if (stripped) return stripped
  }
  return beforeColon || title
}

/** Prefers live metadata over `snapshot`; `snapshotOverrides` inverts that. */
function hydrateOne(card: {
  id: string
  modality: TemplateModality
  recommended: boolean
  apiNode: boolean
  location: IndexLocation | undefined
  snapshot?: TemplateSnapshot
  snapshotOverrides?: boolean
  assetBase: string
}): HydratedTemplate {
  const { id, modality, recommended, apiNode, location, snapshot, snapshotOverrides, assetBase } =
    card
  const entry = snapshotOverrides && snapshot ? undefined : location?.entry

  const title = typeof entry?.title === 'string' ? entry.title : (snapshot?.title ?? id)
  const description =
    typeof entry?.description === 'string' ? entry.description : (snapshot?.description ?? '')
  const sizeBytes =
    typeof entry?.size === 'number' && entry.size > 0 ? entry.size : (snapshot?.sizeBytes ?? 0)
  const mediaSubtype =
    typeof entry?.mediaSubtype === 'string'
      ? entry.mediaSubtype
      : (snapshot?.mediaSubtype ?? 'webp')

  const task = taskOf(location?.entry?.tags, modality)

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
    thumbnailUrl: thumbnailUrlFor(id, mediaSubtype, assetBase),
    category: location?.category ?? ''
  }
}

/** Modality tab order, then manifest order within a modality. */
function byModalityOrder(a: HydratedTemplate, b: HydratedTemplate): number {
  return TEMPLATE_MODALITY_ORDER.indexOf(a.modality) - TEMPLATE_MODALITY_ORDER.indexOf(b.modality)
}

/** Cards plus the asset base they were stamped with, so a caller fetching
 *  workflow JSON reads the same revision the thumbnails came from. */
export interface TemplateCatalog {
  templates: HydratedTemplate[]
  assetBase: string
}

/** Keyed by target version so switching channel mid-wizard re-filters. */
const CATALOG_TTL_MS = 60_000
const catalogInFlight = new Map<string, Promise<TemplateCatalog>>()
const catalogCache = new Map<string, { at: number; value: TemplateCatalog }>()

export function loadTemplateCatalog(opts?: {
  comfyVersion?: string | null
}): Promise<TemplateCatalog> {
  const key = opts?.comfyVersion ?? ''
  const cached = catalogCache.get(key)
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return Promise.resolve(cached.value)

  const existing = catalogInFlight.get(key)
  if (existing) return existing

  const promise = loadTemplateCatalogUncached(opts?.comfyVersion ?? null)
    .then((value) => {
      catalogCache.set(key, { at: Date.now(), value })
      return value
    })
    .finally(() => {
      catalogInFlight.delete(key)
    })
  catalogInFlight.set(key, promise)
  return promise
}

/** Drops the memoized catalog so the next read refetches. Test-only. */
export function resetTemplateCatalogCache(): void {
  catalogInFlight.clear()
  catalogCache.clear()
}

/** An empty list is left empty; `backfill` fills every modality either way. */
async function activeTemplates(): Promise<readonly CuratedTemplate[]> {
  try {
    return await getStarterTemplatesAsync()
  } catch {
    return CURATED_TEMPLATES
  }
}

/** The index the target ComfyUI ships, else the live one. Never throws. */
async function indexForVersion(
  comfyVersion: string | null
): Promise<{ byId: Map<string, IndexLocation>; assetBase: string }> {
  const pin = await resolveTemplatePackageVersion(comfyVersion).catch(() => null)
  const assetBase = templateAssetBaseFor(pin)
  try {
    const index = await fetchJSON(templateIndexUrlFor(pin), { timeoutMs: INDEX_TIMEOUT_MS })
    return { byId: indexById(index), assetBase }
  } catch {
    return { byId: new Map(), assetBase }
  }
}

async function loadTemplateCatalogUncached(comfyVersion: string | null): Promise<TemplateCatalog> {
  const [templates, index] = await Promise.all([activeTemplates(), indexForVersion(comfyVersion)])
  const { byId, assetBase } = index
  const online = byId.size > 0
  const now = Date.now()

  const used = new Set<string>()
  // Payload entries keyed by id, so backfill can honour a window the payload set
  // on a baked-in card instead of reading only the static list.
  const windows = new Map(templates.filter((t) => t?.id).map((t) => [t.id, t]))
  const perModality = new Map<TemplateModality, HydratedTemplate[]>(
    TEMPLATE_MODALITY_ORDER.map((modality) => [modality, []])
  )

  const place = (card: HydratedTemplate): void => {
    perModality.get(card.modality)?.push(card)
  }
  const isFull = (modality: TemplateModality): boolean =>
    (perModality.get(modality)?.length ?? 0) >= SLOTS_PER_MODALITY

  for (const template of templates) {
    if (!template?.id || used.has(template.id)) continue
    if (!perModality.has(template.modality) || isFull(template.modality)) continue

    const disposition = disposeOf(template, byId, used, online, now)
    if (disposition.kind === 'drop') continue

    if (disposition.kind === 'substitute') {
      const { location } = disposition
      used.add(location.entry.name)
      place(
        hydrateOne({
          id: location.entry.name,
          modality: template.modality,
          recommended: template.recommended === true,
          apiNode: false,
          location,
          assetBase
        })
      )
      continue
    }

    used.add(template.id)
    place(
      hydrateOne({
        id: template.id,
        modality: template.modality,
        recommended: template.recommended === true,
        apiNode: template.apiNode === true,
        location: disposition.location,
        snapshot: template.snapshot,
        snapshotOverrides: template.snapshotOverrides,
        assetBase
      })
    )
  }

  backfill(perModality, byId, used, online, assetBase, now, windows)

  const catalog: HydratedTemplate[] = []
  for (const modality of TEMPLATE_MODALITY_ORDER) {
    catalog.push(...enforceOneRecommended(perModality.get(modality) ?? []))
  }
  return { templates: catalog.sort(byModalityOrder), assetBase }
}

/**
 * Strict pass, then `terminal`, which relaxes index membership and then
 * `isRunnableLocally` rather than ship a short tab. Identity and the
 * availability window are never relaxed: two cards sharing an id collide on
 * `FieldOption.value`, the picker's key, and a retired card must stay retired
 * even when the alternative is a short tab.
 */
function fillFromBakedIn(
  slots: HydratedTemplate[],
  modality: TemplateModality,
  byId: Map<string, IndexLocation>,
  used: Set<string>,
  online: boolean,
  assetBase: string,
  now: number,
  windows: Map<string, CuratedTemplate>,
  terminal: boolean
): void {
  const take = (allowUnrunnable: boolean): void => {
    for (const curated of CURATED_TEMPLATES) {
      if (slots.length >= SLOTS_PER_MODALITY) break
      if (curated.modality !== modality || used.has(curated.id)) continue
      // A window the payload set on this id wins, so content can retire a
      // baked-in card rather than watch backfill wave it straight back in.
      if (!isWithinWindow(windows.get(curated.id) ?? curated, now)) continue
      const location = byId.get(curated.id)
      if (!allowUnrunnable && location && !isRunnableLocally(location.entry)) continue
      // Re-adding an index-absent card would undo the gate that dropped it.
      if (!terminal && online && !location && curated.apiNode !== true) continue
      used.add(curated.id)
      slots.push(
        hydrateOne({
          id: curated.id,
          modality,
          recommended: curated.recommended === true,
          apiNode: curated.apiNode === true,
          location,
          snapshot: curated.snapshot,
          assetBase
        })
      )
    }
  }

  take(false)
  if (terminal) take(true)
}

function backfill(
  perModality: Map<TemplateModality, HydratedTemplate[]>,
  byId: Map<string, IndexLocation>,
  used: Set<string>,
  online: boolean,
  assetBase: string,
  now: number,
  windows: Map<string, CuratedTemplate>
): void {
  for (const modality of TEMPLATE_MODALITY_ORDER) {
    const slots = perModality.get(modality)!
    if (slots.length >= SLOTS_PER_MODALITY) continue

    fillFromBakedIn(slots, modality, byId, used, online, assetBase, now, windows, false)

    while (slots.length < SLOTS_PER_MODALITY && online) {
      const sub = firstUnusedOfModality(byId, modality, used)
      if (!sub) break
      used.add(sub.entry.name)
      slots.push(
        hydrateOne({
          id: sub.entry.name,
          modality,
          recommended: false,
          apiNode: false,
          location: sub,
          assetBase
        })
      )
    }

    fillFromBakedIn(slots, modality, byId, used, online, assetBase, now, windows, true)
  }
}

/** An all-API tab gets none: the wizard offers skip rather than auto-selecting
 *  a card that spends credits. */
function enforceOneRecommended(slots: HydratedTemplate[]): HydratedTemplate[] {
  const claimed = slots.find((card) => card.recommended && !card.apiNode)
  const winner = claimed ?? slots.find((card) => !card.apiNode)
  return slots.map((card) => ({ ...card, recommended: card === winner }))
}

/** Skips `api_*`, size-less entries (the disk gate sizes off `sizeBytes`), and
 *  non-starter categories. */
function firstUnusedOfModality(
  byId: Map<string, IndexLocation>,
  modality: TemplateModality,
  used: Set<string>
): IndexLocation | null {
  for (const location of byId.values()) {
    const { entry } = location
    if (location.modality !== modality || used.has(entry.name)) continue
    if (!SUBSTITUTABLE_CATEGORIES.has(location.category)) continue
    // Owed its own slot later; taking it here consumes one instead of filling one.
    if (BAKED_IN_IDS.has(entry.name)) continue
    if (entry.name.startsWith('api_')) continue
    if (typeof entry.size !== 'number' || entry.size <= 0) continue
    if (!isRunnableLocally(entry)) continue
    return location
  }
  return null
}
