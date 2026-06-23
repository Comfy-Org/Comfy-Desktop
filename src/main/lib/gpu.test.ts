import { describe, expect, it } from 'vitest'
import {
  parseNvidiaDriverVersion,
  isVirtualGpu,
  selectPrimaryGpu,
  parseAmdSmiDriverVersion,
  parseRocmSmiDriverVersion,
  type SystemGpuEntry
} from './gpu'

describe('parseNvidiaDriverVersion', () => {
  it('parses driver version from nvidia-smi table output', () => {
    const output = `
+-----------------------------------------------------------------------------------------+
| NVIDIA-SMI 591.59                 Driver Version: 591.59         CUDA Version: 13.1     |
|  GPU  Name                     TCC/WDDM  | Bus-Id          Disp.A | Volatile Uncorr. ECC |
+-----------------------------------------------------------------------------------------+`
    expect(parseNvidiaDriverVersion(output)).toBe('591.59')
  })

  it('parses driver version case-insensitively', () => {
    expect(parseNvidiaDriverVersion('driver version: 535.129.03')).toBe('535.129.03')
    expect(parseNvidiaDriverVersion('DRIVER VERSION: 580.00')).toBe('580.00')
  })

  it('returns undefined for output without driver version', () => {
    expect(parseNvidiaDriverVersion('No devices found')).toBeUndefined()
    expect(parseNvidiaDriverVersion('')).toBeUndefined()
  })

  it('handles Linux-style three-part versions', () => {
    expect(parseNvidiaDriverVersion('Driver Version: 535.183.01')).toBe('535.183.01')
  })
})

const gpu = (
  vendor: string,
  model: string,
  vram_mb: number | null = null,
  driver_version: string | null = null
): SystemGpuEntry => ({ vendor, model, vram_mb, driver_version })

describe('isVirtualGpu', () => {
  it('flags known virtual / remote display adapters', () => {
    expect(isVirtualGpu('Microsoft Basic Render Driver')).toBe(true)
    expect(isVirtualGpu('Microsoft Remote Display Adapter')).toBe(true)
    expect(isVirtualGpu('Parsec Virtual Display Adapter')).toBe(true)
    expect(isVirtualGpu('VMware SVGA 3D')).toBe(true)
    expect(isVirtualGpu('Oracle VirtualBox Graphics Adapter')).toBe(true)
    expect(isVirtualGpu('spacedesk Graphics Adapter')).toBe(true)
  })

  it('flags hypervisor / software-render adapters', () => {
    expect(isVirtualGpu('Microsoft Hyper-V Video')).toBe(true)
    expect(isVirtualGpu('Red Hat VirtIO GPU')).toBe(true)
    expect(isVirtualGpu('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true)
    expect(isVirtualGpu('Microsoft Basic Display Adapter')).toBe(true)
  })

  it('does not flag real GPUs', () => {
    expect(isVirtualGpu('NVIDIA GeForce RTX 4090')).toBe(false)
    expect(isVirtualGpu('AMD Radeon RX 7900 XTX')).toBe(false)
    expect(isVirtualGpu('Intel Arc A770')).toBe(false)
    expect(isVirtualGpu(null)).toBe(false)
    expect(isVirtualGpu('')).toBe(false)
  })
})

describe('selectPrimaryGpu', () => {
  it('returns null for an empty list', () => {
    expect(selectPrimaryGpu([], 'nvidia')).toBeNull()
  })

  it('skips a leading virtual display in favour of the real GPU', () => {
    const gpus = [
      gpu('Microsoft', 'Microsoft Basic Render Driver', null),
      gpu('NVIDIA', 'NVIDIA GeForce RTX 4090', 24576, '591.59')
    ]
    expect(selectPrimaryGpu(gpus, 'nvidia')?.model).toBe('NVIDIA GeForce RTX 4090')
  })

  it('prefers the controller matching the detected vendor', () => {
    const gpus = [
      gpu('Intel Corporation', 'Intel UHD Graphics 770', 128),
      gpu('NVIDIA', 'NVIDIA GeForce RTX 4080', 16384)
    ]
    expect(selectPrimaryGpu(gpus, 'nvidia')?.model).toBe('NVIDIA GeForce RTX 4080')
    expect(selectPrimaryGpu(gpus, 'intel')?.model).toBe('Intel UHD Graphics 770')
  })

  it('breaks ties on VRAM within the matched vendor', () => {
    const gpus = [
      gpu('NVIDIA', 'NVIDIA RTX A2000', 6144),
      gpu('NVIDIA', 'NVIDIA GeForce RTX 4090', 24576)
    ]
    expect(selectPrimaryGpu(gpus, 'nvidia')?.model).toBe('NVIDIA GeForce RTX 4090')
  })

  it('falls back to highest-VRAM real GPU when vendor does not match', () => {
    const gpus = [
      gpu('Microsoft', 'Microsoft Basic Render Driver', null),
      gpu('AMD', 'AMD Radeon RX 6600', 8192),
      gpu('AMD', 'AMD Radeon RX 7900 XTX', 24576)
    ]
    expect(selectPrimaryGpu(gpus, null)?.model).toBe('AMD Radeon RX 7900 XTX')
  })

  it('falls back to a virtual adapter only when nothing else exists', () => {
    const gpus = [gpu('Microsoft', 'Microsoft Basic Render Driver', null)]
    expect(selectPrimaryGpu(gpus, 'nvidia')?.model).toBe('Microsoft Basic Render Driver')
  })

  it('matches the detected vendor via the model name when vendor is empty', () => {
    const gpus = [
      gpu('Microsoft', 'Microsoft Basic Render Driver', null),
      gpu('', 'Intel UHD Graphics 770', 2048),
      gpu('', 'NVIDIA GeForce RTX 4090', 24576)
    ]
    // Without model matching, the empty-vendor NVIDIA card would be skipped and
    // the higher-VRAM card picked by tie-break regardless of vendor.
    expect(selectPrimaryGpu(gpus, 'nvidia')?.model).toBe('NVIDIA GeForce RTX 4090')
    expect(selectPrimaryGpu(gpus, 'intel')?.model).toBe('Intel UHD Graphics 770')
  })

  it('matches AMD via Radeon-branded model with empty vendor', () => {
    const gpus = [
      gpu('', 'NVIDIA GeForce RTX 4090', 24576),
      gpu('', 'Radeon RX 7900 XTX', 24576)
    ]
    expect(selectPrimaryGpu(gpus, 'amd')?.model).toBe('Radeon RX 7900 XTX')
  })
})

describe('parseAmdSmiDriverVersion', () => {
  it('parses the driver version from amd-smi static --json array output', () => {
    const out = JSON.stringify([
      { gpu: 0, driver: { name: 'amdgpu', version: '6.9.0-rc5+' } },
      { gpu: 1, driver: { name: 'amdgpu', version: '6.9.0-rc5+' } }
    ])
    expect(parseAmdSmiDriverVersion(out)).toBe('6.9.0-rc5+')
  })

  it('tolerates uppercase VERSION key and object (non-array) shape', () => {
    const out = JSON.stringify({ driver: { NAME: 'amdgpu', VERSION: '6.8.5' } })
    expect(parseAmdSmiDriverVersion(out)).toBe('6.8.5')
  })

  it('tolerates an uppercase DRIVER section key', () => {
    const out = JSON.stringify([{ DRIVER: { NAME: 'amdgpu', VERSION: '6.9.0-rc5+' } }])
    expect(parseAmdSmiDriverVersion(out)).toBe('6.9.0-rc5+')
  })

  it('parses a flat driver_version / DRIVER_VERSION key', () => {
    expect(parseAmdSmiDriverVersion(JSON.stringify([{ driver_version: '6.8.5' }]))).toBe('6.8.5')
    expect(parseAmdSmiDriverVersion(JSON.stringify({ DRIVER_VERSION: '5.7.1' }))).toBe('5.7.1')
  })

  it('returns undefined for malformed or empty output', () => {
    expect(parseAmdSmiDriverVersion('not json')).toBeUndefined()
    expect(parseAmdSmiDriverVersion(JSON.stringify([{ gpu: 0 }]))).toBeUndefined()
    expect(parseAmdSmiDriverVersion('')).toBeUndefined()
  })
})

describe('parseRocmSmiDriverVersion', () => {
  it('parses the system-scoped driver version', () => {
    const out = JSON.stringify({ system: { 'Driver version': '6.8.5' } })
    expect(parseRocmSmiDriverVersion(out)).toBe('6.8.5')
  })

  it('parses a per-card driver version', () => {
    const out = JSON.stringify({ card0: { 'Driver version': '5.0.71' } })
    expect(parseRocmSmiDriverVersion(out)).toBe('5.0.71')
  })

  it('returns undefined when no driver version key is present', () => {
    expect(parseRocmSmiDriverVersion(JSON.stringify({ system: {} }))).toBeUndefined()
    expect(parseRocmSmiDriverVersion('not json')).toBeUndefined()
  })
})
