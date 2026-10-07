/**
 * Local agent event-log tap: forwards core's `[agent-event] <event> key=value`
 * lines as `comfy.desktop.comfyui.agent.<event>` through the consent-gated
 * `telemetry.emit`, like the assets tap does for `[assets-event]`.
 *
 * Core's output is UNTRUSTED INPUT. No field accepts free text: every string
 * is a closed-set member or a version number, so a path, prompt or model
 * output has nowhere to ride. Unknown fields are omitted for version skew;
 * invalid values and malformed or spoofing keys drop the whole line silently,
 * since reporting the rejection would forward the untrusted content.
 */
import * as telemetry from './telemetry'
import type { TelemetryValue } from './telemetry'
import { createStreamLineBuffer, stripAnsi, stripLogLevelPrefix } from './stderrTail'

/**
 * CROSS-REPO CONTRACT with core's emitter (ComfyUI `app/local_agent.py`): the
 * grammar and the vocabulary below change on both sides or not at all.
 */
export const AGENT_EVENT_LINE = /^\[agent-event\] ([a-z][a-z0-9_]*)((?: [a-z_]+=[^ =]+)*)$/

const EVENT_PREFIX = 'comfy.desktop.comfyui.agent.'

/** An event outside this set is dropped, so a newer core can't send unreviewed events. */
export const ALLOWED_EVENTS: ReadonlySet<string> = new Set([
  'flag_enabled',
  'package_missing',
  'install_hint',
  'agent_starting',
  'agent_waiting',
  'agent_started',
  'node_found',
  'node_fetch_started',
  'node_fetched',
  'node_fetch_failed',
  'health_check_failed',
  'agent_exited',
  'agent_error'
])

/** Emitted by the tap itself; absent from `ALLOWED_EVENTS` so no line can forge it. */
const UNKNOWN_EVENTS_DROPPED = 'unknown_events_dropped'

/**
 * Any other `reason` is forwarded as `unknown`, so a newer core's new failure
 * reason still reports the failure without leaking the raw value.
 */
export const REASONS: ReadonlySet<string> = new Set([
  'timeout',
  'not_found',
  'not_executable',
  'unsupported_platform',
  'spawn_failed',
  'crashed',
  'signal',
  'connection_refused',
  'http_error',
  'network_error',
  'checksum_mismatch',
  'permission_denied',
  'disabled',
  'unknown'
])

/** A Set, not an object literal: untrusted keys like `constructor` can't hit the prototype. */
export const ALLOWED_FIELD_NAMES: ReadonlySet<string> = new Set([
  'code',
  'duration_ms',
  'agent_version',
  'node_version',
  'reason'
])

/** Trusted properties the tap attaches to every event. A line may not name one. */
const BASE_CONTEXT_KEYS: ReadonlySet<string> = new Set([
  'installation_id',
  'variant',
  'release',
  'core_beta_flags'
])

/**
 * `0.4.2`, `v22.11.0`, `1.2.0-rc.1+build.5`, PEP 440 `1.2.3rc1`, a Node
 * nightly `v23.0.0-nightly20240814a4b1ad2b68`. At least one dot.
 */
const VERSION = /^v?\d{1,6}(?:\.\d{1,6}){1,3}(?:[-+.]?[0-9A-Za-z][0-9A-Za-z.+-]{0,39})?$/

function coerceValue(rawValue: string): TelemetryValue {
  if (/^-?\d+$/.test(rawValue)) return Number(rawValue)
  if (rawValue === 'true') return true
  if (rawValue === 'false') return false
  return rawValue
}

function normalizeFieldValue(key: string, value: TelemetryValue): TelemetryValue {
  if (key === 'reason' && !(typeof value === 'string' && REASONS.has(value))) return 'unknown'
  return value
}

function isAllowedFieldValue(key: string, value: unknown): value is TelemetryValue {
  if (key === 'code') return typeof value === 'number' && Number.isSafeInteger(value)
  if (key === 'duration_ms') {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  }
  if (typeof value !== 'string') return false
  if (key === 'agent_version' || key === 'node_version') return VERSION.test(value)
  if (key === 'reason') return REASONS.has(value)
  return false
}

function parseFields(tail: string): Record<string, TelemetryValue> | null {
  const fields: Record<string, TelemetryValue> = {}
  const pairs = tail ? tail.slice(1).split(' ') : []
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf('=')
    const key = pair.slice(0, separatorIndex)
    const rawValue = pair.slice(separatorIndex + 1)
    // Context spoofing, even though the merge order already defeats it.
    if (BASE_CONTEXT_KEYS.has(key)) return null
    if (!ALLOWED_FIELD_NAMES.has(key)) {
      if (Object.hasOwn(Object.prototype, key)) return null
      // A newer core's field: omit it rather than lose the whole event.
      continue
    }
    if (Object.hasOwn(fields, key)) return null
    const value = normalizeFieldValue(key, coerceValue(rawValue))
    if (!isAllowedFieldValue(key, value)) return null
    fields[key] = value
  }
  return fields
}

export interface AgentEvent {
  event: string
  fields: Record<string, TelemetryValue>
}

const UNKNOWN_EVENT = Symbol('unknown event')

function parseLine(line: string): AgentEvent | typeof UNKNOWN_EVENT | null {
  // ANSI and the bundled build's `[LEVEL] ` prefix, so the anchored grammar matches.
  const match = stripLogLevelPrefix(stripAnsi(line).trim()).match(AGENT_EVENT_LINE)
  if (!match) return null
  const [, event, tail] = match
  if (!event || tail === undefined) return null
  if (!ALLOWED_EVENTS.has(event)) return UNKNOWN_EVENT
  const fields = parseFields(tail)
  return fields ? { event, fields } : null
}

/**
 * The tap's validation of one complete line, with no telemetry, consent check
 * or rate cap, for callers that act on agent events whatever the user's
 * telemetry choice. `null` for anything the tap would not forward.
 */
export function parseAgentEventLine(line: string): AgentEvent | null {
  const parsed = parseLine(line)
  return parsed === UNKNOWN_EVENT ? null : parsed
}

/** Per-event budget on top of telemetry's own rate limit. */
const PER_EVENT_HOURLY_CAP = 60
const RATE_WINDOW_MS = 60 * 60_000

export function createAgentTap(opts: {
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

  // Per event name, and NOT reset by beginBoot: a restart loop is when the cap matters.
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
    const parsed = parseLine(line)
    if (parsed === UNKNOWN_EVENT) {
      // Counted, never named: the name is untrusted input.
      unknownEventsDropped++
      return
    }
    if (!parsed || !withinRateCap(parsed.event)) return
    try {
      // Base context merged LAST so parsed fields can never override it.
      telemetry.emit(`${EVENT_PREFIX}${parsed.event}`, { ...parsed.fields, ...baseContext })
    } catch {
      // ignore - telemetry side effect, and the next line must still parse
    }
  }

  const lineBuffer = createStreamLineBuffer()

  return {
    ingest(chunk: string, source: 'stdout' | 'stderr'): void {
      // Runs in the launch stream handler with no enclosing catch: never throw.
      try {
        for (const line of lineBuffer.append(source, chunk)) handleLine(line)
      } catch {
        // ignore - telemetry side effect, not user-visible
      }
    },
    /** Drop the previous (dead) process's partial lines; the rate buckets survive. */
    beginBoot(): void {
      lineBuffer.reset()
    },
    /**
     * Emits the dropped-event count only. An unterminated line is never parsed:
     * callers flush while core may still be writing, and core's logging ends
     * every record with a newline, so a tail without one is a write cut short
     * (`code=12` read as `code=1`). It waits for its newline or `beginBoot`.
     */
    flushSummary(): void {
      try {
        if (unknownEventsDropped > 0 && withinRateCap(UNKNOWN_EVENTS_DROPPED)) {
          const count = unknownEventsDropped
          unknownEventsDropped = 0
          telemetry.emit(`${EVENT_PREFIX}${UNKNOWN_EVENTS_DROPPED}`, { count, ...baseContext })
        }
      } catch {
        // ignore - telemetry side effect, not user-visible
      }
    }
  }
}
