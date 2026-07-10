import { isIP } from 'node:net'

/** Production Cloud origin — serves both the login page and the ingest `/api`. */
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

/**
 * Resolve the Cloud origin the sign-in should run against. A caller may
 * explicitly trust a loopback development origin whose `/api` proxies to a
 * matching local backend. Packaged and production-project flows must leave
 * that disabled so renderer location never chooses the credential endpoint.
 */
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
  } catch {
    // Fall through to production Cloud.
  }
  return CLOUD_LOGIN_ORIGIN
}
