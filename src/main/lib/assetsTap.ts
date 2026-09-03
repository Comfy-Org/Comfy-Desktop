/**
 * Assets event-log tap.
 *
 * ComfyUI's assets system logs structured, privacy-safe records next to its
 * human-readable lines: `[assets-event] <event> <compact-json>` on the INFO
 * channel (`app/assets/event_log.py`). We tail that output, already piped
 * through `proc.stdout` / `proc.stderr` in `sessionActions/launch.ts` — the
 * same stream `hardwareTap` and `executionTap` consume — and forward each
 * accepted record as `comfy.desktop.comfyui.assets.<event>` through
 * `telemetry.emit`, which is consent-gated and PII-scrubbed centrally.
 *
 * Unlike the hardware tap, which matches known prose, this one parses a single
 * grammar. That makes core's stdout UNTRUSTED INPUT: anything writing to the
 * process's stdout can emit a tagged line, so the tap carries its own closed
 * contract — an event allowlist, a field allowlist with a validator per field,
 * and a rejection of any key colliding with the trusted base context. A line
 * that fails any check is dropped whole and silently: reporting the rejection
 * would put the untrusted content back into a signal we forward.
 *
 * THREAT MODEL: this validation catches ACCIDENTAL leakage (a path riding
 * along in a field). It is not a boundary against deliberately encoded
 * exfiltration — the closed vocabulary plus the AST discipline on the core
 * side is the primary guarantee.
 */
import * as telemetry from './telemetry'
import type { TelemetryValue } from './telemetry'
import { stripAnsi, stripLogLevelPrefix } from './stderrTail'

/**
 * The line grammar. This is a CROSS-REPO CONTRACT: ComfyUI holds the
 * equivalent regex as `EVENT_LINE_PATTERN` in `app/assets/event_log.py`'s test
 * module, and `__fixtures__/assets-event-lines.txt` is a byte-identical copy of
 * that repo's `tests-unit/assets_test/fixtures/assets_event_lines.txt`. Neither
 * side may change without the other.
 */
export const ASSETS_EVENT_LINE =
  /^\[assets-event\] ([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*) (\{.*\})$/

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
  'ingest.register_output_failed',
  'ingest.discard_orphan_failed',
  'api.request_failed'
])

type Validator = (value: unknown) => boolean

const MAX_STRING_LENGTH = 64
const FORBIDDEN_STRING_CHARS = ['/', '\\', ':']

/** Cheap first-pass filter: core's field names are lowercase words only. */
const FIELD_NAME = /^[a-z_]+$/

function isSafeString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_STRING_LENGTH &&
    !FORBIDDEN_STRING_CHARS.some((char) => value.includes(char))
  )
}

function oneOf(...allowed: string[]): Validator {
  const members = new Set(allowed)
  return (value) => isSafeString(value) && members.has(value)
}

const isCount: Validator = (value) => typeof value === 'number' && Number.isInteger(value)
const isFlag: Validator = (value) => typeof value === 'boolean'

/**
 * Mirror of `ALLOWED_FIELDS` in ComfyUI `app/assets/event_log.py`. Adding a
 * field is a reviewed change on BOTH sides; the vocabulary deliberately holds
 * no file names, paths, asset ids or content hashes.
 */
export const ALLOWED_FIELDS: Readonly<Record<string, Validator>> = {
  root: oneOf('models', 'input', 'output', 'user', 'temp'),
  phase: oneOf('fast', 'enrich', 'full'),
  stage: oneOf('mark_missing', 'pruning', 'fast_scan', 'enrich', 'finalize'),
  route: oneOf(
    'get_asset_route',
    'upload_asset',
    'update_asset_route',
    'delete_asset_route',
    'add_asset_tags',
    'delete_asset_tags',
    'parse_multipart_upload'
  ),
  size_bucket: oneOf('lt_1m', 'lt_100m', 'lt_1g', 'ge_1g'),
  elapsed_ms: isCount,
  created: isCount,
  enriched: isCount,
  skipped: isCount,
  marked_missing: isCount,
  hash_failed: isCount,
  enrich_failed: isCount,
  permission_denied: isCount,
  count: isCount,
  error_type: isSafeString,
  hashing_enabled: isFlag
}

/** The shape any value must have before its field validator even runs. */
function isTransportableValue(value: unknown): value is TelemetryValue {
  return (
    typeof value === 'number' || typeof value === 'boolean' || value === null || isSafeString(value)
  )
}

/**
 * Parse the JSON payload into forwardable fields, or null if ANY part of it
 * fails the closed contract. Rejection is whole-line: a record with one bad
 * field is not worth partially trusting.
 */
function parseFields(
  json: string,
  baseKeys: ReadonlySet<string>
): Record<string, TelemetryValue> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const fields: Record<string, TelemetryValue> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (!FIELD_NAME.test(key)) return null
    // A field named like a base-context property would be a context-spoofing
    // attempt, even though the merge order already makes it ineffective.
    if (baseKeys.has(key)) return null
    const validate = ALLOWED_FIELDS[key]
    if (!validate) return null
    if (!isTransportableValue(value) || !validate(value)) return null
    fields[key] = value
  }
  return fields
}

/** Per-event budget on top of the telemetry module's own rate limit. */
const PER_EVENT_HOURLY_CAP = 60
const RATE_WINDOW_MS = 60 * 60_000

/** Cap on the unterminated tail carried between chunks, per stream. */
const MAX_PENDING_CHARS = 16_384

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

  // Fixed windows per event name, so one chatty event cannot starve the others.
  // Deliberately NOT reset by beginBoot: a tap is reused across core restarts
  // within one session, and a restart loop is exactly when the cap earns its
  // keep.
  const rateBuckets = new Map<string, { windowStart: number; count: number }>()

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
    const [, event, json] = match
    if (!event || !json || !ALLOWED_EVENTS.has(event)) return
    const fields = parseFields(json, baseKeys)
    if (!fields) return
    if (!withinRateCap(event)) return
    try {
      // Base context merged LAST so parsed JSON can never override it.
      telemetry.emit(`${EVENT_PREFIX}${event}`, { ...fields, ...baseContext })
    } catch {
      // ignore - telemetry side effect, and the next line must still parse
    }
  }

  // Separate per-stream buffers: stdout and stderr arrive as independent chunk
  // streams, so a shared buffer could splice unrelated partial lines together.
  const pendingBySource: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' }

  function appendChunk(source: 'stdout' | 'stderr', chunk: string): string[] {
    // Split first so a large chunk's complete lines are never lost; cap only
    // the unterminated tail, which is the sole unbounded-growth risk.
    const lines = (pendingBySource[source] + chunk).split(/\r?\n/)
    const tail = lines.pop() ?? ''
    pendingBySource[source] =
      tail.length > MAX_PENDING_CHARS ? tail.slice(-MAX_PENDING_CHARS) : tail
    return lines
  }

  return {
    ingest(chunk: string, source: 'stdout' | 'stderr'): void {
      // Hard guarantee: this runs inside the launch stdout/stderr handler with
      // no enclosing catch. A throw here would break log streaming and boot
      // detection. Telemetry must never break the app.
      try {
        for (const line of appendChunk(source, chunk)) handleLine(line)
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
      pendingBySource.stdout = ''
      pendingBySource.stderr = ''
    },
    flushSummary(): void {
      try {
        // Process complete-but-unterminated final lines so a trailing record
        // isn't dropped when the process exits without a newline.
        for (const source of ['stdout', 'stderr'] as const) {
          const pending = pendingBySource[source]
          pendingBySource[source] = ''
          if (pending.trim()) handleLine(pending)
        }
      } catch {
        // ignore - telemetry side effect, not user-visible
      }
    }
  }
}
