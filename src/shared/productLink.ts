export const PRODUCT_LINK_SOURCE = 'comfy_desktop'
export const PRODUCT_LINK_MEDIUM = 'product'

function isComfyHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'comfy.org' || host.endsWith('.comfy.org')
}

export function productLink(url: string, campaign: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (!isComfyHost(parsed.hostname)) return url
  parsed.searchParams.set('utm_source', PRODUCT_LINK_SOURCE)
  parsed.searchParams.set('utm_medium', PRODUCT_LINK_MEDIUM)
  parsed.searchParams.set('utm_campaign', campaign)
  return parsed.href
}
