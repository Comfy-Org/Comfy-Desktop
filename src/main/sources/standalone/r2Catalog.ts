import { fetchJSON } from '../../lib/fetch'
import { R2_BASE_URL } from '../../lib/r2Mirror'

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

export type R2Latest = Record<string, R2Variant>

export interface R2VendorReleases {
  releases: R2Variant[]
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function isSafeFilename(name: string): boolean {
  return SAFE_SEGMENT.test(name) && !name.includes('..')
}

function isOptionalString(v: unknown): v is string | undefined {
  return v === undefined || typeof v === 'string'
}

function isValidVariant(v: unknown): v is R2Variant {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  if (typeof r.tag !== 'string' || !SAFE_SEGMENT.test(r.tag)) return false
  if (typeof r.file !== 'string' || !isSafeFilename(r.file)) return false
  if (typeof r.size !== 'number' || !Number.isFinite(r.size) || r.size <= 0) return false
  if (typeof r.python_version !== 'string' || typeof r.torch_version !== 'string') return false
  if (!isOptionalString(r.torchvision_version) || !isOptionalString(r.torchaudio_version))
    return false
  if (typeof r.comfyui_version !== 'string' || typeof r.comfyui_commit !== 'string') return false
  if (typeof r.build !== 'number' || typeof r.date !== 'string') return false
  return true
}

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

export async function fetchR2VendorReleases(
  vendorId: string,
  refresh = true
): Promise<R2Variant[]> {
  if (!SAFE_SEGMENT.test(vendorId)) throw new Error(`invalid vendor id: ${vendorId}`)
  const data = await fetchJSON(`${R2_BASE_URL}/${vendorId}/releases.json`, { refresh })
  if (!data || typeof data !== 'object') {
    throw new Error(`malformed releases.json for ${vendorId}`)
  }
  const releases = (data as Record<string, unknown>).releases
  if (!Array.isArray(releases)) return []
  return releases.filter(isValidVariant)
}

export function r2BundleUrl(vendorId: string, release: R2Variant): string {
  return `${R2_BASE_URL}/${vendorId}/${release.tag}/${release.file}`
}
