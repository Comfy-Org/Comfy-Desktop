/**
 * Remote kill switch for the pre-launch requirements repair: `off` stops every
 * repair (drift is still detected and reported). Fails open to `auto` and
 * persists the last fetched value. Deleting the flag does NOT revoke an `off`:
 * serve `auto`.
 */
import { makeOpsFlag } from './opsFlag'

export const DEPS_REPAIR_MODE_FLAG_KEY = 'deps_repair_mode'

export type DepsRepairFlag = 'auto' | 'off'

const flag = makeOpsFlag<DepsRepairFlag>({
  key: DEPS_REPAIR_MODE_FLAG_KEY,
  fallback: 'auto',
  parse: (value) => (value === 'off' || value === 'auto' ? value : undefined),
  logLabel: 'deps-repair-mode',
  persist: true
})

export const initDepsRepairMode = flag.init

export const getDepsRepairModeAsync = flag.get

/** @internal — exposed for tests. */
export const _resetForTest = flag._resetForTest
