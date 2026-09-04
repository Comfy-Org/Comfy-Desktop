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

export function selectCoreCanaryArgs(
  flags: readonly CoreCanaryFlag[],
  coreVersion: string | null,
  betaEnabled: boolean,
  userArgs: readonly string[]
): CoreCanaryFlag[] {
  if (coreVersion === null || betaEnabled !== true) return []
  const presentArgs = new Set(userArgs)
  return flags.filter(
    ({ arg, minCoreVersion, maxCoreVersion }) =>
      !presentArgs.has(arg) &&
      semver.gte(coreVersion, minCoreVersion) &&
      (maxCoreVersion === undefined || semver.lt(coreVersion, maxCoreVersion))
  )
}

const flag = makeOpsFlag<CoreCanaryFlag[]>({
  key: CORE_CANARY_FLAG_KEY,
  fallback: [],
  parse: parseCoreCanaryFlags,
  logLabel: 'core-canary'
})

export const initCoreCanary = flag.init

export const getCoreCanaryFlagsAsync = flag.get

export const _resetForTest = flag._resetForTest
