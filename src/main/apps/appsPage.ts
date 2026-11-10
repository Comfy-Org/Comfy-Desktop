const MAX_PAGE_LENGTH = 300
const LIST_HASHES = new Set(['', '#', '#/'])
const EXAMPLE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/
const EXAMPLE_QUERY = /^example=[a-z0-9][a-z0-9-]{0,79}$/

export function isExampleId(value: unknown): value is string {
  return typeof value === 'string' && EXAMPLE_ID.test(value)
}

function hasOnlyExampleQuery(part: string): boolean {
  const at = part.indexOf('?')
  return at < 0 || EXAMPLE_QUERY.test(part.slice(at + 1))
}

function asksOnlyForAnExample(page: string): boolean {
  const hashAt = page.indexOf('#')
  if (hashAt < 0) return hasOnlyExampleQuery(page)
  return hasOnlyExampleQuery(page.slice(0, hashAt)) && hasOnlyExampleQuery(page.slice(hashAt + 1))
}

export function isAppsPath(page: unknown): page is string {
  return (
    typeof page === 'string' &&
    page.length <= MAX_PAGE_LENGTH &&
    page.startsWith('/apps/') &&
    !page.includes('//') &&
    !page.includes('\\') &&
    !page.split(/[/?#]/).includes('..') &&
    !/%2e|%2f|%5c/i.test(page) &&
    ![...page].some(isControlOrSpace) &&
    asksOnlyForAnExample(page)
  )
}

export function examplePage(page: string, exampleId: unknown): string | null {
  if (!isAppsPath(page) || page.includes('?') || !isExampleId(exampleId)) return null
  const withExample = `${page}?example=${exampleId}`
  return isAppsPath(withExample) ? withExample : null
}

function isControlOrSpace(char: string): boolean {
  const code = char.charCodeAt(0)
  return code <= 0x20 || code === 0x7f || /\s/.test(char)
}

export function appsPageUrl(origin: string | null, page: unknown): string | null {
  if (!origin || !isAppsPath(page)) return null
  try {
    const url = new URL(page, origin)
    return url.origin === origin && url.pathname.startsWith('/apps/') ? url.href : null
  } catch {
    return null
  }
}

export function isAppsListUrl(url: string, appsUrl: string): boolean {
  let target: URL
  let list: URL
  try {
    target = new URL(url)
    list = new URL(appsUrl)
  } catch {
    return false
  }
  if (target.origin !== list.origin || !LIST_HASHES.has(target.hash)) return false
  const listPaths = new Set(['/apps', '/apps/', list.pathname])
  return listPaths.has(target.pathname)
}
