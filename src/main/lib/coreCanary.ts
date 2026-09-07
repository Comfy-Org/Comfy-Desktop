/**
 * PostHog-controlled Core beta grants selected for each launch.
 * Payload entries name allowlisted dashed args and strict Core version windows;
 * launch code applies eligible grants only when beta features are enabled.
 */
import semver from 'semver'
import { makeOpsFlag } from './opsFlag'
import type { FeatureFlagValue } from './telemetry'

export const CORE_CANARY_FLAG_KEY = 'desktop_core_beta_features'

export const CORE_CANARY_ALLOWED_FLAGS = ['--enable-assets', '--enable-asset-hashing'] as const

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

// The version window is min-INCLUSIVE and max-EXCLUSIVE (`>=min <max`). The payload field names
// `min_core_version`/`max_core_version` don't say which way either bound closes, so the boundary
// is settled here and echoed in the selection log rather than by renaming the wire format.
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
    if (!semver.gte(version, minCoreVersion)) continue
    if (maxCoreVersion !== undefined) {
      // An upper bound only means anything on an exact tag match. `coreSemver` resolves from
      // `baseTag`, so a latest-channel install 40 commits past v0.3.99 still measures as 0.3.99
      // and would slip under a `<0.4.0` ceiling it is well past. The lower bound needs no such
      // guard: baseTag lag can only under-report the running code, never over-report it.
      if (!core.exact) continue
      if (!semver.lt(version, maxCoreVersion)) continue
    }
    selected.push(flag)
  }
  return selected
}

// Grants persist across launches, so revoking one is an ops SEQUENCE, not a deletion: serving
// `false` on this key is what takes a grant back. Deleting or archiving the key instead reads as
// `unreachable` — indistinguishable from an offline launch — and HOLDS every grant already on
// disk. Disable first, let clients pick it up, delete only afterwards.
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
