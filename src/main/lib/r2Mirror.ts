const DEV_BASE_URL_OVERRIDE =
  (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp === true
    ? process.env.COMFY_STANDALONE_BASE_URL?.replace(/\/+$/, '') || undefined
    : undefined

if (DEV_BASE_URL_OVERRIDE) {
  console.warn(`[dev] standalone base URL overridden: ${DEV_BASE_URL_OVERRIDE}`)
}

export const R2_BASE_URL =
  DEV_BASE_URL_OVERRIDE ?? 'https://desktop-assets.comfy.org/standalone-environments'

export const R2_MIRROR_BASE_URL =
  'https://storage.googleapis.com/comfy-desktop-public/standalone-environments'

export function r2MirrorUrl(primaryUrl: string): string | undefined {
  if (DEV_BASE_URL_OVERRIDE) return undefined
  if (!R2_MIRROR_BASE_URL) return undefined
  if (!primaryUrl.startsWith(R2_BASE_URL)) return undefined
  return R2_MIRROR_BASE_URL + primaryUrl.slice(R2_BASE_URL.length)
}
