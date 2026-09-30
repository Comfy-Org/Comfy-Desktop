/**
 * Per-namespace contract for the structured lines ComfyUI core writes to its
 * stdout: which events a namespace may carry, which fields, and how each field
 * is validated. `coreEventTap` is the only consumer.
 *
 * Every field belongs to exactly one of three safety tiers. Nothing else is
 * accepted, and in particular there is no tier for free text:
 *
 * - CLOSED: event names, field names, and every enum that drives an alert or a
 *   group-by. Exact set membership. In an extensible enum, a value this build
 *   does not know but which has an enum value's shape omits just that field,
 *   and the omission is counted.
 * - SHAPE-CHECKED OPEN: identifiers that name code or operations, never data
 *   (`exc_class`, `op`, versions). Regex shape here, plus the tap's per-session
 *   distinct-value guard. Core only emits the name of first-party code and
 *   collapses everything else to `ext`.
 * - FIXED NUMERIC: a closed set of integer fields, each with its own range.
 *
 * Adding a field is a reviewed change on BOTH sides: a core validator, a
 * validator here, and a fixture line.
 */
import type { TelemetryValue } from './telemetry'

export interface ClosedField {
  readonly tier: 'closed'
  readonly values: ReadonlySet<string> | 'boolean'
  /** Omit (and count) an unknown well-shaped value instead of rejecting the line. */
  readonly extensible?: boolean
}
export interface OpenField {
  readonly tier: 'open'
  readonly accepts: (value: string) => boolean
  /** The value is a string even when every character is a digit. */
  readonly digitString?: boolean
}
export interface NumericField {
  readonly tier: 'numeric'
  readonly min: number
  readonly max: number
  /** One out-of-range value that is still valid, such as `winerror=-1`. */
  readonly sentinel?: number
}
export type FieldSpec = ClosedField | OpenField | NumericField

export interface NamespaceContract {
  readonly events: ReadonlySet<string>
  /**
   * The field-name allowlist; always exactly the keys of `specs`.
   *
   * A Set, NOT an object literal: lookup keys here come straight from untrusted
   * logfmt, and `{}['constructor']` / `{}['__proto__']` resolve up the
   * prototype chain. A Set's keys are never confused with its prototype's
   * properties, so `.has()` is closed by construction.
   */
  readonly fields: ReadonlySet<string>
  readonly specs: ReadonlyMap<string, FieldSpec>
  /** Per-event forwards per hour, before novelty-first admission. */
  readonly hourlyCap: number
}

const MAX_STRING_LENGTH = 64
const FORBIDDEN_STRING_CHARS = ['/', '\\', ':', ' ', '=', '"', '\n', '\r']
/** C0/C1 controls, DEL and the Unicode line/paragraph separators. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/

export function isSafeString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_STRING_LENGTH &&
    !FORBIDDEN_STRING_CHARS.some((char) => value.includes(char)) &&
    !CONTROL_CHARS.test(value)
  )
}

/** The shape an unknown value must have to be omitted rather than rejected. */
export const ENUM_VALUE = /^[a-z][a-z0-9_]*$/

/** Tier validation for one parsed value. Strings must also be safe strings. */
export function isAllowedFieldValue(spec: FieldSpec, value: unknown): value is TelemetryValue {
  switch (spec.tier) {
    case 'numeric':
      return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        (value === spec.sentinel || (value >= spec.min && value <= spec.max))
      )
    case 'closed':
      if (spec.values === 'boolean') return typeof value === 'boolean'
      return isSafeString(value) && spec.values.has(value)
    case 'open':
      return isSafeString(value) && spec.accepts(value)
  }
}

function contract(
  events: readonly string[],
  specs: Readonly<Record<string, FieldSpec>>,
  hourlyCap = 60
): NamespaceContract {
  const specMap = new Map(Object.entries(specs))
  return { events: new Set(events), fields: new Set(specMap.keys()), specs: specMap, hourlyCap }
}

const closed = (values: readonly string[], extensible = false): ClosedField => ({
  tier: 'closed',
  values: new Set(values),
  extensible
})
const FLAG: ClosedField = { tier: 'closed', values: 'boolean' }
const matching = (pattern: RegExp, digitString = false): OpenField => ({
  tier: 'open',
  accepts: (value) => pattern.test(value),
  digitString
})
/** Assets predates the non-negative rule, so its counters take any safe integer. */
const ANY_INTEGER: NumericField = {
  tier: 'numeric',
  min: Number.MIN_SAFE_INTEGER,
  max: Number.MAX_SAFE_INTEGER
}
const NON_NEGATIVE: NumericField = { tier: 'numeric', min: 0, max: Number.MAX_SAFE_INTEGER }

// --- Shared vocabulary -----------------------------------------------------

const ROOTS = ['models', 'input', 'output', 'user', 'temp']
const PHASES = ['fast', 'enrich', 'full']
/** Mirror of ComfyUI `failures.py` `REASONS`. */
const REASONS = [
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
]
/**
 * Core validates `errno_name` against its own interpreter's
 * `errno.errorcode`, which differs by platform (Windows adds Winsock names:
 * `WSAECONNRESET`, but also `WSASYSNOTREADY` and `WSAHOST_NOT_FOUND`), so this
 * checks the shape rather than one platform's list.
 */
// The underscore is deliberately Winsock-only: no POSIX E-name carries one.
const ERRNO_NAME = /^(?:E[A-Z0-9]{1,23}|WSA[A-Z0-9_]{1,24}|none)$/
const EXC_FP = /^[0-9a-f]{12}$/
/** Dotted identifier: a builtin, `module.qualname`, `ext` or `none`. */
const DOTTED_NAME = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/

/**
 * The failure description core attaches to a classified exception. Keyed on
 * errno, winerror, class and first-party frame, never on the message.
 */
function failureFields(reasons: readonly string[]): Record<string, FieldSpec> {
  return {
    reason: closed(reasons, true),
    errno_name: matching(ERRNO_NAME),
    // Sentinel -1: the exception carries no Windows error code.
    winerror: { tier: 'numeric', min: 0, max: 0xffff, sentinel: -1 },
    exc_fp: matching(EXC_FP, true),
    exc_class: matching(DOTTED_NAME),
    exc_site: matching(DOTTED_NAME),
    exc_line: NON_NEGATIVE
  }
}

// --- assets: `[assets-event] <event>` ---------------------------------------

/**
 * Mirror of ComfyUI `app/assets/event_log.py`: its event names and field
 * validators. The vocabulary deliberately holds no file names, paths, asset
 * ids or content hashes.
 */
export const ASSETS_CONTRACT: NamespaceContract = contract(
  [
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
  ],
  {
    root: closed(ROOTS),
    phase: closed(PHASES),
    stage: closed(['mark_missing', 'pruning', 'fast_scan', 'enrich', 'finalize']),
    site: closed(
      [
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
      ],
      true
    ),
    elapsed_ms: ANY_INTEGER,
    created: ANY_INTEGER,
    enriched: ANY_INTEGER,
    skipped: ANY_INTEGER,
    hash_failed: ANY_INTEGER,
    enrich_failed: ANY_INTEGER,
    permission_denied: ANY_INTEGER,
    count: ANY_INTEGER,
    // Grandfathered free-ish string (safe-string checked only). No new
    // namespace gets one; they carry `exc_class` instead.
    error_type: matching(/^/),
    hashing_enabled: FLAG,
    ...failureFields(REASONS)
  }
)

// --- `[comfy-event] <ns>.<event>` namespaces ---------------------------------

/** Core-wide reasons beyond the assets set. */
const CORE_REASONS = [...REASONS, 'oom_device']
const OUTCOMES = ['ok', 'error', 'cancelled', 'window_timeout']
const SCAN_STATES = ['idle', 'fast', 'enrich', 'paused', 'cancelled']
const ROUTE_FAMILIES = [
  'prompt',
  'queue',
  'history',
  'view',
  'upload',
  'assets',
  'userdata',
  'models',
  'ws',
  'internal',
  'ext',
  'other'
]
/** `startup.<mark>`, `assets.scan.<phase>`, `server.http`, ... */
const OP = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,3}$/
const VERSION = /^\d+(?:\.\d+){1,3}(?:\+[a-z0-9.]+)?$/

/**
 * `perf.timing`: one event shape for every duration. A single op carries
 * `duration_ms`; a windowed op (loop lag, HTTP latency) carries the aggregate
 * fields instead. `op` is open so a new core op needs no Desktop release.
 */
const PERF_CONTRACT = contract(
  ['timing'],
  {
    op: matching(OP),
    outcome: closed(OUTCOMES, true),
    duration_ms: NON_NEGATIVE,
    cpu_ms: NON_NEGATIVE,
    count: NON_NEGATIVE,
    bytes_total: NON_NEGATIVE,
    skipped: NON_NEGATIVE,
    batch_failed: NON_NEGATIVE,
    root: closed(ROOTS, true),
    phase: closed(PHASES, true),
    assets_enabled: FLAG,
    p50_ms: NON_NEGATIVE,
    p95_ms: NON_NEGATIVE,
    max_ms: NON_NEGATIVE,
    slow_count: NON_NEGATIVE,
    stall_count: NON_NEGATIVE,
    tick_count: NON_NEGATIVE,
    t_window_ms: NON_NEGATIVE,
    scan_state: closed(SCAN_STATES, true),
    route_family: closed(ROUTE_FAMILIES, true),
    node_class: matching(DOTTED_NAME),
    model_class: matching(DOTTED_NAME),
    load_mode: closed(['full', 'partial', 'dynamic'], true)
  },
  120
)

/** Once per boot: the environment summary and the database-init failure. */
const STARTUP_CONTRACT = contract(['environment', 'db_init_failed'], {
  device_type: closed(['cuda', 'cpu', 'mps', 'xpu', 'npu', 'mlu', 'directml'], true),
  device_count: NON_NEGATIVE,
  vram_mb: NON_NEGATIVE,
  ram_mb: NON_NEGATIVE,
  torch_version: matching(VERSION),
  ...failureFields(CORE_REASONS)
})

/** A namespace core may write that this build does not consume yet: every event is unknown. */
const EMPTY_CONTRACT = contract([], {})

/**
 * The closed set of `[comfy-event]` namespaces. `assets` is deliberately
 * absent: assets events travel on their own tag only.
 */
export const COMFY_EVENT_CONTRACTS: ReadonlyMap<string, NamespaceContract> = new Map([
  ['perf', PERF_CONTRACT],
  ['startup', STARTUP_CONTRACT],
  ['execution', EMPTY_CONTRACT],
  ['models', EMPTY_CONTRACT],
  ['nodes', EMPTY_CONTRACT],
  ['server', EMPTY_CONTRACT]
])
