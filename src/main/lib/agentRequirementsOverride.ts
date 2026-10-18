/** TEMPORARY: delete with its hook and launch wiring once the agent is on by default. */
import type { InstallationRecord } from '../installations'
import * as telemetry from './telemetry'
import { createStreamLineBuffer, stripAnsi } from './stderrTail'
import type { StreamSource } from './stderrTail'

export const FRONTEND_PACKAGE = 'comfyui-frontend-package'

/**
 * The frontend is pinned in ComfyUI's `requirements.txt`, not the agent's file, so a critical fix
 * published to PyPI can reach the agent cohort before ComfyUI's next pin.
 *
 * QA TIER: any of these may also be given as URL entries (`OVERRIDE_URL`), which point a QA
 * campaign at an unpublished build. Production campaigns pin published exact versions only.
 */
const OVERRIDABLE = new Set(['comfy-agent', 'comfy-cli', 'nodejs-wheel-binaries', FRONTEND_PACKAGE])

/**
 * PEP 440 public versions only, so no operator, URL, index, option or marker can get through. An
 * optional epoch (`1!2.3.4`) lets a pin sort above every version without one, which is epoch 0.
 */
const EXACT_VERSION =
  /^(?:\d{1,6}!)?\d{1,6}(?:\.\d{1,6}){0,3}(?:(?:a|b|rc)\d{1,6})?(?:\.post\d{1,6})?(?:\.dev\d{1,6})?$/

const REQUIREMENT_LINE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:==\s*([^\s;#]+))?\s*(?:#.*)?$/
/**
 * An override's URL entry, as text: an https wheel, so nothing builds at install. Printable ASCII
 * without `$` (pip and uv expand `${VAR}`), `;`, `\`, `#`, `?`, `%` or `..`. Where it may point is
 * `isAllowedWheelHost`.
 */
const OVERRIDE_URL = /^https:\/\/(?!.*\.\.)[\x21\x22\x26-\x3a\x3c-\x3e\x40-\x5b\x5d-\x7e]+\.whl$/
const TAILNET = 'fennec-typhon.ts.net'

/**
 * DO NOT MERGE, QA builds only: any path under Comfy-Org on GitHub, or any host on the Comfy tailnet.
 * Checked on the parsed URL, which must already be in normal form, so a lookalike host, userinfo or
 * case change can't pass and what is checked is what uv fetches.
 */
function isAllowedWheelHost(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.href !== url || parsed.username || parsed.password) return false
  const host = parsed.hostname
  if (host === 'github.com') return parsed.port === '' && parsed.pathname.startsWith('/Comfy-Org/')
  return host === TAILNET || host.endsWith(`.${TAILNET}`)
}
/** Marker expressions only: no `-` (so no option), `#`, `;`, `$`, `\`, newline or tab. */
const MARKER = /^[A-Za-z0-9_.,'" =<>!~()]+$/

/** A payload key: an allowlisted name, optionally with extras (`comfy-agent[go]`). */
const PAYLOAD_KEY = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[([^\]]*)\])?$/
/** A PEP 508 extra name, at most 64 characters, like every other field here bounded. */
const EXTRA = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/
const MAX_EXTRAS = 8

const AGENT_KEY = 'comfy-agent'
/**
 * The agent's key decorates the first line of core's file whose name is `comfy-agent` or starts
 * with `comfy-agent-`, so a renamed agent package (`comfy-agent-oss`) is still found but an
 * unrelated `comfy-agentx` is not. The name always comes from core's line: a pin supplies the
 * version and extras, never the package.
 */
const AGENT_LINE = /^comfy-agent(?:-|$)/

function pinKey(normalized: string): string {
  return AGENT_LINE.test(normalized) ? AGENT_KEY : normalized
}
const LEADING_NAME = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/
/** `name @ https://… ; marker`, the per-platform wheel form; captures the marker. uv reads `url;marker` as one URL. */
const URL_LINE = new RegExp(
  LEADING_NAME.source + String.raw`\s*@\s*https:\/\/[^\s;]+(?:\s+;([^#]*))?\s*(?:\s#.*)?$`
)

export const START_FAILURES_TO_REVERT = 2

export type OverrideRefusal =
  | 'not_object'
  | 'unknown_package'
  | 'bad_version'
  | 'bad_url'
  | 'bad_extra'
  | 'not_in_core_file'
  | 'unsupported_line'
  | 'not_newer'
  | 'check_failed'
  | 'core_first'

/**
 * An exact version, or the URL entries (`https://…[ ; marker]`, normalised) that replace the
 * package's lines; either may carry extras (installed as `name[go,x]==version` or `name[go] @ url`).
 */
export type OverridePin =
  | string
  | readonly string[]
  | { readonly version: string; readonly extras: readonly string[] }
  | { readonly urls: readonly string[]; readonly extras: readonly string[] }
export type OverridePins = ReadonlyMap<string, OverridePin>

/** The pin's exact version, or undefined for a URL pin. */
export function pinVersion(pin: OverridePin): string | undefined {
  if (typeof pin === 'string') return pin
  return 'version' in pin ? pin.version : undefined
}

function pinExtras(pin: OverridePin): string {
  if (typeof pin === 'string' || Array.isArray(pin)) return ''
  const { extras } = pin as { extras: readonly string[] }
  return extras.length ? `[${extras.join(',')}]` : ''
}

function pinUrls(pin: OverridePin): readonly string[] | undefined {
  if (Array.isArray(pin)) return pin as readonly string[]
  return typeof pin === 'object' && 'urls' in pin ? pin.urls : undefined
}

/** What follows the package name on the installed lines: `==1!2.0`, `[go]==1!2.0`, `[go] @ url`. */
export function pinSpecifier(pin: OverridePin): string {
  return pinLines('', pin).join(' ')
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
    let pin: OverridePin
    if (Array.isArray(version)) {
      const urls = version.map(normalizeOverrideUrl)
      if (urls.length === 0 || urls.includes(null)) return { kind: 'refused', reason: 'bad_url' }
      pin = urls as string[]
    } else if (typeof version !== 'string' || !EXACT_VERSION.test(version)) {
      return { kind: 'refused', reason: 'bad_version' }
    } else {
      pin = version
    }
    if (match![2] === undefined) {
      pins.set(normalized, pin)
      continue
    }
    const extras = parseExtras(match![2])
    if (extras === null) return { kind: 'refused', reason: 'bad_extra' }
    pins.set(normalized, typeof pin === 'string' ? { version: pin, extras } : { urls: pin, extras })
  }
  return { kind: 'pins', pins }
}

/** `url ; marker` or `url`, or null for anything else. */
function normalizeOverrideUrl(entry: unknown): string | null {
  // Refused outright rather than trimmed away: a line break or tab has no place in an entry.
  if (typeof entry !== 'string' || /[\r\n\t]/.test(entry)) return null
  const [url, marker, ...rest] = entry.split(';').map((part) => part.trim())
  if (rest.length > 0 || !OVERRIDE_URL.test(url!) || !isAllowedWheelHost(url!)) return null
  if (marker === undefined) return url!
  return MARKER.test(marker) ? `${url} ; ${marker}` : null
}

/** The requirement lines a pin puts in place of the package's own. */
function pinLines(name: string, pin: OverridePin): string[] {
  const urls = pinUrls(pin)
  if (urls) return urls.map((entry) => `${name}${pinExtras(pin)} @ ${entry}`)
  return [`${name}${pinExtras(pin)}==${pinVersion(pin)}`]
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
    .flatMap(([name, pin]) => pinLines(name, pin))
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
  // Per pin key: the package name of the line it decorates, and whether its lines so far are URL
  // lines, which may repeat (one per platform).
  const matched = new Map<string, { name: string; url: boolean }>()
  const out: string[] = []
  const keyOf = (line: string): string | undefined => {
    const name = line.match(LEADING_NAME)?.[1]
    return name && pinKey(normalizePackageName(name))
  }
  const agentKeys = new Set(coreText.split(/\r?\n/).map(keyOf))
  const fromMain = mainText.split(/\r?\n/).filter((line) => {
    const key = keyOf(line)
    return !!key && pins.has(key) && !agentKeys.has(key)
  })
  // Before the agent file's trailing newline, so the result still ends in one.
  const lines = coreText.split(/\r?\n/)
  const tail = lines.at(-1) === '' ? lines.splice(-1) : []
  for (const text of [...lines, ...fromMain, ...tail]) {
    const name = text.match(LEADING_NAME)?.[1]
    const normalized = name && normalizePackageName(name)
    const key = normalized ? pinKey(normalized) : undefined
    const pin = key ? pins.get(key) : undefined
    const prior = key ? matched.get(key) : undefined
    // Only the first comfy-agent* package is the agent's; a later, differently named one is left be.
    if (pin === undefined || (prior && prior.name !== normalized)) {
      out.push(text)
      continue
    }
    const url = text.match(URL_LINE)
    const marker = url?.[2]?.trim()
    const line = text.match(REQUIREMENT_LINE)
    const pinned = line?.[2]
    if (
      (!line && !url) ||
      (marker !== undefined && !MARKER.test(marker)) ||
      /\\\s*$/.test(text) ||
      (pinned !== undefined && !EXACT_VERSION.test(pinned)) ||
      (prior && !(url && prior.url))
    ) {
      return { kind: 'refused', reason: 'unsupported_line' }
    }
    // An exact pin must be newer than a line core pinned. A URL pin names a build, not a version, so
    // it goes over any line (QA tier), as an exact pin goes over a bare or URL line: the campaign decides.
    const version = pinVersion(pin)
    if (pinned !== undefined && version !== undefined && compareVersions(version, pinned) <= 0) {
      return { kind: 'refused', reason: 'not_newer' }
    }
    // An exact pin keeps each URL line's marker, so it lands only where core's file would install.
    if (url && version !== undefined) {
      out.push(`${name}${pinExtras(pin)}==${version}${marker ? ` ; ${marker}` : ''}`)
    } else if (!prior) out.push(...pinLines(name!, pin))
    matched.set(key!, { name: normalized!, url: !!url })
  }
  if (matched.size !== pins.size) return { kind: 'refused', reason: 'not_in_core_file' }
  return { kind: 'text', text: out.join('\n') }
}

function parseInstalled(pipListOutput: string): { name: string; version: string }[] | null {
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
    .find((name) => !!name && AGENT_LINE.test(name))
}

/**
 * Pins every installed package where it is, so an override that moves one falls back, except the
 * agent file's own: `comfy-cli`, `nodejs-wheel-binaries`, `comfy-agent`, and the comfy-agent*
 * package `coreText` (the agent's file) lists. Those are freed whether or not this override pins
 * them, since the install also takes core's lines for them and must be able to land on those.
 * Any other comfy-agent* package is held. The frontend is held too unless this override pins it.
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
    .map(({ name, version }) => `${name}==${version}`)
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

/** The pins over lines core left unversioned: core's file can't take those back. */
export function pinsOverBareLines(coreText: string, pins: OverridePins): OverridePins {
  const bare = coreText.split(/\r?\n/).map((line) => line.match(REQUIREMENT_LINE))
  return new Map(
    [...pins].filter(([name]) =>
      bare.some((line) => line && !line[2] && pinKey(normalizePackageName(line[1]!)) === name)
    )
  )
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
      reason: 'install_failed' | 'start_failed' | 'check_failed' | 'previously_failed'
      pins: OverridePins
      failures?: number
      /** The reverted pins core's file can't take back, whether or not they went in. */
      staysInstalled?: OverridePins
    }

export function reportOverrideDecision(installationId: string, d: OverrideDecision): void {
  try {
    const pins = d.pins ? overrideSignature(d.pins) : null
    telemetry.emit('comfy.desktop.agent_requirements_override', {
      installation_id: installationId,
      decision: d.decision,
      reason: 'reason' in d ? d.reason : null,
      pins,
      failures: 'failures' in d ? (d.failures ?? null) : null,
      stays_installed:
        'staysInstalled' in d && d.staysInstalled ? overrideSignature(d.staysInstalled) : null
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

/** ComfyUI's own `==` frontend version, or null when its `requirements.txt` pins none exactly. */
export function coreFrontendVersion(mainText: string): string | null {
  for (const line of mainText.split(/\r?\n/)) {
    const match = line.match(REQUIREMENT_LINE)
    if (!match || normalizePackageName(match[1]!) !== FRONTEND_PACKAGE) continue
    return match[2] !== undefined && EXACT_VERSION.test(match[2]) ? match[2] : null
  }
  return null
}

/** The frontend pin an applied override put in (a version, or its URL entries), recorded until
 *  ComfyUI's is back. */
export function readFrontendPin(installation: InstallationRecord): string | null {
  const state = installation.frontendVersionOverride
  if (!state || typeof state !== 'object') return null
  const { version } = state as Record<string, unknown>
  return typeof version === 'string' ? version : null
}
