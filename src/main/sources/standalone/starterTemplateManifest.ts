/**
 * Loads remote starter-templates (PostHog) to enable dynamic updates in the picker without a release.
 * Falls back: remote payload → disk cache → `CURATED_TEMPLATES`.
 * Uses `opsFlag.ts` to allow picker rendering before user consent.
 */
import fs from 'fs'
import path from 'path'

import { makeOpsFlagPayload } from '../../lib/opsFlag'
import { dataDir } from '../../lib/paths'
import { writeFileSafe } from '../../lib/safe-file'
import {
  CURATED_TEMPLATES,
  TEMPLATE_ID_PATTERN,
  TEMPLATE_MODALITY_ORDER,
  NO_TEMPLATE_VALUE,
  type CuratedTemplate,
  type TemplateModality,
  type TemplateSnapshot
} from './curatedTemplates'

export const STARTER_TEMPLATES_FLAG_KEY = 'desktop_starter_templates'

/** A remote entry naming a known template must agree with its modality. */
const BAKED_IN_BY_ID = new Map(CURATED_TEMPLATES.map((t) => [t.id, t.modality]))

const SCHEMA_VERSION = 1
const MAX_TEXT_LENGTH = 4096
const MAX_ID_LENGTH = 128
// eslint-disable-next-line no-control-regex -- matching control chars is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

const CACHE_FILE = (): string => path.join(dataDir(), 'starter-templates-cache.json')

function isModality(value: unknown): value is TemplateModality {
  return typeof value === 'string' && (TEMPLATE_MODALITY_ORDER as readonly string[]).includes(value)
}

/** Drops the field, not the entry. */
function safeText(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) return undefined
  if (CONTROL_CHARS.test(value)) return undefined
  return value
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function parseSnapshot(value: unknown): TemplateSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined
  const r = value as Record<string, unknown>
  const title = safeText(r.title)
  const description = safeText(r.description)
  const mediaSubtype = safeText(r.mediaSubtype)
  const { sizeBytes } = r
  if (title === undefined || description === undefined || mediaSubtype === undefined) {
    return undefined
  }
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return undefined
  }
  return { title, description, sizeBytes, mediaSubtype }
}

/**
 * Default-deny. `id` reaches a filesystem path and a fetch URL, so it is
 * pattern-checked; a bad optional field drops only itself.
 */
function parseEntry(value: unknown): CuratedTemplate | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>

  const { id } = r
  if (typeof id !== 'string' || id.length > MAX_ID_LENGTH) return null
  if (id === NO_TEMPLATE_VALUE || !TEMPLATE_ID_PATTERN.test(id)) return null
  if (!isModality(r.modality)) return null
  // Would fork the card into two tabs, and the right one could only recover
  // with a duplicate id.
  const bakedIn = BAKED_IN_BY_ID.get(id)
  if (bakedIn && bakedIn !== r.modality) return null

  const recommended = r.recommended === true
  const apiNode = r.apiNode === true
  if (recommended && apiNode) return null

  const snapshot = parseSnapshot(r.snapshot)
  const availableFrom = isIsoDate(r.availableFrom) ? r.availableFrom : undefined
  const availableUntil = isIsoDate(r.availableUntil) ? r.availableUntil : undefined

  const base = {
    id,
    modality: r.modality,
    ...(snapshot ? { snapshot } : {}),
    ...(availableFrom ? { availableFrom } : {}),
    ...(availableUntil ? { availableUntil } : {}),
    ...(r.snapshotOverrides === true && snapshot ? { snapshotOverrides: true as const } : {})
  }

  return apiNode
    ? { ...base, apiNode: true }
    : { ...base, ...(recommended ? { recommended: true as const } : {}) }
}

/**
 * Accepts the escaped-JSON-string form production returns as well as a parsed
 * object. `null` means unusable; invalid entries drop individually.
 */
export function parseStarterTemplateManifest(raw: unknown): CuratedTemplate[] | null {
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

  const entries = document.templates
    .map(parseEntry)
    .filter((entry): entry is CuratedTemplate => entry !== null)

  const seenRecommended = new Set<TemplateModality>()
  return entries.map((entry) => {
    if (entry.recommended !== true) return entry
    if (seenRecommended.has(entry.modality)) {
      const { recommended: _dropped, ...rest } = entry
      return { ...rest }
    }
    seenRecommended.add(entry.modality)
    return entry
  })
}

let diskLoaded = false
let diskTemplates: CuratedTemplate[] | null = null

/**
 * Bounds how long a cached payload can outlive the flag that produced it.
 * Deleting or disabling `desktop_starter_templates` is the first rollback an
 * operator reaches for, and it surfaces as the same `null` a failed fetch does,
 * so an unbounded cache would serve a withdrawn payload forever. Expiry decays
 * the picker back to `CURATED_TEMPLATES` without needing that distinction.
 */
const CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

/** Re-validated on read: shared across app versions, so possibly stale. */
function fromDisk(): CuratedTemplate[] | null {
  if (!diskLoaded) {
    diskLoaded = true
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(CACHE_FILE(), 'utf-8'))
      // Stamped in the payload rather than read from mtime, which a backup
      // restore or file copy would reset.
      const writtenAt = (raw as { writtenAt?: unknown })?.writtenAt
      const fresh = typeof writtenAt === 'number' && Date.now() - writtenAt < CACHE_MAX_AGE_MS
      diskTemplates = fresh ? parseStarterTemplateManifest(raw) : null
    } catch {
      diskTemplates = null
    }
  }
  return diskTemplates
}

function persist(templates: CuratedTemplate[]): void {
  try {
    writeFileSafe(
      CACHE_FILE(),
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, writtenAt: Date.now(), templates }, null, 2)
    )
  } catch {}
}

const flag = makeOpsFlagPayload<CuratedTemplate[] | null>({
  key: STARTER_TEMPLATES_FLAG_KEY,
  fallback: null,
  parse: (value) => parseStarterTemplateManifest(value) ?? undefined
})

/** Persists the resolved list so the next cold start has a warm cache. */
export async function initStarterTemplates(opts: {
  distinctId: string
  timeoutMs?: number
}): Promise<void> {
  await flag.init(opts)
  const resolved = await flag.get()
  if (resolved) persist(resolved)
}

/** Awaits the boot fetch so a picker opening early sees the resolved value. */
export async function getStarterTemplatesAsync(): Promise<readonly CuratedTemplate[]> {
  return (await flag.get()) ?? fromDisk() ?? CURATED_TEMPLATES
}

/** @internal — exposed for tests. */
export function _resetForTest(): void {
  flag._resetForTest()
  diskLoaded = false
  diskTemplates = null
}
