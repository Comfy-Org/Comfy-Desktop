import type { ComfyWindowEntry } from './registry'

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])

function parseWebUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return WEB_PROTOCOLS.has(url.protocol) ? url : null
  } catch {
    return null
  }
}

function isHttpsUpgradeOnDefaultPorts(install: URL, candidate: URL): boolean {
  return (
    install.protocol === 'http:' &&
    candidate.protocol === 'https:' &&
    install.port === '' &&
    candidate.port === '' &&
    install.hostname === candidate.hostname
  )
}

export function isInstallSiteUrl(installUrl: string, candidateUrl: string): boolean {
  const install = parseWebUrl(installUrl)
  const candidate = parseWebUrl(candidateUrl)
  if (!install || !candidate) return false
  return install.origin === candidate.origin || isHttpsUpgradeOnDefaultPorts(install, candidate)
}

export function showsInstallSite(
  entry: Pick<ComfyWindowEntry, 'installationId' | 'comfyUrl'>,
  url: string
): boolean {
  return entry.installationId !== null && isInstallSiteUrl(entry.comfyUrl, url)
}
