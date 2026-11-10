import { isIP } from 'node:net'

export const CLOUD_LOGIN_ORIGIN = 'https://cloud.comfy.org'

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  const bare =
    normalized.startsWith('[') && normalized.endsWith(']') ? normalized.slice(1, -1) : normalized
  if (bare === 'localhost') return true
  if (bare.includes(':')) {
    try {
      if (new URL(`http://[${bare}]/`).hostname === '[::1]') return true
    } catch {
      return false
    }
  }
  return isIP(bare) === 4 && bare.startsWith('127.')
}

export function cloudLoginOriginForUrl(currentUrl: string, allowLoopbackDevOrigin = false): string {
  try {
    const url = new URL(currentUrl)
    if (
      allowLoopbackDevOrigin &&
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      isLoopbackHostname(url.hostname)
    ) {
      return url.origin
    }
  } catch {}
  return CLOUD_LOGIN_ORIGIN
}
