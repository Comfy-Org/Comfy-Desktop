/**
 * Remote rollout for the pre-launch requirements repair: the install kinds to
 * repair, as a JSON array payload (`["adopted", "managed"]`), else a
 * comma-separated string payload or value. Adopted installs repair after their
 * prompt, managed installs without asking; the rest only detect and report.
 * Names are trimmed and lowercased, unknown ones ignored; unset, unreachable,
 * empty or a malformed payload repairs nothing. Never persisted: each Desktop
 * start reads it afresh (unreachable repairs nothing), and an answer that misses
 * the boot deadline still applies to later launches in that session. An
 * emergency empty list, or deleting the flag, applies from the next start.
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
  // A disabled flag keeps its payload (`toOpsFlagValue`), and disabling must stop the repair.
  if (value === false) return []
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
  lateValue: 'session'
})

export const initDepsRepairMode = flag.init

export const getDepsRepairModeAsync = flag.get

/** How much longer a launch with drift waits for a boot fetch that missed its deadline. */
export const DEPS_REPAIR_LATE_WAIT_MS = 5000

/** For a launch that found drift: also waits for a late flag answer, once per session and
 *  capped, since most sessions launch once and an answer that lands after it helps no one. */
export const getDepsRepairModeForDrift = (): Promise<DepsRepairFlag> =>
  flag.getAllowingLate(DEPS_REPAIR_LATE_WAIT_MS)

/** @internal — exposed for tests. */
export const _resetForTest = flag._resetForTest
