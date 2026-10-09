import * as telemetry from './telemetry'
import type { TelemetryContext, TelemetryValue } from './telemetry'
import { createStreamLineBuffer } from './stderrTail'

export const AGENT_PRODUCT_EVENT_PREFIX = '[agent-product-event/v1] '
const AGENT_PRODUCT_EVENT_PREFIX_START = '[agent-product-event/'
const MAX_LINE_BYTES = 16 * 1024
const MAX_ID_LENGTH = 256

export const AGENT_PRODUCT_EVENTS = [
  'agent_session_started',
  'agent_turn_started',
  'agent_first_response',
  'agent_mutation_applied',
  'agent_turn_completed',
  'agent_turn_failed'
] as const

type AgentProductEventName = (typeof AGENT_PRODUCT_EVENTS)[number]

export interface AgentProductEvent {
  event: AgentProductEventName
  eventId: string
  occurredAt: string
  properties: Record<string, TelemetryValue>
}

type Validator = (value: unknown) => boolean
type PropertyRule = { required: boolean; validate: Validator }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const isNonNegativeInteger = (value: unknown): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isBoolean = (value: unknown): boolean => typeof value === 'boolean'
const isOpaqueId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_ID_LENGTH &&
  /^[A-Za-z0-9_.:-]+$/.test(value)
const isToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9_.:+-]*$/.test(value)
const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value))
const isOneOf =
  (...values: string[]): Validator =>
  (value) =>
    typeof value === 'string' && values.includes(value)
const required = (validate: Validator): PropertyRule => ({ required: true, validate })
const optional = (validate: Validator): PropertyRule => ({ required: false, validate })

const schemas: Record<AgentProductEventName, Record<string, PropertyRule>> = {
  agent_session_started: {
    thread_id: required(isOpaqueId),
    entry_source: required(isOneOf('new_tab', 'existing_thread')),
    is_resume: required(isBoolean),
    run_mode: required(isOneOf('', 'ask_approval', 'auto', 'auto_limited')),
    feature_flag_cohort: optional(isToken)
  },
  agent_turn_started: {
    thread_id: required(isOpaqueId),
    turn_id: required(isOpaqueId),
    client_message_id: optional(isOpaqueId),
    workflow_id: required(isOpaqueId),
    run_mode: required(isOneOf('', 'ask_approval', 'auto', 'auto_limited')),
    engine: required(isOneOf('inline', 'temporal')),
    model: required(isToken),
    accepted_at: required(isTimestamp)
  },
  agent_first_response: {
    thread_id: required(isOpaqueId),
    turn_id: required(isOpaqueId),
    response_kind: required(isOneOf('message_delta', 'thinking', 'tool_call')),
    time_to_first_response_ms: required(isNonNegativeInteger)
  },
  agent_mutation_applied: {
    event_schema_version: required(isOneOf('1')),
    timestamp: required(isTimestamp),
    session_id: required(isOpaqueId),
    thread_id: required(isOpaqueId),
    turn_id: required(isOpaqueId),
    workflow_id: required(isOpaqueId),
    mutation_id: required(isOpaqueId),
    op_count: required(isNonNegativeInteger),
    base_version: required(isNonNegativeInteger),
    result_version: required(isNonNegativeInteger),
    apply_duration_ms: required(isNonNegativeInteger)
  },
  agent_turn_completed: {
    event_schema_version: required(isOneOf('1')),
    timestamp: required(isTimestamp),
    session_id: required(isOpaqueId),
    thread_id: required(isOpaqueId),
    turn_id: required(isOpaqueId),
    workflow_id: required(isOpaqueId),
    duration_ms: required(isNonNegativeInteger),
    mutation_count: required(isNonNegativeInteger),
    tool_call_count: required(isNonNegativeInteger),
    input_tokens: required(isNonNegativeInteger),
    output_tokens: required(isNonNegativeInteger),
    cache_creation_input_tokens: required(isNonNegativeInteger),
    cache_read_input_tokens: required(isNonNegativeInteger),
    billed_units: required(isNonNegativeInteger),
    canvas_node_count_before: optional(isNonNegativeInteger),
    canvas_node_count_after: optional(isNonNegativeInteger),
    is_blank_canvas_start: optional(isBoolean)
  },
  agent_turn_failed: {
    thread_id: required(isOpaqueId),
    turn_id: required(isOpaqueId),
    workflow_id: required(isOpaqueId),
    error_class: required(
      isOneOf(
        'cancelled',
        'budget_exceeded',
        'turn_expired',
        'prepare_failed',
        'model_failed',
        'tool_failed',
        'finalize_failed',
        'max_tokens_truncated',
        'credential_stash_failed',
        'internal'
      )
    ),
    failure_stage: required(
      isOneOf(
        'cancelled',
        'timeout',
        'budget',
        'turn_deadline',
        'prepare',
        'model',
        'tool',
        'finalize',
        'auth',
        'internal'
      )
    ),
    retryable: required(isBoolean),
    duration_ms: optional(isNonNegativeInteger)
  }
}

type ParseFailure =
  | 'malformed_json'
  | 'invalid_envelope'
  | 'unknown_event'
  | 'invalid_properties'
  | 'oversized'
  | 'unsupported_version'

type ParseResult =
  | { kind: 'ignored' }
  | { kind: 'invalid'; reason: ParseFailure }
  | { kind: 'event'; event: AgentProductEvent }

function parseProperties(
  event: AgentProductEventName,
  value: unknown
): Record<string, TelemetryValue> | null {
  if (!isRecord(value)) return null
  const schema = schemas[event]
  for (const [key, property] of Object.entries(value)) {
    const rule = schema[key]
    if (!rule || !rule.validate(property)) return null
  }
  for (const [key, rule] of Object.entries(schema)) {
    if (rule.required && !Object.hasOwn(value, key)) return null
  }
  return value as Record<string, TelemetryValue>
}

function parseLine(line: string): ParseResult {
  if (!line.startsWith(AGENT_PRODUCT_EVENT_PREFIX)) {
    return line.startsWith(AGENT_PRODUCT_EVENT_PREFIX_START)
      ? { kind: 'invalid', reason: 'unsupported_version' }
      : { kind: 'ignored' }
  }
  if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
    return { kind: 'invalid', reason: 'oversized' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(line.slice(AGENT_PRODUCT_EVENT_PREFIX.length))
  } catch {
    return { kind: 'invalid', reason: 'malformed_json' }
  }
  if (!isRecord(parsed)) return { kind: 'invalid', reason: 'invalid_envelope' }
  const keys = Object.keys(parsed)
  if (
    keys.length !== 4 ||
    !keys.every((key) => ['event', 'event_id', 'occurred_at', 'properties'].includes(key)) ||
    typeof parsed.event !== 'string' ||
    !isOpaqueId(parsed.event_id) ||
    !isTimestamp(parsed.occurred_at)
  ) {
    return { kind: 'invalid', reason: 'invalid_envelope' }
  }
  if (!(AGENT_PRODUCT_EVENTS as readonly string[]).includes(parsed.event)) {
    return { kind: 'invalid', reason: 'unknown_event' }
  }
  const event = parsed.event as AgentProductEventName
  const properties = parseProperties(event, parsed.properties)
  if (!properties) return { kind: 'invalid', reason: 'invalid_properties' }
  return {
    kind: 'event',
    event: {
      event,
      eventId: parsed.event_id,
      occurredAt: parsed.occurred_at,
      properties
    }
  }
}

export function parseAgentProductEventLine(line: string): AgentProductEvent | null {
  const result = parseLine(line)
  return result.kind === 'event' ? result.event : null
}

type AgentProductEventTapOptions = {
  installationId: string
  variant?: string | null
  release?: string | null
  coreBetaFlags?: readonly string[]
}

const INVALID_EVENT = 'comfy.desktop.comfyui.agent_product_event.invalid'

export function createAgentProductEventTap(opts: AgentProductEventTapOptions): {
  ingest: (chunk: string, source: 'stdout' | 'stderr') => void
  beginBoot: () => void
} {
  const lineBuffer = createStreamLineBuffer(MAX_LINE_BYTES)
  const trustedContext: TelemetryContext = {
    distribution: 'local',
    deployment: 'local',
    installation_id: opts.installationId,
    variant: opts.variant ?? null,
    release: opts.release ?? null,
    core_beta_flags: [...(opts.coreBetaFlags ?? [])]
  }

  function reportInvalid(reason: ParseFailure): void {
    try {
      telemetry.emit(INVALID_EVENT, { reason, count: 1, ...trustedContext })
    } catch {
      // Telemetry must never affect launch or the Agent stream.
    }
  }

  function handleLine(line: string): void {
    const result = parseLine(line)
    if (result.kind === 'ignored') return
    if (result.kind === 'invalid') {
      reportInvalid(result.reason)
      return
    }
    try {
      telemetry.capture(result.event.event, {
        ...result.event.properties,
        occurred_at: result.event.occurredAt,
        $insert_id: result.event.eventId,
        ...trustedContext
      })
    } catch {
      reportInvalid('invalid_envelope')
    }
  }

  return {
    ingest(chunk, source): void {
      try {
        for (const line of lineBuffer.append(source, chunk)) handleLine(line)
      } catch {
        reportInvalid('invalid_envelope')
      }
    },
    beginBoot(): void {
      lineBuffer.reset()
    }
  }
}
