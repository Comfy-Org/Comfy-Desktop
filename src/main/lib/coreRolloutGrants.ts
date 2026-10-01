/**
 * PostHog-controlled rollout of `--enable-assets` to users who are NOT in the beta.
 *
 * A separate key from `coreBetaGrants.ts` on purpose. Its percentage, its kill switch and its
 * payload are its own, and a Desktop that predates this module never fetches it, so no older
 * build can apply it under rules it does not know. The cohorts are disjoint: a launch with beta
 * features on is never selected here, and stays under the beta key's controls.
 *
 * Everything fails closed. One malformed field refuses the whole payload, and every gate refuses
 * on absence (an unresolved commit, an unverified version, an unknown toggle). Two gates exist
 * only here:
 *
 *   - Blockers are ANDed over the grant entries rather than ORed in with them. Entries choose the
 *     window; a blocker that is in scope and not proven fixed vetoes it. A loose entry therefore
 *     cannot undo a blocker, which is the failure an OR-only payload invites.
 *   - The cohort: who this launch is (beta toggle, telemetry consent), and whether the payload
 *     opted that group in.
 *
 * Each launch reports the first gate that refused it, by name, through `[core-rollout]` records.
 */
import semver from 'semver'
import { MAX_RESOLVED_SHAS } from './coreBetaAncestry'
import {
  commitShortfall,
  oppositeArg,
  parseCommitRanges,
  parseCommitSha,
  parseCoreVersion,
  versionGateOpen,
  versionShortfall
} from './coreBetaGrants'
import type { CoreBetaGrant, CoreCommitState, CoreVersionState } from './coreBetaGrants'
import { makeOpsFlag } from './opsFlag'
import type { ConsentState, FeatureFlagValue } from './telemetry'

export const CORE_ROLLOUT_FLAG_KEY = 'desktop_core_rollout'

/** The only arg this key may grant. Hashing and the force-off stay with the beta key. */
export const CORE_ROLLOUT_ARG = '--enable-assets'

/** How long a stored payload stands in for an unreachable server. A code constant so a payload
 *  cannot extend its own life. */
export const CORE_ROLLOUT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

const MAX_GRANTS = 8
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

export interface CoreRollout {
  readonly grants: readonly CoreBetaGrant[]
  readonly blockers: readonly CoreRolloutBlocker[]
  readonly epoch: number
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

// Unknown keys are refused inside an entry, unlike at the top level: a misspelt
// `max_core_version` would otherwise read as an open upper bound, the one typo that fails OPEN.
const GRANT_KEYS: ReadonlySet<string> = new Set([
  'arg',
  'min_core_version',
  'max_core_version',
  'commit_ranges'
])

function parseGrant(candidate: unknown, where: string): CoreBetaGrant {
  if (!isPlainObject(candidate)) fail(`${where}is not an object`)
  const unknownKey = Object.keys(candidate).find((key) => !GRANT_KEYS.has(key))
  if (unknownKey !== undefined) fail(`${where}has unknown key ${unknownKey.slice(0, 32)}`)
  if (field(candidate, 'arg') !== CORE_ROLLOUT_ARG) fail(`${where}arg is not ${CORE_ROLLOUT_ARG}`)
  if ('commit_ranges' in candidate) {
    if ('min_core_version' in candidate || 'max_core_version' in candidate)
      fail(`${where}mixes commit ranges and versions`)
    const commitRanges =
      parseCommitRanges(field(candidate, 'commit_ranges')) ?? fail(`${where}bad commit_ranges`)
    return { arg: CORE_ROLLOUT_ARG, commitRanges }
  }
  const minCoreVersion = requiredVersion(candidate, 'min_core_version', where)
  const maxCoreVersion = optionalVersion(candidate, 'max_core_version', where)
  if (maxCoreVersion !== undefined && !semver.gt(maxCoreVersion, minCoreVersion))
    fail(`${where}max_core_version is not above min_core_version`)
  return {
    arg: CORE_ROLLOUT_ARG,
    minCoreVersion,
    ...(maxCoreVersion === undefined ? {} : { maxCoreVersion })
  }
}

function parseBlocker(candidate: unknown, where: string): CoreRolloutBlocker {
  if (!isPlainObject(candidate)) fail(`${where}is not an object`)
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

function list(payload: object, key: string, max: number): unknown[] {
  const raw = field(payload, key)
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > max)
    fail(`${key} must list 1 to ${max} entries`)
  return raw
}

function requiredBoolean(payload: object, key: string): boolean {
  const raw = field(payload, key)
  return typeof raw === 'boolean' ? raw : fail(`${key} is not a boolean`)
}

/** Every SHA a launch has to relate to HEAD for this payload, deduplicated. */
export function coreRolloutShas(rollout: CoreRollout): string[] {
  const shas = new Set<string>()
  for (const grant of rollout.grants) {
    if (!('commitRanges' in grant)) continue
    for (const [lower, upper] of grant.commitRanges) {
      shas.add(lower)
      if (upper !== null) shas.add(upper)
    }
  }
  for (const blocker of rollout.blockers) {
    for (const sha of [...blocker.fixCommits, ...blocker.introducedCommits]) shas.add(sha)
  }
  return [...shas]
}

export function parseCoreRollout(
  value: FeatureFlagValue | undefined,
  payload: unknown
): CoreRolloutState {
  // `undefined` is what an unreachable server with nothing stored (or stored past its age) parses as.
  if (value === undefined) return off('no flag value (server unreachable, nothing stored in date)')
  if (value === false) return off('flag served false')
  if (value !== true && !(typeof value === 'string' && ROLLOUT_VARIANT_RE.test(value)))
    return off(`variant ${JSON.stringify(value).slice(0, 40)} is not a rollout variant`)
  if (!isPlainObject(payload)) return off('payload is not an object')
  try {
    const grants = list(payload, 'grants', MAX_GRANTS).map((g, i) => parseGrant(g, `grants[${i}] `))
    const blockers = list(payload, 'blockers', MAX_BLOCKERS).map((b, i) =>
      parseBlocker(b, `blockers[${i}] `)
    )
    if (new Set(blockers.map((b) => b.id)).size !== blockers.length) fail('duplicate blocker id')
    const epoch = field(payload, 'epoch')
    if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0)
      fail('epoch is not a non-negative integer')
    const rollout: CoreRollout = {
      grants,
      blockers,
      epoch,
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

/** The gates that run before any git work, so an ineligible launch costs nothing. */
export interface CoreRolloutLaunchFacts {
  readonly appVersion: string
  readonly sourceId: string
  /** `'unknown'` when the beta toggle could not be resolved: it may be on, so this refuses. */
  readonly beta: boolean | 'unknown'
  readonly consent: ConsentState
  readonly userArgs: readonly string[]
}

export type CoreRolloutEligibility =
  | {
      readonly eligible: true
      readonly rollout: CoreRollout
      readonly cohort: CoreRolloutCohort
    }
  | { readonly eligible: false; readonly gate: string; readonly reason: string }

const refuse = (gate: string, reason: string): CoreRolloutEligibility => ({
  eligible: false,
  gate,
  reason
})

/** The arg or its opposite already present, as the reason a grant yields; `null` otherwise. */
function argsConflict(present: readonly string[]): string | null {
  if (present.includes(CORE_ROLLOUT_ARG)) return 'already in the launch args'
  const opposite = oppositeArg(CORE_ROLLOUT_ARG)!
  return present.includes(opposite) ? `the launch args contain ${opposite}` : null
}

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
  if (facts.sourceId !== 'standalone')
    return refuse('install', `source ${facts.sourceId} is not standalone`)
  const cohort = cohortOf(rollout, facts)
  if (cohort !== 'beta-off-with-telemetry' && cohort !== 'telemetry-off')
    return refuse('cohort', cohort)
  const conflict = argsConflict(facts.userArgs)
  if (conflict !== null) return refuse('launch-args', conflict)
  return { eligible: true, rollout, cohort }
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

export type CoreRolloutDecision =
  | {
      readonly granted: true
      readonly grant: CoreBetaGrant
      readonly epoch: number
      readonly cohort: CoreRolloutCohort
    }
  | { readonly granted: false; readonly gate: string; readonly reason: string }

/**
 * The full decision for one launch. `presentArgs` is the user's args plus whatever the beta key
 * selected: the cohorts are disjoint, so the beta part is empty in practice, but a rollout grant
 * must still never contradict or duplicate one.
 */
export function selectCoreRolloutArg(
  eligibility: CoreRolloutEligibility,
  core: CoreVersionState,
  commits: CoreCommitState,
  presentArgs: readonly string[]
): CoreRolloutDecision {
  if (!eligibility.eligible) return { granted: false, ...eligibility }
  const { rollout, cohort } = eligibility
  const conflict = argsConflict(presentArgs)
  if (conflict !== null) return { granted: false, gate: 'launch-args', reason: conflict }

  const versionOpen = versionGateOpen(core, false)
  const shortfalls: string[] = []
  let matched: CoreBetaGrant | null = null
  for (const [index, grant] of rollout.grants.entries()) {
    const shortfall =
      'commitRanges' in grant
        ? commitShortfall(grant, commits)
        : versionShortfall(grant, core, versionOpen)
    if (shortfall === null) {
      matched = grant
      break
    }
    shortfalls.push(`entry ${index + 1}: ${shortfall}`)
  }
  if (matched === null) return { granted: false, gate: 'core', reason: shortfalls.join('; ') }

  for (const blocker of rollout.blockers) {
    const shortfall = blockerShortfall(blocker, core, commits)
    if (shortfall !== null) return { granted: false, gate: 'blocker', reason: shortfall }
  }
  return { granted: true, grant: matched, epoch: rollout.epoch, cohort }
}

/** Newline-terminated, like the `[core-beta]` records, for the install log and output. */
export function coreRolloutRecord(decision: CoreRolloutDecision): string {
  if (decision.granted) {
    return `[core-rollout] ${CORE_ROLLOUT_ARG} granted (cohort ${decision.cohort}, epoch ${decision.epoch}, blockers clear)\n`
  }
  return `[core-rollout] ${CORE_ROLLOUT_ARG} withheld at ${decision.gate}: ${decision.reason}\n`
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
