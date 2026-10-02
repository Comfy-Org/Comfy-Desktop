/**
 * Remote rollout scope for the pre-launch requirements repair. `off` (also the
 * fallback when unset, unreachable or unrecognised) only detects and reports;
 * `adopted` repairs adopted installs after their prompt; `all` also repairs
 * managed installs without asking. Persists the last fetched value; deleting
 * the flag does NOT revoke it - serve `off`.
 */
import { makeOpsFlag } from './opsFlag'

export const DEPS_REPAIR_MODE_FLAG_KEY = 'deps_repair_mode'

export type DepsRepairFlag = 'off' | 'adopted' | 'all'

const flag = makeOpsFlag<DepsRepairFlag>({
  key: DEPS_REPAIR_MODE_FLAG_KEY,
  fallback: 'off',
  parse: (value) => (value === 'off' || value === 'adopted' || value === 'all' ? value : undefined),
  logLabel: 'deps-repair-mode',
  persist: true
})

export const initDepsRepairMode = flag.init

export const getDepsRepairModeAsync = flag.get

/** @internal — exposed for tests. */
export const _resetForTest = flag._resetForTest
