// Fail directions for the two first-use Cloud ops switches.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getOpsFlag = vi.fn()
vi.mock('./telemetry', () => ({ getOpsFlag: (...args: unknown[]) => getOpsFlag(...args) }))

import {
  cloudRecoSwitch,
  cloudFreeRunsSwitch,
  CLOUD_RECO_FLAG_KEY,
  CLOUD_FREE_RUNS_FLAG_KEY
} from './cloudSwitches'

type Switch = typeof cloudRecoSwitch

async function resolveWith(sw: Switch, value: unknown): Promise<boolean> {
  getOpsFlag.mockResolvedValue(value)
  await sw.init({ distinctId: 'anon' })
  return sw.getAsync()
}

beforeEach(() => {
  cloudRecoSwitch._resetForTest()
  cloudFreeRunsSwitch._resetForTest()
  getOpsFlag.mockReset()
})

describe('cloudRecoSwitch — fails open', () => {
  it.each([['off'], [false]])('%s disables the recommendation', async (value) => {
    expect(await resolveWith(cloudRecoSwitch, value)).toBe(false)
  })

  it.each([['on'], [true], [undefined], ['garbage']])(
    'keeps the recommendation on for %s',
    async (value) => {
      // A missing flag, a timed-out fetch, or a value nobody recognises
      // must not silently pull a working feature. Only an explicit off
      // counts as ops deciding to kill it.
      expect(await resolveWith(cloudRecoSwitch, value)).toBe(true)
    }
  )

  it('keeps the recommendation on when the fetch rejects', async () => {
    getOpsFlag.mockRejectedValue(new Error('network'))
    await cloudRecoSwitch.init({ distinctId: 'anon' })
    expect(await cloudRecoSwitch.getAsync()).toBe(true)
  })
})

describe('cloudFreeRunsSwitch — fails closed', () => {
  it.each([['on'], [true]])('%s enables the pill', async (value) => {
    expect(await resolveWith(cloudFreeRunsSwitch, value)).toBe(true)
  })

  it.each([['off'], [false], [undefined], ['garbage']])(
    'keeps the pill hidden for %s',
    async (value) => {
      // The pill asserts a live entitlement. Anything short of an explicit
      // yes means we can't confirm the offer, so we don't make it.
      expect(await resolveWith(cloudFreeRunsSwitch, value)).toBe(false)
    }
  )

  it('keeps the pill hidden when the fetch rejects', async () => {
    getOpsFlag.mockRejectedValue(new Error('network'))
    await cloudFreeRunsSwitch.init({ distinctId: 'anon' })
    expect(await cloudFreeRunsSwitch.getAsync()).toBe(false)
  })
})

describe('shared ops-switch plumbing', () => {
  it('uses the ops-flag path, which bypasses the telemetry consent gate', async () => {
    // The surface these govern renders while consent is still 'undecided'.
    // Reading them through the consent-gated experiments cache would leave
    // ops holding switches that can never fire.
    await resolveWith(cloudRecoSwitch, 'off')
    expect(getOpsFlag).toHaveBeenCalledWith(CLOUD_RECO_FLAG_KEY, 'anon', expect.any(Number))
    getOpsFlag.mockClear()
    await resolveWith(cloudFreeRunsSwitch, 'on')
    expect(getOpsFlag).toHaveBeenCalledWith(CLOUD_FREE_RUNS_FLAG_KEY, 'anon', expect.any(Number))
  })

  it('the pill reads cloud’s free-tier flag, not a desktop mirror', async () => {
    // Tracking the real rollout means there's nothing to keep in sync: the
    // pill appears when free-tier submission actually becomes available.
    expect(CLOUD_FREE_RUNS_FLAG_KEY).toBe('free_tier_workflow_submission_enabled')
  })

  it('the two switches are independent', async () => {
    // Retiring the GPU upsell must not silently pull a live free-tier
    // offer, and vice versa.
    getOpsFlag.mockImplementation((key: string) =>
      Promise.resolve(key === CLOUD_RECO_FLAG_KEY ? 'off' : 'on')
    )
    await Promise.all([
      cloudRecoSwitch.init({ distinctId: 'anon' }),
      cloudFreeRunsSwitch.init({ distinctId: 'anon' })
    ])
    expect(await cloudRecoSwitch.getAsync()).toBe(false)
    expect(await cloudFreeRunsSwitch.getAsync()).toBe(true)
  })

  it('awaits the in-flight boot fetch rather than returning the default', async () => {
    let release: (v: unknown) => void = () => {}
    getOpsFlag.mockReturnValue(
      new Promise((r) => {
        release = r
      })
    )
    void cloudRecoSwitch.init({ distinctId: 'anon' })
    const pending = cloudRecoSwitch.getAsync()
    release('off')
    // A renderer query landing before the fetch settles must see the
    // resolved value, not the fail direction.
    expect(await pending).toBe(false)
  })

  it('is idempotent within a process — one fetch regardless of callers', async () => {
    getOpsFlag.mockResolvedValue('off')
    await Promise.all([
      cloudRecoSwitch.init({ distinctId: 'anon' }),
      cloudRecoSwitch.init({ distinctId: 'anon' })
    ])
    expect(getOpsFlag).toHaveBeenCalledTimes(1)
  })
})
