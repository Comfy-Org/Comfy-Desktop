/**
 * PostHog-controlled Core beta grants selected for each launch.
 * Payload entries name allowlisted dashed args and strict Core version windows;
 * launch code applies eligible grants only when beta features are enabled.
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

export type CoreBetaGrant = {
  readonly arg: string
  readonly minCoreVersion: string
  readonly maxCoreVersion?: string
  /** Notice wording for this grant. Absent when the payload said nothing about it. */
  readonly notice?: CoreBetaNotice
}

const MAX_FLAGS = 32
const CORE_BETA_ARG_RE = /^--[a-z][a-z0-9-]+$/

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

    const minCoreVersion =
      'min_core_version' in candidate ? parseCoreVersion(candidate.min_core_version) : null
    if (minCoreVersion === null) continue

    let maxCoreVersion: string | undefined
    if ('max_core_version' in candidate) {
      const parsedMaxCoreVersion = parseCoreVersion(candidate.max_core_version)
      if (parsedMaxCoreVersion === null) continue
      maxCoreVersion = parsedMaxCoreVersion
    }

    if (flags.some((flag) => flag.arg === candidate.arg)) continue
    const notice = parseCoreBetaNotice(candidate)
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

/**
 * The install's core version when every grant-independent condition holds, else `null`.
 *
 * Shared by both kinds of grant so a frontend pin can never be applied on a version claim the
 * arg grants would refuse. `logPrefix` is `null` when there is nothing to refuse, so a launch
 * with an empty payload stays quiet.
 */
function gatedCoreVersion(
  core: CoreVersionState,
  betaEnabled: boolean,
  logPrefix: string | null
): string | null {
  const version = core.semver
  if (version === null || betaEnabled !== true) return null
  if (!core.current) {
    // Before `verified`, which once the checkout has moved is a true statement about the wrong
    // commit — reporting that instead would name the less useful of the two faults.
    if (logPrefix !== null)
      console.log(`${logPrefix} refused: base ${version} from a record the checkout contradicts`)
    return null
  }
  if (!core.verified) {
    // Echoed for the same reason as the per-flag windows: this refusal drops grants an
    // operator can see in the payload, so it must not be silent.
    if (logPrefix !== null) console.log(`${logPrefix} refused: base ${version} not verified`)
    return null
  }
  return version
}

/** `>=min <max`, with the max bound honoured only on an exact tag match. */
function inCoreWindow(
  version: string,
  exact: boolean,
  minCoreVersion: string,
  maxCoreVersion: string | undefined
): boolean {
  if (!semver.gte(version, minCoreVersion)) return false
  if (maxCoreVersion === undefined) return true
  // An upper bound only means anything on an exact tag match. The gate version is a tag, so
  // a latest-channel install 40 commits past v0.3.99 still measures as 0.3.99
  // and would slip under a `<0.4.0` ceiling it is well past. Under-reporting like that is
  // what `exact` guards; over-reporting is `verified`'s job, in `gatedCoreVersion`.
  return exact && semver.lt(version, maxCoreVersion)
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
// Both bounds are measured against a tag established by ancestry (`coreGateVersion`), and the
// whole payload is refused when there is none. `resolveLocalVersion` also reaches for a display
// tag on paths that do NOT prove the install contains it — the merge-base fallback runs only
// because the tag is not an ancestor — and such a label can satisfy a minimum the running code
// does not meet. The gate measures the `git describe` tag that label displaced instead. Core's
// args schema absorbs the common case, since an install without the feature does not know the
// flag, but not a minimum raised to require a later FIX to a flag it already has.
//
// Every bound is also measured against a PERSISTED record that a `git pull` outdates without
// touching, so the payload is refused outright when the live checkout disagrees with it. The args
// schema is asymmetric here and cannot stand in for that check: an older core does not know the
// granted flag and drops it, but a newer one still parses it, which leaves the MAXIMUM bound
// resting on nothing but the stale record.
export function selectCoreBetaGrantArgs(
  flags: readonly CoreBetaGrant[],
  core: CoreVersionState,
  betaEnabled: boolean,
  userArgs: readonly string[]
): CoreBetaGrant[] {
  const version = gatedCoreVersion(core, betaEnabled, flags.length > 0 ? '[core-beta]' : null)
  if (version === null) return []
  const presentArgs = new Set(userArgs)
  const selected: CoreBetaGrant[] = []
  for (const flag of flags) {
    const { arg, minCoreVersion, maxCoreVersion } = flag
    const window =
      maxCoreVersion === undefined
        ? `>=${minCoreVersion}`
        : `>=${minCoreVersion} <${maxCoreVersion}`
    console.log(`[core-beta] window ${arg}: ${window} version=${version} exact=${core.exact}`)

    if (presentArgs.has(arg)) continue
    const opposite = oppositeArg(arg)
    if (opposite !== null && presentArgs.has(opposite)) continue
    if (!inCoreWindow(version, core.exact, minCoreVersion, maxCoreVersion)) continue
    // Selected grants join the conflict set so the checks above hold between two grants too, not
    // just against the user's args. Redundant after `parseCoreBetaGrants`, load-bearing without it.
    presentArgs.add(arg)
    selected.push(flag)
  }
  return selected
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
 * Same gates as the arg grants (beta toggle, `current`, `verified`, the core window), then two of
 * its own:
 *   - the user's own frontend choice wins, always (`userChoosesFrontend`);
 *   - a FLOOR at the frontend this core pins. The grant must be strictly newer: an older frontend
 *     than the one Core was released against can call into a server it does not match, and an
 *     equal one is the bundled frontend downloaded again for nothing. An unknown floor refuses,
 *     since then there is no telling which side of it the grant falls on.
 */
export function selectCoreFrontendGrant(
  grant: CoreFrontendGrant | null,
  core: CoreVersionState,
  betaEnabled: boolean,
  userArgs: readonly string[],
  requiredFrontendVersion: string | null
): CoreFrontendGrant | null {
  if (grant === null) return null
  const version = gatedCoreVersion(core, betaEnabled, '[core-beta] frontend')
  if (version === null) return null
  const { minCoreVersion, maxCoreVersion } = grant
  const window =
    maxCoreVersion === undefined ? `>=${minCoreVersion}` : `>=${minCoreVersion} <${maxCoreVersion}`
  console.log(
    `[core-beta] window frontend ${grant.version}: ${window} version=${version} exact=${core.exact} required=${requiredFrontendVersion ?? 'unknown'}`
  )
  if (userChoosesFrontend(userArgs)) return null
  if (!inCoreWindow(version, core.exact, minCoreVersion, maxCoreVersion)) return null
  if (requiredFrontendVersion === null) return null
  if (!semver.gt(grant.version, requiredFrontendVersion)) return null
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
