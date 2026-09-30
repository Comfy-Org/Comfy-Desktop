import { describe, expect, it } from 'vitest'

import type { GpuTier } from '../../../shared/gpuTier'
import type { PerformanceTestBenchmark } from '../types/ipc'
import {
  backendToVendor,
  compareToPrevious,
  isDedicatedGpuTier,
  memoryRowLabelKey,
  perImageSeconds,
  tierFromHardware,
  vramPeakView
} from './benchmarkMetrics'

const prior = (over: Partial<PerformanceTestBenchmark>): PerformanceTestBenchmark =>
  ({
    workflowName: 'sd15-txt2img-512',
    hardwareName: 'RTX 4070',
    medianJobDurationSeconds: 2,
    ...over
  }) as unknown as PerformanceTestBenchmark

describe('backendToVendor', () => {
  it('maps compute backends to deriveGpuTier vendors', () => {
    expect(backendToVendor('cuda')).toBe('nvidia')
    expect(backendToVendor('nvidia')).toBe('nvidia')
    expect(backendToVendor('hip')).toBe('amd')
    expect(backendToVendor('rocm')).toBe('amd')
    expect(backendToVendor('mps')).toBe('apple')
    expect(backendToVendor('cpu')).toBeNull()
    expect(backendToVendor(null)).toBeNull()
    expect(backendToVendor(undefined, 'CUDA')).toBe('nvidia') // falls back to deviceType, case-insensitive
  })
})

describe('tierFromHardware', () => {
  it('collapses mps to apple and cpu to cpu_only regardless of memory', () => {
    expect(tierFromHardware({ backend: 'mps', vramMb: 24576 })).toBe('apple')
    expect(tierFromHardware({ backend: 'cpu', vramMb: null })).toBe('cpu_only')
  })
  it('yields a dedicated tier for a real NVIDIA card', () => {
    expect(isDedicatedGpuTier(tierFromHardware({ backend: 'cuda', vramMb: 24576 }))).toBe(true)
  })
})

describe('isDedicatedGpuTier', () => {
  it('is true only for dedicated GPU tiers', () => {
    for (const t of ['high', 'mid', 'low', 'sub_low'] as GpuTier[]) {
      expect(isDedicatedGpuTier(t)).toBe(true)
    }
    for (const t of ['apple', 'cpu_only'] as GpuTier[]) {
      expect(isDedicatedGpuTier(t)).toBe(false)
    }
  })
})

describe('perImageSeconds', () => {
  it('divides median duration by images per run', () => {
    expect(perImageSeconds(4, 2)).toBe(2)
    expect(perImageSeconds(2.5, 1)).toBe(2.5)
  })
  it('returns null on unusable inputs', () => {
    expect(perImageSeconds(null, 1)).toBeNull()
    expect(perImageSeconds(2, 0)).toBeNull()
    expect(perImageSeconds(2, null)).toBeNull()
    expect(perImageSeconds(Number.NaN, 1)).toBeNull()
  })
})

describe('vramPeakView', () => {
  it('apple: memory peak + unified note, never a fit judgement', () => {
    const v = vramPeakView({ tier: 'apple', peakMb: 8192, totalMb: 24576, ramMb: 24576 })
    expect(v.headlineKey).toBe('performanceTest.memoryPeak')
    expect(v.secondLine?.key).toBe('performanceTest.unifiedMemoryNote')
    expect(v.peakGb).toBe(8)
    expect(v.notMeasured).toBe(false)
  })
  it('cpu: system RAM peak, with RAM headroom only when known', () => {
    expect(
      vramPeakView({ tier: 'cpu_only', peakMb: 4096, totalMb: null, ramMb: 16384 }).secondLine
    ).toEqual({ key: 'performanceTest.ofRam', params: { total: 16 } })
    expect(
      vramPeakView({ tier: 'cpu_only', peakMb: 4096, totalMb: null, ramMb: null }).secondLine
    ).toBeNull()
  })
  it('dedicated GPU: fits vs exceeded', () => {
    const fits = vramPeakView({ tier: 'high', peakMb: 7987, totalMb: 12288, ramMb: 32768 })
    expect(fits.headlineKey).toBe('performanceTest.vramPeak')
    expect(fits.secondLine?.key).toBe('performanceTest.vramPeakOfTotalFits')
    expect(fits.tone).toBe('neutral')
    const over = vramPeakView({ tier: 'low', peakMb: 13312, totalMb: 12288, ramMb: 32768 })
    expect(over.secondLine?.key).toBe('performanceTest.vramPeakExceeded')
    expect(over.tone).toBe('caution')
  })
  it('renders not-measured when the peak is missing', () => {
    const v = vramPeakView({ tier: 'high', peakMb: null, totalMb: 12288, ramMb: null })
    expect(v.notMeasured).toBe(true)
    expect(v.peakGb).toBeNull()
    expect(v.secondLine).toBeNull()
  })
})

describe('compareToPrevious', () => {
  const base = {
    imagesPerRun: 1,
    workflowName: 'sd15-txt2img-512',
    hardwareName: 'RTX 4070'
  }
  it('reports first run when no prior of this benchmark exists', () => {
    expect(
      compareToPrevious({ ...base, currentPerImageSeconds: 2, priorBenchmarks: [] }).kind
    ).toBe('first')
  })
  it('reports differentGpu when the prior run is on other hardware only', () => {
    const r = compareToPrevious({
      ...base,
      currentPerImageSeconds: 2,
      priorBenchmarks: [prior({ hardwareName: 'RTX 3060' })]
    })
    expect(r.kind).toBe('differentGpu')
  })
  it('reports faster / slower / same against the same hardware', () => {
    const faster = compareToPrevious({
      ...base,
      currentPerImageSeconds: 1.6,
      priorBenchmarks: [prior({ medianJobDurationSeconds: 2 })]
    })
    expect(faster).toMatchObject({ kind: 'faster', pct: 20, tone: 'positive' })
    const slower = compareToPrevious({
      ...base,
      currentPerImageSeconds: 2.5,
      priorBenchmarks: [prior({ medianJobDurationSeconds: 2 })]
    })
    expect(slower).toMatchObject({ kind: 'slower', tone: 'caution' })
    const same = compareToPrevious({
      ...base,
      currentPerImageSeconds: 2.01,
      priorBenchmarks: [prior({ medianJobDurationSeconds: 2 })]
    })
    expect(same.kind).toBe('same')
  })
  it('shows a delta for two rich runs on the same deviceName (not differentGpu)', () => {
    // Priors store hardwareName from `deviceName ?? deviceType`. The current run
    // must key on the SAME field; if it keyed on gpuModel instead, this would
    // wrongly report `differentGpu` for the same GPU.
    const deviceName = 'AMD Radeon RX 7900 XTX'
    const result = compareToPrevious({
      ...base,
      hardwareName: deviceName,
      currentPerImageSeconds: 1.6,
      priorBenchmarks: [prior({ hardwareName: deviceName, medianJobDurationSeconds: 2 })]
    })
    expect(result).toMatchObject({ kind: 'faster', pct: 20, tone: 'positive' })
  })
})

describe('memoryRowLabelKey', () => {
  it('follows the backend rule', () => {
    expect(memoryRowLabelKey('apple')).toBe('performanceTest.unifiedMemory')
    expect(memoryRowLabelKey('cpu_only')).toBe('performanceTest.systemRam')
    expect(memoryRowLabelKey('high')).toBe('performanceTest.vram')
  })
})
