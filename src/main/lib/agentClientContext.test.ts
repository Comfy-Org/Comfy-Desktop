import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/tmp', getVersion: () => '1.2.3', getLocale: () => 'en' }
}))

import { agentClientContext, setHardwareProbe } from './agentClientContext'

describe('agentClientContext', () => {
  afterEach(() => {
    setHardwareProbe(null)
    vi.useRealTimers()
  })

  it('is undefined without telemetry consent and never runs the probe', async () => {
    const probe = vi.fn(async () => ({ gpu_tier: 'high' }))
    setHardwareProbe(probe)
    expect(await agentClientContext(false, '1.2.3')).toBeUndefined()
    expect(probe).not.toHaveBeenCalled()
  })

  it('carries the channel and the probed tier', async () => {
    setHardwareProbe(async () => ({ gpu_tier: 'mid' }))
    expect(await agentClientContext(true, '1.2.3-beta.1')).toEqual({
      channel: 'beta',
      gpuTier: 'mid'
    })
  })

  it('sends the channel alone when the probe fails or is not registered', async () => {
    setHardwareProbe(async () => {
      throw new Error('nvidia-smi')
    })
    expect(await agentClientContext(true, '1.2.3')).toEqual({ channel: 'stable' })
    setHardwareProbe(null)
    expect(await agentClientContext(true, '1.2.3')).toEqual({ channel: 'stable' })
  })

  it('never fails the launch on a probe that throws or returns no usable tier', async () => {
    for (const probe of [
      () => {
        throw new Error('sync')
      },
      async () => null,
      async () => ({ gpu_tier: { not: 'a tier' } }),
      async () => ({ gpu_tier: '' })
    ]) {
      setHardwareProbe(probe as never)
      expect(await agentClientContext(true, '1.2.3'), String(probe)).toEqual({ channel: 'stable' })
    }
  })

  it('does not hold the launch past the wait on a slow probe', async () => {
    vi.useFakeTimers()
    setHardwareProbe(() => new Promise(() => {}))
    const ctx = agentClientContext(true, '1.2.3')
    await vi.advanceTimersByTimeAsync(1999)
    let settled = false
    void ctx.then(() => (settled = true))
    await Promise.resolve()
    expect(settled, 'still waiting just under the cap').toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await ctx).toEqual({ channel: 'stable' })
  })
})
