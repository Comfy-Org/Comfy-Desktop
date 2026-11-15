export const DEFAULT_APPS_URL = 'https://comfy.org/apps/'

export interface AppsLocation {
  url: string
  origin: string
  scopePath: string
}

function parseWebUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

function asDirectory(pathname: string): string {
  return pathname.endsWith('/') ? pathname : `${pathname}/`
}

export function resolveAppsLocation(override?: string | null): AppsLocation {
  const url = (override ? parseWebUrl(override) : null) ?? new URL(DEFAULT_APPS_URL)
  return { url: url.href, origin: url.origin, scopePath: asDirectory(url.pathname) }
}

export function isInAppsScope(location: AppsLocation, candidate: string): boolean {
  const url = parseWebUrl(candidate)
  if (!url || url.origin !== location.origin) return false
  if (url.username !== '' || url.password !== '') return false
  return asDirectory(url.pathname).startsWith(location.scopePath)
}

const LIST_ROUTES: ReadonlySet<string> = new Set(['', '#', '#/'])

export function isAppsListUrl(location: AppsLocation, candidate: string): boolean {
  const url = parseWebUrl(candidate)
  if (!url || url.origin !== location.origin) return false
  return asDirectory(url.pathname) === location.scopePath && LIST_ROUTES.has(url.hash)
}

export function isWebUrl(candidate: string): boolean {
  return parseWebUrl(candidate) !== null
}
