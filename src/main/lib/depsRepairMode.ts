/**
 * Remote rollout for the pre-launch requirements repair: a comma-separated list
 * of the install kinds to repair, e.g. `adopted` or `adopted,managed`. Adopted
 * installs repair after their prompt, managed installs without asking; the rest
 * only detect and report. Names are trimmed and lowercased, unknown ones ignored;
 * unset, unreachable or empty repairs nothing. Read from a string payload, else a
 * string value. Persists the last fetched list; deleting the flag does NOT revoke
 * it - serve an empty list.
 */
import type { FeatureFlagValue } from './telemetry'
import { makeOpsFlag } from './opsFlag'

export const DEPS_REPAIR_MODE_FLAG_KEY = 'deps_repair_mode'

const KINDS = ['adopted', 'managed'] as const
export type DepsRepairKind = (typeof KINDS)[number]
export type DepsRepairFlag = readonly DepsRepairKind[]

export function parseDepsRepairKinds(
  value: FeatureFlagValue | undefined,
  payload: unknown
): DepsRepairFlag {
  const list = typeof payload === 'string' ? payload : typeof value === 'string' ? value : ''
  const named = new Set(list.split(',').map((name) => name.trim().toLowerCase()))
  return KINDS.filter((kind) => named.has(kind))
}

const flag = makeOpsFlag<DepsRepairFlag>({
  key: DEPS_REPAIR_MODE_FLAG_KEY,
  fallback: [],
  parse: parseDepsRepairKinds,
  logLabel: 'deps-repair-mode',
  persist: true
})

export const initDepsRepairMode = flag.init

export const getDepsRepairModeAsync = flag.get

/** @internal — exposed for tests. */
export const _resetForTest = flag._resetForTest
