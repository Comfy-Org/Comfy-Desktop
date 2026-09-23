/**
 * Local agent event-log tap.
 *
 * ComfyUI and the agent binary it starts log structured, privacy-safe records
 * on core's stdout: `[agent-event] <event> key=value ...`. Each accepted
 * record is forwarded as `comfy.desktop.comfyui.agent.<event>`. The parsing,
 * validation order, rate cap and no-throw contract live in `eventLogTap`; this
 * module holds the agent vocabulary.
 *
 * The vocabulary carries no free text: every string field is either a member
 * of a closed set or a version number, so a path, prompt or model output has
 * no field it could ride in.
 */
import type { TelemetryValue } from './telemetry'
import { createEventLogTap } from './eventLogTap'
import type { EventLogTap, EventLogTapOptions } from './eventLogTap'

/**
 * Same logfmt grammar as the assets tap, with single-segment event names. The
 * grammar and the vocabulary below are a CROSS-REPO CONTRACT with the core-side
 * emitter: adding an event, field or reason is a reviewed change on both sides.
 */
export const AGENT_EVENT_LINE = /^\[agent-event\] ([a-z][a-z0-9_]*)((?: [a-z_]+=[^ =]+)*)$/

/**
 * Every event name this build forwards. An event outside this set is dropped
 * even if it parses, so a future core release cannot start sending events this
 * build has never reviewed.
 */
export const ALLOWED_EVENTS: ReadonlySet<string> = new Set([
  'flag_enabled',
  'package_missing',
  'install_hint',
  'agent_starting',
  'agent_started',
  'node_found',
  'node_fetch_started',
  'node_fetched',
  'node_fetch_failed',
  'health_check_failed',
  'agent_exited',
  'agent_error'
])

/**
 * Values `reason` may take. Any other value is forwarded as `unknown` rather
 * than dropping the line, so a newer core's new failure reason still reports
 * the failure. The replacement discards the raw value, so it never leaks.
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

export const ALLOWED_FIELD_NAMES: ReadonlySet<string> = new Set([
  'code',
  'duration_ms',
  'agent_version',
  'node_version',
  'reason'
])

/**
 * Dotted numeric version with an optional `v` and a short pre-release or build
 * suffix, e.g. `0.4.2`, `v22.11.0`, `1.2.0-rc.1`. At least one dot, so a bare
 * integer (which logfmt coercion turns into a number anyway) never qualifies.
 */
const VERSION = /^v?\d{1,6}(?:\.\d{1,6}){1,3}(?:[-+][0-9A-Za-z.]{1,16})?$/

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

export function createAgentTap(opts: EventLogTapOptions): EventLogTap {
  return createEventLogTap(
    {
      linePattern: AGENT_EVENT_LINE,
      eventPrefix: 'comfy.desktop.comfyui.agent.',
      allowedEvents: ALLOWED_EVENTS,
      allowedFieldNames: ALLOWED_FIELD_NAMES,
      normalizeFieldValue,
      isAllowedFieldValue
    },
    opts
  )
}
