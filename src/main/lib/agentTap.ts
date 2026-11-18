import * as telemetry from './telemetry'
import type { TelemetryValue } from './telemetry'
import { createStreamLineBuffer, stripAnsi } from './stderrTail'

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
  'agent_error',
  'startup_step',
  'startup_stalled',
  'startup_failed',
  'document_host_degraded',
  'agent_orphans_stopped'
])

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
  'unknown',
  'data_dir_locked',
  'address_in_use',
  'not_set_up',
  'config_invalid',
  'outdated',
  'unreadable_link'
])

export const STARTUP_STEPS: ReadonlySet<string> = new Set([
  'init',
  'open_data_dir',
  'cli_provision',
  'find_comfyui',
  'code_search_canary',
  'find_node',
  'sandbox_config',
  'egress_proxy',
  'sandbox_setup',
  'sandbox_grants',
  'object_info',
  'knowledge',
  'cli_skills',
  'detect_environment',
  'document_host',
  'listen',
  'other'
])

export const STARTUP_OPERATIONS: ReadonlySet<string> = new Set([
  'open',
  'stat',
  'mkdir',
  'readdir',
  'readlink',
  'read',
  'write',
  'close',
  'remove',
  'rename',
  'chmod',
  'truncate',
  'resolve_path',
  'resolve_open',
  'resolve_final_name',
  'resolve_attributes',
  'dial',
  'listen',
  'accept',
  'bind',
  'connect',
  'socket'
])

export const STARTUP_FILES: ReadonlySet<string> = new Set([
  'AGENTS.md',
  'agent.db',
  'agent.db-journal',
  'agent.db-shm',
  'agent.db-wal',
  'agent.db.legacy-v0',
  'agent.db.legacy-v0-journal',
  'agent.db.legacy-v0-shm',
  'agent.db.legacy-v0-wal',
  'agent.db.local-v1-new',
  'agent.db.local-v1-new-journal',
  'agent.db.local-v1-new-shm',
  'agent.db.local-v1-new-wal',
  'agent.db.migration.json',
  'agent.db.migration.json.tmp',
  'agent.db.v1.bak',
  'agent.db.v1.bak-journal',
  'agent.db.v1.bak-shm',
  'agent.db.v1.bak-wal',
  'agent.db.v1.bak.tmp',
  'agent.json',
  'agent.lock',
  'egress-allow.json',
  'object_info.json',
  'owner.lock',
  'permissions.json',
  'sandbox-grants.json'
])

export const ALLOWED_FIELD_NAMES: ReadonlySet<string> = new Set([
  'code',
  'duration_ms',
  'agent_version',
  'node_version',
  'reason',
  'step',
  'outcome',
  'attempt',
  'count',
  'uptime_ms',
  'startup_ms',
  'ready',
  'crash',
  'missing',
  'python_arch',
  'python_version',
  'crdt',
  'cli',
  'comfyui',
  'comfyui_found_by',
  'comfyui_match',
  'shell',
  'sandbox',
  'assets',
  'op',
  'file',
  'win_error'
])

const LIFECYCLE_ENUMS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries({
    step: STARTUP_STEPS,
    outcome: ['ok', 'degraded', 'failed'],
    crash: ['panic', 'fatal_error', 'none'],
    missing: ['comfy_cli', 'node', 'comfy_cli_and_node'],
    python_arch: ['amd64', 'arm64', 'other'],
    crdt: ['on', 'disabled', 'failed', 'other'],
    cli: ['provisioned', 'override', 'unavailable', 'other'],
    comfyui: ['found', 'not_found'],
    comfyui_found_by: ['explicit', 'server', 'known_location', 'none', 'other'],
    comfyui_match: ['match', 'mismatch', 'unknown', 'other'],
    shell: ['on', 'off'],
    sandbox: ['none', 'seatbelt', 'appcontainer', 'other'],
    assets: ['enabled', 'disabled', 'unknown', 'other'],
    op: STARTUP_OPERATIONS,
    file: STARTUP_FILES
  }).map(([name, values]): [string, ReadonlySet<string>] => [name, new Set(values)])
)

const LIFECYCLE_COUNTS: ReadonlySet<string> = new Set([
  'duration_ms',
  'attempt',
  'count',
  'uptime_ms',
  'startup_ms',
  'win_error'
])

const VERSION = /^v?\d{1,6}(?:\.\d{1,6}){1,3}(?:[-+.]?[0-9A-Za-z][0-9A-Za-z.+-]{0,39})?$/

type FieldValue = (raw: string) => TelemetryValue | undefined

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const HEX64 = /^[0-9a-f]{64}$/
const TOKEN = /^[A-Za-z0-9_.:+-]{1,128}$/
const UTC_TIMESTAMP =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/

const matching =
  (pattern: RegExp): FieldValue =>
  (raw) =>
    pattern.test(raw) ? raw : undefined
const oneOf = (values: string): FieldValue => {
  const allowed = new Set(values.split(' '))
  return (raw) => (allowed.has(raw) ? raw : 'unknown')
}
const count: FieldValue = (raw) => {
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN
  return Number.isSafeInteger(value) ? value : undefined
}
const bool: FieldValue = (raw) => (raw === 'true' ? true : raw === 'false' ? false : undefined)
const timestamp = matching(UTC_TIMESTAMP)

const fieldsOfType = (names: string, type: FieldValue): Array<[string, FieldValue]> =>
  names.split(' ').map((name) => [name, type])

export const PRODUCT_FIELDS: ReadonlyMap<string, FieldValue> = new Map([
  ...fieldsOfType('thread_id session_id turn_id workflow_id job_id', matching(UUID)),
  ['client_message_id', matching(UUID)],
  ['mutation_id', matching(HEX64)],
  ...fieldsOfType('occurred_at timestamp accepted_at', timestamp),
  ['agent_version', matching(VERSION)],
  ...fieldsOfType('feature_flag_cohort model', matching(TOKEN)),
  ...fieldsOfType('is_resume retryable is_blank_canvas_start has_api_nodes', bool),
  ['entry_source', oneOf('new_tab existing_thread')],
  ['run_mode', oneOf('ask_approval auto auto_limited')],
  ['engine', oneOf('inline temporal')],
  ['job_kind', oneOf('workflow_submit')],
  ['target', oneOf('cloud local')],
  ['approval', oneOf('auto approved')],
  [
    'status',
    oneOf('completed failed cancelled timed_out interrupted not_found unreachable unknown')
  ],
  ['response_kind', oneOf('message_delta thinking tool_call refusal')],
  ['event_schema_version', (raw) => (/^\d{1,4}$/.test(raw) ? raw : 'unknown')],
  [
    'error_class',
    oneOf(
      'cancelled budget_exceeded turn_expired prepare_failed model_failed tool_failed finalize_failed max_tokens_truncated model_refused credential_stash_failed internal interrupted'
    )
  ],
  [
    'failure_stage',
    oneOf(
      'cancelled timeout budget turn_deadline prepare model tool finalize auth credit rate_limit internal shutdown interrupted'
    )
  ],
  ...fieldsOfType(
    'time_to_first_response_ms op_count base_version result_version apply_duration_ms duration_ms mutation_count tool_call_count input_tokens output_tokens cache_creation_input_tokens cache_read_input_tokens billed_units canvas_node_count_before canvas_node_count_after api_node_count api_node_class_count',
    count
  )
])

type ProductEvent = { required: readonly string[]; optional: readonly string[]; hourlyCap: number }

const TURNS_PER_HOUR = 120

const AGENT_MAX_RUNS_PER_TURN = 10

const productEvent = (
  required: string,
  optional: string,
  hourlyCap = TURNS_PER_HOUR
): ProductEvent => ({
  required: required.split(' '),
  optional: `${optional} occurred_at agent_version`.split(' '),
  hourlyCap
})

export const PRODUCT_EVENTS: ReadonlyMap<string, ProductEvent> = new Map([
  [
    'agent_session_started',
    productEvent('thread_id', 'entry_source is_resume run_mode feature_flag_cohort')
  ],
  [
    'agent_turn_started',
    productEvent(
      'thread_id turn_id workflow_id',
      'client_message_id run_mode engine model accepted_at'
    )
  ],
  [
    'agent_first_response',
    productEvent('thread_id turn_id', 'response_kind time_to_first_response_ms')
  ],
  [
    'agent_mutation_applied',
    productEvent(
      'session_id thread_id turn_id workflow_id mutation_id',
      'event_schema_version timestamp op_count base_version result_version apply_duration_ms',
      600
    )
  ],
  [
    'agent_turn_completed',
    productEvent(
      'session_id thread_id turn_id workflow_id',
      'event_schema_version timestamp duration_ms mutation_count tool_call_count input_tokens output_tokens cache_creation_input_tokens cache_read_input_tokens billed_units canvas_node_count_before canvas_node_count_after is_blank_canvas_start'
    )
  ],
  [
    'agent_turn_failed',
    productEvent('thread_id turn_id workflow_id', 'error_class failure_stage retryable duration_ms')
  ],
  [
    'agent_run_submitted',
    productEvent(
      'session_id thread_id turn_id job_id',
      'workflow_id event_schema_version timestamp job_kind target run_mode approval has_api_nodes api_node_count api_node_class_count',
      TURNS_PER_HOUR * AGENT_MAX_RUNS_PER_TURN
    )
  ],
  [
    'agent_run_completed',
    productEvent(
      'session_id thread_id turn_id job_id',
      'workflow_id event_schema_version timestamp status duration_ms target',
      TURNS_PER_HOUR * AGENT_MAX_RUNS_PER_TURN
    )
  ]
])

const PRODUCT_EVENTS_PER_PROCESS = 1500
let productEventsThisProcess = 0

export function _resetProductEventBudgetForTest(): void {
  productEventsThisProcess = 0
}

type AgentTapOptions = {
  installationId: string
  variant?: string | null
  release?: string | null
  coreBetaFlags?: readonly string[]
}

function fieldValue(key: string, rawValue: string): TelemetryValue | undefined {
  if (key === 'reason') return REASONS.has(rawValue) ? rawValue : 'unknown'
  const values = LIFECYCLE_ENUMS.get(key)
  if (values) return values.has(rawValue) ? rawValue : 'unknown'
  if (key === 'ready') return bool(rawValue)
  if (key === 'agent_version' || key === 'node_version' || key === 'python_version') {
    return VERSION.test(rawValue) ? rawValue : undefined
  }
  const value = /^-?\d+$/.test(rawValue) ? Number(rawValue) : NaN
  if (!Number.isSafeInteger(value) || (LIFECYCLE_COUNTS.has(key) && value < 0)) return undefined
  if (key === 'win_error' && value > 0xffffffff) return undefined
  return value
}

function parseFields(
  tail: string,
  valueOf: (key: string, rawValue: string) => TelemetryValue | undefined | null
): Record<string, TelemetryValue> | null {
  const fields: Record<string, TelemetryValue> = {}
  const pairs = tail ? tail.slice(1).split(' ') : []
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf('=')
    const key = pair.slice(0, separatorIndex)
    const value = valueOf(key, pair.slice(separatorIndex + 1))
    if (value === null) continue
    if (Object.hasOwn(fields, key)) return null
    if (value === undefined) return null
    fields[key] = value
  }
  return fields
}

const lifecycleValue = (key: string, rawValue: string): TelemetryValue | undefined | null =>
  ALLOWED_FIELD_NAMES.has(key) ? fieldValue(key, rawValue) : null

function parseProductFields(
  event: ProductEvent,
  tail: string
): Record<string, TelemetryValue> | null {
  const names = new Set([...event.required, ...event.optional])
  const fields = parseFields(tail, (key, rawValue) => {
    const value = names.has(key) ? PRODUCT_FIELDS.get(key) : undefined
    if (!value) return null
    const parsed = value(rawValue)
    if (parsed === undefined && key === 'workflow_id' && !event.required.includes(key)) return null
    return parsed
  })
  return fields && event.required.every((key) => Object.hasOwn(fields, key)) ? fields : null
}

export interface AgentEvent {
  event: string
  fields: Record<string, TelemetryValue>
}

type ParsedLine = AgentEvent & { product?: ProductEvent }

const UNKNOWN_EVENT = Symbol('unknown event')

const RECORD_TAG = '[agent-event] '
const AGENT_OUTPUT_TAG = '[comfy-agent] '

function parseLine(line: string): ParsedLine | typeof UNKNOWN_EVENT | null {
  const text = stripAnsi(line)
  const at = text.lastIndexOf(RECORD_TAG)
  if (at === -1 || text.lastIndexOf(AGENT_OUTPUT_TAG, at) !== -1) return null
  const match = text.slice(at).trim().match(AGENT_EVENT_LINE)
  if (!match) return null
  const [, event, tail] = match
  if (!event || tail === undefined) return null
  const product = PRODUCT_EVENTS.get(event)
  if (product) {
    const fields = parseProductFields(product, tail)
    return fields ? { event, fields, product } : null
  }
  if (!ALLOWED_EVENTS.has(event)) return UNKNOWN_EVENT
  const fields = parseFields(tail, lifecycleValue)
  return fields ? { event, fields } : null
}

export function parseAgentEventLine(line: string): AgentEvent | null {
  const parsed = parseLine(line)
  return parsed === UNKNOWN_EVENT || !parsed || parsed.product ? null : parsed
}

const PER_EVENT_HOURLY_CAP = 60
const LIFECYCLE_HOURLY_CAPS: Readonly<Record<string, number>> = { startup_step: 240 }
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

  const rateBuckets = new Map<string, { windowStart: number; count: number }>()

  const productContext = { ...baseContext, distribution: 'local', deployment: 'local' }

  function rateBucket(event: string): { windowStart: number; count: number } {
    const now = Date.now()
    let bucket = rateBuckets.get(event)
    if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
      bucket = { windowStart: now, count: 0 }
      rateBuckets.set(event, bucket)
    }
    return bucket
  }

  function handleLine(line: string): void {
    const parsed = parseLine(line)
    if (!parsed) return
    if (parsed !== UNKNOWN_EVENT && parsed.product) {
      if (productEventsThisProcess >= PRODUCT_EVENTS_PER_PROCESS) return
      const bucket = rateBucket(parsed.event)
      if (bucket.count >= parsed.product.hourlyCap) return
      try {
        if (telemetry.capture(parsed.event, { ...parsed.fields, ...productContext })) {
          bucket.count++
          productEventsThisProcess++
        }
      } catch {}
      return
    }
    const { event, fields } =
      parsed === UNKNOWN_EVENT ? { event: UNKNOWN_EVENTS_DROPPED, fields: { count: 1 } } : parsed
    const bucket = rateBucket(event)
    if (bucket.count >= (LIFECYCLE_HOURLY_CAPS[event] ?? PER_EVENT_HOURLY_CAP)) return
    bucket.count++
    try {
      telemetry.emit(`${EVENT_PREFIX}${event}`, { ...fields, ...baseContext })
    } catch {}
  }

  const lineBuffer = createStreamLineBuffer()

  return {
    ingest(chunk: string, source: 'stdout' | 'stderr'): void {
      try {
        for (const line of lineBuffer.append(source, chunk)) handleLine(line)
      } catch {}
    },
    beginBoot(): void {
      lineBuffer.reset()
    }
  }
}
