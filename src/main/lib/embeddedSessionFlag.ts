/**
 * Gate for sharing Desktop's Comfy account session with the hosted local
 * ComfyUI view (`__comfyDesktop2.Auth`). Off, the view keeps its own Firebase
 * sign-in exactly as before. Fail-closed, so it is not persisted.
 *
 * Activation gate: keep this off until Cloud has the narrow execution-token
 * exchange (workspace, job, operations, expiry; BE-998 follow-up). Until then
 * the view would run API nodes on Desktop's broad session token, which is a
 * compatibility bridge, not the durable execution credential.
 */
import { makeOpsFlag } from './opsFlag'

export const EMBEDDED_SESSION_FLAG_KEY = 'desktop_embedded_oauth_session'

const flag = makeOpsFlag<boolean>({
  key: EMBEDDED_SESSION_FLAG_KEY,
  fallback: false,
  parse: (value) => value === true || value === 'on'
})

/** Boot-time fetch. Idempotent within a process; never rejects. */
export const initEmbeddedSessionFlag = flag.init

export const isEmbeddedSessionEnabled = flag.get

/** @internal exposed for tests. */
export const _resetForTest = flag._resetForTest
