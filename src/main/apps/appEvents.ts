import * as telemetry from '../lib/telemetry'
import type { TelemetryContext, TelemetryValue } from '../lib/telemetry'
import { isAppsEnabled } from './appsSwitch'

export const APP_EVENT_PREFIX = 'comfy.desktop.apps.'
export const APP_SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/
export const CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
export const NODE_TYPE = /^[A-Za-z0-9_][A-Za-z0-9_ .+()|-]{0,79}$/
export const MAX_NODE_TYPES = 20
const COMFY_VERSION = /^v?\d{1,4}(\.\d{1,4}){1,3}([.+-][0-9A-Za-z]{1,16}){0,3}$/
const MODEL_FILE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}\.(safetensors|pth)$/
const MAX_SECONDS = 7 * 24 * 60 * 60
const MAX_BYTES = 10 ** 13
const MAX_GB = 4096

export type Where = 'cloud' | 'local'

export type RunFailedStep =
  | 'sign_in'
  | 'rate_limited'
  | 'rejected'
  | 'upload'
  | 'setup'
  | 'start_comfy'
  | 'model_download'
  | 'run'

export type GpuClass = 'nvidia' | 'amd' | 'intel' | 'apple'

export interface AppEventFields {
  app_opened: { app: string }
  run_started: {
    app: string
    where: Where
    model?: string
    quality?: 'fast' | 'best'
    seconds?: number
  }
  example_used: { app: string; example: string }
  open_in_comfyui: { app: string; where: Where }
  run_failed: {
    app: string
    where: Where
    step: RunFailedStep
    error_class?: string
    node_types?: string[]
  }
  run_finished: {
    app: string
    where: Where
    outcome: 'success' | 'failed' | 'cancelled'
    run_seconds: number
    queue_seconds?: number
    error_class?: string
    comfy: 'apps_build' | 'own'
    comfy_version?: string
    gpu?: GpuClass
    vram_gb?: number
    ram_gb?: number
    os: NodeJS.Platform
  }
  output_saved: { app: string; where: Where }
  setup: {
    app?: string
    stage: 'comfyui' | 'model'
    outcome: 'started' | 'finished' | 'failed'
    bytes?: number
    seconds?: number
    model_file?: string
  }
}

export type AppEventName = keyof AppEventFields

type Value = TelemetryValue | TelemetryValue[]
type Read = (value: unknown) => Value | undefined

interface Field {
  read: Read
  optional: boolean
}

type Schema = Readonly<Record<string, Field>>

const need = (read: Read): Field => ({ read, optional: false })
const may = (read: Read): Field => ({ read, optional: true })

const matching =
  (pattern: RegExp): Read =>
  (value) =>
    typeof value === 'string' && pattern.test(value) ? value : undefined

const oneOf =
  (...allowed: readonly string[]): Read =>
  (value) =>
    typeof value === 'string' && allowed.includes(value) ? value : undefined

const inRange = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max

const seconds: Read = (value) =>
  inRange(value, MAX_SECONDS) ? Math.round(value * 10) / 10 : undefined

const whole =
  (max: number): Read =>
  (value) =>
    inRange(value, max) ? Math.round(value) : undefined

const nodeTypes: Read = (value) =>
  Array.isArray(value) &&
  value.length >= 1 &&
  value.length <= MAX_NODE_TYPES &&
  value.every((type) => typeof type === 'string' && NODE_TYPE.test(type))
    ? [...(value as string[])]
    : undefined

const slug = matching(APP_SLUG)
const where = oneOf('cloud', 'local')
const errorClass = matching(CLASS_NAME)

const PAGE_SCHEMAS: Record<string, Schema> = {
  app_opened: { app: need(slug) },
  run_started: {
    app: need(slug),
    where: need(where),
    model: may(slug),
    quality: may(oneOf('fast', 'best')),
    seconds: may(seconds)
  },
  example_used: { app: need(slug), example: need(slug) },
  open_in_comfyui: { app: need(slug), where: need(where) }
}

const MAIN_ONLY_SCHEMAS: Record<string, Schema> = {
  run_failed: {
    app: need(slug),
    where: need(where),
    step: need(
      oneOf(
        'sign_in',
        'rate_limited',
        'rejected',
        'upload',
        'setup',
        'start_comfy',
        'model_download',
        'run'
      )
    ),
    error_class: may(errorClass),
    node_types: may(nodeTypes)
  },
  run_finished: {
    app: need(slug),
    where: need(where),
    outcome: need(oneOf('success', 'failed', 'cancelled')),
    run_seconds: need(seconds),
    queue_seconds: may(seconds),
    error_class: may(errorClass),
    comfy: need(oneOf('apps_build', 'own')),
    comfy_version: may(matching(COMFY_VERSION)),
    gpu: may(oneOf('nvidia', 'amd', 'intel', 'apple')),
    vram_gb: may(whole(MAX_GB)),
    ram_gb: may(whole(MAX_GB)),
    os: need(oneOf('win32', 'darwin', 'linux'))
  },
  output_saved: { app: need(slug), where: need(where) },
  setup: {
    app: may(slug),
    stage: need(oneOf('comfyui', 'model')),
    outcome: need(oneOf('started', 'finished', 'failed')),
    bytes: may(whole(MAX_BYTES)),
    seconds: may(seconds),
    model_file: may(matching(MODEL_FILE))
  }
}

export const PAGE_EVENTS: ReadonlyMap<string, Schema> = new Map(Object.entries(PAGE_SCHEMAS))

export const MAIN_EVENTS: ReadonlyMap<string, Schema> = new Map([
  ...Object.entries(PAGE_SCHEMAS),
  ...Object.entries(MAIN_ONLY_SCHEMAS)
])

const MIRRORED_TO_DATADOG: ReadonlySet<string> = new Set(['run_failed'])

export function checkAppEvent(
  events: ReadonlyMap<string, Schema>,
  name: unknown,
  fields: unknown
): TelemetryContext | null {
  if (typeof name !== 'string') return null
  const schema = events.get(name)
  if (!schema) return null
  if (fields !== undefined && (!fields || typeof fields !== 'object' || Array.isArray(fields))) {
    return null
  }
  const given = (fields ?? {}) as Record<string, unknown>
  const checked: TelemetryContext = {}
  for (const [key, field] of Object.entries(schema)) {
    const raw = given[key]
    if (raw === undefined || raw === null) {
      if (field.optional) continue
      return null
    }
    const value = field.read(raw)
    if (value === undefined) return null
    checked[key] = value
  }
  return checked
}

function send(name: string, checked: TelemetryContext): void {
  const event = `${APP_EVENT_PREFIX}${name}`
  const context = { ...checked, apps_enabled: isAppsEnabled() }
  if (MIRRORED_TO_DATADOG.has(name)) telemetry.emit(event, context)
  else telemetry.capture(event, context)
}

export function trackFromPage(name: unknown, fields: unknown): void {
  try {
    const checked = checkAppEvent(PAGE_EVENTS, name, fields)
    if (checked) send(name as string, checked)
  } catch {}
}

export function trackApps<N extends AppEventName>(name: N, fields: AppEventFields[N]): void {
  try {
    const checked = checkAppEvent(MAIN_EVENTS, name, fields)
    if (checked) send(name, checked)
  } catch {}
}
