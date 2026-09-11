// Fail-closed semantics for the free-tier availability lookup.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getOpsFlag = vi.fn()
vi.mock('./telemetry', () => ({ getOpsFlag: (...args: unknown[]) => getOpsFlag(...args) }))

import {
  initCloudFreeRuns,
  getCloudFreeRunsEnabledAsync,
  CLOUD_FREE_RUNS_FLAG_KEY,
  _resetForTest
} from './cloudFreeRuns'

async function resolveWith(value: unknown): Promise<boolean> {
  getOpsFlag.mockResolvedValue(value)
  await initCloudFreeRuns({ distinctId: 'anon' })
  return getCloudFreeRunsEnabledAsync()
}

beforeEach(() => {
  _resetForTest()
  getOpsFlag.mockReset()
})

describe('cloudFreeRuns', () => {
  it('reads cloud’s own free-tier flag, not a desktop mirror', async () => {
    // Tracking the real rollout means there's nothing to keep in sync: the
    // pill appears when free-tier submission actually becomes available.
    expect(CLOUD_FREE_RUNS_FLAG_KEY).toBe('free_tier_workflow_submission_enabled')
    await resolveWith('on')
    expect(getOpsFlag).toHaveBeenCalledWith(CLOUD_FREE_RUNS_FLAG_KEY, 'anon', expect.any(Number))
  })

  it.each([['on'], [true]])('%s enables the pill', async (value) => {
    expect(await resolveWith(value)).toBe(true)
  })

  it.each([['off'], [false], [undefined], ['garbage']])(
    'keeps the pill hidden for %s',
    async (value) => {
      // The pill asserts a live entitlement. Anything short of an explicit
      // yes means we can't confirm the offer, so we don't make it.
      expect(await resolveWith(value)).toBe(false)
    }
  )

  it('keeps the pill hidden when the fetch rejects', async () => {
    getOpsFlag.mockRejectedValue(new Error('network'))
    await initCloudFreeRuns({ distinctId: 'anon' })
    expect(await getCloudFreeRunsEnabledAsync()).toBe(false)
  })

  it('awaits the in-flight boot fetch rather than returning the default', async () => {
    let release: (v: unknown) => void = () => {}
    getOpsFlag.mockReturnValue(
      new Promise((r) => {
        release = r
      })
    )
    void initCloudFreeRuns({ distinctId: 'anon' })
    const pending = getCloudFreeRunsEnabledAsync()
    release('on')
    // A renderer query landing before the fetch settles must see the
    // resolved value, not the fail-closed default.
    expect(await pending).toBe(true)
  })

  it('is idempotent within a process — one fetch regardless of callers', async () => {
    getOpsFlag.mockResolvedValue('on')
    await Promise.all([
      initCloudFreeRuns({ distinctId: 'anon' }),
      initCloudFreeRuns({ distinctId: 'anon' })
    ])
    expect(getOpsFlag).toHaveBeenCalledTimes(1)
  })
})
