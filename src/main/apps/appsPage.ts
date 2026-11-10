const MAX_PAGE_LENGTH = 300
const LIST_HASHES = new Set(['', '#', '#/'])

export function isAppsPath(page: unknown): page is string {
  return (
    typeof page === 'string' &&
    page.length <= MAX_PAGE_LENGTH &&
    page.startsWith('/apps/') &&
    !page.includes('//') &&
    !page.includes('\\') &&
    !page.split(/[/?#]/).includes('..') &&
    !/%2e|%2f|%5c/i.test(page) &&
    ![...page].some(isControlOrSpace)
  )
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
