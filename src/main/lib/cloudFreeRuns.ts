import { makeOpsFlag } from './opsFlag'

export const CLOUD_FREE_RUNS_FLAG_KEY = 'free_tier_workflow_submission_enabled'

const flag = makeOpsFlag<boolean>({
  key: CLOUD_FREE_RUNS_FLAG_KEY,
  fallback: false,
  parse: (value) => value === true || value === 'on'
})

export const initCloudFreeRuns = flag.init

export const getCloudFreeRunsEnabledAsync = flag.get

export const _resetForTest = flag._resetForTest
