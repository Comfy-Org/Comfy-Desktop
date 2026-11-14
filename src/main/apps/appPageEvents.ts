import { APP_ID_PATTERN } from '../../shared/appsLocation'
import * as mainTelemetry from '../lib/telemetry'
import type { TelemetryContext } from '../lib/telemetry'

export const APP_PAGE_EVENT_PREFIX = 'comfy.desktop.apps.'
export const MAX_PAGE_EVENT_PROPERTIES = 16
export const PAGE_EVENTS_PER_MINUTE = 60
export const PAGE_EVENTS_PER_SESSION = 1_000
const MINUTE_MS = 60_000

const EVENT_NAME = /^[a-z][a-z0-9_]{0,47}$/
const PROPERTY_NAME = /^[a-z][a-z0-9_]{0,31}$/
const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/

export const DESKTOP_APP_EVENTS: ReadonlySet<string> = new Set(['app_opened', 'app_page_failed'])
export const UNLIMITED_EVENT_NAMES: ReadonlySet<string> = new Set(['error'])
const DESKTOP_PROPERTIES: ReadonlySet<string> = new Set(['app', 'app_id'])

type PropertyValue = boolean | number | string

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function propertyValue(value: unknown): PropertyValue | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return SLUG.test(value) ? value : undefined
  return undefined
}

function isPageProperty(key: string): boolean {
  return (
    PROPERTY_NAME.test(key) &&
    !DESKTOP_PROPERTIES.has(key) &&
    !mainTelemetry.DEFAULT_EVENT_PROPERTY_NAMES.has(key)
  )
}

export interface CheckedPageEvent {
  event: string
  properties: TelemetryContext
}

export function checkAppPageEvent(
  name: unknown,
  props: unknown,
  appId: string | null
): CheckedPageEvent | null {
  if (
    typeof name !== 'string' ||
    !EVENT_NAME.test(name) ||
    DESKTOP_APP_EVENTS.has(name) ||
    UNLIMITED_EVENT_NAMES.has(name)
  ) {
    return null
  }
  if (appId === null || !APP_ID_PATTERN.test(appId)) return null
  const properties: TelemetryContext = {}
  let kept = 0
  for (const [key, raw] of Object.entries(isPlainRecord(props) ? props : {})) {
    if (kept === MAX_PAGE_EVENT_PROPERTIES) break
    if (!isPageProperty(key)) continue
    const value = propertyValue(raw)
    if (value === undefined) continue
    properties[key] = value
    kept++
  }
  properties['app_id'] = appId
  return { event: `${APP_PAGE_EVENT_PREFIX}${name}`, properties }
}

const sentThisMinute = new Map<string, number[]>()
let sentThisSession = 0

function recentFor(appId: string, now: number): number[] {
  const recent = (sentThisMinute.get(appId) ?? []).filter((at) => at > now - MINUTE_MS)
  sentThisMinute.set(appId, recent)
  return recent
}

function isUnderPageLimits(appId: string, now: number): boolean {
  return (
    sentThisSession < PAGE_EVENTS_PER_SESSION &&
    recentFor(appId, now).length < PAGE_EVENTS_PER_MINUTE
  )
}

function countSent(appId: string, now: number): void {
  recentFor(appId, now).push(now)
  sentThisSession++
}

export function _resetPageEventLimitsForTest(): void {
  sentThisMinute.clear()
  sentThisSession = 0
}

export function trackAppPageEvent(name: unknown, props: unknown, appId: string | null): boolean {
  try {
    const checked = checkAppPageEvent(name, props, appId)
    const now = Date.now()
    if (!checked || appId === null || !isUnderPageLimits(appId, now)) return false
    const sent = mainTelemetry.capture(checked.event, checked.properties)
    if (sent) countSent(appId, now)
    return sent
  } catch {
    return false
  }
}
