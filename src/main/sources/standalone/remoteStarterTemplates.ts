/**
 * The picker's starter-template list, served from R2 so content changes need no
 * release. `CURATED_TEMPLATES` is the floor: invalid entries drop individually
 * and an unusable document is ignored whole, so the picker always renders four
 * cards per modality.
 *
 * Fetched once per process, with no disk cache — deleting the remote document
 * is the rollback, so it must not be outlived by a cached copy.
 */
import { fetchJSON } from '../../lib/fetch'
import { R2_BASE_URL } from '../../lib/r2Mirror'
import {
  CURATED_TEMPLATES,
  TEMPLATE_MODALITY_ORDER,
  isPersistableTemplateId,
  type CuratedTemplate,
  type TemplateModality,
  type TemplateSnapshot
} from './curatedTemplates'

export const STARTER_TEMPLATES_URL = `${R2_BASE_URL}/starter-templates.json`

const SCHEMA_VERSION = 1
const SLOTS_PER_MODALITY = 4
const MAX_ID_LENGTH = 128
const MAX_TEXT_LENGTH = 4096
/** Past the largest real template (~57 GB); beyond this the disk-space gate
 *  becomes unsatisfiable and no install can proceed. */
const MAX_SIZE_BYTES = 2 * 1024 ** 4
const MAX_ENTRIES = 256
/** Clear `TEMPLATE_ID_PATTERN` but name a directory, not a template. */
const RESERVED_IDS = new Set(['.', '..'])
/** `fetchJSON` has no timeout and the picker blocks on this read. */
const FETCH_TIMEOUT_MS = 5000

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function isModality(value: unknown): value is TemplateModality {
  return typeof value === 'string' && (TEMPLATE_MODALITY_ORDER as readonly string[]).includes(value)
}

/** Trimmed, so a whitespace-only value renders as a blank card rather than
 *  passing the emptiness check. */
function safeText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) return null
  const trimmed = value.trim()
  return trimmed || null
}

function parseSnapshot(value: unknown): TemplateSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const r = value as Record<string, unknown>
  const title = safeText(r.title)
  const description = safeText(r.description)
  const mediaSubtype = safeText(r.mediaSubtype)
  if (!title || !description || !mediaSubtype) return null
  const { sizeBytes } = r
  if (!Number.isInteger(sizeBytes) || (sizeBytes as number) < 0) return null
  if ((sizeBytes as number) > MAX_SIZE_BYTES) return null
  return { title, description, sizeBytes: sizeBytes as number, mediaSubtype }
}

/** Default-deny: anything unexpected drops this entry alone. `id` is validated
 *  hardest — it reaches a deeplink URL and a package-relative path. */
function parseEntry(value: unknown): CuratedTemplate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const r = value as Record<string, unknown>

  const { id } = r
  if (!isPersistableTemplateId(id) || id.length > MAX_ID_LENGTH) return null
  if (RESERVED_IDS.has(id)) return null
  if (!isModality(r.modality)) return null

  const snapshot = parseSnapshot(r.snapshot)
  if (!snapshot) return null

  // A truthy-but-not-true `apiNode` would degrade to a free card, offering a
  // paid template as free.
  if (!isOptionalBoolean(r.apiNode) || !isOptionalBoolean(r.recommended)) return null

  const base = { id, modality: r.modality, snapshot }
  if (r.apiNode === true) {
    // Contradictory: dropped rather than rewritten into something valid.
    if (r.recommended === true) return null
    return { ...base, apiNode: true }
  }
  return { ...base, ...(r.recommended === true ? { recommended: true as const } : {}) }
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

  const payload = data as Record<string, unknown>
  if (payload.schemaVersion !== SCHEMA_VERSION) return null
  if (!Array.isArray(payload.templates)) return null

  const seen = new Set<string>()
  const entries: CuratedTemplate[] = []
  for (const value of payload.templates.slice(0, MAX_ENTRIES)) {
    const entry = parseEntry(value)
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    entries.push(entry)
  }
  return entries.length > 0 ? entries : null
}

/**
 * At most one free card per tab carries the badge, so the wizard never
 * auto-selects a card that spends credits. An all-paid tab gets none.
 *
 * @param fromRemote leading slots the document supplied. The badge stays among
 * them, since a backfilled card arrives pre-flagged and would otherwise claim
 * an auto-pick content did not choose.
 */
function enforceOneRecommended(cards: CuratedTemplate[], fromRemote: number): CuratedTemplate[] {
  const preferred = fromRemote > 0 ? cards.slice(0, fromRemote) : cards
  const free = (c: CuratedTemplate): boolean => c.apiNode !== true
  const winner =
    preferred.find((c) => c.recommended === true && free(c)) ??
    preferred.find(free) ??
    cards.find(free)

  return cards.map((card) => {
    if (card.apiNode === true) return card
    const { recommended: _drop, ...base } = card
    return card === winner ? { ...base, recommended: true } : base
  })
}

const BUILT_IN_MODALITY = new Map(CURATED_TEMPLATES.map((t) => [t.id, t.modality]))

/**
 * Remote entries lead, then the built-in list tops each modality up to four.
 * Pass `null` for the built-in list alone.
 *
 * A remote entry reusing a built-in id must keep that id's modality: filing the
 * image ids under `video` would consume them before the image tab is reached,
 * emptying it.
 */
export function resolveStarterTemplates(
  remote: readonly CuratedTemplate[] | null
): CuratedTemplate[] {
  const eligible = remote?.filter((entry) => {
    const builtIn = BUILT_IN_MODALITY.get(entry.id)
    return builtIn === undefined || builtIn === entry.modality
  })

  const used = new Set<string>()
  const resolved: CuratedTemplate[] = []

  for (const modality of TEMPLATE_MODALITY_ORDER) {
    const slots: CuratedTemplate[] = []
    let fromRemote = 0

    const take = (candidates: readonly CuratedTemplate[]): void => {
      for (const candidate of candidates) {
        if (slots.length >= SLOTS_PER_MODALITY) break
        if (candidate.modality !== modality || used.has(candidate.id)) continue
        used.add(candidate.id)
        slots.push(candidate)
      }
    }

    if (eligible) {
      take(eligible)
      fromRemote = slots.length
    }
    take(CURATED_TEMPLATES)

    resolved.push(...enforceOneRecommended(slots, fromRemote))
  }
  return resolved
}

let inFlight: Promise<CuratedTemplate[]> | null = null

/** Resolves once per process and never rejects: any failure, including a
 *  timeout, yields the built-in list. */
export function loadStarterTemplates(): Promise<CuratedTemplate[]> {
  inFlight ??= Promise.race([
    fetchJSON(STARTER_TEMPLATES_URL, { refresh: true }),
    new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error('starter-templates fetch timed out')),
        FETCH_TIMEOUT_MS
      ).unref?.()
    })
  ])
    .then((raw) => resolveStarterTemplates(parseRemoteStarterTemplates(raw)))
    .catch(() => resolveStarterTemplates(null))
  return inFlight
}

/** @internal */
export function _resetStarterTemplatesForTest(): void {
  inFlight = null
}
