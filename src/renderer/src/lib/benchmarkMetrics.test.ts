import { describe, expect, it } from 'vitest'

import type { PerformanceTestBenchmark } from '../types/ipc'
import {
  backendToVendor,
  compareToPrevious,
  computeMetricDelta,
  perImageSeconds,
  SAME_BAND_PCT,
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
    expect(['high', 'mid', 'low', 'sub_low']).toContain(
      tierFromHardware({ backend: 'cuda', vramMb: 24576 })
    )
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
  it('apple: memory peak + unified note, factual percent, never a fit judgement', () => {
    const v = vramPeakView({ tier: 'apple', peakMb: 8192, totalMb: 24576, ramMb: 24576 })
    expect(v.headlineKey).toBe('performanceTest.memoryPeak')
    expect(v.noteKey).toBe('performanceTest.unifiedMemoryNote')
    expect(v.secondLine).toEqual({
      key: 'performanceTest.vramPeakOfTotal',
      params: { total: 24, percent: 33 }
    })
    expect(v.peakGb).toBe(8)
    expect(v.notMeasured).toBe(false)
    expect(v.tone).toBe('neutral')
  })
  it('cpu: system RAM peak, factual percent only when the total is known', () => {
    expect(
      vramPeakView({ tier: 'cpu_only', peakMb: 4096, totalMb: null, ramMb: 16384 }).secondLine
    ).toEqual({ key: 'performanceTest.vramPeakOfRam', params: { total: 16, percent: 25 } })
    expect(
      vramPeakView({ tier: 'cpu_only', peakMb: 4096, totalMb: null, ramMb: null }).secondLine
    ).toBeNull()
  })
  it('dedicated GPU: presents high usage factually and stays neutral (no fits/exceeded)', () => {
    const high = vramPeakView({ tier: 'high', peakMb: 31747, totalMb: 32607, ramMb: 65536 })
    expect(high.headlineKey).toBe('performanceTest.vramPeak')
    expect(high.secondLine).toEqual({
      key: 'performanceTest.vramPeakOfTotal',
      params: { total: 31.8, percent: 97 }
    })
    expect(high.percent).toBe(97)
    expect(high.fraction).toBeCloseTo(0.9736, 3)
    expect(high.tone).toBe('neutral')
    // Even when the peak exceeds the reported total, the tone stays neutral —
    // interpretation (offload / throttle) is surfaced separately, not here.
    const over = vramPeakView({ tier: 'low', peakMb: 13312, totalMb: 12288, ramMb: 32768 })
    expect(over.secondLine?.key).toBe('performanceTest.vramPeakOfTotal')
    expect(over.tone).toBe('neutral')
  })
  it('renders not-measured when the peak is missing', () => {
    const v = vramPeakView({ tier: 'high', peakMb: null, totalMb: 12288, ramMb: null })
    expect(v.notMeasured).toBe(true)
    expect(v.peakGb).toBeNull()
    expect(v.secondLine).toBeNull()
    expect(v.percent).toBeNull()
    expect(v.fraction).toBeNull()
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

describe('computeMetricDelta', () => {
  it('returns null when either side is missing or non-finite (view renders —)', () => {
    expect(computeMetricDelta({ baseline: null, current: 5, lowerIsBetter: true })).toBeNull()
    expect(computeMetricDelta({ baseline: 5, current: null, lowerIsBetter: true })).toBeNull()
    expect(computeMetricDelta({ baseline: Number.NaN, current: 5, lowerIsBetter: true })).toBeNull()
  })

  it('scores lower-is-better by outcome, not by sign', () => {
    // VRAM/energy/power/temp/duration: a LOWER current is better.
    const lower = computeMetricDelta({ baseline: 10, current: 8, lowerIsBetter: true })
    expect(lower).toMatchObject({ outcome: 'better', direction: 'down', abs: -2 })
    expect(lower!.pct).toBeCloseTo(-20, 5)
    const higher = computeMetricDelta({ baseline: 10, current: 12, lowerIsBetter: true })
    expect(higher).toMatchObject({ outcome: 'worse', direction: 'up', abs: 2 })
  })

  it('scores higher-is-better by outcome (it/s: a higher current is better)', () => {
    expect(computeMetricDelta({ baseline: 10, current: 12, lowerIsBetter: false })).toMatchObject({
      outcome: 'better',
      direction: 'up'
    })
    expect(computeMetricDelta({ baseline: 10, current: 8, lowerIsBetter: false })).toMatchObject({
      outcome: 'worse',
      direction: 'down'
    })
  })

  it(`treats changes within ±${SAME_BAND_PCT}% as "same" (no crying wolf over noise)`, () => {
    // 1.5% movement either way is inside the dead-band.
    expect(
      computeMetricDelta({ baseline: 100, current: 101.5, lowerIsBetter: true })
    ).toMatchObject({ outcome: 'same' })
    expect(
      computeMetricDelta({ baseline: 100, current: 98.5, lowerIsBetter: false })
    ).toMatchObject({ outcome: 'same' })
    // Exactly at the band edge is NOT same (strict <).
    expect(computeMetricDelta({ baseline: 100, current: 102, lowerIsBetter: true })?.outcome).toBe(
      'worse'
    )
  })

  it('keeps neutral metrics (lowerIsBetter null, e.g. GPU util) muted and uncolored', () => {
    const big = computeMetricDelta({ baseline: 90, current: 100, lowerIsBetter: null })
    // Even a large move stays "same" (muted) — a neutral metric has no good direction.
    expect(big).toMatchObject({ outcome: 'same', direction: 'up', abs: 10 })
  })

  it('marks per-run metrics across different workflows as notComparable (the ✕ chip)', () => {
    expect(
      computeMetricDelta({ baseline: 1.12, current: 3.47, lowerIsBetter: true, comparable: false })
    ).toMatchObject({ outcome: 'notComparable' })
    // Missing values still win over notComparable (— takes precedence).
    expect(
      computeMetricDelta({ baseline: null, current: 3.47, lowerIsBetter: true, comparable: false })
    ).toBeNull()
  })

  it('handles a zero baseline without dividing by zero (pct null, abs drives it)', () => {
    const fromZero = computeMetricDelta({ baseline: 0, current: 5, lowerIsBetter: false })
    expect(fromZero).toMatchObject({ outcome: 'better', pct: null, abs: 5, direction: 'up' })
    expect(computeMetricDelta({ baseline: 0, current: 0, lowerIsBetter: false })).toMatchObject({
      outcome: 'same',
      pct: null,
      abs: 0
    })
  })
})
