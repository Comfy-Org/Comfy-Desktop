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
const MAX_SIZE_BYTES = 2 * 1024 ** 4
const MAX_ENTRIES = 256
const FETCH_TIMEOUT_MS = 5000

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function isModality(value: unknown): value is TemplateModality {
  return typeof value === 'string' && (TEMPLATE_MODALITY_ORDER as readonly string[]).includes(value)
}

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

function parseEntry(value: unknown): CuratedTemplate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const r = value as Record<string, unknown>

  const { id } = r
  if (!isPersistableTemplateId(id) || id.length > MAX_ID_LENGTH) return null
  if (!isModality(r.modality)) return null

  const snapshot = parseSnapshot(r.snapshot)
  if (!snapshot) return null

  if (!isOptionalBoolean(r.apiNode) || !isOptionalBoolean(r.recommended)) return null

  const base = { id, modality: r.modality, snapshot }
  if (r.apiNode === true) {
    if (r.recommended === true) return null
    return { ...base, apiNode: true }
  }
  return { ...base, ...(r.recommended === true ? { recommended: true as const } : {}) }
}

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

export function _resetStarterTemplatesForTest(): void {
  inFlight = null
}
