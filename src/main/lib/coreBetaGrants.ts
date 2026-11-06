import semver from 'semver'
import { filterUnsupportedArgs } from './comfy-args'
import type { ComfyArgsSchema } from './comfy-args'
import { makeOpsFlag } from './opsFlag'
import type { FeatureFlagValue } from './telemetry'
import type { BetaArgView } from '../../types/ipc'

export const CORE_BETA_FEATURES_FLAG_KEY = 'desktop_core_beta_features'

export const CORE_BETA_GRANTABLE_ARGS = [
  '--enable-asset-hashing',
  '--disable-assets',
  '--enable-agent'
] as const

export const ASSETS_MIN_CORE_COMMIT = '7897b4ee3527847a155bc0921a44f90489548019'
const ASSETS_MIN_CORE_VERSION = '0.38.0'
const ASSETS_ARG = '--enable-assets'
const ASSETS_FORCE_OFF_ARG = '--disable-assets'

export type CoreBetaNotice = {
  readonly silent?: true
  readonly description?: string
}

type CoreBetaGrantBase = {
  readonly arg: string
  readonly notice?: CoreBetaNotice
}

export type CoreBetaVersionGrant = CoreBetaGrantBase & {
  readonly minCoreVersion: string
  readonly maxCoreVersion?: string
}

export type CoreCommitRange = readonly [lower: string, upper: string | null]

export type CoreBetaCommitGrant = CoreBetaGrantBase & {
  readonly commitRanges: readonly CoreCommitRange[]
}

export type CoreBetaGrant = CoreBetaVersionGrant | CoreBetaCommitGrant

export function isCommitGrant(grant: CoreBetaGrant): grant is CoreBetaCommitGrant {
  return 'commitRanges' in grant
}

const MAX_FLAGS = 32
const CORE_BETA_ARG_RE = /^--[a-z][a-z0-9-]+$/

const MAX_COMMIT_RANGES = 8

const FULL_SHA_RE = /^[0-9a-f]{40}$/i

const MAX_DESCRIPTION_LENGTH = 48

const PRINTABLE_DESCRIPTION = /^[^\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]+$/u

const OFF_VARIANTS = new Set(['control', 'off', 'false', 'disabled'])

function isEnabled(value: FeatureFlagValue | undefined): boolean {
  if (value === true) return true
  return typeof value === 'string' && !OFF_VARIANTS.has(value.toLowerCase())
}

function parseCoreVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return semver.valid(value.replace(/^v/, ''))
}

function parseCommitSha(value: unknown): string | null {
  if (typeof value !== 'string' || !FULL_SHA_RE.test(value)) return null
  return value.toLowerCase()
}

function parseCommitRanges(value: unknown): CoreCommitRange[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COMMIT_RANGES) return null
  const ranges: CoreCommitRange[] = []
  for (const range of value) {
    if (!Array.isArray(range) || range.length !== 2) return null
    const lower = parseCommitSha(range[0])
    if (lower === null) return null
    let upper: string | null = null
    if (range[1] !== null) {
      upper = parseCommitSha(range[1])
      if (upper === null) return null
    }
    ranges.push([lower, upper])
  }
  return ranges
}

function parseCoreBetaNotice(candidate: object): CoreBetaNotice | undefined {
  const notice: { silent?: true; description?: string } = {}

  if ('notice' in candidate && (candidate as { notice?: unknown }).notice === 'silent') {
    notice.silent = true
  }

  if ('description' in candidate) {
    const raw = (candidate as { description?: unknown }).description
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (
        trimmed.length > 0 &&
        trimmed.length <= MAX_DESCRIPTION_LENGTH &&
        PRINTABLE_DESCRIPTION.test(trimmed)
      ) {
        notice.description = trimmed
      }
    }
  }

  return notice.silent === undefined && notice.description === undefined ? undefined : notice
}

export function parseCoreBetaGrants(
  value: FeatureFlagValue | undefined,
  payload: unknown
): CoreBetaGrant[] {
  if (!isEnabled(value) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return []
  }
  const requested = 'flags' in payload ? payload.flags : undefined
  if (!Array.isArray(requested) || requested.length > MAX_FLAGS) return []

  const allowed = new Set(CORE_BETA_GRANTABLE_ARGS)
  const flags: CoreBetaGrant[] = []
  for (const candidate of requested) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    if (!('arg' in candidate) || typeof candidate.arg !== 'string') continue
    if (!CORE_BETA_ARG_RE.test(candidate.arg) || !allowed.has(candidate.arg)) continue

    const notice = parseCoreBetaNotice(candidate)

    if ('commit_ranges' in candidate) {
      if ('min_core_version' in candidate || 'max_core_version' in candidate) continue
      const commitRanges = parseCommitRanges(candidate.commit_ranges)
      if (commitRanges === null) continue
      flags.push({
        arg: candidate.arg,
        commitRanges,
        ...(notice === undefined ? {} : { notice })
      })
      continue
    }

    const minCoreVersion =
      'min_core_version' in candidate ? parseCoreVersion(candidate.min_core_version) : null
    if (minCoreVersion === null) continue

    let maxCoreVersion: string | undefined
    if ('max_core_version' in candidate) {
      const parsedMaxCoreVersion = parseCoreVersion(candidate.max_core_version)
      if (parsedMaxCoreVersion === null) continue
      maxCoreVersion = parsedMaxCoreVersion
    }

    flags.push({
      arg: candidate.arg,
      minCoreVersion,
      ...(maxCoreVersion === undefined ? {} : { maxCoreVersion }),
      ...(notice === undefined ? {} : { notice })
    })
  }
  const grantedArgs = new Set(flags.map((flag) => flag.arg))
  for (const { arg } of flags) {
    const opposite = oppositeArg(arg)
    if (opposite !== null && grantedArgs.has(opposite)) return []
  }
  return flags
}

export interface CoreVersionState {
  semver: string | null
  exact: boolean
  verified: boolean
  current: boolean
}

const ENABLE_PREFIX = '--enable-'
const DISABLE_PREFIX = '--disable-'

export function oppositeArg(arg: string): string | null {
  if (arg.startsWith(ENABLE_PREFIX)) return DISABLE_PREFIX + arg.slice(ENABLE_PREFIX.length)
  if (arg.startsWith(DISABLE_PREFIX)) return ENABLE_PREFIX + arg.slice(DISABLE_PREFIX.length)
  return null
}

export interface CoreCommitState {
  head: string | null
  ancestry: ReadonlyMap<string, boolean>
}

export const NO_CORE_COMMITS: CoreCommitState = { head: null, ancestry: new Map() }

export function commitGrantShas(
  flags: readonly CoreBetaGrant[],
  userArgs: readonly string[] = []
): string[] {
  const user = new Set(userArgs)
  const shas = new Set<string>()
  for (const flag of flags) {
    if (!isCommitGrant(flag) || flag.arg === ASSETS_FORCE_OFF_ARG) continue
    const opposite = oppositeArg(flag.arg)
    if (user.has(flag.arg) || (opposite !== null && user.has(opposite))) continue
    for (const [lower, upper] of flag.commitRanges) {
      shas.add(lower)
      if (upper !== null) shas.add(upper)
    }
  }
  return [...shas]
}

function commitRangeMatches(
  [lower, upper]: CoreCommitRange,
  ancestry: ReadonlyMap<string, boolean>
): boolean {
  if (ancestry.get(lower) !== true) return false
  return upper === null || ancestry.get(upper) === false
}

function formatCommitRange([lower, upper]: CoreCommitRange): string {
  return `${lower.slice(0, 12)}..${upper === null ? '' : upper.slice(0, 12)}`
}

function rangeShortfall(
  [lower, upper]: CoreCommitRange,
  ancestry: ReadonlyMap<string, boolean>
): string {
  const lowerState = ancestry.get(lower)
  if (lowerState !== true) {
    return `lower ${lower.slice(0, 12)} ${lowerState === false ? 'not contained' : 'unresolved'}`
  }
  return ancestry.get(upper!) === true
    ? `HEAD past upper ${upper!.slice(0, 12)}`
    : `upper ${upper!.slice(0, 12)} unresolved`
}

function commitShortfall(flag: CoreBetaCommitGrant, commits: CoreCommitState): string | null {
  if (flag.commitRanges.some((range) => commitRangeMatches(range, commits.ancestry))) return null
  if (commits.head === null) return 'no readable git HEAD to measure'
  return flag.commitRanges
    .map(
      (range) =>
        `commit range ${formatCommitRange(range)}: ${rangeShortfall(range, commits.ancestry)}`
    )
    .join(' | ')
}

function versionGateOpen(
  core: CoreVersionState,
  hasVersionGrants: boolean,
  trace: (line: string) => void
): boolean {
  const version = core.semver
  if (version === null) return false
  if (!core.current) {
    if (hasVersionGrants)
      trace(`[core-beta] refused: base ${version} from a record the checkout contradicts`)
    return false
  }
  if (!core.verified) {
    if (hasVersionGrants) trace(`[core-beta] refused: base ${version} not verified`)
    return false
  }
  return true
}

export function selectCoreBetaGrantArgs(
  flags: readonly CoreBetaGrant[],
  core: CoreVersionState,
  betaEnabled: boolean,
  userArgs: readonly string[],
  commits: CoreCommitState = NO_CORE_COMMITS,
  withheld?: string[],
  trace: (line: string) => void = console.log
): CoreBetaGrant[] {
  if (betaEnabled !== true) return []
  const version = core.semver
  const versionOpen = versionGateOpen(
    core,
    flags.some((flag) => !isCommitGrant(flag)),
    trace
  )
  const presentArgs = new Set(userArgs)
  const selected: CoreBetaGrant[] = []
  const shortfalls = new Map<string, string[]>()
  for (const [index, flag] of flags.entries()) {
    const { arg } = flag
    let shortfall: string | null
    if (isCommitGrant(flag)) {
      const ranges = flag.commitRanges.map(formatCommitRange).join(' | ')
      const head = commits.head === null ? 'none' : commits.head.slice(0, 12)
      shortfall = commitShortfall(flag, commits)
      trace(
        `[core-beta] commits ${arg}: ${ranges} head=${head} in-range=${shortfall === null ? 'yes' : 'no'}`
      )
    } else {
      if (versionOpen && version !== null) {
        const { minCoreVersion, maxCoreVersion } = flag
        const window =
          maxCoreVersion === undefined
            ? `>=${minCoreVersion}`
            : `>=${minCoreVersion} <${maxCoreVersion}`
        trace(`[core-beta] window ${arg}: ${window} version=${version} exact=${core.exact}`)
      }
      shortfall = versionShortfall(flag, core, versionOpen)
    }
    if (presentArgs.has(arg)) continue
    const opposite = oppositeArg(arg)
    if (opposite !== null && presentArgs.has(opposite)) continue
    if (shortfall !== null) {
      const entries = shortfalls.get(arg) ?? []
      entries.push(`entry ${index + 1}: ${shortfall}`)
      shortfalls.set(arg, entries)
      continue
    }
    presentArgs.add(arg)
    selected.push(flag)
  }
  if (withheld) reportWithheld(flags, userArgs, selected, shortfalls, withheld)
  return selected
}

function reportWithheld(
  flags: readonly CoreBetaGrant[],
  userArgs: readonly string[],
  selected: readonly CoreBetaGrant[],
  shortfalls: ReadonlyMap<string, readonly string[]>,
  withheld: string[]
): void {
  const user = new Set(userArgs)
  const granted = new Set(selected.map((flag) => flag.arg))
  for (const arg of new Set(flags.map((flag) => flag.arg))) {
    if (granted.has(arg)) continue
    const opposite = oppositeArg(arg)
    let reason: string
    if (user.has(arg)) reason = 'already in the launch args'
    else if (opposite !== null && user.has(opposite)) reason = `the launch args contain ${opposite}`
    else if (opposite !== null && granted.has(opposite))
      reason = `conflicts with granted ${opposite}`
    else reason = (shortfalls.get(arg) ?? []).join('; ') || 'no entry matched'
    withheld.push(`[core-beta] ${arg} withheld: ${reason}`)
  }
}

function versionShortfall(
  flag: CoreBetaVersionGrant,
  core: CoreVersionState,
  versionOpen: boolean
): string | null {
  const version = core.semver
  if (version === null) return 'core version unknown'
  if (!versionOpen) {
    return core.current
      ? `no ancestry-proven release (base ${version})`
      : 'checkout does not confirm the record'
  }
  if (!semver.gte(version, flag.minCoreVersion))
    return `version ${version} < min ${flag.minCoreVersion}`
  if (flag.maxCoreVersion !== undefined) {
    if (!core.exact) return `max ${flag.maxCoreVersion} needs an exact release tag`
    if (!semver.lt(version, flag.maxCoreVersion)) {
      return `version ${version} >= max ${flag.maxCoreVersion}`
    }
  }
  return null
}

export interface CoreBetaFacts {
  readonly grants: readonly CoreBetaGrant[]
  readonly betaEnabled: boolean
  readonly userArgs: readonly string[]
  readonly core: CoreVersionState
  readonly commits: CoreCommitState
  readonly schema: ComfyArgsSchema
}

export interface CoreBetaPlan {
  readonly applied: readonly CoreBetaGrant[]
  readonly droppedUnsupported: readonly string[]
  readonly withheld: readonly string[]
  readonly trace: readonly string[]
  readonly assetsArgs: readonly string[]
  readonly assetsRecord: string
}

const FORCED_OFF = 'forced off remotely'

const releaseAtAssetsFloor = ({ semver: version, verified, current }: CoreVersionState): boolean =>
  version !== null && verified && current && semver.gte(version, ASSETS_MIN_CORE_VERSION)

function assetsDecided(
  grants: readonly CoreBetaGrant[],
  userArgs: readonly string[],
  schema: ComfyArgsSchema
): string | null {
  if (userArgs.includes(ASSETS_ARG)) return 'already in the launch args'
  if (userArgs.includes(ASSETS_FORCE_OFF_ARG))
    return `the launch args contain ${ASSETS_FORCE_OFF_ARG}`
  if (grants.some((grant) => grant.arg === ASSETS_FORCE_OFF_ARG)) return FORCED_OFF
  if (!schema.knownFlags.has(ASSETS_ARG.slice(2))) return 'not supported by this core'
  return null
}

export function assetsFloorShas(
  grants: readonly CoreBetaGrant[],
  userArgs: readonly string[],
  schema: ComfyArgsSchema,
  core: CoreVersionState
): string[] {
  const needed = assetsDecided(grants, userArgs, schema) === null && !releaseAtAssetsFloor(core)
  return needed ? [ASSETS_MIN_CORE_COMMIT] : []
}

function assetsDecision(facts: CoreBetaFacts): Pick<CoreBetaPlan, 'assetsArgs' | 'assetsRecord'> {
  const { grants, userArgs, schema, core, commits } = facts
  let withheld = assetsDecided(grants, userArgs, schema)
  if (
    withheld === null &&
    !releaseAtAssetsFloor(core) &&
    !commitRangeMatches([ASSETS_MIN_CORE_COMMIT, null], commits.ancestry)
  ) {
    const where = `core ${commits.head?.slice(0, 12) ?? core.semver ?? 'unknown'}`
    const floor = ASSETS_MIN_CORE_COMMIT.slice(0, 12)
    withheld =
      commits.ancestry.get(ASSETS_MIN_CORE_COMMIT) === false
        ? `${where} does not contain ${floor}`
        : `${where} proves neither ${floor} nor a verified v${ASSETS_MIN_CORE_VERSION}+ release`
  }
  const assetsRecord = `[assets] ${ASSETS_ARG} ${withheld === null ? 'passed' : `withheld: ${withheld}`}`
  if (withheld === null) return { assetsArgs: [ASSETS_ARG], assetsRecord }
  const forceOff = withheld === FORCED_OFF && schema.knownFlags.has(ASSETS_FORCE_OFF_ARG.slice(2))
  return { assetsArgs: forceOff ? [ASSETS_FORCE_OFF_ARG] : [], assetsRecord }
}

export function planCoreBetaArgs(facts: CoreBetaFacts): CoreBetaPlan {
  const withheld: string[] = []
  const trace: string[] = []
  const selected = selectCoreBetaGrantArgs(
    facts.grants.filter((grant) => grant.arg !== ASSETS_FORCE_OFF_ARG),
    facts.core,
    facts.betaEnabled,
    facts.userArgs,
    facts.commits,
    withheld,
    (line) => trace.push(line)
  )
  const supported = new Set(
    filterUnsupportedArgs(
      selected.map((grant) => grant.arg),
      facts.schema
    )
  )
  return {
    applied: selected.filter((grant) => supported.has(grant.arg)),
    droppedUnsupported: selected
      .filter((grant) => !supported.has(grant.arg))
      .map((grant) => grant.arg),
    withheld,
    trace,
    ...assetsDecision(facts)
  }
}

export function toBetaArgView(grant: CoreBetaGrant): BetaArgView {
  return { arg: grant.arg, name: grant.notice?.description ?? null }
}

const flag = makeOpsFlag<CoreBetaGrant[]>({
  key: CORE_BETA_FEATURES_FLAG_KEY,
  fallback: [],
  parse: parseCoreBetaGrants,
  logLabel: 'core-beta',
  timeoutMs: 5000,
  persist: true
})

export const initCoreBetaGrants = flag.init

export const getCoreBetaGrantsAsync = flag.get

export const refreshCoreBetaGrants = flag.refresh

export const _resetForTest = flag._resetForTest
