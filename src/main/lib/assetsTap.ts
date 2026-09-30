/**
 * Assets event-log tap.
 *
 * ComfyUI's assets system logs structured, privacy-safe records next to its
 * human-readable lines: `[assets-event] <event> key=value ...` on the INFO
 * channel (`app/assets/event_log.py`). We tail that output, already piped
 * through `proc.stdout` / `proc.stderr` in `sessionActions/launch.ts` — the
 * same stream `hardwareTap` and `executionTap` consume — and forward each
 * accepted record as `comfy.desktop.comfyui.assets.<event>` through
 * `telemetry.emit`, which is consent-gated and PII-scrubbed centrally.
 *
 * Unlike the hardware tap, which matches known prose, this one parses a single
 * grammar. That makes core's stdout UNTRUSTED INPUT: anything writing to the
 * process's stdout can emit a tagged line, so the tap carries its own closed
 * contract: an event allowlist, a field-name allowlist, per-field type and
 * value checks, and rejection of any key colliding with the trusted base
 * context. Ordinary unknown fields are omitted for version skew, as is a
 * `reason`, `site` or `error_kind` value outside its enum that still has an
 * enum value's shape. The one exception: an unknown field named by a typed convention
 * (`*_ms`, `*_count`, `*_bytes`, `*_pct`, `*_enabled`, `is_*`, `has_*`) is
 * forwarded when its value is a number or boolean of that convention's type
 * (see the CONVENTION CONTRACT below), so core can add metrics without a Desktop
 * release. Other invalid known values and malformed or spoofing keys drop the
 * whole line silently:
 * reporting the rejection would put the untrusted content back into a signal
 * we forward.
 *
 * THREAT MODEL: this validation catches ACCIDENTAL leakage (a path riding
 * along in a field). It is not a boundary against deliberately encoded
 * exfiltration — the closed vocabulary plus the AST discipline on the core
 * side is the primary guarantee.
 */
import * as telemetry from './telemetry'
import type { TelemetryValue } from './telemetry'
import { DATADOG_GLOBAL_CONTEXT_KEYS } from '../../shared/datadogMirroredEvents'
import { createStreamLineBuffer, stripAnsi, stripLogLevelPrefix } from './stderrTail'

/**
 * The logfmt line grammar. This is a CROSS-REPO CONTRACT: ComfyUI holds the
 * equivalent regex as `EVENT_LINE_PATTERN` in its assets event-log tests, and
 * `__fixtures__/assets-event-lines.txt` is a byte-identical copy of that repo's
 * `tests-unit/assets_test/fixtures/assets_event_lines.txt`. Neither side may
 * change without the other.
 */
export const ASSETS_EVENT_LINE =
  /^\[assets-event\] ([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)((?: [a-z_]+=[^ =]+)*)$/

/** Namespace for the forwarded events. */
const EVENT_PREFIX = 'comfy.desktop.comfyui.assets.'

/**
 * Every event name the core call sites emit. An event outside this set is
 * dropped even if it parses, so a future core release cannot start sending
 * events this build has never reviewed.
 */
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

/**
 * Emitted by the tap itself, never parsed from a line. Deliberately absent from
 * `ALLOWED_EVENTS` so a crafted log line cannot forge it.
 */
const UNKNOWN_EVENTS_DROPPED = 'unknown_events_dropped'
/** Same contract as above, for `reason` / `site` / `error_kind` values the build doesn't know. */
const UNKNOWN_ENUM_VALUES_OMITTED = 'unknown_enum_values_omitted'
/** Same contract, for valid convention fields past the per-event cap. */
const CONVENTION_FIELDS_OVER_EVENT_CAP = 'convention_fields_over_event_cap'
/** Same contract, for valid convention fields with a name past the session cap. */
const CONVENTION_NAMES_OVER_SESSION_CAP = 'convention_names_over_session_cap'

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
/** Mirror of ComfyUI `app/assets/failures.py` `REASONS`. */
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
/**
 * Mirror of ComfyUI `app/assets/event_log.py` `ERROR_KINDS`: what a failure
 * was, classified from its SQLite result code, errno or winerror, never from
 * its message.
 */
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
/**
 * Enums a newer core is expected to grow. A well-shaped value this build does
 * not know omits just that field, so a new failure reason cannot silently drop
 * the failure events (and their Datadog alerting copies) that carry it.
 */
const EXTENSIBLE_ENUMS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['reason', REASONS],
  ['site', SITES],
  ['error_kind', ERROR_KINDS]
])
const ENUM_VALUE = /^[a-z][a-z0-9_]*$/
/**
 * Core validates `errno_name` against its own interpreter's
 * `errno.errorcode`, which differs by platform (Windows adds Winsock names:
 * `WSAECONNRESET`, but also `WSASYSNOTREADY` and `WSAHOST_NOT_FOUND`), so this
 * checks the shape rather than one platform's list.
 */
// The underscore is deliberately Winsock-only: no POSIX E-name carries one.
const ERRNO_NAME = /^(?:E[A-Z0-9]{1,23}|WSA[A-Z0-9_]{1,24}|none)$/
/** Sentinel core sends when an exception carries no Windows error code. */
const NO_WINERROR = -1
const MAX_WINERROR = 0xffff
const EXC_FP = /^[0-9a-f]{12}$/
/** Dotted identifier: a builtin, `module.qualname`, `ext` or `none`. */
const DOTTED_NAME = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/
/**
 * Fields whose value is a string even when every character is a digit: an
 * `exc_fp` like `012345678901` must not be coerced to a number and then
 * rejected for its type.
 */
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

/** Cheap first-pass filter: core's field names are lowercase words only. */
const FIELD_NAME = /^[a-z_]+$/

/** C0/C1 controls, DEL and the Unicode line/paragraph separators. */
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

/**
 * Mirror of the field names in ComfyUI `app/assets/event_log.py`. Adding a field
 * is a reviewed change on BOTH sides; the vocabulary deliberately holds no
 * file names, paths, asset ids or content hashes. Numeric and boolean metrics
 * can skip that review by following a typed naming convention (see
 * `fieldConvention` below); a name listed here keeps its own validator even
 * when it also fits a convention, as `elapsed_ms` and `hashing_enabled` do.
 *
 * A Set, NOT an object literal: lookup keys here come straight from untrusted
 * logfmt, and `{}['constructor']` / `{}['__proto__']` resolve up the prototype
 * chain. A Set's keys are never confused with its prototype's properties, so
 * `.has()` is closed by construction.
 */
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

/**
 * Typed-field conventions for names OUTSIDE `ALLOWED_FIELD_NAMES`. A number or
 * boolean can't carry a path, a name or file content, so a field whose name
 * declares one of these types is safe to forward without a reviewed allowlist
 * entry. Strings stay strict: an unknown string-valued field is never
 * forwarded, whatever its name. A value of the wrong type is omitted like any
 * other unknown field, since the name is only a claim about the value.
 *
 * CONVENTION CONTRACT, for core authors adding a field to `event_log.py`
 * without a matching Desktop change:
 *
 * | Name                                 | Value forwarded              |
 * | ------------------------------------ | ---------------------------- |
 * | `*_ms`, `*_count`, `*_bytes`         | integer, 0 to 2^53 - 1       |
 * | `*_pct`                              | integer, 0 to 100            |
 * | `*_enabled`, `is_*`, `has_*`         | `true` / `false`             |
 *
 * - Names follow the line grammar (`[a-z_]+`, so no digits: `p95_ms` drops the
 *   whole line) and are at most 48 characters.
 * - Suffixes are checked before prefixes: `is_cache_hit_pct` is a percentage.
 * - Fractions are not forwarded (`99.5` stays a string); send an integer.
 * - A value that doesn't match is omitted and the rest of the line forwards.
 *   The same name twice on one line drops the line.
 * - At most 8 convention fields per event, in core's (sorted) field order;
 *   the rest are omitted and counted.
 * - At most 32 distinct convention names per tap (one Desktop launch); a new
 *   name past that is omitted and counted, names already forwarded still are.
 * - Names Desktop attaches to every event itself (base context, telemetry
 *   defaults, Datadog global context) are never forwarded.
 *
 * The shared fixture has no convention line yet; one is added with core's
 * matching change to its copy.
 */
const MAX_CONVENTION_FIELD_NAME_LENGTH = 48
/** Per event, so a runaway core cannot fan one event out into many properties. */
const MAX_CONVENTION_FIELDS = 8
/**
 * Per tap, so crafted lines cannot mint unbounded analytics property names by
 * rotating fresh names under the per-event cap.
 */
const MAX_DISTINCT_CONVENTION_NAMES = 32
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
  // `-0` coerces from a literal `-0` and is not `< 0`; it is still a negative.
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

/** Same coercion core's logfmt values get for allowlisted fields. */
function coerceValue(key: string, rawValue: string): TelemetryValue {
  if (DIGIT_STRING_FIELDS.has(key)) return rawValue
  if (/^-?\d+$/.test(rawValue)) return Number(rawValue)
  if (rawValue === 'true') return true
  if (rawValue === 'false') return false
  return rawValue
}

/**
 * Mirror of each field validator in ComfyUI `app/assets/event_log.py`, plus
 * JavaScript's exact transport restriction for integers. Core's integers are
 * signed, but values outside Number's safe range would be silently rounded
 * before telemetry emission, so reject those in addition to Core validation.
 */
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

interface ParsedFields {
  fields: Record<string, TelemetryValue>
  omittedEnumValues: number
  /** Forwarded convention names not yet in the tap's session set. */
  newConventionNames: string[]
  conventionFieldsOverEventCap: number
  conventionNamesOverSessionCap: number
}

/**
 * Parse the logfmt tail into forwardable fields, omitting ordinary unknown
 * fields, reserved names, convention-named fields whose value doesn't match
 * the convention (or past the per-event or session name cap), and
 * unknown-but-well-shaped extensible enum values. Other invalid known values
 * and malformed, duplicate or spoofing keys reject the whole line.
 */
function parseFields(
  tail: string,
  baseKeys: ReadonlySet<string>,
  reservedKeys: ReadonlySet<string>,
  forwardedConventionNames: ReadonlySet<string>
): ParsedFields | null {
  const fields: Record<string, TelemetryValue> = {}
  let omittedEnumValues = 0
  let conventionFields = 0
  const newConventionNames: string[] = []
  let conventionFieldsOverEventCap = 0
  let conventionNamesOverSessionCap = 0
  // Separate from `fields`, which omits some keys, so a repeat is still caught.
  const seenKeys = new Set<string>()
  const pairs = tail ? tail.slice(1).split(' ') : []
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf('=')
    const key = pair.slice(0, separatorIndex)
    const rawValue = pair.slice(separatorIndex + 1)
    if (!FIELD_NAME.test(key)) return null
    // A field named like a base-context property is a context-spoofing
    // attempt. The merge order already makes it ineffective.
    if (baseKeys.has(key)) return null
    if (!ALLOWED_FIELD_NAMES.has(key)) {
      // Prototype keys clear the lowercase FIELD_NAME filter but are never a
      // plausible core field, so they stay whole-line rejects.
      if (Object.hasOwn(Object.prototype, key)) return null
      // Names Desktop sets on every event itself lose nothing by being
      // omitted, but forwarded they would win the merge: over a telemetry
      // default in PostHog, and over the renderer's Datadog global context.
      // Omitted rather than rejected, like any other unknown field.
      if (reservedKeys.has(key)) continue
      // Anything else is a newer core emitting a field this build predates;
      // rejecting the line would delete an existing metric instead.
      const convention = fieldConvention(key)
      if (!convention) continue
      // A repeated convention key is malformed, like a repeated listed key.
      if (seenKeys.has(key)) return null
      seenKeys.add(key)
      const value = coerceValue(key, rawValue)
      if (!conventionFieldValue(convention, value)) continue
      const isNewName = !forwardedConventionNames.has(key)
      // Checked before the per-event cap so a refused name doesn't take a slot.
      if (
        isNewName &&
        forwardedConventionNames.size + newConventionNames.length >= MAX_DISTINCT_CONVENTION_NAMES
      ) {
        conventionNamesOverSessionCap++
        continue
      }
      if (conventionFields >= MAX_CONVENTION_FIELDS) {
        conventionFieldsOverEventCap++
        continue
      }
      conventionFields++
      if (isNewName) newConventionNames.push(key)
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
  return {
    fields,
    omittedEnumValues,
    newConventionNames,
    conventionFieldsOverEventCap,
    conventionNamesOverSessionCap
  }
}

/**
 * Per-event budget on top of the telemetry module's own rate limit.
 *
 * `scanner.failure_bucket` shares it even though core sends up to 50 per scan,
 * so its buckets are hour-sampled: the first failing scan in a window spends
 * most of the budget, and a classification that first appears after the
 * budget is spent is dropped until the next window.
 */
const PER_EVENT_HOURLY_CAP = 60
const RATE_WINDOW_MS = 60 * 60_000

export function createAssetsTap(opts: {
  installationId: string
  variant?: string | null
  release?: string | null
  coreBetaFlags?: readonly string[]
}): {
  ingest: (chunk: string, source: 'stdout' | 'stderr') => void
  beginBoot: () => void
  flushSummary: () => void
} {
  const baseContext = {
    installation_id: opts.installationId,
    variant: opts.variant ?? null,
    release: opts.release ?? null,
    core_beta_flags: [...(opts.coreBetaFlags ?? [])]
  }
  const baseKeys: ReadonlySet<string> = new Set(Object.keys(baseContext))
  // Telemetry's own defaults and the renderer's Datadog global context lose
  // the merge to per-event fields: a forged `is_packaged=false` or
  // `telemetry_enabled=false` fits a convention.
  const reservedKeys: ReadonlySet<string> = new Set([
    ...telemetry.DEFAULT_EVENT_PROPERTY_NAMES,
    ...DATADOG_GLOBAL_CONTEXT_KEYS
  ])
  // Convention names forwarded so far. Like the rate buckets, deliberately NOT
  // reset by beginBoot: the cap bounds the property names one launch can mint.
  const forwardedConventionNames = new Set<string>()

  // Fixed windows per event name, so one chatty event cannot starve the others.
  // Deliberately NOT reset by beginBoot: a tap is reused across core restarts
  // within one session, and a restart loop is exactly when the cap earns its
  // keep.
  const rateBuckets = new Map<string, { windowStart: number; count: number }>()

  let unknownEventsDropped = 0
  let unknownEnumValuesOmitted = 0
  let conventionFieldsOverEventCap = 0
  let conventionNamesOverSessionCap = 0

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
    // Strip ANSI then a leading `[LEVEL] ` tag (Desktop's bundled build) so the
    // anchored grammar matches both the prefixed and bare log formats.
    const match = stripLogLevelPrefix(stripAnsi(line).trim()).match(ASSETS_EVENT_LINE)
    if (!match) return
    const [, event, tail] = match
    if (!event || tail === undefined) return
    if (!ALLOWED_EVENTS.has(event)) {
      // Counted, never named: the name is untrusted input, so carrying it in a
      // payload would reintroduce the cardinality blow-up the allow-list exists
      // to prevent. A bare count still answers "is this build behind core?".
      unknownEventsDropped++
      return
    }
    const parsed = parseFields(tail, baseKeys, reservedKeys, forwardedConventionNames)
    if (!parsed) return
    const { fields } = parsed
    // Counted like unknown events, and for the same reason: it says this build
    // is behind core's vocabulary without naming the untrusted value.
    unknownEnumValuesOmitted += parsed.omittedEnumValues
    if (!withinRateCap(event)) return
    // Counted so a new metric evicting an old one is visible, still unnamed.
    // After the rate cap: a line that is never sent omitted nothing from an event.
    conventionFieldsOverEventCap += parsed.conventionFieldsOverEventCap
    conventionNamesOverSessionCap += parsed.conventionNamesOverSessionCap
    // Only names that are actually sent spend the session budget.
    for (const name of parsed.newConventionNames) forwardedConventionNames.add(name)
    try {
      // Base context merged LAST so parsed fields can never override it.
      telemetry.emit(`${EVENT_PREFIX}${event}`, { ...fields, ...baseContext })
    } catch {
      // ignore - telemetry side effect, and the next line must still parse
    }
  }

  const lineBuffer = createStreamLineBuffer()

  return {
    ingest(chunk: string, source: 'stdout' | 'stderr'): void {
      // Hard guarantee: this runs inside the launch stdout/stderr handler with
      // no enclosing catch. A throw here would break log streaming and boot
      // detection. Telemetry must never break the app.
      try {
        for (const line of lineBuffer.append(source, chunk)) {
          // Per-line isolation: one line that throws must not discard the
          // rest of a chunk that has already been split off the buffer.
          try {
            handleLine(line)
          } catch {
            // ignore - telemetry side effect, not user-visible
          }
        }
      } catch {
        // ignore - telemetry side effect, not user-visible
      }
    },
    /**
     * Drop incomplete lines from the previous (now-dead) process streams. A
     * single launch can restart ComfyUI several times, each reusing this tap.
     * The rate buckets deliberately survive.
     */
    beginBoot(): void {
      lineBuffer.reset()
    },
    flushSummary(): void {
      try {
        // Process complete-but-unterminated final lines so a trailing record
        // isn't dropped when the process exits without a newline.
        for (const source of ['stdout', 'stderr'] as const) {
          const pending = lineBuffer.takePending(source)
          // Per-source isolation: a throwing stdout tail must not skip stderr's.
          try {
            if (pending.trim()) handleLine(pending)
          } catch {
            // ignore - telemetry side effect, not user-visible
          }
        }
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
        if (conventionFieldsOverEventCap > 0 && withinRateCap(CONVENTION_FIELDS_OVER_EVENT_CAP)) {
          const count = conventionFieldsOverEventCap
          conventionFieldsOverEventCap = 0
          telemetry.emit(`${EVENT_PREFIX}${CONVENTION_FIELDS_OVER_EVENT_CAP}`, {
            count,
            ...baseContext
          })
        }
        if (conventionNamesOverSessionCap > 0 && withinRateCap(CONVENTION_NAMES_OVER_SESSION_CAP)) {
          const count = conventionNamesOverSessionCap
          conventionNamesOverSessionCap = 0
          telemetry.emit(`${EVENT_PREFIX}${CONVENTION_NAMES_OVER_SESSION_CAP}`, {
            count,
            ...baseContext
          })
        }
      } catch {
        // ignore - telemetry side effect, not user-visible
      }
    }
  }
}
