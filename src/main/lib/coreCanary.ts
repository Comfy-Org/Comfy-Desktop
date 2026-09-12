/**
 * PostHog-controlled Core beta flags for installations created by the wizard.
 * Flags are written to `launchArgs` once; existing installations are never
 * enrolled, and disabling the remote flag does not remove saved args.
 */
import { makeOpsFlag } from './opsFlag'
import type { FeatureFlagValue } from './telemetry'

export const CORE_CANARY_FLAG_KEY = 'desktop_core_beta_features'

/** Explicit because ComfyUI is not installed yet and not every bare
 * `enable-*` flag is safe (`--enable-cors-header` allows every origin). */
export const CORE_CANARY_ALLOWED_FLAGS: readonly string[] = [
  'enable-assets',
  'enable-asset-hashing'
]

const MAX_FLAGS = 32

// Prevent a control payload copied between PostHog variants from enrolling users.
const OFF_VARIANTS = new Set(['control', 'off', 'false', 'disabled'])

function isEnabled(value: FeatureFlagValue | undefined): boolean {
  if (value === true) return true
  return typeof value === 'string' && !OFF_VARIANTS.has(value.toLowerCase())
}

export function parseCoreCanaryFlags(
  value: FeatureFlagValue | undefined,
  payload: unknown
): string[] {
  if (!isEnabled(value) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return []
  }
  const requested = (payload as { flags?: unknown }).flags
  if (!Array.isArray(requested) || requested.length > MAX_FLAGS) return []

  const allowed = new Set(CORE_CANARY_ALLOWED_FLAGS)
  const flags: string[] = []
  for (const candidate of requested) {
    if (typeof candidate !== 'string') continue
    if (!allowed.has(candidate) || flags.includes(candidate)) continue
    flags.push(candidate)
  }
  return flags
}

// Source defaults, including explicit `--disable-*` flags, take precedence.
export function appendCoreCanaryFlags(launchArgs: string, flags: string[]): string {
  if (flags.length === 0) return launchArgs
  const present = new Set(
    launchArgs
      .split(/\s+/)
      .filter((token) => token.startsWith('--'))
      .map((token) => token.slice(2).replace(/=.*$/, ''))
  )
  const additions = flags
    .filter((name) => {
      if (present.has(name)) return false
      const opposite = name.startsWith('enable-') ? `disable-${name.slice('enable-'.length)}` : null
      return !(opposite && present.has(opposite))
    })
    .map((name) => `--${name}`)
  return additions.length > 0 ? [launchArgs, ...additions].join(' ').trim() : launchArgs
}

const flag = makeOpsFlag<string[]>({
  key: CORE_CANARY_FLAG_KEY,
  fallback: [],
  parse: parseCoreCanaryFlags,
  logLabel: 'core-canary'
})

export const initCoreCanary = flag.init

export const getCoreCanaryFlagsAsync = flag.get

export const _resetForTest = flag._resetForTest

export async function withCoreCanaryLaunchArgs<T extends Record<string, unknown>>(
  record: T
): Promise<T> {
  if (typeof record.launchArgs !== 'string') return record
  const launchArgs = appendCoreCanaryFlags(record.launchArgs, await getCoreCanaryFlagsAsync())
  if (launchArgs === record.launchArgs) return record
  console.info('[core-canary] Pre-filled Core beta flags on a new installation:', launchArgs)
  return { ...record, launchArgs }
}
