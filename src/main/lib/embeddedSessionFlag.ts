/**
 * Gate for sharing Desktop's Comfy account session with the hosted local
 * ComfyUI view (`__comfyDesktop2.Auth`). Off, the view keeps its own Firebase
 * sign-in exactly as before. Fail-closed, so it is not persisted.
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
