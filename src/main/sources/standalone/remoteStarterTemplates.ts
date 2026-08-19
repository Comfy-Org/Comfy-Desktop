/**
 * Serves the picker's starter-template list from R2 so content can change it
 * without an app release, falling back to `CURATED_TEMPLATES` whenever the
 * remote document is unusable.
 *
 * Fallback is per entry, not all-or-nothing: three valid entries and one broken
 * one keeps the three and backfills the fourth slot. `CURATED_TEMPLATES` is the
 * floor, so the picker always shows four cards in each of the four modalities.
 *
 * Fetched once per process. A content change lands on the next launch, which is
 * why there is no disk cache: offline already falls back to the built-in list,
 * and a cached copy would keep serving a withdrawn payload indefinitely.
 */
import { fetchJSON } from '../../lib/fetch'
import { R2_BASE_URL } from '../../lib/r2Mirror'
import {
  CURATED_TEMPLATES,
  TEMPLATE_MODALITY_ORDER,
  type CuratedTemplate,
  type TemplateModality,
  type TemplateSnapshot
} from './curatedTemplates'

export const STARTER_TEMPLATES_URL = `${R2_BASE_URL}/starter-templates.json`

const SCHEMA_VERSION = 1
const SLOTS_PER_MODALITY = 4
const MAX_ID_LENGTH = 128
const MAX_TEXT_LENGTH = 4096

/** Mirrors the frontend's deeplink validator; the id reaches a URL and a
 *  package-relative path, so no separators and no control characters. */
const TEMPLATE_ID_PATTERN = /^[a-zA-Z0-9_.-]+$/

function isModality(value: unknown): value is TemplateModality {
  return typeof value === 'string' && (TEMPLATE_MODALITY_ORDER as readonly string[]).includes(value)
}

function safeText(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > MAX_TEXT_LENGTH) return null
  return value
}

function parseSnapshot(value: unknown): TemplateSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const r = value as Record<string, unknown>
  const title = safeText(r.title)
  const description = safeText(r.description)
  const mediaSubtype = safeText(r.mediaSubtype)
  if (!title || !description || !mediaSubtype) return null
  const { sizeBytes } = r
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 0) return null
  return { title, description, sizeBytes, mediaSubtype }
}

/** Default-deny: anything unexpected drops this entry alone. */
function parseEntry(value: unknown): CuratedTemplate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const r = value as Record<string, unknown>

  const { id } = r
  if (typeof id !== 'string' || id.length > MAX_ID_LENGTH || !TEMPLATE_ID_PATTERN.test(id)) {
    return null
  }
  if (!isModality(r.modality)) return null

  const snapshot = parseSnapshot(r.snapshot)
  if (!snapshot) return null

  const base = { id, modality: r.modality, snapshot }
  // A paid card never carries the recommendation: the auto-selected pick must
  // not spend credits on first run.
  return r.apiNode === true
    ? { ...base, apiNode: true }
    : { ...base, ...(r.recommended === true ? { recommended: true as const } : {}) }
}

/**
 * Validate a remote document. Returns `null` when it is unusable as a whole —
 * bad JSON, an unknown `schemaVersion`, or no entry surviving validation — so
 * the caller keeps the built-in list rather than half-applying an edit.
 */
export function parseRemoteStarterTemplates(raw: unknown): CuratedTemplate[] | null {
  let data = raw
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return null
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null

  const document = data as Record<string, unknown>
  if (document.schemaVersion !== SCHEMA_VERSION) return null
  if (!Array.isArray(document.templates)) return null

  const seen = new Set<string>()
  const entries: CuratedTemplate[] = []
  for (const value of document.templates) {
    const entry = parseEntry(value)
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    entries.push(entry)
  }
  if (entries.length === 0) return null

  const claimed = new Set<TemplateModality>()
  return entries.map((entry) => {
    if (entry.recommended !== true) return entry
    if (claimed.has(entry.modality)) {
      const { recommended: _demoted, ...rest } = entry
      return rest as CuratedTemplate
    }
    claimed.add(entry.modality)
    return entry
  })
}

/** Exactly one free card per tab carries the badge, so the wizard never
 *  auto-selects a card that costs money. An all-paid tab gets none. */
function enforceOneRecommended(cards: CuratedTemplate[]): CuratedTemplate[] {
  const winner = cards.find((c) => c.recommended && !c.apiNode) ?? cards.find((c) => !c.apiNode)
  return cards.map((card) => {
    if (card.apiNode) return card
    const shouldRecommend = card === winner
    if (shouldRecommend === (card.recommended === true)) return card
    const { recommended: _drop, ...rest } = card
    return (shouldRecommend ? { ...rest, recommended: true as const } : rest) as CuratedTemplate
  })
}

/**
 * Merge the remote list with the built-in one: remote entries lead, then the
 * built-in list tops each modality up to four. Pass `null` to use the built-in
 * list alone.
 */
export function resolveStarterTemplates(
  remote: readonly CuratedTemplate[] | null
): CuratedTemplate[] {
  const used = new Set<string>()
  const resolved: CuratedTemplate[] = []

  for (const modality of TEMPLATE_MODALITY_ORDER) {
    const slots: CuratedTemplate[] = []

    const take = (candidates: readonly CuratedTemplate[]): void => {
      for (const candidate of candidates) {
        if (slots.length >= SLOTS_PER_MODALITY) break
        if (candidate.modality !== modality || used.has(candidate.id)) continue
        used.add(candidate.id)
        slots.push(candidate)
      }
    }

    if (remote) take(remote)
    take(CURATED_TEMPLATES)

    resolved.push(...enforceOneRecommended(slots))
  }
  return resolved
}

let inFlight: Promise<CuratedTemplate[]> | null = null

/**
 * The list the picker should render. Resolves once per process and never
 * rejects: any failure yields the built-in list.
 */
export function loadStarterTemplates(): Promise<CuratedTemplate[]> {
  inFlight ??= fetchJSON(STARTER_TEMPLATES_URL, { refresh: true })
    .then((raw) => resolveStarterTemplates(parseRemoteStarterTemplates(raw)))
    .catch(() => resolveStarterTemplates(null))
  return inFlight
}

/** @internal - exposed for tests. */
export function _resetStarterTemplatesForTest(): void {
  inFlight = null
}
