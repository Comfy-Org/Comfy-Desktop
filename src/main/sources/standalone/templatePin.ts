/**
 * Maps a ComfyUI version to the template index it ships. ComfyUI pins
 * `comfyui-workflow-templates` in its `requirements.txt`, and that pin is the
 * only compatibility map that exists — the index carries no version field.
 *
 * Every failure returns `null`, which falls back to the live `main` index.
 */
import { fetchText } from '../../lib/fetch'
import { INDEX_URL, RAW_TEMPLATES_BASE } from './curatedTemplates'

const MAX_PIN_CACHE_SIZE = 100
const PIN_TIMEOUT_MS = 5000

const VERSION_TAG_PATTERN = /^v?\d+(?:\.\d+)*$/
/** Hyphenated; the underscored form is the Python import path, not the pin. */
const PIN_PATTERN = /^\s*comfyui-workflow-templates\s*==\s*(\d+(?:\.\d+)*)\s*(?:#.*)?$/m

const TEMPLATES_REPO = 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates'
const COMFYUI_REPO = 'https://raw.githubusercontent.com/comfyanonymous/ComfyUI'

/** Failures cache as `null`, so a 404 isn't refetched on every picker open. */
const pinCache = new Map<string, string | null>()
const inflight = new Map<string, Promise<string | null>>()

export function parseTemplatePin(contents: string): string | null {
  return PIN_PATTERN.exec(contents)?.[1] ?? null
}

/** Both forms are persisted; see `version.ts:tagsEqual` for the strip-side. */
function normalizeTag(tag: string): string {
  return tag.startsWith('v') ? tag : `v${tag}`
}

/** `null` when the pin can't be determined. Never throws. */
export async function resolveTemplatePackageVersion(
  comfyTag: string | null | undefined
): Promise<string | null> {
  if (!comfyTag || !VERSION_TAG_PATTERN.test(comfyTag)) return null

  const ref = normalizeTag(comfyTag)
  const cached = pinCache.get(ref)
  if (cached !== undefined) return cached
  const existing = inflight.get(ref)
  if (existing) return existing

  const promise = (async () => {
    const resolved = await fetchText(`${COMFYUI_REPO}/${ref}/requirements.txt`, {
      timeoutMs: PIN_TIMEOUT_MS
    })
      .then(parseTemplatePin)
      .catch(() => null)
    remember(ref, resolved)
    inflight.delete(ref)
    return resolved
  })()

  inflight.set(ref, promise)
  return promise
}

/** `VERSION_TAG_PATTERN` admits unbounded dot-groups, so cap the key space. */
function remember(ref: string, resolved: string | null): void {
  if (pinCache.size >= MAX_PIN_CACHE_SIZE) {
    const oldest = pinCache.keys().next().value
    if (oldest !== undefined) pinCache.delete(oldest)
  }
  pinCache.set(ref, resolved)
}

/** Falls back to `main` when the pin is unknown or malformed. */
export function templateIndexUrlFor(packageVersion: string | null): string {
  if (!packageVersion || !VERSION_TAG_PATTERN.test(packageVersion)) return INDEX_URL
  return `${TEMPLATES_REPO}/${normalizeTag(packageVersion)}/templates/index.json`
}

/** Thumbnail base, so previews match the index they came from. */
export function templateAssetBaseFor(packageVersion: string | null): string {
  if (!packageVersion || !VERSION_TAG_PATTERN.test(packageVersion)) return RAW_TEMPLATES_BASE
  return `${TEMPLATES_REPO}/${normalizeTag(packageVersion)}/templates`
}

/** @internal — exposed for tests. */
export function _resetForTest(): void {
  pinCache.clear()
  inflight.clear()
}
