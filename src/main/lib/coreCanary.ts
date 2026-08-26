/**
 * PostHog-controlled Core beta features for Desktop launches.
 *
 * The PostHog flag is a boolean/multivariate targeting gate. Its matched JSON
 * payload has this deliberately small contract:
 *
 *     { "flags": ["enable-assets"] }
 *
 * Values are Core CLI flag names without leading dashes. At launch, every
 * requested name is checked against that installation's live `--help` schema.
 * Only boolean `enable-*` switches in Core's `features` category are accepted;
 * paths, network settings, Manager controls, and value-taking arguments can
 * never be introduced through remote configuration.
 */
import type { ComfyArgsSchema } from './comfy-args'
import * as mainTelemetry from './telemetry'

export const CORE_CANARY_FLAG_KEY = 'desktop_core_beta_features'

const DEFAULT_TIMEOUT_MS = 2000
const MAX_FLAGS = 32
const CORE_FLAG_NAME_RE = /^enable-[a-z0-9][a-z0-9-]*$/

export interface CoreCanaryConfig {
  flags: string[]
}

const EMPTY_CONFIG: CoreCanaryConfig = Object.freeze({ flags: [] })

let cached: CoreCanaryConfig = EMPTY_CONFIG
let initPromise: Promise<void> | null = null

function isEnabled(value: mainTelemetry.FeatureFlagValue): boolean {
  return value === true || typeof value === 'string'
}

/** Parse the remote payload without trusting it as command-line input. */
export function parseCoreCanaryConfig(
  value: mainTelemetry.FeatureFlagValue,
  payload: unknown
): CoreCanaryConfig {
  if (!isEnabled(value) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return EMPTY_CONFIG
  }

  const requested = (payload as { flags?: unknown }).flags
  if (!Array.isArray(requested) || requested.length > MAX_FLAGS) return EMPTY_CONFIG

  const flags: string[] = []
  const seen = new Set<string>()
  for (const candidate of requested) {
    if (typeof candidate !== 'string' || !CORE_FLAG_NAME_RE.test(candidate)) continue
    if (seen.has(candidate)) continue
    seen.add(candidate)
    flags.push(candidate)
  }
  return flags.length > 0 ? { flags } : EMPTY_CONFIG
}

/**
 * Resolve remote names through the running Core version's discovered schema.
 * This is the trust boundary that turns configuration into argv entries.
 */
export function resolveCoreCanaryLaunchArgs(
  config: CoreCanaryConfig,
  schema: ComfyArgsSchema
): string[] {
  if (config.flags.length === 0) return []
  const definitions = new Map(schema.args.map((arg) => [arg.name, arg]))
  return config.flags.flatMap((name) => {
    const definition = definitions.get(name)
    return definition?.type === 'boolean' && definition.category === 'features'
      ? [definition.flag]
      : []
  })
}

/** Boot-time fetch. Idempotent within a process and never rejects. */
export function initCoreCanary(opts: { distinctId: string; timeoutMs?: number }): Promise<void> {
  if (initPromise) return initPromise
  initPromise = mainTelemetry
    .getOpsFlagResult(CORE_CANARY_FLAG_KEY, opts.distinctId, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    .then((result) => {
      cached = result ? parseCoreCanaryConfig(result.value, result.payload) : EMPTY_CONFIG
    })
    .catch(() => {
      cached = EMPTY_CONFIG
    })
  return initPromise
}

/** Await the boot fetch so an immediate launch cannot race to the empty fallback. */
export async function getCoreCanaryConfigAsync(): Promise<CoreCanaryConfig> {
  if (initPromise) await initPromise
  return cached
}

/** @internal — exposed for tests. */
export function _resetForTest(): void {
  cached = EMPTY_CONFIG
  initPromise = null
}
