/** TEMPORARY: delete with its hook and launch wiring once the agent is on by default. */
import type { InstallationRecord } from '../installations'
import * as telemetry from './telemetry'
import { createStreamLineBuffer, stripAnsi } from './stderrTail'
import type { StreamSource } from './stderrTail'

export const FRONTEND_PACKAGE = 'comfyui-frontend-package'

const AGENT_GO = 'comfy-agent-go'

/**
 * The frontend is pinned in ComfyUI's `requirements.txt`, not the agent's file, so a critical fix
 * published to PyPI can reach the agent cohort before ComfyUI's next pin. `comfy-agent-go` is in
 * neither file, so its pin is added as a line of its own. Exact versions only.
 */
const OVERRIDABLE = new Set([
  'comfy-agent',
  'comfy-cli',
  'nodejs-wheel-binaries',
  FRONTEND_PACKAGE,
  AGENT_GO
])

/**
 * PEP 440 public versions only, so no operator, URL, index, option or marker can get through. An
 * optional epoch (`1!2.3.4`) lets a pin sort above every version without one, which is epoch 0.
 */
const EXACT_VERSION =
  /^(?:\d{1,6}!)?\d{1,6}(?:\.\d{1,6}){0,3}(?:(?:a|b|rc)\d{1,6})?(?:\.post\d{1,6})?(?:\.dev\d{1,6})?$/

const REQUIREMENT_LINE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:==\s*([^\s;#]+))?\s*(?:#.*)?$/

/** A payload key: an allowlisted name, optionally with extras (`comfy-agent[go]`). */
const PAYLOAD_KEY = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[([^\]]*)\])?$/
/** A PEP 508 extra name, at most 64 characters, like every other field here bounded. */
const EXTRA = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/
const MAX_EXTRAS = 8

const AGENT_KEY = 'comfy-agent'
/**
 * The agent's key decorates the first line of core's file whose name is `comfy-agent` or starts
 * with `comfy-agent-` (other than the Go carrier, `comfy-agent-go`), so a renamed agent package
 * (`comfy-agent-oss`) is still found but an unrelated `comfy-agentx` is not. The name always comes
 * from core's line: a pin supplies the version and extras, never the package.
 */
const AGENT_LINE = /^comfy-agent(?:-|$)/

function isAgentLine(normalized: string): boolean {
  return normalized !== AGENT_GO && AGENT_LINE.test(normalized)
}

/**
 * A Go pin without an agent pin leaves the installed agent where it is: core's agent line can be a
 * placeholder (`0.0.0.dev0`) that would replace a working agent.
 */
function holdsAgent(pins: OverridePins): boolean {
  return pins.has(AGENT_GO) && !pins.has(AGENT_KEY)
}

function pinKey(normalized: string): string {
  return isAgentLine(normalized) ? AGENT_KEY : normalized
}
const LEADING_NAME = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/

export const START_FAILURES_TO_REVERT = 2

export type OverrideRefusal =
  | 'not_object'
  | 'unknown_package'
  | 'bad_version'
  | 'bad_extra'
  | 'not_in_core_file'
  | 'unsupported_line'
  | 'not_newer'
  | 'check_failed'
  | 'core_first'

/** An exact version, or a version with extras (installed as `name[go,x]==version`). */
export type OverridePin = string | { readonly version: string; readonly extras: readonly string[] }
export type OverridePins = ReadonlyMap<string, OverridePin>

export function pinVersion(pin: OverridePin): string {
  return typeof pin === 'string' ? pin : pin.version
}

/** What follows the package name on the installed line: `==1!2.0`, or `[go]==1!2.0`. */
export function pinSpecifier(pin: OverridePin): string {
  return typeof pin === 'string' ? `==${pin}` : `[${pin.extras.join(',')}]==${pin.version}`
}

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
  const pins = new Map<string, OverridePin>()
  for (const [key, version] of entries) {
    const match = key.match(PAYLOAD_KEY)
    const normalized = match ? normalizePackageName(match[1]!) : ''
    if (!OVERRIDABLE.has(normalized) || pins.has(normalized)) {
      return { kind: 'refused', reason: 'unknown_package' }
    }
    if (typeof version !== 'string' || !EXACT_VERSION.test(version)) {
      return { kind: 'refused', reason: 'bad_version' }
    }
    if (match![2] === undefined) {
      pins.set(normalized, version)
      continue
    }
    const extras = parseExtras(match![2])
    if (extras === null) return { kind: 'refused', reason: 'bad_extra' }
    pins.set(normalized, { version, extras })
  }
  return { kind: 'pins', pins }
}

/** Comma-separated PEP 508 extra names, canonicalised and sorted, or null for anything else. */
function parseExtras(text: string): string[] | null {
  // Spaces only: a trim would also take a newline or tab, which has no place in the line.
  const extras = text.split(',').map((extra) => extra.replace(/^ +| +$/g, ''))
  if (extras.length > MAX_EXTRAS || !extras.every((extra) => EXTRA.test(extra))) return null
  return [...new Set(extras.map(normalizePackageName))].sort()
}

const VERSION_PARTS = /^(?:(\d+)!)?([\d.]+)(?:(a|b|rc)(\d+))?(?:\.post(\d+))?(?:\.dev(\d+))?$/
const PRE_RANK = { a: 0, b: 1, rc: 2 } as const

/** PEP 440 order for the versions EXACT_VERSION admits (`packaging`'s comparison key). */
function versionKey(version: string): number[] {
  const [, epoch, release, pre, preNum, post, dev] = version.match(VERSION_PARTS)!
  const parts = release!.split('.').map(Number)
  while (parts.length < 4) parts.push(0)
  // A bare X.devN sorts before X's pre-releases; a final release after them.
  const preRank = pre ? PRE_RANK[pre as keyof typeof PRE_RANK] : dev && !post ? -1 : 3
  // The epoch outranks everything after it: 1!0.1 is newer than 9.9.
  return [
    epoch === undefined ? 0 : Number(epoch),
    ...parts,
    preRank,
    pre ? Number(preNum) : 0,
    post === undefined ? -1 : Number(post),
    dev === undefined ? Infinity : Number(dev)
  ]
}

export function compareVersions(a: string, b: string): number {
  const ka = versionKey(a)
  const kb = versionKey(b)
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! < kb[i]! ? -1 : 1
  return 0
}

export function overrideSignature(pins: OverridePins): string {
  return [...pins]
    .map(([name, pin]) => `${name}${pinSpecifier(pin)}`)
    .sort()
    .join(',')
}

/**
 * `mainText` is ComfyUI's `requirements.txt`: a pinned package the agent's file doesn't name is
 * taken from there under the same rules, and its pinned line appended.
 */
export function effectiveAgentRequirements(
  coreText: string,
  pins: OverridePins,
  mainText = ''
): { kind: 'text'; text: string } | { kind: 'refused'; reason: OverrideRefusal } {
  // Per pin key, the package name of the line it decorates.
  const matched = new Map<string, string>()
  const held = holdsAgent(pins) ? agentPackage(coreText) : undefined
  const lines = coreText.split(/\r?\n/).filter((line) => {
    const name = line.match(LEADING_NAME)?.[1]
    return !name || normalizePackageName(name) !== held
  })
  const keyOf = (line: string): string | undefined => {
    const name = line.match(LEADING_NAME)?.[1]
    return name && pinKey(normalizePackageName(name))
  }
  const agentKeys = new Set(lines.map(keyOf))
  const appended = mainText.split(/\r?\n/).filter((line) => {
    const key = keyOf(line)
    return !!key && pins.has(key) && !agentKeys.has(key)
  })
  if (pins.has(AGENT_GO)) appended.push(AGENT_GO)
  // Before the agent file's trailing newline, so the result still ends in one.
  lines.splice(lines.at(-1) === '' ? -1 : lines.length, 0, ...appended)
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i]!.match(LEADING_NAME)?.[1]
    if (!name) continue
    const normalized = normalizePackageName(name)
    const key = pinKey(normalized)
    const pin = pins.get(key)
    if (pin === undefined) continue
    // Only the first comfy-agent* package is the agent's; a later, differently named one is left be.
    if (matched.has(key) && matched.get(key) !== normalized) continue
    const line = lines[i]!.match(REQUIREMENT_LINE)
    const pinned = line?.[2]
    if (!line || (pinned !== undefined && !EXACT_VERSION.test(pinned)) || matched.has(key)) {
      return { kind: 'refused', reason: 'unsupported_line' }
    }
    // A bare line takes any exact pin, older ones included: core's file can't downgrade it, the campaign can.
    if (pinned !== undefined && compareVersions(pinVersion(pin), pinned) <= 0) {
      return { kind: 'refused', reason: 'not_newer' }
    }
    matched.set(key, normalized)
    lines[i] = `${name}${pinSpecifier(pin)}`
  }
  if (matched.size !== pins.size) return { kind: 'refused', reason: 'not_in_core_file' }
  return { kind: 'text', text: lines.join('\n') }
}

export function parseInstalled(pipListOutput: string): { name: string; version: string }[] | null {
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
  const packages: { name: string; version: string }[] = []
  for (const entry of installed) {
    const { name, version } = (entry ?? {}) as { name?: unknown; version?: unknown }
    if (typeof name !== 'string' || typeof version !== 'string') return null
    packages.push({ name, version })
  }
  return packages
}

/** The name of the first comfy-agent* package core's file lists: the one an agent pin decorates. */
function agentPackage(coreText: string): string | undefined {
  return coreText
    .split(/\r?\n/)
    .map((line) => line.match(LEADING_NAME)?.[1])
    .map((name) => name && normalizePackageName(name))
    .find((name) => !!name && isAgentLine(name))
}

/**
 * Holds every installed package at or above its version, so an override that would move one down
 * falls back. A local build (`+cpu`) stays exact: uv refuses `>=` on one, and the prefetch drops
 * exactly those `==` lines. The agent file's own are exempt: `comfy-cli`, `nodejs-wheel-binaries`,
 * `comfy-agent`, and the comfy-agent*
 * package `coreText` (the agent's file) lists. Those are freed whether or not this override pins
 * them, since the install also takes core's lines for them and must be able to land on those.
 * `comfy-agent-go` is among them: the agent's extras pin it to the agent's exact version, so
 * holding it would block every agent upgrade. Any other comfy-agent* package is held. The
 * frontend is held too unless this override pins it.
 */
export function installedConstraints(
  pipListOutput: string,
  pins: OverridePins = new Map(),
  coreText = ''
): string | null {
  const installed = parseInstalled(pipListOutput)
  if (!installed) return null
  const agent = agentPackage(coreText)
  const free = (name: string): boolean =>
    name === FRONTEND_PACKAGE ? pins.has(name) : OVERRIDABLE.has(name) || name === agent
  const lines = installed
    .filter(({ name }) => !free(normalizePackageName(name)))
    .map(({ name, version }) => `${name}${version.includes('+') ? '==' : '>='}${version}`)
  return lines.join('\n') + '\n'
}

/**
 * False until every package core's file names is installed: on a fresh install, core's goes first.
 * Marker, URL and path lines are skipped: uv may rightly never install them here, or they name no
 * package to look for, either of which would defer forever.
 */
export function coreFileInstalled(coreText: string, pipListOutput: string): boolean {
  const installed = new Set(
    (parseInstalled(pipListOutput) ?? []).map(({ name }) => normalizePackageName(name))
  )
  return coreText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s#.*$/, ''))
    .map((line) => (/[;/\\]/.test(line) ? undefined : line.match(LEADING_NAME)?.[1]))
    .every((name) => name === undefined || installed.has(normalizePackageName(name)))
}

/**
 * The pins over lines core left unversioned, or over no line at all (an added `comfy-agent-go`):
 * core's file can't take those back.
 */
export function pinsOverBareLines(coreText: string, pins: OverridePins): OverridePins {
  const bare = coreText.split(/\r?\n/).map((line) => line.match(REQUIREMENT_LINE))
  return new Map(
    [...pins].filter(
      ([name]) =>
        name === AGENT_GO ||
        bare.some((line) => line && !line[2] && pinKey(normalizePackageName(line[1]!)) === name)
    )
  )
}

/**
 * The agent runs its Go carrier only when the carrier is at least its own version, and otherwise
 * falls back to its bundled agent, saying so only in its own output. Returns the agent's package
 * and both versions when a `comfy-agent-go` pin is older than the agent this override leaves: its
 * pin, else the installed one, which a Go pin alone holds where it is.
 */
export function agentGoBehindAgent(
  pins: OverridePins,
  coreText: string,
  pipListOutput: string
): { name: string; go: string; agent: string } | null {
  const go = pins.get(AGENT_GO)
  if (go === undefined) return null
  const agentPin = pins.get(AGENT_KEY)
  const name = agentPackage(coreText) ?? AGENT_KEY
  const agent =
    agentPin !== undefined
      ? pinVersion(agentPin)
      : parseInstalled(pipListOutput)?.find((p) => normalizePackageName(p.name) === name)?.version
  // An installed version can carry a local label (`+cu`) this comparison does not order.
  if (agent === undefined || !EXACT_VERSION.test(agent)) return null
  return compareVersions(pinVersion(go), agent) < 0 ? { name, go: pinVersion(go), agent } : null
}

export interface AgentOverrideState {
  signature: string
  failures: number
  /** The failures that were the agent failing to start, not an install or check of the whole
   *  override. Absent on a record from before it was kept. */
  startFailures?: number
}

export function readOverrideState(installation: InstallationRecord): AgentOverrideState | null {
  const state = installation.agentRequirementsOverride
  if (!state || typeof state !== 'object') return null
  const { signature, failures, startFailures } = state as Record<string, unknown>
  if (typeof signature !== 'string' || typeof failures !== 'number') return null
  return { signature, failures, ...(typeof startFailures === 'number' && { startFailures }) }
}

export function isRevertedFor(state: AgentOverrideState | null, pins: OverridePins): boolean {
  return (
    state !== null &&
    state.failures >= START_FAILURES_TO_REVERT &&
    state.signature === overrideSignature(pins)
  )
}

export interface InstallReport {
  outcome: 'exited' | 'timed_out' | 'abandoned' | 'spawn_error' | 'cancelled'
  exitCode: number | null
  elapsedMs: number
  budgetMs: number
  errorTail: string | null
}

/** The installed agent (`name==version`) a launch kept rather than fall back to the placeholder. */
interface Kept {
  kept?: string
}

export type OverrideDecision =
  | { decision: 'applied'; pins: OverridePins }
  | ({ decision: 'refused'; reason: OverrideRefusal; pins?: OverridePins } & Kept)
  /** Not in uv's cache yet: a background download fetches it for a later launch. Never counted. */
  | ({
      decision: 'deferred'
      reason: 'not_cached'
      pins: OverridePins
      install?: InstallReport
    } & Kept)
  | ({
      decision: 'reverted'
      reason: 'install_failed' | 'start_failed' | 'check_failed' | 'previously_failed'
      pins: OverridePins
      install?: InstallReport
      failures?: number
      /** The reverted pins core's file can't take back, whether or not they went in. */
      staysInstalled?: OverridePins
    } & Kept)
  /** A member's campaign flag gave no answer in time, so the launch has no override to try. */
  | { decision: 'kept_installed'; reason: 'no_answer'; pins?: undefined; kept: string }

const PLACEHOLDER_VERSION = /^0\.0\.0(?!\d)/
/** A `name==version` line, extras allowed: core's agent line can carry them. */
const PINNED_LINE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*==\s*([^\s;#]+)/

/**
 * The agent version of an override that failed to start, if any. An install or check failure is
 * the whole override's, so it says nothing about an agent at that version that is already in.
 */
function failedPin(state: AgentOverrideState | null, pattern: RegExp): string | undefined {
  if (!state || (state.startFailures ?? state.failures) === 0) return undefined
  return state.signature.match(pattern)?.[1]
}

const SIGNATURE_AGENT = /(?:^|,)comfy-agent(?:\[[^\]]*\])?==([^,]+)/
/** The Go carrier stays installed after a failed override (core's file can't take it back), and an
 *  agent no newer than it selects it again, so a start-failed carrier disqualifies that agent. */
const SIGNATURE_AGENT_GO = /(?:^|,)comfy-agent-go==([^,]+)/

function sameVersion(a: string, b: string): boolean {
  return EXACT_VERSION.test(a) && EXACT_VERSION.test(b) ? compareVersions(a, b) === 0 : a === b
}

/** Whether core's file pins its agent package (whatever its name) at the placeholder. */
export function corePinsPlaceholderAgent(coreText: string): boolean {
  const name = agentPackage(coreText)
  return coreText.split(/\r?\n/).some((line) => {
    const match = line.match(PINNED_LINE)
    return (
      !!match && normalizePackageName(match[1]!) === name && PLACEHOLDER_VERSION.test(match[2]!)
    )
  })
}

/**
 * The installed agent worth keeping when an override can't apply: the package core's file names
 * for the agent, at a real version rather than the placeholder, and not the version a recorded
 * override has seen fail. `name==version`, or null.
 */
export function keepableAgent(
  coreText: string,
  pipListOutput: string,
  state: AgentOverrideState | null
): string | null {
  const name = agentPackage(coreText)
  if (name === undefined) return null
  const installed = parseInstalled(pipListOutput) ?? []
  const version = installed.find((p) => normalizePackageName(p.name) === name)?.version
  if (version === undefined || PLACEHOLDER_VERSION.test(version)) return null
  const failed = failedPin(state, SIGNATURE_AGENT)
  if (failed !== undefined && sameVersion(version, failed)) return null
  const failedGo = failedPin(state, SIGNATURE_AGENT_GO)
  const go = installed.find((p) => normalizePackageName(p.name) === AGENT_GO)?.version
  // An installed carrier with a local label (`+cu`) can't be ordered: assume the agent may run it.
  const runsGo =
    go !== undefined &&
    (!EXACT_VERSION.test(go) ||
      !agentGoBehindAgent(new Map([[AGENT_GO, go]]), coreText, pipListOutput))
  if (failedGo !== undefined && runsGo && sameVersion(go, failedGo)) return null
  return `${name}==${version}`
}

/** Which index uv was pointed at, never the URL itself. */
export type IndexKind = 'pypi' | 'cn_mirror' | 'custom'

export function indexKind(mirrors: {
  pypiMirror?: string
  useChineseMirrors?: boolean
}): IndexKind {
  if (mirrors.pypiMirror?.trim()) return 'custom'
  return mirrors.useChineseMirrors ? 'cn_mirror' : 'pypi'
}

export function reportOverrideDecision(
  installationId: string,
  d: OverrideDecision,
  index: IndexKind | null = null
): void {
  try {
    const pins = d.pins ? overrideSignature(d.pins) : null
    const install = 'install' in d ? d.install : undefined
    const kept = 'kept' in d ? (d.kept ?? null) : null
    // One event per decision: a kept agent rides on the original decision as `kept_agent`.
    telemetry.emit('comfy.desktop.agent_requirements_override', {
      installation_id: installationId,
      decision: d.decision,
      reason: 'reason' in d ? d.reason : null,
      pins,
      failures: 'failures' in d ? (d.failures ?? null) : null,
      stays_installed:
        'staysInstalled' in d && d.staysInstalled ? overrideSignature(d.staysInstalled) : null,
      install_outcome: install?.outcome ?? null,
      exit_code: install?.exitCode ?? null,
      elapsed_ms: install?.elapsedMs ?? null,
      budget_ms: install?.budgetMs ?? null,
      error_tail: install?.errorTail ?? null,
      kept_agent: kept,
      index
    })
  } catch {
    // Telemetry must never reach the launch.
  }
}

export function reportAgentCoreFailure(
  installationId: string,
  r: InstallReport,
  index: IndexKind
): void {
  try {
    telemetry.emit('comfy.desktop.agent_requirements_core', {
      installation_id: installationId,
      install_outcome: r.outcome,
      exit_code: r.exitCode,
      elapsed_ms: r.elapsedMs,
      budget_ms: r.budgetMs,
      error_tail: r.errorTail,
      index
    })
  } catch {}
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
  outcome: AgentStartOutcome,
  /** False for an install or check failure of the override, counted toward retiring it alone. */
  agentStart = true
): { state: AgentOverrideState; reverted: boolean } | null {
  if (outcome === 'inconclusive') return null
  const signature = overrideSignature(pins)
  const same = previous?.signature === signature
  const base = same ? previous.failures : 0
  const failures = outcome === 'started' ? 0 : base + 1
  const startBase = same ? (previous.startFailures ?? previous.failures) : 0
  const startFailures = outcome === 'started' ? 0 : startBase + (agentStart ? 1 : 0)
  return {
    state: { signature, failures, startFailures },
    reverted: failures === START_FAILURES_TO_REVERT
  }
}

/** ComfyUI's own `==` frontend version, or null when its `requirements.txt` pins none exactly. */
export function coreFrontendVersion(mainText: string): string | null {
  for (const line of mainText.split(/\r?\n/)) {
    const match = line.match(REQUIREMENT_LINE)
    if (!match || normalizePackageName(match[1]!) !== FRONTEND_PACKAGE) continue
    return match[2] !== undefined && EXACT_VERSION.test(match[2]) ? match[2] : null
  }
  return null
}

/** The frontend version an applied override put in, recorded until ComfyUI's is back. */
export function readFrontendPin(installation: InstallationRecord): string | null {
  const state = installation.frontendVersionOverride
  if (!state || typeof state !== 'object') return null
  const { version } = state as Record<string, unknown>
  return typeof version === 'string' ? version : null
}

export interface PrefetchReport {
  outcome:
    | 'completed'
    | 'nothing_missing'
    | 'resolve_failed'
    | 'not_served'
    | 'unreachable'
    | 'list_failed'
    | 'download_failed'
    | 'timed_out'
    | 'abandoned'
    | 'spawn_error'
    | 'cancelled'
  exitCode: number | null
  elapsedMs: number
  downloadsStarted: number
  downloadsFinished: number
  errorTail: string | null
  uvVersion: string | null
}

export function reportAgentPrefetch(
  installationId: string,
  signature: string,
  index: IndexKind,
  r: PrefetchReport
): void {
  try {
    telemetry.emit('comfy.desktop.agent_requirements_prefetch', {
      installation_id: installationId,
      target: signature === 'core' ? 'core' : 'override',
      pins: signature === 'core' ? null : signature,
      install_outcome: r.outcome,
      exit_code: r.exitCode,
      elapsed_ms: r.elapsedMs,
      downloads_started: r.downloadsStarted,
      downloads_finished: r.downloadsFinished,
      error_tail: r.errorTail,
      index,
      uv_version: r.uvVersion
    })
  } catch {
    // Telemetry must never reach the launch.
  }
}
