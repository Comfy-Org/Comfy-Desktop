// Core's output is untrusted: this catches accidental leakage, not deliberately encoded text.
import * as telemetry from './telemetry'
import type { TelemetryValue } from './telemetry'
import { createStreamLineBuffer, stripAnsi } from './stderrTail'

// Contract with core's emitter: the grammar and vocabulary change on both sides or not at all.
export const AGENT_EVENT_LINE = /^\[agent-event\] ([a-z][a-z0-9_]*)((?: [a-z_]+=[^ =]+)*)$/

const EVENT_PREFIX = 'comfy.desktop.comfyui.agent.'

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

// Absent from ALLOWED_EVENTS, so no line can forge it.
const UNKNOWN_EVENTS_DROPPED = 'unknown_events_dropped'

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

// A Set, not an object literal, so untrusted keys like `constructor` can't hit the prototype.
export const ALLOWED_FIELD_NAMES: ReadonlySet<string> = new Set([
  'code',
  'duration_ms',
  'agent_version',
  'node_version',
  'reason'
])

type AgentTapOptions = {
  installationId: string
  variant?: string | null
  release?: string | null
  coreBetaFlags?: readonly string[]
}

const VERSION = /^v?\d{1,6}(?:\.\d{1,6}){1,3}(?:[-+.]?[0-9A-Za-z][0-9A-Za-z.+-]{0,39})?$/

function fieldValue(key: string, rawValue: string): TelemetryValue | undefined {
  if (key === 'reason') return REASONS.has(rawValue) ? rawValue : 'unknown'
  if (key === 'agent_version' || key === 'node_version') {
    return VERSION.test(rawValue) ? rawValue : undefined
  }
  const value = /^-?\d+$/.test(rawValue) ? Number(rawValue) : NaN
  if (!Number.isSafeInteger(value) || (key === 'duration_ms' && value < 0)) return undefined
  return value
}

function parseFields(tail: string): Record<string, TelemetryValue> | null {
  const fields: Record<string, TelemetryValue> = {}
  const pairs = tail ? tail.slice(1).split(' ') : []
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf('=')
    const key = pair.slice(0, separatorIndex)
    const rawValue = pair.slice(separatorIndex + 1)
    // A newer core's field: omit it rather than lose the whole event.
    if (!ALLOWED_FIELD_NAMES.has(key)) continue
    if (Object.hasOwn(fields, key)) return null
    const value = fieldValue(key, rawValue)
    if (value === undefined) return null
    fields[key] = value
  }
  return fields
}

export interface AgentEvent {
  event: string
  fields: Record<string, TelemetryValue>
}

const UNKNOWN_EVENT = Symbol('unknown event')

const RECORD_TAG = '[agent-event] '
// Core relays the agent's own output behind this tag so it can never pass as a record.
const AGENT_OUTPUT_TAG = '[comfy-agent] '

function parseLine(line: string): AgentEvent | typeof UNKNOWN_EVENT | null {
  const text = stripAnsi(line)
  // Not anchored: a tqdm bar redraws as `\r<bar>` with no newline, so a record can land behind it.
  const at = text.lastIndexOf(RECORD_TAG)
  if (at === -1 || text.lastIndexOf(AGENT_OUTPUT_TAG, at) !== -1) return null
  const match = text.slice(at).trim().match(AGENT_EVENT_LINE)
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

// Per-event budget on top of telemetry's own per-minute limit.
const PER_EVENT_HOURLY_CAP = 60
const RATE_WINDOW_MS = 60 * 60_000

export function createAgentTap(opts: AgentTapOptions): {
  ingest: (chunk: string, source: 'stdout' | 'stderr') => void
  beginBoot: () => void
} {
  const baseContext = {
    installation_id: opts.installationId,
    variant: opts.variant ?? null,
    release: opts.release ?? null,
    core_beta_flags: [...(opts.coreBetaFlags ?? [])]
  }

  // Not reset by beginBoot, so the port-conflict relaunch loop shares one cap.
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
    const parsed = parseLine(line)
    if (!parsed) return
    // Counted, never named: an unknown event's name is untrusted input.
    const { event, fields } =
      parsed === UNKNOWN_EVENT ? { event: UNKNOWN_EVENTS_DROPPED, fields: { count: 1 } } : parsed
    if (!withinRateCap(event)) return
    try {
      // Base context merged last so parsed fields can never override it.
      telemetry.emit(`${EVENT_PREFIX}${event}`, { ...fields, ...baseContext })
    } catch {
      // ignore - telemetry side effect, and the next line must still parse
    }
  }

  // Never asked for its unterminated tail: a line without a newline may be a write cut short.
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
    beginBoot(): void {
      lineBuffer.reset()
    }
  }
}
