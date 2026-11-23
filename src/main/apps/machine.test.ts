import { afterEach, describe, expect, it, vi } from 'vitest'

import { setHardwareProbe } from '../lib/agentClientContext'
import { machine } from './machine'

const gpu = (model: string, vendor = '') => ({ vendor, model, vram_mb: null, driver_version: null })
const VMWARE = gpu('VMware SVGA 3D', 'VMware, Inc.')
const HYPER_V = gpu('Microsoft Hyper-V Video', 'Microsoft')

function probeFinds(hardware: Record<string, unknown>): void {
  setHardwareProbe(async () => hardware)
}

afterEach(() => {
  setHardwareProbe(null)
  vi.useRealTimers()
})

describe('the GPU memory Desktop tells an app page', () => {
  it.each([
    ['win32', 8188, 8],
    ['linux', 24564, 24],
    ['win32', 128, 0]
  ] as const)('on %s with %d MB is %d', async (platform, mb, gb) => {
    probeFinds({ gpu_vendor: 'nvidia', gpu_vram_mb: mb, gpu_vram_gb: gb, gpus: [] })

    expect(await machine(platform)).toEqual({ platform, gpuMemoryGb: gb })
  })

  it.each([
    ['the probe knows no memory', 'win32', null, null],
    ['the probe reports zero, as when Windows gives no number', 'win32', 0, 0],
    ['Linux reports under half a gigabyte, the size of a PCI window', 'linux', 256, 0]
  ] as const)('is left out when %s', async (_case, platform, mb, gb) => {
    probeFinds({ gpu_vendor: 'amd', gpu_vram_mb: mb, gpu_vram_gb: gb, gpus: [gpu('Radeon')] })

    expect(await machine(platform)).toEqual({ platform })
  })

  it.each([
    ['no probe is set', null],
    ['the probe fails', async () => Promise.reject(new Error('no GPU'))]
  ])('is left out when %s', async (_case, probe) => {
    setHardwareProbe(probe)

    expect(await machine('win32')).toEqual({ platform: 'win32' })
  })

  it('is left out when the probe takes too long', async () => {
    vi.useFakeTimers()
    setHardwareProbe(() => new Promise(() => {}))

    const answer = machine('win32')
    await vi.advanceTimersByTimeAsync(5000)

    expect(await answer).toEqual({ platform: 'win32' })
  })
})

describe('no GPU, as Desktop tells an app page', () => {
  const NONE = { gpu_vendor: null, gpu_vram_mb: 1024, gpu_vram_gb: 1 }

  it.each(['win32', 'linux'] as const)(
    'is said on %s when each display adapter is a virtual machine one',
    async (platform) => {
      probeFinds({ ...NONE, gpus: [VMWARE, HYPER_V] })

      expect(await machine(platform)).toEqual({ platform, noGpu: true })
    }
  )

  it.each([
    ['the probe lists no adapter, as when it fails', { gpus: [] }],
    ['there is also a card Desktop cannot measure', { gpus: [VMWARE, gpu('Adreno X1-85')] }],
    ['Desktop found a vendor', { gpu_vendor: 'nvidia', gpus: [HYPER_V] }],
    ['an adapter is a remote desktop, which can hide the card', { gpus: [gpu('Remote Desktop')] }],
    ['an adapter has no driver', { gpus: [gpu('Microsoft Basic Display Adapter')] }]
  ])('is not said when %s', async (_case, hardware) => {
    probeFinds({ ...NONE, gpu_vram_mb: null, gpu_vram_gb: null, ...hardware })

    expect(await machine('win32')).toEqual({ platform: 'win32' })
  })

  it('is never said on a Mac', async () => {
    probeFinds({ ...NONE, gpu_vram_mb: null, gpu_vram_gb: null, gpus: [VMWARE] })

    expect(await machine('darwin')).toEqual({ platform: 'darwin' })
  })
})
