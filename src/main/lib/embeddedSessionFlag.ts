import { makeOpsFlag } from './opsFlag'

export const EMBEDDED_SESSION_FLAG_KEY = 'desktop_embedded_oauth_session'

const flag = makeOpsFlag<boolean>({
  key: EMBEDDED_SESSION_FLAG_KEY,
  fallback: false,
  parse: (value) => value === true || value === 'on'
})

export const initEmbeddedSessionFlag = flag.init

export const isEmbeddedSessionEnabled = flag.get

export const _resetForTest = flag._resetForTest
