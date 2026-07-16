const CLOUD_DISTRIBUTION_HOST = 'cloud.comfy.org'

const DEFAULT_UTM_PARAMS: Record<string, string> = {
  utm_source: 'comfy.desktop',
  utm_medium: 'app_feature'
}

function warnSkippedUtm(reason: string, details: Record<string, string>): void {
  console.warn(`[cloud-utm] ${reason}`, details)
}

export function withCloudDistributionUtm(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    warnSkippedUtm('Skipped UTM tagging because URL parsing failed', { rawUrl })
    return rawUrl
  }
  if (url.hostname.toLowerCase() !== CLOUD_DISTRIBUTION_HOST) {
    warnSkippedUtm('Skipped UTM tagging because host is not cloud.comfy.org', {
      host: url.hostname,
      rawUrl: url.href
    })
    return rawUrl
  }

  for (const [key, value] of Object.entries(DEFAULT_UTM_PARAMS)) {
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value)
    }
  }

  // Installation identifiers are properties, never URL-carried identities.
  url.searchParams.delete('desktop_device_id')
  url.searchParams.delete('installation_id')

  return url.href
}

/** Human-readable form of a launch URL: just the host (e.g. "cloud.comfy.org").
 *  Used for "Connecting to …" status text so UTM params
 *  appended by `withCloudDistributionUtm` — and the rest of the path/query — don't
 *  leak into the UI. Host is parsed from the URL, never hardcoded, so it works for
 *  any remote/cloud target. `url.host` keeps a non-default port if present. */
export function displayLaunchUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).host
  } catch {
    return rawUrl
  }
}
