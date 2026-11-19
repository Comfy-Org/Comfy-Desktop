import * as telemetry from './telemetry'
import type { SessionKind } from '../../shared/performanceTestSession'
import type { TelemetryValue } from './telemetry'
import { DATADOG_GLOBAL_CONTEXT_KEYS } from '../../shared/datadogMirroredEvents'
import { createStreamLineBuffer, stripAnsi, stripLogLevelPrefix } from './stderrTail'

export const ASSETS_EVENT_LINE =
  /^\[assets-event\] ([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)((?: [a-z_]+=[^ =]+)*)$/

const EVENT_PREFIX = 'comfy.desktop.comfyui.assets.'

export const ALLOWED_EVENTS: ReadonlySet<string> = new Set([
  'assets.enabled',
  'seeder.scan_started',
  'seeder.scan_completed',
  'seeder.scan_failed',
  'seeder.scan_cancelled',
  'seeder.marked_missing',
  'seeder.batch_insert_failed',
  'scanner.hash_failed',
  'scanner.enrich_failed',
  'scanner.hash_discarded_modified',
  'scanner.fast_scan_failed',
  'scanner.temp_sync_failed',
  'scanner.mark_missing_failed',
  'scanner.stat_failed',
  'scanner.invalid_mtime',
  'scanner.watch_stat_failed',
  'scanner.watch_spec_failed',
  'scanner.watch_seed_failed',
  'scanner.failure_bucket',
  'scanner.root_unreachable',
  'scanner.walk_failed',
  'scanner.metadata_failed'
])

const UNKNOWN_EVENTS_DROPPED = 'unknown_events_dropped'
const UNKNOWN_ENUM_VALUES_OMITTED = 'unknown_enum_values_omitted'

const MAX_STRING_LENGTH = 64
const FORBIDDEN_STRING_CHARS = ['/', '\\', ':', ' ', '=', '"', '\n', '\r']
const ROOTS: ReadonlySet<string> = new Set(['models', 'input', 'output', 'user', 'temp'])
const PHASES: ReadonlySet<string> = new Set(['fast', 'enrich', 'full'])
const STAGES: ReadonlySet<string> = new Set([
  'mark_missing',
  'pruning',
  'fast_scan',
  'enrich',
  'finalize'
])
const SITES: ReadonlySet<string> = new Set([
  'discovery',
  'enrich',
  'reference',
  'seed_observation',
  'walk_root',
  'walk_dir',
  'hash',
  'metadata',
  'batch_insert',
  'watch_stat',
  'watch_spec',
  'watch_seed'
])
const REASONS: ReadonlySet<string> = new Set([
  'permission_denied',
  'vanished',
  'locked',
  'cloud_placeholder',
  'network_unavailable',
  'device_unavailable',
  'io_error',
  'encoding',
  'name_too_long',
  'path_loop',
  'too_large',
  'no_space',
  'read_only',
  'fd_exhausted',
  'oom',
  'timeout',
  'corrupt',
  'unsupported_format',
  'db_busy',
  'db_locked',
  'db_corrupt',
  'db_full',
  'db_io',
  'db_readonly',
  'db_cantopen',
  'db_constraint',
  'dependency_missing',
  'other'
])
const ERROR_KINDS: ReadonlySet<string> = new Set([
  'expression_tree_too_large',
  'too_many_variables',
  'database_locked',
  'disk_full',
  'disk_io',
  'unable_to_open',
  'database_corrupt',
  'permission_denied',
  'file_locked',
  'read_only',
  'other'
])
const EXTENSIBLE_ENUMS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['reason', REASONS],
  ['site', SITES],
  ['error_kind', ERROR_KINDS]
])
const ENUM_VALUE = /^[a-z][a-z0-9_]*$/
const ERRNO_NAME = /^(?:E[A-Z0-9]{1,23}|WSA[A-Z0-9_]{1,24}|none)$/
const NO_WINERROR = -1
const MAX_WINERROR = 0xffff
const EXC_FP = /^[0-9a-f]{12}$/
const DOTTED_NAME = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/
const DIGIT_STRING_FIELDS: ReadonlySet<string> = new Set(['exc_fp'])
const INTEGER_FIELDS: ReadonlySet<string> = new Set([
  'elapsed_ms',
  'created',
  'enriched',
  'skipped',
  'hash_failed',
  'enrich_failed',
  'permission_denied',
  'count'
])

const FIELD_NAME = /^[a-z_]+$/

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/

function isSafeString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_STRING_LENGTH &&
    !FORBIDDEN_STRING_CHARS.some((char) => value.includes(char)) &&
    !CONTROL_CHARS.test(value)
  )
}

export const ALLOWED_FIELD_NAMES: ReadonlySet<string> = new Set([
  'root',
  'phase',
  'stage',
  'site',
  'elapsed_ms',
  'created',
  'enriched',
  'skipped',
  'hash_failed',
  'enrich_failed',
  'permission_denied',
  'count',
  'error_type',
  'error_kind',
  'hashing_enabled',
  'reason',
  'errno_name',
  'winerror',
  'exc_fp',
  'exc_class',
  'exc_site',
  'exc_line'
])

const MAX_CONVENTION_FIELD_NAME_LENGTH = 48
const MAX_CONVENTION_NAMES = 64
const MAX_PCT = 100

type FieldConvention = 'non_negative_integer' | 'percent' | 'boolean'

function fieldConvention(key: string): FieldConvention | null {
  if (key.length > MAX_CONVENTION_FIELD_NAME_LENGTH) return null
  if (key.endsWith('_ms') || key.endsWith('_count') || key.endsWith('_bytes')) {
    return 'non_negative_integer'
  }
  if (key.endsWith('_pct')) return 'percent'
  if (key.endsWith('_enabled') || key.startsWith('is_') || key.startsWith('has_')) {
    return 'boolean'
  }
  return null
}

function conventionFieldValue(convention: FieldConvention, value: TelemetryValue): boolean {
  if (convention === 'boolean') return typeof value === 'boolean'
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    Object.is(value, -0)
  ) {
    return false
  }
  return convention === 'non_negative_integer' || value <= MAX_PCT
}

function coerceValue(key: string, rawValue: string): TelemetryValue {
  if (DIGIT_STRING_FIELDS.has(key)) return rawValue
  if (/^-?\d+$/.test(rawValue)) return Number(rawValue)
  if (rawValue === 'true') return true
  if (rawValue === 'false') return false
  return rawValue
}

function isAllowedFieldValue(key: string, value: unknown): value is TelemetryValue {
  if (INTEGER_FIELDS.has(key)) return typeof value === 'number' && Number.isSafeInteger(value)
  if (key === 'hashing_enabled') return typeof value === 'boolean'
  if (key === 'winerror') {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      (value === NO_WINERROR || (value >= 0 && value <= MAX_WINERROR))
    )
  }
  if (key === 'exc_line')
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  if (!isSafeString(value)) return false
  if (key === 'error_type') return true
  if (key === 'root') return ROOTS.has(value)
  if (key === 'phase') return PHASES.has(value)
  if (key === 'stage') return STAGES.has(value)
  if (key === 'site') return SITES.has(value)
  if (key === 'reason') return REASONS.has(value)
  if (key === 'error_kind') return ERROR_KINDS.has(value)
  if (key === 'errno_name') return ERRNO_NAME.test(value)
  if (key === 'exc_fp') return EXC_FP.test(value)
  if (key === 'exc_class' || key === 'exc_site') return DOTTED_NAME.test(value)
  return false
}

function parseFields(
  tail: string,
  baseKeys: ReadonlySet<string>,
  reservedKeys: ReadonlySet<string>,
  conventionNames: ReadonlySet<string>
): {
  fields: Record<string, TelemetryValue>
  omittedEnumValues: number
  newNames: string[]
} | null {
  const fields: Record<string, TelemetryValue> = {}
  const newNames: string[] = []
  let omittedEnumValues = 0
  const seenKeys = new Set<string>()
  const pairs = tail ? tail.slice(1).split(' ') : []
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf('=')
    const key = pair.slice(0, separatorIndex)
    const rawValue = pair.slice(separatorIndex + 1)
    if (!FIELD_NAME.test(key)) return null
    if (baseKeys.has(key)) return null
    if (!ALLOWED_FIELD_NAMES.has(key)) {
      if (Object.hasOwn(Object.prototype, key)) return null
      const convention = fieldConvention(key)
      if (!convention) continue
      if (seenKeys.has(key)) return null
      seenKeys.add(key)
      if (reservedKeys.has(key)) continue
      const value = coerceValue(key, rawValue)
      if (!conventionFieldValue(convention, value)) continue
      if (!conventionNames.has(key)) {
        if (conventionNames.size + newNames.length >= MAX_CONVENTION_NAMES) continue
        newNames.push(key)
      }
      fields[key] = value
      continue
    }
    if (seenKeys.has(key)) return null
    seenKeys.add(key)
    const value = coerceValue(key, rawValue)
    const enumValues = EXTENSIBLE_ENUMS.get(key)
    if (
      enumValues &&
      typeof value === 'string' &&
      !enumValues.has(value) &&
      isSafeString(value) &&
      ENUM_VALUE.test(value)
    ) {
      omittedEnumValues++
      continue
    }
    if (!isAllowedFieldValue(key, value)) return null
    fields[key] = value
  }
  return { fields, omittedEnumValues, newNames }
}

const PER_EVENT_HOURLY_CAP = 60
const RATE_WINDOW_MS = 60 * 60_000

export function createAssetsTap(opts: {
  installationId: string
  variant?: string | null
  release?: string | null
  coreBetaFlags?: readonly string[]
  sessionKind?: SessionKind
}): {
  ingest: (chunk: string, source: 'stdout' | 'stderr') => void
  beginBoot: () => void
  flushSummary: () => void
} {
  const baseContext = {
    installation_id: opts.installationId,
    variant: opts.variant ?? null,
    release: opts.release ?? null,
    core_beta_flags: [...(opts.coreBetaFlags ?? [])],
    session_kind: opts.sessionKind ?? 'normal'
  }
  const baseKeys: ReadonlySet<string> = new Set(Object.keys(baseContext))
  const reservedKeys: ReadonlySet<string> = new Set([
    ...telemetry.DEFAULT_EVENT_PROPERTY_NAMES,
    ...DATADOG_GLOBAL_CONTEXT_KEYS
  ])
  const conventionNames = new Set<string>()

  const rateBuckets = new Map<string, { windowStart: number; count: number }>()

  let unknownEventsDropped = 0
  let unknownEnumValuesOmitted = 0

  function withinRateCap(event: string): boolean {
    const now = Date.now()
    const bucket = rateBuckets.get(event)
    if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
      rateBuckets.set(event, { windowStart: now, count: 1 })
      return true
    }
    if (bucket.count >= PER_EVENT_HOURLY_CAP) return false
    bucket.count++
    return true
  }

  function handleLine(line: string): void {
    const match = stripLogLevelPrefix(stripAnsi(line).trim()).match(ASSETS_EVENT_LINE)
    if (!match) return
    const [, event, tail] = match
    if (!event || tail === undefined) return
    if (telemetry.getConsentState() !== 'granted') return
    if (!ALLOWED_EVENTS.has(event)) {
      unknownEventsDropped++
      return
    }
    const parsed = parseFields(tail, baseKeys, reservedKeys, conventionNames)
    if (!parsed) return
    const { fields } = parsed
    unknownEnumValuesOmitted += parsed.omittedEnumValues
    if (!withinRateCap(event)) return
    for (const name of parsed.newNames) conventionNames.add(name)
    try {
      telemetry.emit(`${EVENT_PREFIX}${event}`, { ...fields, ...baseContext })
    } catch {}
  }

  const lineBuffer = createStreamLineBuffer()

  return {
    ingest(chunk: string, source: 'stdout' | 'stderr'): void {
      try {
        for (const line of lineBuffer.append(source, chunk)) {
          try {
            handleLine(line)
          } catch {}
        }
      } catch {}
    },
    beginBoot(): void {
      lineBuffer.reset()
    },
    flushSummary(): void {
      try {
        if (unknownEventsDropped > 0 && withinRateCap(UNKNOWN_EVENTS_DROPPED)) {
          const count = unknownEventsDropped
          unknownEventsDropped = 0
          telemetry.emit(`${EVENT_PREFIX}${UNKNOWN_EVENTS_DROPPED}`, {
            count,
            ...baseContext
          })
        }
        if (unknownEnumValuesOmitted > 0 && withinRateCap(UNKNOWN_ENUM_VALUES_OMITTED)) {
          const count = unknownEnumValuesOmitted
          unknownEnumValuesOmitted = 0
          telemetry.emit(`${EVENT_PREFIX}${UNKNOWN_ENUM_VALUES_OMITTED}`, {
            count,
            ...baseContext
          })
        }
      } catch {}
    }
  }
}
