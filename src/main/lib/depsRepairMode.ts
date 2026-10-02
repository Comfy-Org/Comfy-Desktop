/**
 * Remote rollout for the pre-launch requirements repair: the install kinds to
 * repair, as a JSON array payload (`["adopted", "managed"]`), else a
 * comma-separated string payload or value. Adopted installs repair after their
 * prompt, managed installs without asking; the rest only detect and report.
 * Names are trimmed and lowercased, unknown ones ignored; unset, unreachable,
 * empty or a malformed payload repairs nothing. Not persisted: each launch reads
 * the flag afresh, so an unreachable flag repairs nothing and an emergency
 * empty list (or deleting the flag) takes effect on the next launch.
 */
import type { FeatureFlagValue } from './telemetry'
import { makeOpsFlag } from './opsFlag'

export const DEPS_REPAIR_MODE_FLAG_KEY = 'deps_repair_mode'

const KINDS = ['adopted', 'managed'] as const
export type DepsRepairKind = (typeof KINDS)[number]
export type DepsRepairFlag = readonly DepsRepairKind[]

/** Variant names that mean off whatever the payload says, as in `coreBetaGrants.ts`. */
const OFF_VARIANTS = new Set(['control', 'off', 'false', 'disabled'])

export function parseDepsRepairKinds(
  value: FeatureFlagValue | undefined,
  payload: unknown
): DepsRepairFlag {
  // A disabled flag (or an off variant) keeps its payload (`toOpsFlagValue`), and disabling
  // must stop the repair.
  if (value === false || (typeof value === 'string' && OFF_VARIANTS.has(value.toLowerCase())))
    return []
  const names = Array.isArray(payload)
    ? payload
        .filter((name): name is string => typeof name === 'string')
        .flatMap((name) => name.split(','))
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
  logLabel: 'deps-repair-mode'
})

export const initDepsRepairMode = flag.init

export const getDepsRepairModeAsync = flag.get

/** @internal — exposed for tests. */
export const _resetForTest = flag._resetForTest
