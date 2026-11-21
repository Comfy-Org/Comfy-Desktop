import { afterEach, describe, expect, it, vi } from 'vitest'

import { machine, setMachineProbe } from './machine'

afterEach(() => {
  setMachineProbe(null)
  vi.useRealTimers()
})

describe('what Desktop tells an app page about this computer', () => {
  it('gives the platform and the GPU memory from the hardware probe', async () => {
    setMachineProbe(async () => ({ gpu_vram_gb: 8 }))

    expect(await machine('win32')).toEqual({ platform: 'win32', gpuMemoryGb: 8 })
  })

  it.each([
    ['no probe is set', null],
    ['the probe knows no GPU memory', async () => ({ gpu_vram_gb: null })],
    ['the probe reports zero', async () => ({ gpu_vram_gb: 0 })],
    ['the probe fails', async () => Promise.reject(new Error('no GPU'))]
  ])('leaves out the GPU memory when %s', async (_case, probe) => {
    setMachineProbe(probe)

    expect(await machine('darwin')).toEqual({ platform: 'darwin' })
  })

  it('gives the platform alone when the probe takes too long', async () => {
    vi.useFakeTimers()
    setMachineProbe(() => new Promise(() => {}))

    const answer = machine('win32')
    await vi.advanceTimersByTimeAsync(5000)

    expect(await answer).toEqual({ platform: 'win32' })
  })

  it('names any platform other than Windows and macOS as linux', async () => {
    expect(await machine('freebsd')).toEqual({ platform: 'linux' })
  })
})
