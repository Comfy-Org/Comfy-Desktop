/**
 * Shared engine for the structured event-log taps (`assetsTap`, `agentTap`).
 *
 * ComfyUI subsystems log privacy-safe records next to their human-readable
 * lines: `[<tag>] <event> key=value ...`. We tail that output, already piped
 * through `proc.stdout` / `proc.stderr` in `sessionActions/launch.ts` (the
 * same stream `hardwareTap` and `executionTap` consume), and forward each
 * accepted record as `<eventPrefix><event>` through `telemetry.emit`, which is
 * consent-gated and PII-scrubbed centrally.
 *
 * Unlike the hardware tap, which matches known prose, this parses a single
 * grammar. That makes core's stdout UNTRUSTED INPUT: anything writing to the
 * process's stdout can emit a tagged line, so each tap carries its own closed
 * contract: an event allowlist, a field-name allowlist, per-field type and
 * value checks, and rejection of any key colliding with the trusted base
 * context. Ordinary unknown fields are omitted for version skew. Invalid
 * known values and malformed or spoofing keys drop the whole line silently:
 * reporting the rejection would put the untrusted content back into a signal
 * we forward.
 *
 * THREAT MODEL: this validation catches ACCIDENTAL leakage (a path riding
 * along in a field). It is not a boundary against deliberately encoded
 * exfiltration: the closed vocabulary plus the discipline on the emitting
 * side is the primary guarantee.
 */
import * as telemetry from './telemetry'
import type { TelemetryValue } from './telemetry'
import { createStreamLineBuffer, stripAnsi, stripLogLevelPrefix } from './stderrTail'

export interface EventLogTapSpec {
  /**
   * Anchored grammar capturing the event name (group 1) and logfmt tail
   * (group 2). The tail must be empty or start with the single space that
   * separates it from the event name; the parser strips exactly one.
   */
  linePattern: RegExp
  /** Namespace for the forwarded events. */
  eventPrefix: string
  /**
   * An event outside this set is dropped even if it parses, so a future core
   * release cannot start sending events this build has never reviewed.
   */
  allowedEvents: ReadonlySet<string>
  /**
   * A Set, NOT an object literal: lookup keys come straight from untrusted
   * logfmt, and `{}['constructor']` / `{}['__proto__']` resolve up the
   * prototype chain. A Set's `.has()` is closed by construction.
   */
  allowedFieldNames: ReadonlySet<string>
  /**
   * Optional rewrite of a known field's coerced value, applied before
   * `isAllowedFieldValue`. It may only narrow a value into the vocabulary.
   */
  normalizeFieldValue?: (key: string, value: TelemetryValue) => TelemetryValue
  /** Per-field type and value check, applied after logfmt coercion. */
  isAllowedFieldValue: (key: string, value: unknown) => value is TelemetryValue
}

export interface EventLogTapOptions {
  installationId: string
  variant?: string | null
  release?: string | null
  coreBetaFlags?: readonly string[]
}

export interface EventLogTap {
  ingest: (chunk: string, source: 'stdout' | 'stderr') => void
  beginBoot: () => void
  flushSummary: () => void
}

/**
 * Emitted by the tap itself, never parsed from a line. Every tap's
 * `allowedEvents` must leave it out so a crafted log line cannot forge it.
 */
const UNKNOWN_EVENTS_DROPPED = 'unknown_events_dropped'

const MAX_STRING_LENGTH = 64
const FORBIDDEN_STRING_CHARS = ['/', '\\', ':', ' ', '=', '"']

/** Cheap first-pass filter: core's field names are lowercase words only. */
const FIELD_NAME = /^[a-z_]+$/

/** A bounded, non-empty string free of path separators and logfmt delimiters. */
export function isSafeString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_STRING_LENGTH &&
    !FORBIDDEN_STRING_CHARS.some((char) => value.includes(char))
  )
}

/**
 * Parse the logfmt tail into forwardable fields, omitting ordinary unknown
 * fields. Invalid known values and malformed, duplicate or spoofing keys
 * reject the whole line.
 */
function parseFields(
  spec: EventLogTapSpec,
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
    if (!spec.allowedFieldNames.has(key)) {
      // Prototype keys clear the lowercase FIELD_NAME filter but are never a
      // plausible core field, so they stay whole-line rejects.
      if (Object.hasOwn(Object.prototype, key)) return null
      // Anything else is a newer core emitting a field this build predates;
      // rejecting the line would delete an existing metric instead.
      continue
    }
    if (Object.hasOwn(fields, key)) return null
    const coerced: TelemetryValue = /^-?\d+$/.test(rawValue)
      ? Number(rawValue)
      : rawValue === 'true'
        ? true
        : rawValue === 'false'
          ? false
          : rawValue
    const value = spec.normalizeFieldValue ? spec.normalizeFieldValue(key, coerced) : coerced
    if (!spec.isAllowedFieldValue(key, value)) return null
    fields[key] = value
  }
  return fields
}

/** Per-event budget on top of the telemetry module's own rate limit. */
const PER_EVENT_HOURLY_CAP = 60
const RATE_WINDOW_MS = 60 * 60_000

export function createEventLogTap(spec: EventLogTapSpec, opts: EventLogTapOptions): EventLogTap {
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
    const match = stripLogLevelPrefix(stripAnsi(line).trim()).match(spec.linePattern)
    if (!match) return
    const [, event, tail] = match
    if (!event || tail === undefined) return
    if (!spec.allowedEvents.has(event)) {
      // Counted, never named: the name is untrusted input, so carrying it in a
      // payload would reintroduce the cardinality blow-up the allow-list exists
      // to prevent. A bare count still answers "is this build behind core?".
      unknownEventsDropped++
      return
    }
    const fields = parseFields(spec, tail, baseKeys)
    if (!fields) return
    if (!withinRateCap(event)) return
    try {
      // Base context merged LAST so parsed fields can never override it.
      telemetry.emit(`${spec.eventPrefix}${event}`, { ...fields, ...baseContext })
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
    /**
     * Never parses an unterminated line. Callers flush while the process may
     * still be running (a `waitForPort` timeout, app quit), and a line cut at
     * a chunk boundary can still match the grammar with a truncated value
     * (`code=12` read as `code=1`). Nor is stream end proof of completeness:
     * a normal exit flushes whole newline-terminated lines, so an unterminated
     * tail only survives a kill or crash, which is when it may be cut short.
     * Partial lines stay buffered until a newline completes them or
     * `beginBoot` drops them.
     */
    flushSummary(): void {
      try {
        if (unknownEventsDropped > 0 && withinRateCap(UNKNOWN_EVENTS_DROPPED)) {
          const count = unknownEventsDropped
          unknownEventsDropped = 0
          telemetry.emit(`${spec.eventPrefix}${UNKNOWN_EVENTS_DROPPED}`, {
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
