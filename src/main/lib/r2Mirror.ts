// Primary host for the standalone Python bundles + their JSON manifests.
// Backed by Cloudflare R2. Unreachable from regions where R2's edge is
// throttled, so we maintain a parallel public mirror with the same content
// layout and fall back to it when the primary connection-resets.

// Dev-only base-URL override for testing locally built standalone artifacts
// without publishing: COMFY_STANDALONE_BASE_URL pointed at a local server
// mimicking the R2 layout. Honored only when the app runs unpackaged via the
// default electron binary (`pnpm dev`): `process.defaultApp` is never set in
// packaged builds and stays undefined under plain Node, so production and
// tests always use the canonical hosts. Kept free of electron imports so this
// leaf module needs no mocking in tests.
const DEV_BASE_URL_OVERRIDE =
  (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp === true
    ? process.env.COMFY_STANDALONE_BASE_URL?.replace(/\/+$/, '') || undefined
    : undefined

if (DEV_BASE_URL_OVERRIDE) {
  console.warn(`[dev] standalone base URL overridden: ${DEV_BASE_URL_OVERRIDE}`)
}

export const R2_BASE_URL =
  DEV_BASE_URL_OVERRIDE ?? 'https://desktop-assets.comfy.org/standalone-environments'

// Public GCS bucket (region: asia-east2) that mirrors R2 1:1 under the same
// /standalone-environments/ prefix. Kept in sync at each release.
export const R2_MIRROR_BASE_URL =
  'https://storage.googleapis.com/comfy-desktop-public/standalone-environments'

// Returns the mirror URL for a primary R2 URL, or undefined when the URL is
// outside the R2 namespace or no mirror is configured. While the dev override
// is active there is no mirror: a failed local fetch must fail, not silently
// fall back to production metadata or artifacts.
export function r2MirrorUrl(primaryUrl: string): string | undefined {
  if (DEV_BASE_URL_OVERRIDE) return undefined
  if (!R2_MIRROR_BASE_URL) return undefined
  if (!primaryUrl.startsWith(R2_BASE_URL)) return undefined
  return R2_MIRROR_BASE_URL + primaryUrl.slice(R2_BASE_URL.length)
}
