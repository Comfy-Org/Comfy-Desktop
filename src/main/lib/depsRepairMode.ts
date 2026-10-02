/**
 * Remote rollout for the pre-launch requirements repair: the install kinds to
 * repair, as a JSON array payload (`["adopted", "managed"]`), else a
 * comma-separated string payload or value. Adopted installs repair after their
 * prompt, managed installs without asking; the rest only detect and report.
 * Names are trimmed and lowercased, unknown ones ignored; unset, unreachable,
 * empty or a malformed payload repairs nothing. Persists the last fetched list;
 * deleting the flag does NOT revoke it - serve an empty list.
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
  const names = Array.isArray(payload)
    ? payload.filter((name): name is string => typeof name === 'string')
    : typeof payload === 'string'
      ? payload.split(',')
      : payload == null && typeof value === 'string'
        ? value.split(',')
        : []
  const named = new Set(names.map((name) => name.trim().toLowerCase()))
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
