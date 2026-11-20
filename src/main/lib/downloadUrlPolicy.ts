export type DownloadUrlCheck = (url: string) => boolean

const BLOCKED_HOSTNAMES = new Set(['metadata', 'metadata.google.internal'])

function parse(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw === '') return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

function ipv4Octets(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return null
  const octets = m.slice(1).map(Number)
  return octets.every((o) => o <= 255) ? octets : null
}

function mappedIpv4(host: string): number[] | null {
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
  if (!m) return null
  const hi = parseInt(m[1] ?? '', 16)
  const lo = parseInt(m[2] ?? '', 16)
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]
}

function isBlockedIpv4(octets: number[]): boolean {
  return octets[0] === 0 || (octets[0] === 169 && octets[1] === 254)
}

function isLoopbackIpv4(octets: number[]): boolean {
  return octets[0] === 127
}

function bareHost(url: URL): string {
  const host = url.hostname.toLowerCase()
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

function isBlockedHost(url: URL): boolean {
  const host = bareHost(url)
  if (BLOCKED_HOSTNAMES.has(host.replace(/\.$/, ''))) return true
  const v4 = ipv4Octets(host) ?? mappedIpv4(host)
  if (v4) return isBlockedIpv4(v4)
  if (host.includes(':')) {
    if (host === '::') return true
    if (/^fe[89ab][0-9a-f]?:/.test(host)) return true
    if (host === 'fd00:ec2::254') return true
  }
  return false
}

export function isLoopbackHost(url: URL): boolean {
  const host = bareHost(url)
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1') return true
  const v4 = ipv4Octets(host) ?? mappedIpv4(host)
  return v4 !== null && isLoopbackIpv4(v4)
}

export function isPermittedDownloadUrl(raw: unknown): boolean {
  const url = parse(raw)
  if (!url) return false
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (url.username !== '' || url.password !== '') return false
  if (url.hostname === '') return false
  return !isBlockedHost(url)
}

export function isSecurePublicDownloadUrl(raw: unknown): boolean {
  if (!isPermittedDownloadUrl(raw)) return false
  const url = new URL(raw as string)
  return url.protocol === 'https:' || isLoopbackHost(url)
}

export function isPermittedRedirect(from: string, to: string, check: DownloadUrlCheck): boolean {
  if (!check(to)) return false
  const prev = parse(from)
  const next = parse(to)
  if (!prev || !next) return false
  return !(prev.protocol === 'https:' && next.protocol === 'http:')
}

export function isPermittedChain(chain: readonly string[], validateUrl: DownloadUrlCheck): boolean {
  const [first, ...rest] = chain
  if (first === undefined || !validateUrl(first)) return false
  let prev = first
  for (const next of rest) {
    if (!isPermittedRedirect(prev, next, validateUrl)) return false
    prev = next
  }
  return true
}

export function originOf(raw: unknown): string | null {
  const url = parse(raw)
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null
  return url.origin
}

export function isSameOrigin(a: string, b: string): boolean {
  const oa = originOf(a)
  return oa !== null && oa === originOf(b)
}

export function sameOriginCheck(origins: Iterable<string | null>): DownloadUrlCheck {
  const allowed = new Set([...origins].filter((o): o is string => o !== null))
  return (raw) => isPermittedDownloadUrl(raw) && allowed.has(originOf(raw) ?? '')
}
