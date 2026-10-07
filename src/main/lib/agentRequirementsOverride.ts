/**
 * TEMPORARY: the agent campaign's `agent_requirements_override` (e.g. `{"comfy-agent": "0.2.3"}`)
 * ships agent versions faster than core's weekly pins. Every rule about the field lives here;
 * removing the feature is deleting this module, its hook in `agentRequirementsLaunch.ts` and the
 * launch wiring.
 *
 * Going back is always "install core's file": an override is only accepted against an exact
 * `name==x` line, so `uv pip install -r` moves the version back. That install runs on every agent
 * launch, so a removed or reverted override is repaired by the next launch.
 */
import type { InstallationRecord } from '../installations'
import * as telemetry from './telemetry'
import { createStreamLineBuffer, stripAnsi, stripLogLevelPrefix } from './stderrTail'
import type { StreamSource } from './stderrTail'

/** The only packages a payload may name. Each must also already be in core's file. */
const OVERRIDABLE = new Set(['comfy-agent', 'comfy-cli', 'nodejs-wheel-binaries'])

/** PEP 440 public versions only, so no operator, URL, index, option or marker can get through. */
const EXACT_VERSION =
  /^\d{1,6}(?:\.\d{1,6}){0,3}(?:(?:a|b|rc)\d{1,6})?(?:\.post\d{1,6})?(?:\.dev\d{1,6})?$/

/** One requirement line naming a package, optionally `==`-pinned, optionally commented. */
const REQUIREMENT_LINE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:==\s*([^\s;#]+))?\s*(?:#.*)?$/
const LEADING_NAME = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/

/**
 * Consecutive failed starts of one overridden version before the install goes back to core's.
 * One retry absorbs a one-off on a fresh binary's first start; a slow start never counts. A
 * false revert only costs the newer version, while a missed one leaves the agent broken until
 * the operator pulls the field. Reasoned, not measured: there is no field data yet.
 */
export const START_FAILURES_TO_REVERT = 2

export type OverrideRefusal =
  | 'not_object'
  | 'too_many'
  | 'unknown_package'
  | 'bad_version'
  | 'not_in_core_file'
  | 'unsupported_line'
  | 'would_change_other'
  | 'check_failed'

/** Normalised package name → exact version. */
export type OverridePins = ReadonlyMap<string, string>

export type ParsedOverride =
  | { kind: 'none' }
  | { kind: 'pins'; pins: OverridePins }
  | { kind: 'refused'; reason: OverrideRefusal }

/** PEP 503 normalisation, so `Comfy_CLI` and `comfy-cli` are one package. */
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
  if (entries.length > OVERRIDABLE.size) return { kind: 'refused', reason: 'too_many' }
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

/** Stable identity of one override, for the per-version start-failure latch. */
export function overrideSignature(pins: OverridePins): string {
  return [...pins]
    .map(([name, version]) => `${name}==${version}`)
    .sort()
    .join(',')
}

/** Core's file with each pinned package's line replaced by `name==version`. A pinned package
 *  must appear exactly once, as a plain `name==x` line, so a payload can never add a package. */
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
    if (!line || line[2] === undefined || seen.has(normalized)) {
      return { kind: 'refused', reason: 'unsupported_line' }
    }
    seen.add(normalized)
    lines[i] = `${name}==${version}`
  }
  if (seen.size !== pins.size) return { kind: 'refused', reason: 'not_in_core_file' }
  return { kind: 'text', text: lines.join('\n') }
}

/** What a `uv pip install --dry-run` would do: target version per package, and which installed
 *  packages it would replace. */
export interface DryRunPlan {
  installs: ReadonlyMap<string, string>
  replaces: ReadonlySet<string>
}

const DRY_RUN_LINE = /^\s*([+-])\s+([A-Za-z0-9][A-Za-z0-9._-]*)==(\S+)\s*$/

export function parseDryRun(output: string): DryRunPlan {
  const installs = new Map<string, string>()
  const replaces = new Set<string>()
  for (const raw of stripAnsi(output).split(/\r?\n/)) {
    const match = raw.match(DRY_RUN_LINE)
    if (!match) continue
    const name = normalizePackageName(match[2]!)
    if (match[1] === '+') installs.set(name, match[3]!)
    else replaces.add(name)
  }
  return { installs, replaces }
}

/** True when the override would leave an installed package outside the payload at a different
 *  version than core's own file would (comfy-cli brings a broad dependency set). Packages only
 *  the override adds are allowed: nothing ComfyUI already runs on changes. */
export function overrideChangesOthers(
  effective: DryRunPlan,
  core: DryRunPlan,
  pins: OverridePins
): boolean {
  const target = (plan: DryRunPlan, name: string): string | null =>
    plan.installs.get(name) ?? (plan.replaces.has(name) ? null : 'unchanged')
  const names = new Set([...effective.replaces, ...core.replaces])
  for (const name of names) {
    if (pins.has(name)) continue
    if (target(effective, name) !== target(core, name)) return true
  }
  return false
}

/** Per-install record of the last override that went in, for the start-failure latch. */
export interface AgentOverrideState {
  signature: string
  failures: number
  reverted: boolean
}

export function readOverrideState(installation: InstallationRecord): AgentOverrideState | null {
  const state = (installation as { agentRequirementsOverride?: unknown }).agentRequirementsOverride
  if (!state || typeof state !== 'object') return null
  const { signature, failures, reverted } = state as Record<string, unknown>
  if (
    typeof signature !== 'string' ||
    typeof failures !== 'number' ||
    typeof reverted !== 'boolean'
  )
    return null
  return { signature, failures, reverted }
}

/** True when this install already gave up on these pins; a different version is a fresh try. */
export function isRevertedFor(state: AgentOverrideState | null, pins: OverridePins): boolean {
  return state !== null && state.reverted && state.signature === overrideSignature(pins)
}

export type OverrideDecision =
  | { decision: 'applied'; pins: OverridePins }
  | { decision: 'refused'; reason: OverrideRefusal; pins?: OverridePins }
  | {
      decision: 'reverted'
      reason: 'install_failed' | 'start_failed'
      pins: OverridePins
      failures?: number
    }
  | { decision: 'version_mismatch'; pins: OverridePins; agentVersion: string }

export function reportOverrideDecision(installationId: string, d: OverrideDecision): void {
  try {
    const pins = d.pins ? overrideSignature(d.pins) : null
    telemetry.emit('comfy.desktop.agent_requirements_override', {
      installation_id: installationId,
      decision: d.decision,
      reason: 'reason' in d ? d.reason : null,
      pins,
      failures: 'failures' in d ? (d.failures ?? null) : null,
      agent_version: 'agentVersion' in d ? d.agentVersion : null
    })
  } catch {
    // Telemetry must never reach the launch.
  }
}

/**
 * Only `agent_error` and `health_check_failed` are failures. `agent_exited` is not (the agent's
 * own exit after a good start, or an agent stopped during a slow start), nor is
 * `package_missing` (core's import check), nor `permission_denied` (a declined prompt).
 */
export type AgentStartOutcome = 'started' | 'failed' | 'inconclusive'

/** Same grammar as the agent telemetry tap: a cross-repo contract with core's emitter. */
const AGENT_EVENT_LINE = /^\[agent-event\] ([a-z][a-z0-9_]*)((?: [a-z_]+=[^ =]+)*)$/

export function classifyAgentEvent(
  line: string
): { outcome: AgentStartOutcome } | { agentVersion: string } | null {
  const match = stripLogLevelPrefix(stripAnsi(line).trim()).match(AGENT_EVENT_LINE)
  if (!match) return null
  const fields = new Map(
    match[2]!
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((pair) => pair.split('=') as [string, string])
  )
  switch (match[1]) {
    case 'agent_starting': {
      const version = fields.get('agent_version')
      return version ? { agentVersion: version } : null
    }
    case 'agent_started':
      return { outcome: 'started' }
    case 'health_check_failed':
      return { outcome: 'failed' }
    case 'agent_error':
      return { outcome: fields.get('reason') === 'permission_denied' ? 'inconclusive' : 'failed' }
    default:
      return null
  }
}

/** Watch one launch's output for the agent's first start. Independent of the consent-gated
 *  telemetry tap, since this has to work without consent. Settles once per launch. */
export function createAgentStartWatcher(opts: {
  onOutcome: (outcome: AgentStartOutcome) => void
  onAgentVersion?: (version: string) => void
}): { ingest: (text: string, source: StreamSource) => void } {
  const buffer = createStreamLineBuffer()
  let settled = false
  return {
    ingest(text, source) {
      if (settled) return
      for (const line of buffer.append(source, text)) {
        const event = classifyAgentEvent(line)
        if (!event) continue
        if ('agentVersion' in event) {
          opts.onAgentVersion?.(event.agentVersion)
          continue
        }
        settled = true
        opts.onOutcome(event.outcome)
        return
      }
    }
  }
}

/** Fold one start outcome into the install's state; null when it decides nothing. `reverted`
 *  is true only on the failure that tips the count, so the revert is reported once. */
export function nextOverrideState(
  previous: AgentOverrideState | null,
  pins: OverridePins,
  outcome: AgentStartOutcome
): { state: AgentOverrideState; reverted: boolean } | null {
  if (outcome === 'inconclusive') return null
  const signature = overrideSignature(pins)
  const base = previous?.signature === signature ? previous.failures : 0
  const failures = outcome === 'started' ? 0 : base + 1
  const reverted = failures >= START_FAILURES_TO_REVERT
  return { state: { signature, failures, reverted }, reverted }
}
