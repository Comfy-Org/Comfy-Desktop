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
 * contract — an event allowlist, a field-name allowlist, global structural
 * value checks, and a rejection of any key colliding with the trusted base
 * context. A line that fails any check is dropped whole and silently:
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
  'scanner.stat_failed'
])

/**
 * Emitted by the tap itself, never parsed from a line. Deliberately absent from
 * `ALLOWED_EVENTS` so a crafted log line cannot forge it.
 */
const UNKNOWN_EVENTS_DROPPED = 'unknown_events_dropped'

const MAX_STRING_LENGTH = 64
const FORBIDDEN_STRING_CHARS = ['/', '\\', ':', ' ', '=', '"']

/** Cheap first-pass filter: core's field names are lowercase words only. */
const FIELD_NAME = /^[a-z_]+$/

function isSafeString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_STRING_LENGTH &&
    !FORBIDDEN_STRING_CHARS.some((char) => value.includes(char))
  )
}

/**
 * Mirror of the field names in ComfyUI `app/assets/event_log.py`. Adding a field
 * is a reviewed change on BOTH sides; the vocabulary deliberately holds no
 * file names, paths, asset ids or content hashes.
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
  'hashing_enabled'
])

/** Global value shape accepted after the field-name and collision checks. */
function isTransportableValue(value: unknown): value is TelemetryValue {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean' ||
    isSafeString(value)
  )
}

/**
 * Parse the logfmt tail into forwardable fields, or null if ANY pair fails the
 * closed contract. Rejection is whole-line: a record with one bad field is not
 * worth partially trusting.
 */
function parseFields(
  tail: string,
  baseKeys: ReadonlySet<string>
): Record<string, TelemetryValue> | null {
  const fields: Record<string, TelemetryValue> = {}
  const pairs = tail ? tail.slice(1).split(' ') : []
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf('=')
    const key = pair.slice(0, separatorIndex)
    const rawValue = pair.slice(separatorIndex + 1)
    if (!FIELD_NAME.test(key)) return null
    // A field named like a base-context property would be a context-spoofing
    // attempt, even though the merge order already makes it ineffective.
    if (baseKeys.has(key)) return null
    if (!ALLOWED_FIELD_NAMES.has(key)) {
      // Prototype keys clear the lowercase FIELD_NAME filter but are never a
      // plausible core field, so they stay whole-line rejects.
      if (Object.hasOwn(Object.prototype, key)) return null
      // Anything else is a newer core emitting a field this build predates;
      // rejecting the line would delete an existing metric instead.
      continue
    }
    if (Object.hasOwn(fields, key)) return null
    const value: TelemetryValue = /^-?\d+$/.test(rawValue)
      ? Number(rawValue)
      : rawValue === 'true'
        ? true
        : rawValue === 'false'
          ? false
          : rawValue
    if (!isTransportableValue(value)) return null
    fields[key] = value
  }
  return fields
}

/** Per-event budget on top of the telemetry module's own rate limit. */
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

  // Fixed windows per event name, so one chatty event cannot starve the others.
  // Deliberately NOT reset by beginBoot: a tap is reused across core restarts
  // within one session, and a restart loop is exactly when the cap earns its
  // keep.
  const rateBuckets = new Map<string, { windowStart: number; count: number }>()

  let unknownEventsDropped = 0

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
    const fields = parseFields(tail, baseKeys)
    if (!fields) return
    if (!withinRateCap(event)) return
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
      } catch {
        // ignore - telemetry side effect, not user-visible
      }
    }
  }
}
