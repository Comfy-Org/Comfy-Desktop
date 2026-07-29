import { fetchJSON } from '../../lib/fetch'
import { R2_BASE_URL } from '../../lib/r2Mirror'

/** One standalone-environment bundle release as published in R2 metadata. */
export interface R2Variant {
  tag: string
  comfyui_version: string
  comfyui_commit: string
  build: number
  date: string
  file: string
  size: number
  python_version: string
  torch_version: string
  torchvision_version?: string
  torchaudio_version?: string
}

/** latest.json: vendor_id → newest release */
export type R2Latest = Record<string, R2Variant>

/** {vendor}/releases.json: full history for one vendor */
export interface R2VendorReleases {
  releases: R2Variant[]
}

/** Path-segment allowlist for vendor IDs and release tags: these are joined
 *  into download URLs and cache keys, so slashes, dots-only names, or other
 *  traversal material must never pass. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Bundle filenames additionally appear on disk in the download cache. */
function isSafeFilename(name: string): boolean {
  return SAFE_SEGMENT.test(name) && !name.includes('..')
}

function isOptionalString(v: unknown): v is string | undefined {
  return v === undefined || typeof v === 'string'
}

/** Runtime validation of one release entry. R2 metadata is remote input —
 *  malformed shapes, non-positive sizes (used by disk preflight), or unsafe
 *  path segments must be rejected here, never trusted via a cast. */
function isValidVariant(v: unknown): v is R2Variant {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  if (typeof r.tag !== 'string' || !SAFE_SEGMENT.test(r.tag)) return false
  if (typeof r.file !== 'string' || !isSafeFilename(r.file)) return false
  if (typeof r.size !== 'number' || !Number.isFinite(r.size) || r.size <= 0) return false
  if (typeof r.python_version !== 'string' || typeof r.torch_version !== 'string') return false
  if (!isOptionalString(r.torchvision_version) || !isOptionalString(r.torchaudio_version)) return false
  if (typeof r.comfyui_version !== 'string' || typeof r.comfyui_commit !== 'string') return false
  if (typeof r.build !== 'number' || typeof r.date !== 'string') return false
  return true
}

/** Fetch the newest release per vendor. `refresh` bypasses the ETag cache.
 *  Invalid vendor IDs or malformed entries are dropped, not returned. */
export async function fetchR2Latest(refresh = true): Promise<R2Latest> {
  const data = await fetchJSON(`${R2_BASE_URL}/latest.json`, { refresh })
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('malformed latest.json: expected an object of vendor releases')
  }
  const out: R2Latest = {}
  for (const [vendorId, release] of Object.entries(data)) {
    if (!SAFE_SEGMENT.test(vendorId)) continue
    if (!isValidVariant(release)) continue
    out[vendorId] = release
  }
  return out
}

/** Fetch the full bundle history for one vendor variant, newest first.
 *  Malformed entries are dropped, not returned. */
export async function fetchR2VendorReleases(vendorId: string, refresh = true): Promise<R2Variant[]> {
  if (!SAFE_SEGMENT.test(vendorId)) throw new Error(`invalid vendor id: ${vendorId}`)
  const data = await fetchJSON(`${R2_BASE_URL}/${vendorId}/releases.json`, { refresh })
  if (!data || typeof data !== 'object') {
    throw new Error(`malformed releases.json for ${vendorId}`)
  }
  const releases = (data as Record<string, unknown>).releases
  if (!Array.isArray(releases)) return []
  return releases.filter(isValidVariant)
}

/** Download URL for a bundle release of a vendor variant. */
export function r2BundleUrl(vendorId: string, release: R2Variant): string {
  return `${R2_BASE_URL}/${vendorId}/${release.tag}/${release.file}`
}
