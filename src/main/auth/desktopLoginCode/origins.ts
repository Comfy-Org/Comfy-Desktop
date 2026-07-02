import { isIP } from 'node:net'

/** Production Cloud origin — serves both the login page and the ingest `/api`. */
export const CLOUD_LOGIN_ORIGIN = 'https://cloud.comfy.org'

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') return true
  return isIP(normalized) === 4 && normalized.startsWith('127.')
}

/**
 * Resolve the Cloud origin the sign-in should run against. When the embedded
 * view is served from a loopback dev server we keep the developer's origin
 * (its `/api` proxies to their local backend); anything else — including a
 * malformed URL — resolves to production Cloud so the flow can never be
 * redirected off-site.
 */
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
