import { describe, expect, it } from 'vitest'
import { deriveGpuTier } from './gpuTier'

describe('deriveGpuTier', () => {
  it('returns apple for Apple-vendor GPUs regardless of VRAM', () => {
    expect(deriveGpuTier({ vendor: 'apple', vramGb: null })).toBe('apple')
    expect(deriveGpuTier({ vendor: 'Apple', vramGb: 8 })).toBe('apple')
  })

  it("returns apple for the canonical 'mps' GpuId that main reports for Apple Silicon", () => {
    expect(deriveGpuTier({ vendor: 'mps', vramGb: null })).toBe('apple')
    expect(deriveGpuTier({ vendor: 'MPS', vramGb: 64 })).toBe('apple')
  })

  it('returns high for NVIDIA / AMD with at least 24 GB VRAM', () => {
    expect(deriveGpuTier({ vendor: 'nvidia', vramGb: 24 })).toBe('high')
    expect(deriveGpuTier({ vendor: 'nvidia', vramGb: 80 })).toBe('high')
    expect(deriveGpuTier({ vendor: 'amd', vramGb: 24 })).toBe('high')
  })

  it('returns mid for 12-23 GB VRAM', () => {
    expect(deriveGpuTier({ vendor: 'nvidia', vramGb: 12 })).toBe('mid')
    expect(deriveGpuTier({ vendor: 'nvidia', vramGb: 23 })).toBe('mid')
  })

  it('returns low for 6-11 GB VRAM', () => {
    expect(deriveGpuTier({ vendor: 'nvidia', vramGb: 6 })).toBe('low')
    expect(deriveGpuTier({ vendor: 'nvidia', vramGb: 11 })).toBe('low')
  })

  it('returns sub_low for NVIDIA / AMD below 6 GB and other GPU vendors', () => {
    expect(deriveGpuTier({ vendor: 'nvidia', vramGb: 4 })).toBe('sub_low')
    expect(deriveGpuTier({ vendor: 'intel', vramGb: 16 })).toBe('sub_low')
  })

  it('returns cpu_only when vendor or VRAM is missing', () => {
    expect(deriveGpuTier({ vendor: null, vramGb: 8 })).toBe('cpu_only')
    expect(deriveGpuTier({ vendor: 'nvidia', vramGb: 0 })).toBe('cpu_only')
    expect(deriveGpuTier({ vendor: 'nvidia', vramGb: null })).toBe('cpu_only')
  })
})
