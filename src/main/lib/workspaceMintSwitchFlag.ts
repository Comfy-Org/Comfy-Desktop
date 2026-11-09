/**
 * Kill switch for minting workspace tokens from Desktop's grant. Serving `false` is the kill, so
 * create it enabled at 100%. Fails open and persists: an unreachable PostHog holds the last answer.
 */
import { makeOpsFlag } from './opsFlag'

export const WORKSPACE_MINT_SWITCH_FLAG_KEY = 'desktop_workspace_mint_switch'

const flag = makeOpsFlag<boolean>({
  key: WORKSPACE_MINT_SWITCH_FLAG_KEY,
  fallback: true,
  parse: (value) => (typeof value === 'boolean' ? value : undefined),
  persist: true
})

/** Boot-time fetch. Idempotent within a process; never rejects. */
export const initWorkspaceMintSwitchFlag = flag.init

export const isWorkspaceMintSwitchEnabled = flag.get

/** @internal exposed for tests. */
export const _resetForTest = flag._resetForTest
