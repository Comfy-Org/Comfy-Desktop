import { datadogRum, type RumBeforeSend, type RumErrorEvent } from '@datadog/browser-rum'
import { scrubPII } from '../../../shared/piiScrub'

export const DATADOG_BUNDLE_BASE_URL = 'app://app'

const DATADOG_BUNDLE_PATH_PATTERNS = [
  /file:\/\/\/[^\s)\n]*?[\\/]+out[\\/]+(renderer|main|preload)([\\/][^)\s\n:]+\.js)/g,
  /[A-Za-z]:\\[^\s)\n]*?\\out\\(renderer|main|preload)(\\[^)\s\n:]+\.js)/g,
  /\/[^\s)\n]*?\/out\/(renderer|main|preload)(\/[^)\s\n:]+\.js)/g
]

export function normalizeDatadogBundlePaths(value: string | undefined): string | undefined {
  if (!value) return value

  let normalized = value
  for (const pattern of DATADOG_BUNDLE_PATH_PATTERNS) {
    normalized = normalized.replace(pattern, (_match, bundleName: string, resourcePath: string) => {
      return `${DATADOG_BUNDLE_BASE_URL}/${bundleName}${resourcePath.replace(/\\/g, '/')}`
    })
  }

  return normalized
}

const URL_QUERY_PATTERN = /(https?:\/\/[^\s?#"')]+)\?[^\s"')]*/gi
const DATA_URI_PATTERN = /data:[^\s"')]+/gi

export function scrubRumText(value: string): string {
  return scrubPII(value)
    .replace(URL_QUERY_PATTERN, (_match, address: string) => `${address}?[REDACTED]`)
    .replace(DATA_URI_PATTERN, 'data:[REDACTED]')
}

export function normalizeRumErrorEvent(event: RumErrorEvent): void {
  event.error.message = scrubRumText(event.error.message)
  event.error.stack = normalizeDatadogBundlePaths(event.error.stack)
  if (event.error.stack) {
    event.error.stack = scrubRumText(event.error.stack)
  }
  if (event.error.resource?.url) {
    event.error.resource.url =
      normalizeDatadogBundlePaths(event.error.resource.url) || event.error.resource.url
    event.error.resource.url = scrubRumText(event.error.resource.url)
  }
}

export function flattenErrorWithCauses(error: RumErrorEvent['error']): Error {
  const causes = error.causes ?? []
  const message = [
    error.message,
    ...causes.map((cause) => `Caused by: ${cause.type ?? 'Error'}: ${cause.message}`)
  ]
  const flattened = new Error(scrubRumText(message.join('\n')))
  flattened.name = error.type ?? flattened.name
  const stacks = [error.stack, ...causes.map((cause) => cause.stack)].filter(Boolean)
  flattened.stack = scrubRumText(normalizeDatadogBundlePaths(stacks.join('\n')) ?? '')
  return flattened
}

export const rumBeforeSend: RumBeforeSend = (event) => {
  if (event.type !== 'error') return true
  if (event.error.causes?.length) {
    const flattened = flattenErrorWithCauses(event.error)
    setTimeout(() => datadogRum.addError(flattened, event.context))
    return false
  }
  normalizeRumErrorEvent(event)
  return true
}
