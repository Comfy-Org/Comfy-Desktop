/**
 * PostHog-controlled Core beta features for newly created installations.
 *
 * The flag is a boolean/multivariate targeting gate whose matched JSON payload
 * names the Core CLI flags to pre-fill:
 *
 *     { "flags": ["enable-assets"] }
 *
 * Enrollment happens exactly once, when the install wizard builds the record:
 * the enabled flags are appended to that install's `launchArgs` — the same
 * user-facing field that already carries `--enable-manager` and the CPU
 * variant's `--cpu` (see `sources/standalone/index.ts`). From then on they are
 * ordinary launch args: visible and removable in the args-builder UI, and
 * dropped automatically by `filterUnsupportedArgs` if the install's Core build
 * doesn't recognise them.
 *
 * Nothing reads this at launch, so an install's flags never change under it.
 * Existing installations are structurally excluded rather than filtered out:
 * adoption, standalone migration, snapshot restore and copy all build their
 * records without going through the wizard's `build-installation` handler.
 *
 * Turning the PostHog flag off stops new enrollments immediately; it does not
 * retract args already written, which would need a record migration.
 */
import { makeOpsFlag } from './opsFlag'
import type { FeatureFlagValue } from './telemetry'

export const CORE_CANARY_FLAG_KEY = 'desktop_core_beta_features'

/**
 * The Core flags remote configuration may pre-fill.
 *
 * Deliberately a hardcoded allowlist rather than a name pattern: there is no
 * `--help` schema to validate against at record-build time (ComfyUI isn't
 * downloaded yet), and `enable-*` is not a safe shape on its own —
 * `--enable-cors-header` takes an optional value and bare means "allow every
 * origin". Adding an entry here is a reviewed Desktop change; choosing among
 * them, and who gets them, stays remote.
 */
export const CORE_CANARY_ALLOWED_FLAGS: readonly string[] = [
  'enable-assets',
  'enable-asset-hashing'
]

const MAX_FLAGS = 32

/** PostHog's default multivariate flag ships a `control` variant. Treat the
 *  conventional off-names as disabled so a control group is never enrolled,
 *  even if the payload was copied across every variant. */
const OFF_VARIANTS = new Set(['control', 'off', 'false', 'disabled'])

function isEnabled(value: FeatureFlagValue | undefined): boolean {
  if (value === true) return true
  return typeof value === 'string' && !OFF_VARIANTS.has(value.toLowerCase())
}

/** Parse the remote payload without trusting it as command-line input. Returns
 *  the allowlisted flag names, or `[]` for anything disabled or malformed. */
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

/**
 * Merge the enabled flags into a launch-args string.
 *
 * Skips a flag the string already sets, and one whose conventional `--disable-*`
 * opposite is already there — a source's `DEFAULT_LAUNCH_ARGS` is authoritative
 * over remote configuration.
 */
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
  // Fail closed: a miss, a timeout, or an unrecognised payload enrolls nobody.
  fallback: [],
  parse: parseCoreCanaryFlags,
  // The only control surface is a remote JSON blob, so log what the parse
  // accepted — otherwise a payload naming a flag outside the allowlist is
  // indistinguishable from the flag being off.
  logLabel: 'core-canary'
})

/** Boot-time fetch. Idempotent within a process; never rejects. */
export const initCoreCanary = flag.init

/** Awaits the in-flight boot fetch so a wizard finishing before it settles
 *  still sees the resolved flags rather than the fail-closed default. */
export const getCoreCanaryFlagsAsync = flag.get

/** @internal — exposed for tests. */
export const _resetForTest = flag._resetForTest

/**
 * Pre-fill the enabled Core beta flags on a record the install wizard just
 * built. No-op for sources without launch args (Cloud, remote) and when the
 * flags are already covered by the source's defaults.
 */
export async function withCoreCanaryLaunchArgs<T extends Record<string, unknown>>(
  record: T
): Promise<T> {
  if (typeof record.launchArgs !== 'string') return record
  const launchArgs = appendCoreCanaryFlags(record.launchArgs, await getCoreCanaryFlagsAsync())
  if (launchArgs === record.launchArgs) return record
  console.info('[core-canary] Pre-filled Core beta flags on a new installation:', launchArgs)
  return { ...record, launchArgs }
}
