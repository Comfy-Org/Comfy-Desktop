import { makeOpsFlag } from '../lib/opsFlag'

export const APPS_FLAG_KEY = 'desktop_apps_enabled'

const flag = makeOpsFlag<boolean>({
  key: APPS_FLAG_KEY,
  fallback: false,
  parse: (value) => value === true || value === 'on',
  persist: true
})

export const initAppsFlag = flag.init

export const isAppsFlagOn = flag.get

export const _resetForTest = flag._resetForTest
