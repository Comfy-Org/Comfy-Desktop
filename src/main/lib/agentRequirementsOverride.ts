/**
 * Temporary override of the agent's versions in core's `agent_requirements.txt`.
 *
 * Core pins the agent's packages exactly and moves them weekly. The agent campaign's payload
 * may carry `agent_requirements_override` (e.g. `{"comfy-agent": "0.2.3"}`) to ship a newer
 * version in between; the campaign layer hands the field over untouched and every rule about
 * it lives here. Removing the feature is deleting this module, its hook in
 * `agentRequirementsLaunch.ts` and the launch wiring: nothing else reads it.
 *
 * Going back is always "install core's file": core's lines for overridden packages are exact
 * pins (an override against any other line is refused), and `==` makes `uv pip install -r`
 * move an overridden version back. The install step runs on every agent launch, so a removed
 * or reverted override, or a fallback that did not finish, is repaired by the next launch
 * with no state of its own.
 */
import type { InstallationRecord } from '../installations'
import * as telemetry from './telemetry'
import { createStreamLineBuffer, stripAnsi, stripLogLevelPrefix } from './stderrTail'
import type { StreamSource } from './stderrTail'

/** The only packages a payload may name. Each must also already be in core's file. */
const OVERRIDABLE = new Set(['comfy-agent', 'comfy-cli', 'nodejs-wheel-binaries'])

/** PEP 440 public release, pre, post and dev segments only. No operator, local version,
 *  whitespace or separator can match, so nothing but a version reaches the requirements
 *  text: no URL, index, `--find-links`, marker or extra option. */
const EXACT_VERSION =
  /^\d{1,6}(?:\.\d{1,6}){0,3}(?:(?:a|b|rc)\d{1,6})?(?:\.post\d{1,6})?(?:\.dev\d{1,6})?$/

/** One requirement line naming a package, optionally `==`-pinned, optionally commented. */
const REQUIREMENT_LINE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:==\s*([^\s;#]+))?\s*(?:#.*)?$/
const LEADING_NAME = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/

/**
 * Consecutive failed starts of one overridden version before this install goes back to core's.
 *
 * Only a definite failure counts (see `classifyAgentEvent`): a slow start never does, since
 * core keeps waiting for it, and a session that ends first decides nothing. One retry absorbs a
 * one-off at the most fragile moment, the first start of a freshly installed binary, and a
 * second failure in a row of the same version is almost certainly the version. Reverting is
 * cheap, the user keeps core's agent; not reverting leaves the agent broken on every launch
 * until the operator pulls the field. Reasoned, not measured: the agent has no field
 * start-failure data yet.
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

/** Validate the raw payload field. All or nothing: one bad entry refuses the whole payload,
 *  rather than applying the part an operator got right. */
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

/**
 * Core's file with each pinned package's line replaced by `name==version`.
 *
 * Every other line stays exactly as core wrote it. A pinned package must appear exactly once,
 * as a plain `name==x` line: that is what keeps "go back to core's file" a real downgrade, and
 * what stops a payload from adding a package or rewriting a line with extras or markers.
 */
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

/**
 * True when the override would leave an already-installed package outside the payload at a
 * different version than core's own file would.
 *
 * comfy-cli, for one, brings a broad dependency set into ComfyUI's environment, and the
 * override exists precisely to bypass the review core's pins get. Packages only the override
 * pulls in are allowed: they are new, so nothing ComfyUI already runs on changes.
 */
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

/** True when this install already gave up on exactly these pins. A different version is a
 *  fresh try. */
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
 * Which way one agent start went, from core's `[agent-event]` lines.
 *
 * Only `agent_error` and `health_check_failed` are failures. `agent_exited` is not: core
 * prints it on every stop, including a user quitting during a slow start on macOS and Linux.
 * `package_missing` is core's import check, not the agent starting. `agent_error
 * reason=permission_denied` is the user declining an elevation prompt, which no revert fixes.
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

/**
 * Watch one launch's output for how the overridden agent's first start went.
 *
 * A control loop, deliberately independent of the consent-gated telemetry tap: it has to work
 * for users who never consented. Settles once per launch; a respawn's lines after that are
 * ignored, and a launch that ends with no verdict records nothing.
 */
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

/**
 * Fold one start outcome into the install's state. Null for an outcome that decides nothing.
 * `reverted` is true only on the failure that tips the count, so the revert is reported once.
 */
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
