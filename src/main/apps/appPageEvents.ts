import * as mainTelemetry from '../lib/telemetry'
import type { TelemetryContext } from '../lib/telemetry'

export const APP_PAGE_EVENT_PREFIX = 'comfy.desktop.apps.'

const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_SECONDS = 86_400

type Read = (value: unknown) => string | number | undefined

const slug: Read = (value) => (typeof value === 'string' && SLUG.test(value) ? value : undefined)

const oneOf =
  (...allowed: readonly string[]): Read =>
  (value) =>
    typeof value === 'string' && allowed.includes(value) ? value : undefined

const seconds: Read = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_SECONDS
    ? Math.max(1, Math.round(value))
    : undefined

const READ: Readonly<Record<string, Read>> = {
  where: oneOf('cloud', 'local'),
  model: slug,
  quality: oneOf('fast', 'best'),
  seconds,
  example: slug
}

interface PageEvent {
  need: readonly string[]
  may: readonly string[]
}

const PAGE_EVENTS: ReadonlyMap<string, PageEvent> = new Map([
  ['run_started', { need: ['where'], may: ['model', 'quality', 'seconds'] }],
  ['example_used', { need: ['example'], may: [] }],
  ['open_in_comfyui', { need: ['where'], may: [] }]
])

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface CheckedPageEvent {
  event: string
  properties: TelemetryContext
}

export function checkAppPageEvent(name: unknown, props: unknown): CheckedPageEvent | null {
  if (typeof name !== 'string') return null
  const spec = PAGE_EVENTS.get(name)
  if (!spec) return null
  const given = isPlainRecord(props) ? props : {}
  const appId = slug(given['app'])
  if (appId === undefined) return null
  const properties: TelemetryContext = { app_id: appId }
  for (const key of [...spec.need, ...spec.may]) {
    const raw = given[key]
    const value = raw === undefined || raw === null ? undefined : READ[key](raw)
    if (value !== undefined) properties[key] = value
    else if (spec.need.includes(key)) return null
  }
  return { event: `${APP_PAGE_EVENT_PREFIX}${name}`, properties }
}

export function trackAppPageEvent(name: unknown, props: unknown): boolean {
  try {
    const checked = checkAppPageEvent(name, props)
    return checked ? mainTelemetry.capture(checked.event, checked.properties) : false
  } catch {
    return false
  }
}
