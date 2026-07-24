import { describe, expect, it } from 'vitest'
import {
  parseNvidiaDriverVersion,
  isVirtualGpu,
  promoteGpuController,
  parseAmdSmiDriverVersion,
  parseRocmSmiDriverVersion,
  parseWmiDriverVersions,
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

describe('promoteGpuController', () => {
  const emptyEnrichment = {
    model: null,
    vram_mb: null,
    vram_gb: null,
    tier: null,
    driver_version: null
  }

  it('promotes one non-virtual controller matching the detected vendor', () => {
    const gpus = [
      gpu('Microsoft', 'Microsoft Basic Render Driver', null),
      gpu('Intel Corporation', 'Intel UHD Graphics 770', 128),
      gpu('NVIDIA', 'NVIDIA GeForce RTX 4090', 24576, '591.59')
    ]
    expect(promoteGpuController(gpus, 'nvidia')).toEqual({
      model: 'NVIDIA GeForce RTX 4090',
      vram_mb: 24576,
      vram_gb: 24,
      tier: 'high',
      driver_version: '591.59'
    })
  })

  it('does not promote a cross-vendor controller', () => {
    const gpus = [
      gpu('Intel Corporation', 'Intel UHD Graphics 770', 128),
      gpu('AMD', 'AMD Radeon RX 7900 XTX', 24576)
    ]
    expect(promoteGpuController(gpus, 'nvidia')).toEqual(emptyEnrichment)
  })

  it('does not match AMD through "Corporation" in another vendor name', () => {
    expect(
      promoteGpuController([gpu('Intel Corporation', 'Intel UHD Graphics 770', 128)], 'amd')
    ).toEqual(emptyEnrichment)
    expect(
      promoteGpuController(
        [gpu('NVIDIA Corporation', 'NVIDIA GeForce RTX 4090', 24576)],
        'amd'
      )
    ).toEqual(emptyEnrichment)
  })

  it('does not promote virtual-only controller data', () => {
    const gpus = [
      gpu('NVIDIA', 'Parsec Virtual Display Adapter', 24576, '591.59'),
      gpu('Microsoft', 'Microsoft Basic Render Driver', null)
    ]
    expect(promoteGpuController(gpus, 'nvidia')).toEqual(emptyEnrichment)
  })

  it('does not select the highest-VRAM controller among same-vendor matches', () => {
    const gpus = [
      gpu('NVIDIA', 'NVIDIA RTX A2000', 6144, '550.00'),
      gpu('NVIDIA', 'NVIDIA GeForce RTX 4090', 24576, '591.59')
    ]
    expect(promoteGpuController(gpus, 'nvidia')).toEqual(emptyEnrichment)
  })

  it('does not promote enrichment without controller or detector data', () => {
    expect(promoteGpuController([], 'nvidia')).toEqual(emptyEnrichment)
    expect(
      promoteGpuController([gpu('NVIDIA', 'NVIDIA GeForce RTX 4090', 24576)], null)
    ).toEqual(emptyEnrichment)
  })

  it('matches the detected vendor via the model name when vendor is empty', () => {
    const gpus = [
      gpu('Microsoft', 'Microsoft Basic Render Driver', null),
      gpu('', 'NVIDIA GeForce RTX 4090', 24576)
    ]
    expect(promoteGpuController(gpus, 'nvidia').model).toBe('NVIDIA GeForce RTX 4090')
  })

  it('matches AMD via Radeon-branded model with empty vendor', () => {
    const gpus = [gpu('', 'Radeon RX 7900 XTX', 24576)]
    expect(promoteGpuController(gpus, 'amd').model).toBe('Radeon RX 7900 XTX')
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

describe('parseWmiDriverVersions', () => {
  it('parses an array of controllers, keyed by lowercased name', () => {
    const out = JSON.stringify([
      { Name: 'NVIDIA GeForce RTX 5090', DriverVersion: '32.0.15.9174' },
      { Name: 'AMD Radeon(TM) Graphics', DriverVersion: '31.0.22044.1' }
    ])
    const map = parseWmiDriverVersions(out)
    expect(map.get('nvidia geforce rtx 5090')).toBe('32.0.15.9174')
    expect(map.get('amd radeon(tm) graphics')).toBe('31.0.22044.1')
  })

  it('parses a single bare object (ConvertTo-Json single-item shape)', () => {
    const out = JSON.stringify({ Name: 'Intel Arc A770', DriverVersion: '31.0.101.5333' })
    const map = parseWmiDriverVersions(out)
    expect(map.get('intel arc a770')).toBe('31.0.101.5333')
  })

  it('skips entries with missing or blank driver versions', () => {
    const out = JSON.stringify([
      { Name: 'Real GPU', DriverVersion: '1.2.3.4' },
      { Name: 'No Version' },
      { Name: 'Blank Version', DriverVersion: '   ' }
    ])
    const map = parseWmiDriverVersions(out)
    expect(map.get('real gpu')).toBe('1.2.3.4')
    expect(map.has('no version')).toBe(false)
    expect(map.has('blank version')).toBe(false)
  })

  it('returns an empty map for malformed or empty output', () => {
    expect(parseWmiDriverVersions('not json').size).toBe(0)
    expect(parseWmiDriverVersions('').size).toBe(0)
  })
})
