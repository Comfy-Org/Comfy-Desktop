/**
 * PostHog-controlled rollout of allowlisted Core args to users who are NOT in the beta.
 *
 * A separate key from `coreBetaGrants.ts` on purpose. Its percentage, its kill switch and its
 * payload are its own, and a Desktop that predates this module never fetches it, so no older
 * build can apply it under rules it does not know. The cohorts are disjoint: a launch with beta
 * features on is never selected here, and stays under the beta key's controls.
 *
 * Any arg in `POSTHOG_CONTROLLED_ARGS` may be granted, one grant object per arg. Everything fails
 * closed: one malformed field refuses the whole payload, and every gate refuses on absence (an
 * unresolved commit, an unverified version, an unknown toggle). Gates that exist only here:
 *
 *   - Blockers belong to an ARG and are ANDed over its version windows rather than ORed in with
 *     them. Windows choose where the arg may run; a blocker that is in scope and not proven fixed
 *     vetoes it. A loose window therefore cannot undo a blocker, which is the failure an OR-only
 *     payload invites, and one arg's blockers never hold back another arg.
 *   - Args whose row says `requiresBlockers` (turning a feature on) must name at least one.
 *   - Install sources, per grant: standalone only unless the grant says otherwise.
 *   - The cohort: who this launch is (beta toggle, telemetry consent), and whether the payload
 *     opted that group in.
 *
 * Each launch reports the first gate that refused it, by name, through `[core-rollout]` records:
 * one line for a payload-wide refusal, otherwise one line per arg the payload names.
 */
import semver from 'semver'
import { MAX_RESOLVED_SHAS } from './coreBetaAncestry'
import {
  commitShortfall,
  parseCommitRanges,
  parseCommitSha,
  parseCoreVersion,
  versionGateOpen,
  versionShortfall
} from './coreBetaGrants'
import type { CoreBetaGrant, CoreCommitState, CoreVersionState } from './coreBetaGrants'
import { makeOpsFlag } from './opsFlag'
import { POSTHOG_CONTROLLED_ARGS, controlledArg, oppositeArg } from './posthogControlledArgs'
import type { ConsentState, FeatureFlagValue } from './telemetry'

export const CORE_ROLLOUT_FLAG_KEY = 'desktop_core_rollout'

/** How long a stored payload stands in for an unreachable server. A code constant so a payload
 *  cannot extend its own life. A stored `false` ages out the same way and then reads as "no
 *  value", which refuses just as `false` did: expiry can only ever withdraw a grant. */
export const CORE_ROLLOUT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

/** Install sources a grant may name. `desktop` (v1) and `remote`/`cloud` never assemble Core
 *  args, so naming them is a payload error rather than a no-op. git and portable venvs are
 *  user-managed: a grant reaches them only when ops lists them. */
export const ROLLOUT_INSTALL_SOURCES: ReadonlySet<string> = new Set([
  'standalone',
  'git',
  'portable',
  'comfybuilder'
])
const DEFAULT_INSTALL_SOURCES: readonly string[] = ['standalone']

const MAX_WINDOWS = 8
const MAX_BLOCKERS = 8
const MAX_BLOCKER_SHAS = 4
const BLOCKER_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
// Stricter than the beta key, which takes any string outside an off-list: a variant named
// anything else (`control` included) is a payload this build was never told to act on.
const ROLLOUT_VARIANT_RE = /^rollout(?:-[a-z0-9]{1,16})?$/

export interface CoreRolloutBlocker {
  readonly id: string
  // Commit lists name one SHA per lineage, as `commit_ranges` do: a proven absence of every
  // introducing commit rules the blocker out, so a lineage missing from that list is one it
  // cannot see. Same contract for `fix_commits`, where the omission only ever withholds.
  readonly fixCommits: readonly string[]
  readonly fixedIn?: string
  readonly introducedCommits: readonly string[]
  readonly introducedIn?: string
}

export interface CoreRolloutGrant {
  readonly arg: string
  /** Generation of this arg's grant. Lets a later breaker re-arm one arg without the others. */
  readonly epoch: number
  /** ORed: the arg may run on a core any window matches. Each carries `arg` so the beta key's
   *  window checks apply unchanged. */
  readonly windows: readonly CoreBetaGrant[]
  /** ANDed over the windows. */
  readonly blockers: readonly CoreRolloutBlocker[]
  readonly installSources: readonly string[]
}

export interface CoreRollout {
  readonly grants: readonly CoreRolloutGrant[]
  readonly minDesktopVersion: string
  readonly includeTelemetryOff: boolean
  readonly includeBetaOffWithTelemetry: boolean
}

/** The fetched treatment: a usable payload, or why there is none. */
export type CoreRolloutState =
  | { readonly kind: 'on'; readonly rollout: CoreRollout }
  | { readonly kind: 'off'; readonly reason: string }

const off = (reason: string): CoreRolloutState => ({ kind: 'off', reason })

class PayloadError extends Error {}

function fail(reason: string): never {
  throw new PayloadError(reason)
}

function field(obj: object, key: string): unknown {
  return (obj as Record<string, unknown>)[key]
}

function isPlainObject(value: unknown): value is object {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function requiredVersion(obj: object, key: string, where: string): string {
  return optionalVersion(obj, key, where) ?? fail(`${where}${key} missing`)
}

function optionalVersion(obj: object, key: string, where: string): string | undefined {
  if (!(key in obj)) return undefined
  return parseCoreVersion(field(obj, key)) ?? fail(`${where}${key} is not a version`)
}

function shaList(obj: object, key: string, where: string): string[] {
  if (!(key in obj)) return []
  const raw = field(obj, key)
  if (!Array.isArray(raw) || raw.length > MAX_BLOCKER_SHAS) fail(`${where}${key} is not a list`)
  return raw.map((value) => parseCommitSha(value) ?? fail(`${where}${key} has a bad commit`))
}

function list(obj: object, key: string, min: number, max: number, where = ''): unknown[] {
  const raw = field(obj, key)
  if (!Array.isArray(raw) || raw.length < min || raw.length > max)
    fail(`${where}${key} must list ${min} to ${max} entries`)
  return raw
}

// Unknown keys are refused inside grants, windows and blockers, unlike at the top level: a
// misspelt `max_core_version` would otherwise read as an open upper bound, a misspelt
// `install_sources` as the default, and a misspelt `introduced_commits` would leave scope to the
// version bound alone, which can rule a backported bug out. Those are the typos that fail OPEN.
function refuseUnknownKeys(obj: object, allowed: ReadonlySet<string>, where: string): void {
  const unknownKey = Object.keys(obj).find((key) => !allowed.has(key))
  if (unknownKey !== undefined) fail(`${where}has unknown key ${unknownKey.slice(0, 32)}`)
}

const GRANT_KEYS: ReadonlySet<string> = new Set([
  'arg',
  'epoch',
  'windows',
  'blockers',
  'install_sources'
])
const BLOCKER_KEYS: ReadonlySet<string> = new Set([
  'id',
  'fix_commits',
  'fixed_in',
  'introduced_commits',
  'introduced_in'
])
const WINDOW_KEYS: ReadonlySet<string> = new Set([
  'min_core_version',
  'max_core_version',
  'commit_ranges'
])

function parseWindow(arg: string, candidate: unknown, where: string): CoreBetaGrant {
  if (!isPlainObject(candidate)) fail(`${where}is not an object`)
  refuseUnknownKeys(candidate, WINDOW_KEYS, where)
  if ('commit_ranges' in candidate) {
    if ('min_core_version' in candidate || 'max_core_version' in candidate)
      fail(`${where}mixes commit ranges and versions`)
    const commitRanges =
      parseCommitRanges(field(candidate, 'commit_ranges')) ?? fail(`${where}bad commit_ranges`)
    return { arg, commitRanges }
  }
  const minCoreVersion = requiredVersion(candidate, 'min_core_version', where)
  const maxCoreVersion = optionalVersion(candidate, 'max_core_version', where)
  if (maxCoreVersion !== undefined && !semver.gt(maxCoreVersion, minCoreVersion))
    fail(`${where}max_core_version is not above min_core_version`)
  return { arg, minCoreVersion, ...(maxCoreVersion === undefined ? {} : { maxCoreVersion }) }
}

function parseBlocker(candidate: unknown, where: string): CoreRolloutBlocker {
  if (!isPlainObject(candidate)) fail(`${where}is not an object`)
  refuseUnknownKeys(candidate, BLOCKER_KEYS, where)
  const id = field(candidate, 'id')
  if (typeof id !== 'string' || !BLOCKER_ID_RE.test(id)) fail(`${where}id is missing or malformed`)
  const fixedIn = optionalVersion(candidate, 'fixed_in', where)
  const introducedIn = optionalVersion(candidate, 'introduced_in', where)
  return {
    id,
    fixCommits: shaList(candidate, 'fix_commits', where),
    ...(fixedIn === undefined ? {} : { fixedIn }),
    introducedCommits: shaList(candidate, 'introduced_commits', where),
    ...(introducedIn === undefined ? {} : { introducedIn })
  }
}

function parseInstallSources(candidate: object, where: string): readonly string[] {
  if (!('install_sources' in candidate)) return DEFAULT_INSTALL_SOURCES
  const sources = list(candidate, 'install_sources', 1, ROLLOUT_INSTALL_SOURCES.size, where)
  for (const source of sources) {
    if (typeof source !== 'string' || !ROLLOUT_INSTALL_SOURCES.has(source))
      fail(`${where}install_sources names ${JSON.stringify(source).slice(0, 32)}`)
  }
  return sources as string[]
}

function parseGrant(candidate: unknown, where: string): CoreRolloutGrant {
  if (!isPlainObject(candidate)) fail(`${where}is not an object`)
  refuseUnknownKeys(candidate, GRANT_KEYS, where)
  const arg = field(candidate, 'arg')
  const row = typeof arg === 'string' ? controlledArg(arg) : undefined
  if (row === undefined) fail(`${where}arg is not an allowlisted arg`)
  const epoch = field(candidate, 'epoch')
  if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0)
    fail(`${where}epoch is not a non-negative integer`)
  const windows = list(candidate, 'windows', 1, MAX_WINDOWS, where).map((w, i) =>
    parseWindow(row.arg, w, `${where}windows[${i}] `)
  )
  // Required even when empty, so "no known blockers" is always something ops wrote down.
  const blockers = list(candidate, 'blockers', 0, MAX_BLOCKERS, where).map((b, i) =>
    parseBlocker(b, `${where}blockers[${i}] `)
  )
  if (row.requiresBlockers && blockers.length === 0)
    fail(`${where}${row.arg} needs at least one blocker`)
  if (new Set(blockers.map((b) => b.id)).size !== blockers.length)
    fail(`${where}duplicate blocker id`)
  return {
    arg: row.arg,
    epoch,
    windows,
    blockers,
    installSources: parseInstallSources(candidate, where)
  }
}

function requiredBoolean(payload: object, key: string): boolean {
  const raw = field(payload, key)
  return typeof raw === 'boolean' ? raw : fail(`${key} is not a boolean`)
}

/** Every SHA a launch has to relate to HEAD for this payload, deduplicated. */
export function coreRolloutShas(rollout: CoreRollout): string[] {
  const shas = new Set<string>()
  for (const grant of rollout.grants) {
    for (const window of grant.windows) {
      if (!('commitRanges' in window)) continue
      for (const [lower, upper] of window.commitRanges) {
        shas.add(lower)
        if (upper !== null) shas.add(upper)
      }
    }
    for (const blocker of grant.blockers) {
      for (const sha of [...blocker.fixCommits, ...blocker.introducedCommits]) shas.add(sha)
    }
  }
  return [...shas]
}

export function parseCoreRollout(
  value: FeatureFlagValue | undefined,
  payload: unknown
): CoreRolloutState {
  // `undefined` is all the fetch layer reports both for a server that answered without this key
  // and for one that could not be reached, so the reason names both.
  if (value === undefined)
    return off('no flag value (key not served, or server unreachable; nothing stored in date)')
  if (value === false) return off('flag served false')
  if (value !== true && !(typeof value === 'string' && ROLLOUT_VARIANT_RE.test(value)))
    return off(`variant ${JSON.stringify(value).slice(0, 40)} is not a rollout variant`)
  if (!isPlainObject(payload)) return off('payload is not an object')
  try {
    const grants = list(payload, 'grants', 1, POSTHOG_CONTROLLED_ARGS.length).map((g, i) =>
      parseGrant(g, `grants[${i}] `)
    )
    const args = new Set(grants.map((g) => g.arg))
    // One grant per arg: two would OR together and the looser one would win.
    if (args.size !== grants.length) fail('names an arg more than once')
    // Naming a flag and its opposite is an operator mistake, not a precedence order.
    for (const { arg } of grants) {
      const opposite = oppositeArg(arg)
      if (opposite !== null && args.has(opposite)) fail(`names both ${arg} and ${opposite}`)
    }
    const rollout: CoreRollout = {
      grants,
      minDesktopVersion: requiredVersion(payload, 'min_desktop_version', ''),
      includeTelemetryOff: requiredBoolean(payload, 'include_telemetry_off'),
      includeBetaOffWithTelemetry: requiredBoolean(payload, 'include_beta_off_with_telemetry')
    }
    // Past the cap the ancestry pass leaves SHAs unchecked, which would refuse anyway, but
    // silently and per launch; refusing here names the cause once.
    if (coreRolloutShas(rollout).length > MAX_RESOLVED_SHAS)
      fail(`names more than ${MAX_RESOLVED_SHAS} commits`)
    return { kind: 'on', rollout }
  } catch (err) {
    if (err instanceof PayloadError) return off(`payload refused: ${err.message}`)
    throw err
  }
}

export type CoreRolloutCohort = 'beta-off-with-telemetry' | 'telemetry-off'

/** The payload-wide gates, which run before any git work so an ineligible launch costs nothing. */
export interface CoreRolloutLaunchFacts {
  readonly appVersion: string
  readonly sourceId: string
  /** `'unknown'` when the beta toggle could not be resolved: it may be on, so this refuses. */
  readonly beta: boolean | 'unknown'
  readonly consent: ConsentState
}

export type CoreRolloutEligibility =
  | {
      readonly eligible: true
      readonly rollout: CoreRollout
      readonly cohort: CoreRolloutCohort
      readonly sourceId: string
    }
  | { readonly eligible: false; readonly gate: string; readonly reason: string }

const refuse = (gate: string, reason: string): CoreRolloutEligibility => ({
  eligible: false,
  gate,
  reason
})

function cohortOf(rollout: CoreRollout, facts: CoreRolloutLaunchFacts): CoreRolloutCohort | string {
  if (facts.beta === 'unknown') return 'beta setting could not be read'
  if (facts.beta) return 'beta features are on (the beta key governs this launch)'
  if (facts.consent === 'granted') {
    return rollout.includeBetaOffWithTelemetry
      ? 'beta-off-with-telemetry'
      : 'payload excludes beta-off users with telemetry on'
  }
  if (facts.consent === 'denied') {
    return rollout.includeTelemetryOff ? 'telemetry-off' : 'payload excludes telemetry-off users'
  }
  return 'telemetry consent not decided yet'
}

export function coreRolloutEligibility(
  state: CoreRolloutState,
  facts: CoreRolloutLaunchFacts
): CoreRolloutEligibility {
  if (state.kind === 'off') return refuse('payload', state.reason)
  const { rollout } = state
  const app = parseCoreVersion(facts.appVersion)
  if (app === null) return refuse('desktop', `app version ${facts.appVersion} is not semver`)
  if (!semver.gte(app, rollout.minDesktopVersion))
    return refuse('desktop', `app ${app} < min ${rollout.minDesktopVersion}`)
  const cohort = cohortOf(rollout, facts)
  if (cohort !== 'beta-off-with-telemetry' && cohort !== 'telemetry-off')
    return refuse('cohort', cohort)
  return { eligible: true, rollout, cohort, sourceId: facts.sourceId }
}

/** The SHAs worth relating for this launch: only grants that could still apply after the cheap
 *  per-arg gates (install source, the user's own args). */
export function eligibleRolloutShas(
  eligibility: CoreRolloutEligibility,
  userArgs: readonly string[]
): string[] {
  if (!eligibility.eligible) return []
  const grants = eligibility.rollout.grants.filter(
    (grant) =>
      grant.installSources.includes(eligibility.sourceId) &&
      argsConflict(grant.arg, userArgs) === null
  )
  return coreRolloutShas({ ...eligibility.rollout, grants })
}

/** `arg` or its opposite already present, as the reason a grant yields; `null` otherwise. */
function argsConflict(arg: string, present: readonly string[]): string | null {
  if (present.includes(arg)) return 'already in the launch args'
  const opposite = oppositeArg(arg)
  return opposite !== null && present.includes(opposite)
    ? `the launch args contain ${opposite}`
    : null
}

/** Why `blocker` vetoes this launch, or `null` when it is out of scope or proven fixed. An
 *  unproven relation never helps: it counts as in scope and as not fixed. */
export function blockerShortfall(
  blocker: CoreRolloutBlocker,
  core: CoreVersionState,
  commits: CoreCommitState
): string | null {
  const contained = (sha: string): boolean => commits.ancestry.get(sha) === true
  const notContained = (sha: string): boolean => commits.ancestry.get(sha) === false
  // A version proof needs a release the install provably contains, on a record that still
  // describes the checkout: the same bar the version entries clear.
  const version = core.semver !== null && core.verified && core.current ? core.semver : null

  const scoped = blocker.introducedCommits.length > 0 || blocker.introducedIn !== undefined
  let scope: 'in' | 'out' | 'unknown' = scoped ? 'unknown' : 'in'
  if (scoped) {
    const provenIn =
      blocker.introducedCommits.some(contained) ||
      (blocker.introducedIn !== undefined &&
        version !== null &&
        semver.gte(version, blocker.introducedIn))
    // Below the bound proves "out" only on an exact tag: past a tag, the install may well
    // contain the introducing change already.
    const provenOut =
      (blocker.introducedCommits.length > 0 && blocker.introducedCommits.every(notContained)) ||
      (blocker.introducedIn !== undefined &&
        version !== null &&
        core.exact &&
        semver.lt(version, blocker.introducedIn))
    if (provenIn) scope = 'in'
    else if (provenOut) scope = 'out'
  }
  if (scope === 'out') return null

  const fixed =
    blocker.fixCommits.some(contained) ||
    (blocker.fixedIn !== undefined && version !== null && semver.gte(version, blocker.fixedIn))
  if (fixed) return null
  return `blocker ${blocker.id} ${scope === 'in' ? 'applies' : 'may apply (scope not proven)'} and its fix is not proven present`
}

/** One arg's outcome on a launch the payload-wide gates admitted. */
export type CoreRolloutArgDecision =
  | { readonly arg: string; readonly granted: true; readonly epoch: number }
  | {
      readonly arg: string
      readonly granted: false
      readonly gate: string
      readonly reason: string
    }

export type CoreRolloutDecision =
  | {
      readonly evaluated: true
      readonly cohort: CoreRolloutCohort
      readonly args: readonly CoreRolloutArgDecision[]
    }
  | { readonly evaluated: false; readonly gate: string; readonly reason: string }

function decideGrant(
  grant: CoreRolloutGrant,
  sourceId: string,
  core: CoreVersionState,
  commits: CoreCommitState,
  presentArgs: readonly string[]
): CoreRolloutArgDecision {
  const withheld = (gate: string, reason: string): CoreRolloutArgDecision => ({
    arg: grant.arg,
    granted: false,
    gate,
    reason
  })
  if (!grant.installSources.includes(sourceId))
    return withheld('install', `source ${sourceId} is not in ${grant.installSources.join(', ')}`)
  const conflict = argsConflict(grant.arg, presentArgs)
  if (conflict !== null) return withheld('launch-args', conflict)

  const versionOpen = versionGateOpen(core, false)
  const shortfalls: string[] = []
  let matched = false
  for (const [index, window] of grant.windows.entries()) {
    const shortfall =
      'commitRanges' in window
        ? commitShortfall(window, commits)
        : versionShortfall(window, core, versionOpen)
    if (shortfall === null) {
      matched = true
      break
    }
    shortfalls.push(`window ${index + 1}: ${shortfall}`)
  }
  if (!matched) return withheld('core', shortfalls.join('; '))

  for (const blocker of grant.blockers) {
    const shortfall = blockerShortfall(blocker, core, commits)
    if (shortfall !== null) return withheld('blocker', shortfall)
  }
  return { arg: grant.arg, granted: true, epoch: grant.epoch }
}

/**
 * The full decision for one launch, per arg. `presentArgs` is the user's args plus whatever the
 * beta key selected: the cohorts are disjoint, so the beta part is empty in practice, but a
 * rollout grant must still never contradict or duplicate one.
 */
export function selectCoreRolloutArgs(
  eligibility: CoreRolloutEligibility,
  core: CoreVersionState,
  commits: CoreCommitState,
  presentArgs: readonly string[]
): CoreRolloutDecision {
  if (!eligibility.eligible) return { evaluated: false, ...eligibility }
  const { rollout, cohort, sourceId } = eligibility
  return {
    evaluated: true,
    cohort,
    args: rollout.grants.map((grant) => decideGrant(grant, sourceId, core, commits, presentArgs))
  }
}

/** Newline-terminated, like the `[core-beta]` records, for the install log and output. */
export function coreRolloutRecords(decision: CoreRolloutDecision): string[] {
  if (!decision.evaluated) {
    return [`[core-rollout] withheld at ${decision.gate}: ${decision.reason}\n`]
  }
  return decision.args.map((arg) => coreRolloutArgRecord(arg, decision.cohort))
}

export function coreRolloutArgRecord(
  decision: CoreRolloutArgDecision,
  cohort: CoreRolloutCohort
): string {
  if (decision.granted) {
    return `[core-rollout] ${decision.arg} granted (cohort ${cohort}, epoch ${decision.epoch}, blockers clear)\n`
  }
  return `[core-rollout] ${decision.arg} withheld at ${decision.gate}: ${decision.reason}\n`
}

// Revoke by serving `false`, never by deleting the key: a missing key reads as unreachable and
// holds the stored payload, though only until `CORE_ROLLOUT_MAX_AGE_MS` (see `opsFlag.ts`).
const flag = makeOpsFlag<CoreRolloutState>({
  key: CORE_ROLLOUT_FLAG_KEY,
  fallback: off('flag not fetched'),
  parse: parseCoreRollout,
  logLabel: 'core-rollout',
  persist: true,
  maxAgeMs: CORE_ROLLOUT_MAX_AGE_MS
})

export const initCoreRollout = flag.init

export const getCoreRolloutAsync = flag.get

export const _resetForTest = flag._resetForTest
