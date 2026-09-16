/**
 * PostHog-controlled Core beta grants selected for each launch.
 * Payload entries name allowlisted dashed args and strict Core version windows;
 * launch code applies eligible grants only when beta features are enabled.
 *
 * This system may only ADD args. It has no authority over the user's own launch arguments and
 * never removes or overrides one — several of these flags are first-class, user-settable
 * options in Desktop's launch-args UI, so a grant is an addition on top of what the user asked
 * for, never a substitute for it.
 */
import semver from 'semver'
import { makeOpsFlag } from './opsFlag'
import type { FeatureFlagValue } from './telemetry'

export const CORE_CANARY_FLAG_KEY = 'desktop_core_beta_features'

/**
 * The args a PostHog payload may GRANT. That is this list's only job — it is not a registry of
 * canary-owned tokens, and membership says nothing about whether a user may pass the same arg
 * by hand (they may, and it wins; see `selectCoreCanaryArgs`).
 *
 * An entry need not exist in Core yet: `--disable-assets` is the planned remote force-off for
 * when assets go default-on, and granting an arg Core cannot parse is already safe — the
 * running core's supported-argument schema filters it and the launch reports it as
 * `dropped_unsupported`.
 */
export const CORE_CANARY_ALLOWED_FLAGS = [
  '--enable-assets',
  '--enable-asset-hashing',
  '--disable-assets'
] as const

export type CoreCanaryFlag = {
  readonly arg: string
  readonly minCoreVersion: string
  readonly maxCoreVersion?: string
}

const MAX_FLAGS = 32
const CORE_CANARY_ARG_RE = /^--[a-z][a-z0-9-]+$/

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

export function parseCoreCanaryFlags(
  value: FeatureFlagValue | undefined,
  payload: unknown
): CoreCanaryFlag[] {
  if (!isEnabled(value) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return []
  }
  const requested = 'flags' in payload ? payload.flags : undefined
  if (!Array.isArray(requested) || requested.length > MAX_FLAGS) return []

  const allowed = new Set(CORE_CANARY_ALLOWED_FLAGS)
  const flags: CoreCanaryFlag[] = []
  for (const candidate of requested) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    if (!('arg' in candidate) || typeof candidate.arg !== 'string') continue
    if (!CORE_CANARY_ARG_RE.test(candidate.arg) || !allowed.has(candidate.arg)) continue

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
    flags.push(
      maxCoreVersion === undefined
        ? { arg: candidate.arg, minCoreVersion }
        : { arg: candidate.arg, minCoreVersion, maxCoreVersion }
    )
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

// The version window is min-INCLUSIVE and max-EXCLUSIVE (`>=min <max`). The payload field names
// `min_core_version`/`max_core_version` don't say which way either bound closes, so the boundary
// is settled here and echoed in the selection log rather than by renaming the wire format.
//
// Grants are additive only. A grant is withheld when the user already passed that same arg, and
// equally when they passed its opposite: someone who set `--disable-assets` must not also
// receive `--enable-assets`, and vice versa. Contradictory flags never go on one command line —
// Core's precedence between them is unspecified — and the tie is always broken the same way,
// with the user's own argument winning and the canary yielding.
export function selectCoreCanaryArgs(
  flags: readonly CoreCanaryFlag[],
  core: CoreVersionState,
  betaEnabled: boolean,
  userArgs: readonly string[]
): CoreCanaryFlag[] {
  const version = core.semver
  if (version === null || betaEnabled !== true) return []
  const presentArgs = new Set(userArgs)
  const selected: CoreCanaryFlag[] = []
  for (const flag of flags) {
    const { arg, minCoreVersion, maxCoreVersion } = flag
    const window =
      maxCoreVersion === undefined
        ? `>=${minCoreVersion}`
        : `>=${minCoreVersion} <${maxCoreVersion}`
    console.log(`[core-canary] window ${arg}: ${window} version=${version} exact=${core.exact}`)

    if (presentArgs.has(arg)) continue
    const opposite = oppositeArg(arg)
    if (opposite !== null && presentArgs.has(opposite)) continue
    if (!semver.gte(version, minCoreVersion)) continue
    if (maxCoreVersion !== undefined) {
      // An upper bound only means anything on an exact tag match. `coreSemver` resolves from
      // `baseTag`, so a latest-channel install 40 commits past v0.3.99 still measures as 0.3.99
      // and would slip under a `<0.4.0` ceiling it is well past.
      //
      // `baseTag` usually under-reports the running code, but it can over-report: in the
      // backport case `resolveLocalVersion` assigns the newer tag on a path only reached
      // because that tag is NOT an ancestor. The lower bound has no guard for that. Core's
      // argument schema absorbs the common case, since an install without the feature does not
      // know the flag, so what is left exposed is a minimum raised to require a later FIX.
      if (!core.exact) continue
      if (!semver.lt(version, maxCoreVersion)) continue
    }
    // Selected grants join the conflict set so the checks above hold between two grants too, not
    // just against the user's args. Redundant after `parseCoreCanaryFlags`, load-bearing without it.
    presentArgs.add(arg)
    selected.push(flag)
  }
  return selected
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
const flag = makeOpsFlag<CoreCanaryFlag[]>({
  key: CORE_CANARY_FLAG_KEY,
  fallback: [],
  parse: parseCoreCanaryFlags,
  logLabel: 'core-canary',
  persist: true
})

export const initCoreCanary = flag.init

export const getCoreCanaryFlagsAsync = flag.get

export const _resetForTest = flag._resetForTest
