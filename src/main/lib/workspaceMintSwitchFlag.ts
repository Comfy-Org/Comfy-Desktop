import { makeOpsFlag } from './opsFlag'

export const WORKSPACE_MINT_SWITCH_FLAG_KEY = 'desktop_workspace_mint_switch'

const flag = makeOpsFlag<boolean>({
  key: WORKSPACE_MINT_SWITCH_FLAG_KEY,
  fallback: true,
  parse: (value) => (typeof value === 'boolean' ? value : undefined),
  persist: true
})

export const initWorkspaceMintSwitchFlag = flag.init

export const isWorkspaceMintSwitchEnabled = flag.get

export const _resetForTest = flag._resetForTest
