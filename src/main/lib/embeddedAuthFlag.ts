/**
 * Gate for handing Desktop's OAuth session to the embedded ComfyUI view
 * (`__comfyDesktop2.Auth`). An ops flag so it can be ramped without a release.
 *
 * Fails CLOSED: off, the view keeps its own Firebase sign-in exactly as before.
 */
import { makeOpsFlag } from './opsFlag'

export const EMBEDDED_OAUTH_SESSION_FLAG_KEY = 'desktop_embedded_oauth_session'

const flag = makeOpsFlag<boolean>({
  key: EMBEDDED_OAUTH_SESSION_FLAG_KEY,
  fallback: false,
  parse: (value) => value === true || value === 'on'
})

/** Boot-time fetch. Idempotent within a process; never rejects. */
export const initEmbeddedOAuthSessionFlag = flag.init

export const isEmbeddedOAuthSessionEnabled = flag.get

/** @internal exposed for tests. */
export const _resetForTest = flag._resetForTest
