// IPC for renderer-originated telemetry: the renderer routes through main so
// identity, consent, and dedup live in one place. Capture messages are
// fire-and-forget (ipcMain.on).
import { ipcMain } from 'electron'
import * as mainTelemetry from '../telemetry'
import {
  getFlagAsync as getExperimentFlagAsync,
  recordExposure,
  type ExperimentExposureSource
} from '../experiments'

interface CapturePayload {
  event?: unknown
  properties?: unknown
}

interface CaptureExceptionPayload {
  message?: unknown
  stack?: unknown
  properties?: unknown
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isTelemetryValue(v: unknown): v is mainTelemetry.TelemetryValue {
  return (
    v === null ||
    v === undefined ||
    typeof v === 'boolean' ||
    typeof v === 'number' ||
    typeof v === 'string'
  )
}

const MAX_TELEMETRY_KEYS = 128
const MAX_TELEMETRY_ARRAY_ITEMS = 128
const MAX_TELEMETRY_STRING_LENGTH = 2048

function clampTelemetryValue(v: mainTelemetry.TelemetryValue): mainTelemetry.TelemetryValue {
  return typeof v === 'string' ? v.slice(0, MAX_TELEMETRY_STRING_LENGTH) : v
}

function asTelemetryValueArray(v: unknown): mainTelemetry.TelemetryValue[] | null {
  if (!Array.isArray(v)) return null
  const out: mainTelemetry.TelemetryValue[] = []
  for (let i = 0; i < v.length && i < MAX_TELEMETRY_ARRAY_ITEMS; i++) {
    const raw = v[i]
    if (!isTelemetryValue(raw)) return null
    out.push(clampTelemetryValue(raw))
  }
  return out
}

function asTelemetryObject(value: unknown, allowArrays: true): mainTelemetry.TelemetryContext
function asTelemetryObject(
  value: unknown,
  allowArrays: false
): Record<string, mainTelemetry.TelemetryValue>
function asTelemetryObject(value: unknown, allowArrays: boolean): mainTelemetry.TelemetryContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const out: mainTelemetry.TelemetryContext = {}
  let count = 0
  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue
    if (count++ >= MAX_TELEMETRY_KEYS) break
    const raw = source[key]
    if (isTelemetryValue(raw)) {
      out[key] = clampTelemetryValue(raw)
    } else if (allowArrays) {
      const array = asTelemetryValueArray(raw)
      if (array) out[key] = array
    }
  }
  return out
}

// Per-key filter to the TelemetryContext contract.
function asProps(value: unknown): mainTelemetry.TelemetryContext {
  return asTelemetryObject(value, true)
}

function asPersonProps(value: unknown): Record<string, mainTelemetry.TelemetryValue> {
  return asTelemetryObject(value, false)
}

export function registerTelemetryHandlers(): void {
  ipcMain.on('telemetry:capture', (_event, payload: CapturePayload) => {
    const eventName = asString(payload?.event)
    if (!eventName) return
    mainTelemetry.capture(eventName, asProps(payload.properties))
  })

  ipcMain.on('telemetry:captureException', (_event, payload: CaptureExceptionPayload) => {
    const message = asString(payload?.message) ?? 'Unknown renderer error'
    const stackStr = asString(payload?.stack) ?? undefined
    const err = new Error(message)
    if (stackStr) err.stack = stackStr
    mainTelemetry.captureException(err, asProps(payload?.properties))
  })

  ipcMain.on('telemetry:registerProperties', (_event, properties: unknown) => {
    const props = asPersonProps(properties)
    if (Object.keys(props).length === 0) return
    mainTelemetry.registerPersonProperties(props)
  })

  // On login: alias the anonymous installation_id into the user_id. Renderer
  // still owns datadogRum.setUser (Datadog is browser-only).
  ipcMain.on('telemetry:bindUserId', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const userId = asString((payload as Record<string, unknown>).userId)
    if (!userId) return
    const properties = asPersonProps((payload as Record<string, unknown>).properties)
    mainTelemetry.bindUserId(userId, properties)
  })

  // Logout: switch distinct_id back to the anonymous installation_id (NOT
  // posthog.reset(), which would clobber installation_id + download_token).
  ipcMain.on('telemetry:unbindUserId', () => {
    mainTelemetry.unbindUserId()
  })

  // Flag lookup for renderer A/B branches; awaits the boot fetch so a query
  // landing before it settles still gets the real variant. null → control.
  ipcMain.handle('telemetry:getExperimentFlag', async (_event, key: unknown) => {
    const flagKey = asString(key)
    if (!flagKey) return null
    const value = await getExperimentFlagAsync(flagKey)
    return value === undefined ? null : value
  })

  // Exposure event; per-session dedup is enforced main-side.
  ipcMain.on('telemetry:recordExposure', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const p = payload as Record<string, unknown>
    const experimentKey = asString(p.experimentKey)
    const variant = asString(p.variant)
    const sourceStr = asString(p.source)
    if (!experimentKey || !variant) return
    const source: ExperimentExposureSource =
      sourceStr === 'remote' ? 'remote' : sourceStr === 'fallback' ? 'fallback' : 'cache'
    recordExposure(experimentKey, variant, source)
  })
}
