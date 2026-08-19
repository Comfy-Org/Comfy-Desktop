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
 *
 * This deliberately differs from `torchIndexManifest`, which persists a
 * last-good copy so offline reads keep working. That manifest has no usable
 * built-in fallback, whereas this one does, so here the built-in list is both
 * the safer and the fresher answer. Deleting the remote document is the
 * rollback, and it must take effect rather than be outlived by a cache.
 *
 * A failed fetch is memoized too, so a blip at boot serves the built-in list
 * for the process lifetime. That is the same next-launch contract, not an
 * oversight.
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
/** Comfortably past the largest real template (~57 GB) while still rejecting a
 *  value that would make the disk-space gate unsatisfiable. */
const MAX_SIZE_BYTES = 2 * 1024 ** 4
/** Only 16 slots can ever be filled; the rest is wasted main-process work. */
const MAX_ENTRIES = 256
/** Clear the id pattern but name a directory rather than a template. */
const RESERVED_IDS = new Set(['.', '..'])
/** `fetchJSON` has no timeout of its own, and the picker blocks on this read,
 *  so a stalled connection would leave it rendering nothing. */
const FETCH_TIMEOUT_MS = 5000

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function isModality(value: unknown): value is TemplateModality {
  return typeof value === 'string' && (TEMPLATE_MODALITY_ORDER as readonly string[]).includes(value)
}

function safeText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) return null
  // Trimmed before the emptiness test: these strings go straight into the card,
  // and a whitespace-only title renders as a blank card, not a missing one.
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
  // Bounded because this drives the install-time disk-space gate: an absurd
  // value would block every install with an unsatisfiable free-space check.
  if (!Number.isInteger(sizeBytes) || (sizeBytes as number) < 0) return null
  if ((sizeBytes as number) > MAX_SIZE_BYTES) return null
  return { title, description, sizeBytes: sizeBytes as number, mediaSubtype }
}

/** Default-deny: anything unexpected drops this entry alone. */
function parseEntry(value: unknown): CuratedTemplate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const r = value as Record<string, unknown>

  const { id } = r
  // Shared with the picker's own validator, so the id cannot escape a path or
  // URL and cannot smuggle in the "skip" sentinel. `.` and `..` clear that
  // pattern but are path segments, not ids, so they are rejected outright.
  if (!isPersistableTemplateId(id) || id.length > MAX_ID_LENGTH) return null
  if (RESERVED_IDS.has(id)) return null
  if (!isModality(r.modality)) return null

  const snapshot = parseSnapshot(r.snapshot)
  if (!snapshot) return null

  // Default-deny the flags too. A truthy-but-not-true `apiNode` (`"true"`, `1`)
  // would otherwise degrade to a free card, offering a paid template as free and
  // making it eligible for the auto-pick badge.
  if (!isOptionalBoolean(r.apiNode) || !isOptionalBoolean(r.recommended)) return null

  const base = { id, modality: r.modality, snapshot }
  if (r.apiNode === true) {
    // Contradictory under our own invariant: the auto-selected pick must never
    // spend credits. Dropped rather than silently rewritten, so the slot
    // backfills and the malformed row is not quietly made valid.
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
  // The one-recommended-per-tab rule is owned by `enforceOneRecommended`, which
  // re-derives it over the resolved slots. Demoting here too would be dead work.
  return entries.length > 0 ? entries : null
}

/**
 * Exactly one free card per tab carries the badge, so the wizard never
 * auto-selects a card that costs money. An all-paid tab gets none, and the
 * wizard offers skip instead.
 *
 * `fromRemote` is how many leading slots the remote document supplied. When it
 * filled any, the badge stays among them: a backfilled built-in card arrives
 * pre-flagged, and letting that win would hand the auto-pick to the one card
 * content did not choose.
 */
function enforceOneRecommended(cards: CuratedTemplate[], fromRemote: number): CuratedTemplate[] {
  const preferred = fromRemote > 0 ? cards.slice(0, fromRemote) : cards
  const free = (c: CuratedTemplate): boolean => c.apiNode !== true
  const winner =
    preferred.find((c) => c.recommended === true && free(c)) ??
    preferred.find(free) ??
    cards.find(free)

  return cards.map((card) => {
    // Narrowed to the free arm of the union, so `recommended` is assignable
    // without asserting past the type that makes the two mutually exclusive.
    if (card.apiNode === true) return card
    const { recommended: _drop, ...base } = card
    return card === winner ? { ...base, recommended: true } : base
  })
}

/** Modality each built-in id belongs to, so a remote entry cannot file one
 *  under a different tab and drain that tab's fallback. */
const BUILT_IN_MODALITY = new Map(CURATED_TEMPLATES.map((t) => [t.id, t.modality]))

/**
 * Merge the remote list with the built-in one: remote entries lead, then the
 * built-in list tops each modality up to four. Pass `null` to use the built-in
 * list alone.
 *
 * A remote entry reusing a built-in id must keep that id's modality. Otherwise
 * filing, say, the four image ids under `video` would consume them before the
 * image tab is reached, leaving it with nothing to fall back to — an empty tab
 * from a single content edit.
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

/**
 * The list the picker should render. Resolves once per process and never
 * rejects: any failure yields the built-in list.
 */
export function loadStarterTemplates(): Promise<CuratedTemplate[]> {
  inFlight ??= Promise.race([
    fetchJSON(STARTER_TEMPLATES_URL, { refresh: true }),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('starter-templates fetch timed out')), FETCH_TIMEOUT_MS)
        // Never hold the process open for a timer whose only job is to bound a
        // fetch the picker may already have given up on.
        .unref?.()
    })
  ])
    .then((raw) => resolveStarterTemplates(parseRemoteStarterTemplates(raw)))
    .catch(() => resolveStarterTemplates(null))
  return inFlight
}

/** @internal - exposed for tests. */
export function _resetStarterTemplatesForTest(): void {
  inFlight = null
}
