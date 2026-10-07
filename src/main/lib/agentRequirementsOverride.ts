/** TEMPORARY: delete with its hook and launch wiring once the agent is on by default. */
import type { InstallationRecord } from '../installations'
import * as telemetry from './telemetry'
import { createStreamLineBuffer, stripAnsi } from './stderrTail'
import type { StreamSource } from './stderrTail'

const OVERRIDABLE = new Set(['comfy-agent', 'comfy-cli', 'nodejs-wheel-binaries'])

/** PEP 440 public versions only, so no operator, URL, index, option or marker can get through. */
const EXACT_VERSION =
  /^\d{1,6}(?:\.\d{1,6}){0,3}(?:(?:a|b|rc)\d{1,6})?(?:\.post\d{1,6})?(?:\.dev\d{1,6})?$/

const REQUIREMENT_LINE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:==\s*([^\s;#]+))?\s*(?:#.*)?$/
const LEADING_NAME = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/

export const START_FAILURES_TO_REVERT = 2

export type OverrideRefusal =
  | 'not_object'
  | 'unknown_package'
  | 'bad_version'
  | 'not_in_core_file'
  | 'unsupported_line'
  | 'check_failed'

export type OverridePins = ReadonlyMap<string, string>

export type ParsedOverride =
  | { kind: 'none' }
  | { kind: 'pins'; pins: OverridePins }
  | { kind: 'refused'; reason: OverrideRefusal }

export function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}

/** All or nothing: one bad entry refuses the whole payload. */
export function parseAgentRequirementsOverride(raw: unknown): ParsedOverride {
  if (raw === undefined || raw === null) return { kind: 'none' }
  if (typeof raw !== 'object' || Array.isArray(raw))
    return { kind: 'refused', reason: 'not_object' }
  const entries = Object.entries(raw)
  if (entries.length === 0) return { kind: 'none' }
  const pins = new Map<string, string>()
  for (const [name, version] of entries) {
    const normalized = normalizePackageName(name)
    if (!OVERRIDABLE.has(normalized) || pins.has(normalized)) {
      return { kind: 'refused', reason: 'unknown_package' }
    }
    if (typeof version !== 'string' || !EXACT_VERSION.test(version)) {
      return { kind: 'refused', reason: 'bad_version' }
    }
    pins.set(normalized, version)
  }
  return { kind: 'pins', pins }
}

export function overrideSignature(pins: OverridePins): string {
  return [...pins]
    .map(([name, version]) => `${name}==${version}`)
    .sort()
    .join(',')
}

export function effectiveAgentRequirements(
  coreText: string,
  pins: OverridePins
): { kind: 'text'; text: string } | { kind: 'refused'; reason: OverrideRefusal } {
  const seen = new Set<string>()
  const lines = coreText.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i]!.match(LEADING_NAME)?.[1]
    if (!name) continue
    const normalized = normalizePackageName(name)
    const version = pins.get(normalized)
    if (version === undefined) continue
    const line = lines[i]!.match(REQUIREMENT_LINE)
    if (!line || !EXACT_VERSION.test(line[2] ?? '') || seen.has(normalized)) {
      return { kind: 'refused', reason: 'unsupported_line' }
    }
    seen.add(normalized)
    lines[i] = `${name}==${version}`
  }
  if (seen.size !== pins.size) return { kind: 'refused', reason: 'not_in_core_file' }
  return { kind: 'text', text: lines.join('\n') }
}

/** Pins every installed non-agent package where it is, so an override that moves one falls back. */
export function installedConstraints(pipListOutput: string): string | null {
  // uv's stderr ("Using Python … environment at") shares the captured stream.
  const json = pipListOutput
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.startsWith('['))
  let installed: unknown
  try {
    installed = JSON.parse(json ?? '')
  } catch {
    return null
  }
  if (!Array.isArray(installed)) return null
  const lines: string[] = []
  for (const entry of installed) {
    const { name, version } = (entry ?? {}) as { name?: unknown; version?: unknown }
    if (typeof name !== 'string' || typeof version !== 'string') return null
    if (!OVERRIDABLE.has(normalizePackageName(name))) lines.push(`${name}==${version}`)
  }
  return lines.join('\n') + '\n'
}

export interface AgentOverrideState {
  signature: string
  failures: number
}

export function readOverrideState(installation: InstallationRecord): AgentOverrideState | null {
  const state = installation.agentRequirementsOverride
  if (!state || typeof state !== 'object') return null
  const { signature, failures } = state as Record<string, unknown>
  if (typeof signature !== 'string' || typeof failures !== 'number') return null
  return { signature, failures }
}

export function isRevertedFor(state: AgentOverrideState | null, pins: OverridePins): boolean {
  return (
    state !== null &&
    state.failures >= START_FAILURES_TO_REVERT &&
    state.signature === overrideSignature(pins)
  )
}

export type OverrideDecision =
  | { decision: 'applied'; pins: OverridePins }
  | { decision: 'refused'; reason: OverrideRefusal; pins?: OverridePins }
  | {
      decision: 'reverted'
      reason: 'install_failed' | 'start_failed' | 'previously_failed'
      pins: OverridePins
      failures?: number
    }

export function reportOverrideDecision(installationId: string, d: OverrideDecision): void {
  try {
    const pins = d.pins ? overrideSignature(d.pins) : null
    telemetry.emit('comfy.desktop.agent_requirements_override', {
      installation_id: installationId,
      decision: d.decision,
      reason: 'reason' in d ? d.reason : null,
      pins,
      failures: 'failures' in d ? (d.failures ?? null) : null
    })
  } catch {
    // Telemetry must never reach the launch.
  }
}

/** Failures: agent_error, health_check_failed, package_missing. Not agent_exited or permission_denied. */
export type AgentStartOutcome = 'started' | 'failed' | 'inconclusive'

/** Same grammar as the agent telemetry tap: a cross-repo contract with core's emitter. */
const AGENT_EVENT_LINE = /^\[agent-event\] ([a-z][a-z0-9_]*)((?: [a-z_]+=[^ =]+)*)$/
const RECORD_TAG = '[agent-event] '
const AGENT_OUTPUT_TAG = '[comfy-agent] '

export function classifyAgentEvent(line: string): AgentStartOutcome | null {
  // Cut at the last tag, as the tap does: a record can land behind a tqdm `\r` redraw.
  const text = stripAnsi(line)
  const at = text.lastIndexOf(RECORD_TAG)
  if (at === -1 || text.lastIndexOf(AGENT_OUTPUT_TAG, at) !== -1) return null
  const match = text.slice(at).trim().match(AGENT_EVENT_LINE)
  if (!match) return null
  const fields = new Map(
    match[2]!
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((pair) => pair.split('=') as [string, string])
  )
  switch (match[1]) {
    case 'agent_started':
      return 'started'
    case 'health_check_failed':
    case 'package_missing':
      return 'failed'
    case 'agent_error':
      return fields.get('reason') === 'permission_denied' ? 'inconclusive' : 'failed'
    default:
      return null
  }
}

/** Independent of the consent-gated telemetry tap: the revert has to work without consent. */
export function createAgentStartWatcher(onOutcome: (outcome: AgentStartOutcome) => void): {
  ingest: (text: string, source: StreamSource) => void
} {
  const buffer = createStreamLineBuffer()
  let settled = false
  return {
    ingest(text, source) {
      if (settled) return
      for (const line of buffer.append(source, text)) {
        const outcome = classifyAgentEvent(line)
        if (!outcome) continue
        settled = true
        onOutcome(outcome)
        return
      }
    }
  }
}

export function nextOverrideState(
  previous: AgentOverrideState | null,
  pins: OverridePins,
  outcome: AgentStartOutcome
): { state: AgentOverrideState; reverted: boolean } | null {
  if (outcome === 'inconclusive') return null
  const signature = overrideSignature(pins)
  const base = previous?.signature === signature ? previous.failures : 0
  const failures = outcome === 'started' ? 0 : base + 1
  return { state: { signature, failures }, reverted: failures === START_FAILURES_TO_REVERT }
}
