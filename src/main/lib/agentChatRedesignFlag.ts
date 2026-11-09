/**
 * Gate for the frontend's redesigned Comfy Agent chat (`agent-chat-redesign`) on
 * local-process installs. On, the launch injects the core feature flag so the
 * frontend served by the local ComfyUI reads it from `/api/features`. Fail-closed,
 * so it is not persisted.
 */
import { makeOpsFlag } from './opsFlag'

export const AGENT_CHAT_REDESIGN_FLAG_KEY = 'desktop_agent_chat_redesign'

const flag = makeOpsFlag<boolean>({
  key: AGENT_CHAT_REDESIGN_FLAG_KEY,
  fallback: false,
  parse: (value) => value === true || value === 'on',
  logLabel: 'agent-chat-redesign'
})

/** Boot-time fetch. Idempotent within a process; never rejects. */
export const initAgentChatRedesignFlag = flag.init

export const isAgentChatRedesignEnabled = flag.get

/** @internal exposed for tests. */
export const _resetForTest = flag._resetForTest
