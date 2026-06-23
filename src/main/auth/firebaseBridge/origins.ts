import { isIP } from 'node:net'

export const CLOUD_LOGIN_ORIGIN = 'https://cloud.comfy.org'

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') return true
  return isIP(normalized) === 4 && normalized.startsWith('127.')
}

export function cloudLoginOriginForUrl(currentUrl: string): string {
  try {
    const url = new URL(currentUrl)
    if (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      isLoopbackHostname(url.hostname)
    ) {
      return url.origin
    }
  } catch {
    // Fall through to production Cloud.
  }
  return CLOUD_LOGIN_ORIGIN
}

export function isAllowedCloudCallbackOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    const url = new URL(origin)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    return url.origin === CLOUD_LOGIN_ORIGIN || isLoopbackHostname(url.hostname)
  } catch {
    return false
  }
}
