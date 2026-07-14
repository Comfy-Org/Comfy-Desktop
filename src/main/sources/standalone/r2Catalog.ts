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

/** Fetch the newest release per vendor. `refresh` bypasses the ETag cache. */
export async function fetchR2Latest(refresh = true): Promise<R2Latest> {
  return (await fetchJSON(`${R2_BASE_URL}/latest.json`, { refresh })) as R2Latest
}

/** Fetch the full bundle history for one vendor variant, newest first. */
export async function fetchR2VendorReleases(vendorId: string, refresh = true): Promise<R2Variant[]> {
  const data = (await fetchJSON(`${R2_BASE_URL}/${vendorId}/releases.json`, { refresh })) as R2VendorReleases
  return data.releases ?? []
}

/** Download URL for a bundle release of a vendor variant. */
export function r2BundleUrl(vendorId: string, release: R2Variant): string {
  return `${R2_BASE_URL}/${vendorId}/${release.tag}/${release.file}`
}
