/**
 * PostHog-controlled Core beta grants selected for each launch.
 * Payload entries name allowlisted dashed args and either a strict Core version window or a set
 * of commit ranges; launch code applies eligible grants only when beta features are enabled.
 *
 * This system may only ADD args. It has no authority over the user's own launch arguments and
 * never removes or overrides one — several of these flags are first-class, user-settable
 * options in Desktop's launch-args UI, so a grant is an addition on top of what the user asked
 * for, never a substitute for it.
 *
 * The same payload may also carry ONE frontend grant (`frontend`), which pins the frontend
 * release Core serves. It is a separate, typed field rather than another allowlisted arg because
 * it selects which frontend CODE runs: see `parseCoreFrontendGrant` for what narrows it. The build
 * itself is fetched from PyPI into a Desktop-owned cache (`frontendCache.ts`) and handed to Core
 * as `--front-end-root`.
 */
import fs from 'fs'
import path from 'path'
import semver from 'semver'
import { makeOpsFlag } from './opsFlag'
import type { FeatureFlagValue } from './telemetry'

export const CORE_BETA_FEATURES_FLAG_KEY = 'desktop_core_beta_features'

/**
 * The args a PostHog payload may GRANT. That is this list's only job — it is not a registry of
 * grant-owned tokens, and membership says nothing about whether a user may pass the same arg
 * by hand (they may, and it wins; see `selectCoreBetaGrantArgs`).
 *
 * An entry need not exist in Core yet: `--disable-assets` is the planned remote force-off for
 * when assets go default-on, and `--enable-agent` lands here ahead of the Core flag because
 * Desktop reaches users on its own update cadence — the allowlist has to already be installed
 * before a payload can grant anything. Granting an arg Core cannot parse is safe meanwhile: the
 * running core's supported-argument schema filters it and the launch reports it as
 * `dropped_unsupported`.
 */
export const CORE_BETA_GRANTABLE_ARGS = [
  '--enable-assets',
  '--enable-asset-hashing',
  '--disable-assets',
  '--enable-agent'
] as const

/** How a grant's activation notice should be worded, when it is announced at all. Both fields
 *  are optional and independent of whether the grant APPLIES — copy never gates a flag. */
export type CoreBetaNotice = {
  /** `true` when the payload asked for no card at all. Ops-controlled because not every
   *  granted flag is user-visible: a diagnostic or an internal rollout has nothing to tell the
   *  user, and a card for it is noise that trains people to dismiss the real ones. */
  readonly silent?: true
  /** Human name of the feature, e.g. `"Asset library"`. Supplied by the payload rather than
   *  mapped in Desktop because the allowlist is installed ahead of the features it names — a
   *  table here would have to ship before anyone knew what to call them. Absent means the
   *  card falls back to its generic wording.
   *
   *  NOT localized, and not localizable from here: it arrives as one string for every user,
   *  in whatever language ops wrote it — English today. The card's SENTENCE is translated
   *  around it. That asymmetry is why the notice templates treat this as an opaque token and
   *  never as the word they agree with; see the placeholder contract in
   *  `locales/drafts/README.md`. */
  readonly description?: string
}

type CoreBetaGrantBase = {
  readonly arg: string
  /** Notice wording for this grant. Absent when the payload said nothing about it. */
  readonly notice?: CoreBetaNotice
}

export type CoreBetaVersionGrant = CoreBetaGrantBase & {
  readonly minCoreVersion: string
  readonly maxCoreVersion?: string
}

export type CoreCommitRange = readonly [lower: string, upper: string | null]

/** Ranges OR, one per lineage: a backported fix has a different SHA on each branch. */
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

// Full SHAs only: an abbreviation can become ambiguous as the repository grows.
const FULL_SHA_RE = /^[0-9a-f]{40}$/i

/** Cap on a payload-supplied feature name. Bounds the card's HEIGHT: the bubble is a fixed
 *  ~280px wide, so a long name wraps to more and more lines until the card covers what it is
 *  annotating. (Width is handled in CSS — `overflow-wrap` breaks an unbroken token that would
 *  otherwise overflow.) An over-long description is dropped rather than cut, so the card falls
 *  back to wording that is at least correct. */
const MAX_DESCRIPTION_LENGTH = 48

/** A feature name is rendered verbatim in desktop chrome, beside an action that opens
 *  Settings — so it is held to printable characters only. Newlines would reshape the card,
 *  C0/C1 controls can do worse, and a bidi override (U+202E) can visually reverse the
 *  sentence around it. The payload is hand-authored by operators, so this guards a typo as
 *  much as anything else; a name that fails it falls back to the generic wording. */
const PRINTABLE_DESCRIPTION = /^[^\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]+$/u

// Prevent a control payload copied between PostHog variants from enrolling users.
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

/** Any bad range drops the entry, as a bad `max_core_version` does, rather than granting on less. */
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

/**
 * Read the optional notice wording off one payload entry.
 *
 * Every malformed shape degrades to "the payload said nothing", never to a refusal: this
 * governs COPY, and losing a grant because someone typed the feature name wrong would be a
 * far worse failure than showing the generic card. Returns `undefined` when nothing usable
 * was supplied, so the field is simply absent on the grant.
 */
function parseCoreBetaNotice(candidate: object): CoreBetaNotice | undefined {
  const notice: { silent?: true; description?: string } = {}

  // Only the exact string `'silent'` suppresses. A boolean `true` is deliberately NOT accepted:
  // `notice: true` reads as "yes, notify" at least as naturally as "yes, silent", and a
  // payload that silences a rollout by accident is invisible until someone asks why nobody
  // was told.
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

    // One kind per entry: combined bounds leave AND-vs-OR unclear, and separate entries already OR.
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

    // No dedup by arg: selection grants an arg when ANY of its entries matches.
    flags.push({
      arg: candidate.arg,
      minCoreVersion,
      ...(maxCoreVersion === undefined ? {} : { maxCoreVersion }),
      ...(notice === undefined ? {} : { notice })
    })
  }
  // Naming a flag and its opposite is an operator mistake, not a precedence order. Applying
  // either one would pick a silent winner from payload order, so the whole payload grants
  // nothing — the same way a malformed one does, and visibly enough to get corrected.
  const grantedArgs = new Set(flags.map((flag) => flag.arg))
  for (const { arg } of flags) {
    const opposite = oppositeArg(arg)
    if (opposite !== null && grantedArgs.has(opposite)) return []
  }
  return flags
}

/** The install's core release as the version gate sees it. Grouped rather than passed as two
 *  more positional arguments, so `exact` can never be transposed with `betaEnabled`. */
export interface CoreVersionState {
  /** Strict semver of the release, or `null` when it cannot be established. */
  semver: string | null
  /** Whether the install sits exactly on that release tag (`coreSemverExact`). */
  exact: boolean
  /** Whether that release was established by ancestry (`coreGateVersion`). */
  verified: boolean
  /** Whether the record those three came from still describes the live checkout
   *  (`coreRecordCurrent`). The other three are assertions about the RECORDED commit and stay
   *  true once it is superseded, so without this the gate can decide on code that is no longer
   *  installed. */
  current: boolean
}

const ENABLE_PREFIX = '--enable-'
const DISABLE_PREFIX = '--disable-'

/** The token that contradicts `arg`, or `null` for an arg with no negated form. Derived from
 *  the `--enable-`/`--disable-` prefix pair rather than a hardcoded table, so a new allowlist
 *  entry gets its conflict rule for free. Swapping only the prefix keeps the stem exact, so
 *  `--enable-assets` pairs with `--disable-assets` and never with `--disable-asset-hashing`. */
function oppositeArg(arg: string): string | null {
  if (arg.startsWith(ENABLE_PREFIX)) return DISABLE_PREFIX + arg.slice(ENABLE_PREFIX.length)
  if (arg.startsWith(DISABLE_PREFIX)) return ENABLE_PREFIX + arg.slice(DISABLE_PREFIX.length)
  return null
}

/** Ancestry facts the launch path resolves (repository, maybe network), so selection stays pure. */
export interface CoreCommitState {
  head: string | null
  /** Proven relations only: an unresolved SHA is absent, and absence satisfies neither bound. */
  ancestry: ReadonlyMap<string, boolean>
}

export const NO_CORE_COMMITS: CoreCommitState = { head: null, ancestry: new Map() }

/** SHAs to relate for this launch. Entries whose arg the user's own args already decide (the arg or
 *  its opposite) are skipped: selection would withhold them whatever their ancestry. */
export function commitGrantShas(
  flags: readonly CoreBetaGrant[],
  userArgs: readonly string[] = []
): string[] {
  const user = new Set(userArgs)
  const shas = new Set<string>()
  for (const flag of flags) {
    if (!isCommitGrant(flag)) continue
    const opposite = oppositeArg(flag.arg)
    if (user.has(flag.arg) || (opposite !== null && user.has(opposite))) continue
    for (const [lower, upper] of flag.commitRanges) {
      shas.add(lower)
      if (upper !== null) shas.add(upper)
    }
  }
  return [...shas]
}

// The upper bound needs a proven `false`: an unresolved upper SHA is exactly when HEAD may be past it.
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
  // Reached only when this range failed, so a matched lower bound implies a failed upper one.
  return ancestry.get(upper!) === true
    ? `HEAD past upper ${upper!.slice(0, 12)}`
    : `upper ${upper!.slice(0, 12)} unresolved`
}

/** Why a commit entry does not match, or `null` when it does. */
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

/** `logPrefix` is `null` when there is nothing to refuse, so an empty payload stays quiet. */
function versionGateOpen(core: CoreVersionState, logPrefix: string | null): boolean {
  const version = core.semver
  if (version === null) return false
  if (!core.current) {
    // Before `verified`, which once the checkout has moved is a true statement about the wrong
    // commit — reporting that instead would name the less useful of the two faults.
    if (logPrefix !== null)
      console.log(`${logPrefix} refused: base ${version} from a record the checkout contradicts`)
    return false
  }
  if (!core.verified) {
    // Echoed for the same reason as the per-flag windows below: this refusal drops grants an
    // operator can see in the payload, so it must not be silent.
    if (logPrefix !== null) console.log(`${logPrefix} refused: base ${version} not verified`)
    return false
  }
  return true
}

// The version window is min-INCLUSIVE and max-EXCLUSIVE (`>=min <max`). The payload field names
// `min_core_version`/`max_core_version` don't say which way either bound closes, so the boundary
// is settled here and echoed in the selection log rather than by renaming the wire format.
//
// Grants are additive only. A grant is withheld when the user already passed that same arg, and
// equally when they passed its opposite: someone who set `--disable-assets` must not also
// receive `--enable-assets`, and vice versa. Contradictory flags never go on one command line —
// Core's precedence between them is unspecified — and the tie is always broken the same way,
// with the user's own argument winning and the grant yielding.
//
// Entries OR: an arg is granted by the first entry for it that matches, and later entries for the
// same arg are then skipped exactly as a user-supplied copy would be. The returned list therefore
// never names an arg twice.
//
// Both version bounds are measured against a tag established by ancestry (`coreGateVersion`), and
// version entries are refused when there is none. `resolveLocalVersion` also reaches for a display
// tag on paths that do NOT prove the install contains it — the merge-base fallback runs only
// because the tag is not an ancestor — and such a label can satisfy a minimum the running code
// does not meet. The gate measures the `git describe` tag that label displaced instead. Core's
// args schema absorbs the common case, since an install without the feature does not know the
// flag, but not a minimum raised to require a later FIX to a flag it already has.
//
// Every version bound is also measured against a PERSISTED record that a `git pull` outdates
// without touching, so version entries are refused outright when the live checkout disagrees with
// it. The args schema is asymmetric here and cannot stand in for that check: an older core does
// not know the granted flag and drops it, but a newer one still parses it, which leaves the
// MAXIMUM bound resting on nothing but the stale record.
//
// Commit entries need neither refusal: they are measured against the live HEAD, never the record,
// and their upper bound holds on any checkout — including a latest-channel one, where a version
// ceiling cannot (see `exact` below).
//
// Every arg the payload names but does not get is reported through `withheld`, one line per arg
// with the reason for each entry that failed, so a refusal is as visible as a grant.
export function selectCoreBetaGrantArgs(
  flags: readonly CoreBetaGrant[],
  core: CoreVersionState,
  betaEnabled: boolean,
  userArgs: readonly string[],
  commits: CoreCommitState = NO_CORE_COMMITS,
  withheld?: string[]
): CoreBetaGrant[] {
  if (betaEnabled !== true) return []
  const version = core.semver
  const versionOpen = versionGateOpen(
    core,
    flags.some((flag) => !isCommitGrant(flag)) ? '[core-beta]' : null
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
      console.log(
        `[core-beta] commits ${arg}: ${ranges} head=${head} in-range=${shortfall === null ? 'yes' : 'no'}`
      )
    } else {
      if (versionOpen && version !== null) {
        const { minCoreVersion, maxCoreVersion } = flag
        const window =
          maxCoreVersion === undefined
            ? `>=${minCoreVersion}`
            : `>=${minCoreVersion} <${maxCoreVersion}`
        console.log(`[core-beta] window ${arg}: ${window} version=${version} exact=${core.exact}`)
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
    // Selected grants join the conflict set so the checks above hold between two grants too, not
    // just against the user's args. Redundant after `parseCoreBetaGrants`, load-bearing without it.
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

/** Why a version entry does not match, or `null` when it does. */
function versionShortfall(
  flag: { readonly minCoreVersion: string; readonly maxCoreVersion?: string },
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
    // An upper bound only means anything on an exact tag match. The gate version is a tag, so
    // a latest-channel install 40 commits past v0.3.99 still measures as 0.3.99
    // and would slip under a `<0.4.0` ceiling it is well past. Under-reporting like that is
    // what `exact` guards; over-reporting is `verified`'s job, above.
    if (!core.exact) return `max ${flag.maxCoreVersion} needs an exact release tag`
    if (!semver.lt(version, flag.maxCoreVersion)) {
      return `version ${version} >= max ${flag.maxCoreVersion}`
    }
  }
  return null
}

/** How a granted frontend reaches Core: the cached build's directory, served with no network.
 *  The payload names a VERSION and nothing else; the package is fixed (`FRONTEND_PACKAGE`), so the
 *  most a bad or compromised payload can do is pick another PyPI release of the frontend Core
 *  already ships. */
export const FRONTEND_ROOT_ARG = '--front-end-root'

/** A payload request to serve a specific frontend release instead of the one Core bundles. */
export type CoreFrontendGrant = {
  /** Exact `MAJOR.MINOR.PATCH`, no `v`. */
  readonly version: string
  readonly minCoreVersion: string
  readonly maxCoreVersion?: string
}

/** Everything one `desktop_core_beta_features` payload grants. */
export type CoreBetaPayload = {
  readonly flags: CoreBetaGrant[]
  readonly frontend: CoreFrontendGrant | null
}

/** Exact release only: no ranges, tags, `latest`/`prerelease`, `v` prefix or prerelease suffix.
 *  Core's own version pattern accepts all of those, so this is the narrowing. Leading zeros are
 *  refused so one release has exactly one spelling. */
const EXACT_FRONTEND_VERSION_RE = /^(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})$/

/** The whole vocabulary of a frontend grant. Anything else refuses it, so a payload that tries
 *  to name a repo, package or URL is rejected outright rather than applied with the field
 *  ignored: an operator who wrote `repo` believes a different source will be served. */
const FRONTEND_GRANT_KEYS: ReadonlySet<string> = new Set([
  'version',
  'min_core_version',
  'max_core_version'
])

/**
 * Read the optional `frontend` grant off the payload.
 *
 * Only the version's FORMAT is checked here. Whether that release is on PyPI is found out by the
 * prefetch, and a missing one is never applied: those launches serve the bundled frontend and
 * report the grant as `pending`, not applied.
 *
 * Independent of `flags`: a malformed frontend object drops only itself, and a malformed `flags`
 * list does not take the frontend grant with it. Every failure is a refusal (`null`), never a
 * repaired value, because this one decides which code runs.
 */
export function parseCoreFrontendGrant(
  value: FeatureFlagValue | undefined,
  payload: unknown
): CoreFrontendGrant | null {
  if (!isEnabled(value) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const candidate = 'frontend' in payload ? payload.frontend : undefined
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
  if (Object.keys(candidate).some((key) => !FRONTEND_GRANT_KEYS.has(key))) return null

  if (!('version' in candidate) || typeof candidate.version !== 'string') return null
  if (!EXACT_FRONTEND_VERSION_RE.test(candidate.version)) return null

  const minCoreVersion =
    'min_core_version' in candidate ? parseCoreVersion(candidate.min_core_version) : null
  if (minCoreVersion === null) return null

  let maxCoreVersion: string | undefined
  if ('max_core_version' in candidate) {
    const parsed = parseCoreVersion(candidate.max_core_version)
    if (parsed === null) return null
    maxCoreVersion = parsed
  }
  return {
    version: candidate.version,
    minCoreVersion,
    ...(maxCoreVersion === undefined ? {} : { maxCoreVersion })
  }
}

export function parseCoreBetaPayload(
  value: FeatureFlagValue | undefined,
  payload: unknown
): CoreBetaPayload {
  return {
    flags: parseCoreBetaGrants(value, payload),
    frontend: parseCoreFrontendGrant(value, payload)
  }
}

/** Matches the exact pin ComfyUI's `requirements.txt` carries, e.g.
 *  `comfyui-frontend-package==1.52.7`. A range or a missing line is `null`, not a guess. */
const REQUIRED_FRONTEND_RE =
  /^[ \t]*comfyui[-_]frontend[-_]package[ \t]*==[ \t]*(\d+\.\d+\.\d+)[ \t]*(?:#.*)?$/im

/** The frontend version this core pins, from the text of its `requirements.txt`. */
export function parseRequiredFrontendVersion(requirements: string): string | null {
  const match = REQUIRED_FRONTEND_RE.exec(requirements)
  return match === null ? null : semver.valid(match[1]!)
}

/** `parseRequiredFrontendVersion` over the live checkout's `requirements.txt`. Read from the
 *  checkout Core is about to run, not a record, so a `git pull` that raised the pin is seen. */
export function readRequiredFrontendVersion(comfyuiDir: string): string | null {
  try {
    return parseRequiredFrontendVersion(
      fs.readFileSync(path.join(comfyuiDir, 'requirements.txt'), 'utf-8')
    )
  } catch {
    return null
  }
}

/** Launch-arg names that mean the user already chose a frontend. Both count: `--front-end-root`
 *  is the arg the grant itself would add, and `--front-end-version` is the user asking Core to
 *  fetch one of their choosing. */
const USER_FRONTEND_ARG_NAMES: ReadonlySet<string> = new Set([
  'front-end-version',
  'front-end-root'
])

/** Whether the user's own args pick a frontend. Name-matched the way `filterUnsupportedArgs`
 *  reads a token, so `--front-end-version=x` and `--front-end-version x` both count. */
export function userChoosesFrontend(userArgs: readonly string[]): boolean {
  return userArgs.some(
    (arg) => arg.startsWith('--') && USER_FRONTEND_ARG_NAMES.has(arg.slice(2).replace(/=.*$/, ''))
  )
}

/**
 * The frontend grant to apply on this launch, or `null`.
 *
 * Same gates as a version-bounded arg grant (beta toggle, `current`, `verified`, the core window),
 * then two of its own:
 *   - the user's own frontend choice wins, always (`userChoosesFrontend`);
 *   - a FLOOR at the frontend this core pins. The grant must be strictly newer: an older frontend
 *     than the one Core was released against can call into a server it does not match, and an
 *     equal one is the bundled frontend downloaded again for nothing. An unknown floor refuses,
 *     since then there is no telling which side of it the grant falls on.
 * Every refusal after the shared gate is logged with its reason, as `withheld` does for args.
 */
export function selectCoreFrontendGrant(
  grant: CoreFrontendGrant | null,
  core: CoreVersionState,
  betaEnabled: boolean,
  userArgs: readonly string[],
  requiredFrontendVersion: string | null
): CoreFrontendGrant | null {
  if (grant === null || betaEnabled !== true) return null
  const version = core.semver
  if (version === null || !versionGateOpen(core, '[core-beta] frontend')) return null
  const { minCoreVersion, maxCoreVersion } = grant
  const window =
    maxCoreVersion === undefined ? `>=${minCoreVersion}` : `>=${minCoreVersion} <${maxCoreVersion}`
  console.log(
    `[core-beta] window frontend ${grant.version}: ${window} version=${version} exact=${core.exact} required=${requiredFrontendVersion ?? 'unknown'}`
  )
  const withheld = (reason: string): null => {
    console.log(`[core-beta] frontend ${grant.version} withheld: ${reason}`)
    return null
  }
  if (userChoosesFrontend(userArgs)) return withheld('the launch args choose a frontend')
  const shortfall = versionShortfall(grant, core, true)
  if (shortfall !== null) return withheld(shortfall)
  if (requiredFrontendVersion === null) return withheld('required frontend unknown')
  if (!semver.gt(grant.version, requiredFrontendVersion)) {
    return withheld(`not newer than required frontend ${requiredFrontendVersion}`)
  }
  return grant
}

// Grants persist across launches, so revoking one is an ops SEQUENCE, not a deletion: serving
// `false` on this key is what takes a grant back. Deleting or archiving the key instead reads as
// `unreachable` — indistinguishable from an offline launch — and HOLDS every grant already on
// disk. Disable first, let clients pick it up, delete only afterwards.
//
// Unchanged by late-result persistence, which only moves WHEN a disable lands, never whether a
// deletion counts as one. What it buys is convergence: a client whose `/flags` POST reliably
// outruns the boot deadline used to lose the revocation on every launch and hold the grant
// forever. It now persists the late `false` and picks it up on the next launch, so expect a
// retraction to take one extra restart rather than never arriving.
const flag = makeOpsFlag<CoreBetaPayload>({
  key: CORE_BETA_FEATURES_FLAG_KEY,
  fallback: { flags: [], frontend: null },
  parse: parseCoreBetaPayload,
  logLabel: 'core-beta',
  persist: true
})

export const initCoreBetaGrants = flag.init

export async function getCoreBetaGrantsAsync(): Promise<CoreBetaGrant[]> {
  return (await flag.get()).flags
}

export async function getCoreFrontendGrantAsync(): Promise<CoreFrontendGrant | null> {
  return (await flag.get()).frontend
}

export const _resetForTest = flag._resetForTest
