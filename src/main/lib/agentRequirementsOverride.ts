import type { InstallationRecord } from '../installations'
import * as telemetry from './telemetry'
import { createStreamLineBuffer, stripAnsi } from './stderrTail'
import type { StreamSource } from './stderrTail'

export const FRONTEND_PACKAGE = 'comfyui-frontend-package'

const AGENT_GO = 'comfy-agent-go'

const OVERRIDABLE = new Set([
  'comfy-agent',
  'comfy-cli',
  'nodejs-wheel-binaries',
  FRONTEND_PACKAGE,
  AGENT_GO
])

const EXACT_VERSION =
  /^(?:\d{1,6}!)?\d{1,6}(?:\.\d{1,6}){0,3}(?:(?:a|b|rc)\d{1,6})?(?:\.post\d{1,6})?(?:\.dev\d{1,6})?$/

const REQUIREMENT_LINE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:==\s*([^\s;#]+))?\s*(?:#.*)?$/

const PAYLOAD_KEY = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[([^\]]*)\])?$/
const EXTRA = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/
const MAX_EXTRAS = 8

const AGENT_KEY = 'comfy-agent'
const AGENT_LINE = /^comfy-agent(?:-|$)/

function isAgentLine(normalized: string): boolean {
  return normalized !== AGENT_GO && AGENT_LINE.test(normalized)
}

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

export type OverridePin = string | { readonly version: string; readonly extras: readonly string[] }
export type OverridePins = ReadonlyMap<string, OverridePin>

export function pinVersion(pin: OverridePin): string {
  return typeof pin === 'string' ? pin : pin.version
}

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

function parseExtras(text: string): string[] | null {
  const extras = text.split(',').map((extra) => extra.replace(/^ +| +$/g, ''))
  if (extras.length > MAX_EXTRAS || !extras.every((extra) => EXTRA.test(extra))) return null
  return [...new Set(extras.map(normalizePackageName))].sort()
}

const VERSION_PARTS = /^(?:(\d+)!)?([\d.]+)(?:(a|b|rc)(\d+))?(?:\.post(\d+))?(?:\.dev(\d+))?$/
const PRE_RANK = { a: 0, b: 1, rc: 2 } as const

function versionKey(version: string): number[] {
  const [, epoch, release, pre, preNum, post, dev] = version.match(VERSION_PARTS)!
  const parts = release!.split('.').map(Number)
  while (parts.length < 4) parts.push(0)
  const preRank = pre ? PRE_RANK[pre as keyof typeof PRE_RANK] : dev && !post ? -1 : 3
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

export function effectiveAgentRequirements(
  coreText: string,
  pins: OverridePins,
  mainText = ''
): { kind: 'text'; text: string } | { kind: 'refused'; reason: OverrideRefusal } {
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
  lines.splice(lines.at(-1) === '' ? -1 : lines.length, 0, ...appended)
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i]!.match(LEADING_NAME)?.[1]
    if (!name) continue
    const normalized = normalizePackageName(name)
    const key = pinKey(normalized)
    const pin = pins.get(key)
    if (pin === undefined) continue
    if (matched.has(key) && matched.get(key) !== normalized) continue
    const line = lines[i]!.match(REQUIREMENT_LINE)
    const pinned = line?.[2]
    if (!line || (pinned !== undefined && !EXACT_VERSION.test(pinned)) || matched.has(key)) {
      return { kind: 'refused', reason: 'unsupported_line' }
    }
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

function agentPackage(coreText: string): string | undefined {
  return coreText
    .split(/\r?\n/)
    .map((line) => line.match(LEADING_NAME)?.[1])
    .map((name) => name && normalizePackageName(name))
    .find((name) => !!name && isAgentLine(name))
}

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
  if (agent === undefined || !EXACT_VERSION.test(agent)) return null
  return compareVersions(pinVersion(go), agent) < 0 ? { name, go: pinVersion(go), agent } : null
}

export interface AgentOverrideState {
  signature: string
  failures: number
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

interface Kept {
  kept?: string
}

export type OverrideDecision =
  | { decision: 'applied'; pins: OverridePins }
  | ({ decision: 'refused'; reason: OverrideRefusal; pins?: OverridePins } & Kept)
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
      staysInstalled?: OverridePins
    } & Kept)
  | { decision: 'kept_installed'; reason: 'no_answer'; pins?: undefined; kept: string }

const PLACEHOLDER_VERSION = /^0\.0\.0(?!\d)/
const PINNED_LINE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*==\s*([^\s;#]+)/

function failedPin(state: AgentOverrideState | null, pattern: RegExp): string | undefined {
  if (!state || (state.startFailures ?? state.failures) === 0) return undefined
  return state.signature.match(pattern)?.[1]
}

const SIGNATURE_AGENT = /(?:^|,)comfy-agent(?:\[[^\]]*\])?==([^,]+)/
const SIGNATURE_AGENT_GO = /(?:^|,)comfy-agent-go==([^,]+)/

function sameVersion(a: string, b: string): boolean {
  return EXACT_VERSION.test(a) && EXACT_VERSION.test(b) ? compareVersions(a, b) === 0 : a === b
}

export function corePinsPlaceholderAgent(coreText: string): boolean {
  const name = agentPackage(coreText)
  return coreText.split(/\r?\n/).some((line) => {
    const match = line.match(PINNED_LINE)
    return (
      !!match && normalizePackageName(match[1]!) === name && PLACEHOLDER_VERSION.test(match[2]!)
    )
  })
}

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
  const runsGo =
    go !== undefined &&
    (!EXACT_VERSION.test(go) ||
      !agentGoBehindAgent(new Map([[AGENT_GO, go]]), coreText, pipListOutput))
  if (failedGo !== undefined && runsGo && sameVersion(go, failedGo)) return null
  return `${name}==${version}`
}

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
  } catch {}
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

export type AgentStartOutcome = 'started' | 'failed' | 'inconclusive'

const AGENT_EVENT_LINE = /^\[agent-event\] ([a-z][a-z0-9_]*)((?: [a-z_]+=[^ =]+)*)$/
const RECORD_TAG = '[agent-event] '
const AGENT_OUTPUT_TAG = '[comfy-agent] '

export function classifyAgentEvent(line: string): AgentStartOutcome | null {
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

export function coreFrontendVersion(mainText: string): string | null {
  for (const line of mainText.split(/\r?\n/)) {
    const match = line.match(REQUIREMENT_LINE)
    if (!match || normalizePackageName(match[1]!) !== FRONTEND_PACKAGE) continue
    return match[2] !== undefined && EXACT_VERSION.test(match[2]) ? match[2] : null
  }
  return null
}

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
  } catch {}
}
