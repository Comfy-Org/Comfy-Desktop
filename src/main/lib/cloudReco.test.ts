// Fail-open semantics for the `desktop-cloud-reco` ops kill switch.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getOpsFlag = vi.fn()
vi.mock('./telemetry', () => ({ getOpsFlag: (...args: unknown[]) => getOpsFlag(...args) }))

import { initCloudReco, getCloudRecoEnabledAsync, _resetForTest } from './cloudReco'

async function resolveWith(value: unknown): Promise<boolean> {
  getOpsFlag.mockResolvedValue(value)
  await initCloudReco({ distinctId: 'anon' })
  return getCloudRecoEnabledAsync()
}

beforeEach(() => {
  _resetForTest()
  getOpsFlag.mockReset()
})

describe('cloudReco kill switch', () => {
  it.each([['off'], [false]])('%s turns the recommendation off', async (value) => {
    expect(await resolveWith(value)).toBe(false)
  })

  it.each([['on'], [true], [undefined], ['garbage']])(
    'keeps the recommendation on for %s',
    async (value) => {
      // Fail-open: a missing flag, a timed-out fetch, or a value nobody
      // recognises must not silently pull a working feature. Only an
      // explicit off counts as ops deciding to kill it.
      expect(await resolveWith(value)).toBe(true)
    }
  )

  it('keeps the recommendation on when the flag fetch rejects', async () => {
    getOpsFlag.mockRejectedValue(new Error('network'))
    await initCloudReco({ distinctId: 'anon' })
    expect(await getCloudRecoEnabledAsync()).toBe(true)
  })

  it('uses the ops-flag path, which bypasses the telemetry consent gate', async () => {
    // The surface this governs renders while consent is still
    // 'undecided'. Reading it through the consent-gated experiments cache
    // would leave ops holding a switch that can never fire.
    await resolveWith('off')
    expect(getOpsFlag).toHaveBeenCalledWith('desktop-cloud-reco', 'anon', expect.any(Number))
  })

  it('awaits the in-flight boot fetch rather than returning the default', async () => {
    let release: (v: unknown) => void = () => {}
    getOpsFlag.mockReturnValue(
      new Promise((r) => {
        release = r
      })
    )
    void initCloudReco({ distinctId: 'anon' })
    const pending = getCloudRecoEnabledAsync()
    release('off')
    // A renderer query landing before the fetch settles must see the
    // resolved value, not the fail-open default.
    expect(await pending).toBe(false)
  })

  it('is idempotent within a process — one fetch regardless of callers', async () => {
    getOpsFlag.mockResolvedValue('off')
    await Promise.all([
      initCloudReco({ distinctId: 'anon' }),
      initCloudReco({ distinctId: 'anon' })
    ])
    expect(getOpsFlag).toHaveBeenCalledTimes(1)
  })
})
