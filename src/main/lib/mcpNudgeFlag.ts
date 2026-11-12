import { makeOpsFlag } from './opsFlag'

export const MCP_NUDGE_FLAG_KEY = 'desktop_mcp_nudge'

const flag = makeOpsFlag<boolean>({
  key: MCP_NUDGE_FLAG_KEY,
  fallback: false,
  parse: (value) => value === true || value === 'on',
  persist: true
})

export const initMcpNudgeFlag = flag.init

export const isMcpNudgeEnabled = flag.get

export const _resetForTest = flag._resetForTest
