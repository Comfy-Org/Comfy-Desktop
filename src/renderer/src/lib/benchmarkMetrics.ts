/**
 * Pure, backend-aware metric helpers for the Benchmarks results view.
 *
 * ALL cross-platform branching (CUDA vs Apple unified memory vs CPU system RAM)
 * lives here, not in the template — the view just renders what these return.
 * Functions return i18n keys + params (never localized strings) so the view owns
 * `t()`. Unit-tested in `benchmarkMetrics.test.ts`.
 */
import { deriveGpuTier, type GpuTier } from '../../../shared/gpuTier'
import type { PerformanceTestBenchmark } from '../types/ipc'

/**
 * Map a ComfyUI compute backend / device type to the vendor `deriveGpuTier`
 * expects. `deriveGpuTier` already understands `apple`/`mps`; this also folds
 * `cuda`→`nvidia` and `hip`/`rocm`→`amd`, and returns null for `cpu`/unknown so
 * the tier collapses to `cpu_only`.
 */
export function backendToVendor(
  backend: string | null | undefined,
  deviceType?: string | null | undefined
): string | null {
  const raw = (backend ?? deviceType ?? '').toLowerCase()
  if (!raw) return null
  if (raw === 'cuda' || raw === 'nvidia') return 'nvidia'
  if (raw === 'hip' || raw === 'rocm' || raw === 'amd') return 'amd'
  if (raw === 'mps' || raw === 'apple') return 'apple'
  if (raw === 'cpu') return null
  return raw
}

/** Derive the hardware tier from a result's backend + VRAM (single source). */
export function tierFromHardware(opts: {
  backend: string | null | undefined
  deviceType?: string | null | undefined
  vramMb: number | null | undefined
}): GpuTier {
  return deriveGpuTier({
    vendor: backendToVendor(opts.backend, opts.deviceType),
    vramGb: opts.vramMb != null ? opts.vramMb / 1024 : null
  })
}

const DEDICATED_TIERS: ReadonlySet<GpuTier> = new Set<GpuTier>(['high', 'mid', 'low', 'sub_low'])

/** True only on dedicated NVIDIA/AMD GPUs, where "VRAM" and "fits" are meaningful. */
export function isDedicatedGpuTier(tier: GpuTier): boolean {
  return DEDICATED_TIERS.has(tier)
}

/** Median seconds per image. Null when duration or images-per-run is unusable. */
export function perImageSeconds(
  medianSeconds: number | null | undefined,
  imagesPerRun: number | null | undefined
): number | null {
  if (medianSeconds == null || !Number.isFinite(medianSeconds)) return null
  if (imagesPerRun == null || !Number.isFinite(imagesPerRun) || imagesPerRun <= 0) return null
  return medianSeconds / imagesPerRun
}

export type BenchmarkTone = 'neutral' | 'positive' | 'caution'

export interface VramPeakSecondLine {
  key: string
  params: Record<string, string | number>
}

export interface VramPeakView {
  /** True when the backend never reported a peak (renders "— not measured"). */
  notMeasured: boolean
  /** Peak value in GB (1 decimal) for the big number; null when not measured. */
  peakGb: number | null
  /** i18n key for the headline label (`vramPeak` / `memoryPeak` / `systemRamPeak`). */
  headlineKey: string
  /** Second line (fit / unified note / RAM headroom), or null to omit it. */
  secondLine: VramPeakSecondLine | null
  tone: BenchmarkTone
}

function toGb(mb: number | null | undefined): number | null {
  if (mb == null || !Number.isFinite(mb)) return null
  return Math.round((mb / 1024) * 10) / 10
}

/**
 * Backend-aware VRAM-peak block (design §6.3). "VRAM"/"fits" only on dedicated
 * GPUs; "unified memory" on Apple; "system RAM" on CPU. Never claims a VRAM
 * budget against shared memory.
 */
export function vramPeakView(opts: {
  tier: GpuTier
  peakMb: number | null | undefined
  totalMb: number | null | undefined
  ramMb: number | null | undefined
}): VramPeakView {
  const peakGb = toGb(opts.peakMb)
  const notMeasured = peakGb == null

  if (opts.tier === 'apple') {
    return {
      notMeasured,
      peakGb,
      headlineKey: 'performanceTest.memoryPeak',
      secondLine: { key: 'performanceTest.unifiedMemoryNote', params: {} },
      tone: 'neutral'
    }
  }

  if (opts.tier === 'cpu_only') {
    const ramGb = toGb(opts.ramMb)
    return {
      notMeasured,
      peakGb,
      headlineKey: 'performanceTest.systemRamPeak',
      secondLine: ramGb != null ? { key: 'performanceTest.ofRam', params: { total: ramGb } } : null,
      tone: 'neutral'
    }
  }

  // Dedicated NVIDIA / AMD GPU: show VRAM + a fit judgement against total VRAM.
  const totalGb = toGb(opts.totalMb)
  let secondLine: VramPeakSecondLine | null = null
  let tone: BenchmarkTone = 'neutral'
  if (!notMeasured && totalGb != null && peakGb != null) {
    if (peakGb <= totalGb) {
      secondLine = { key: 'performanceTest.vramPeakOfTotalFits', params: { total: totalGb } }
      tone = 'neutral'
    } else {
      secondLine = { key: 'performanceTest.vramPeakExceeded', params: { total: totalGb } }
      tone = 'caution'
    }
  }
  return { notMeasured, peakGb, headlineKey: 'performanceTest.vramPeak', secondLine, tone }
}

export type CompareResult =
  | { kind: 'faster'; pct: number; prevSeconds: number; tone: BenchmarkTone }
  | { kind: 'slower'; pct: number; prevSeconds: number; tone: BenchmarkTone }
  | { kind: 'same'; prevSeconds: number; tone: BenchmarkTone }
  | { kind: 'first'; tone: BenchmarkTone }
  | { kind: 'differentGpu'; tone: BenchmarkTone }

/** Delta is "same" inside this band, so we don't cry wolf over run-to-run noise. */
const SAME_BAND_PCT = 2

/**
 * Compare the current run's median sec/image to the newest prior run of the
 * SAME benchmark on the SAME hardware (design §6.2). `priorBenchmarks` is
 * expected newest-first (as `listPerformanceTestBenchmarks` returns).
 */
export function compareToPrevious(opts: {
  currentPerImageSeconds: number | null
  imagesPerRun: number
  workflowName: string
  hardwareName: string | null
  priorBenchmarks: readonly PerformanceTestBenchmark[]
}): CompareResult {
  if (opts.currentPerImageSeconds == null || opts.imagesPerRun <= 0) {
    return { kind: 'first', tone: 'neutral' }
  }
  const sameBenchmark = opts.priorBenchmarks.filter(
    (benchmark) =>
      benchmark.workflowName === opts.workflowName &&
      benchmark.medianJobDurationSeconds != null
  )
  if (sameBenchmark.length === 0) return { kind: 'first', tone: 'neutral' }

  const sameHardware = sameBenchmark.find(
    (benchmark) => benchmark.hardwareName === opts.hardwareName
  )
  if (!sameHardware) return { kind: 'differentGpu', tone: 'neutral' }

  const prevSeconds = sameHardware.medianJobDurationSeconds! / opts.imagesPerRun
  if (prevSeconds <= 0) return { kind: 'first', tone: 'neutral' }

  const deltaPct = ((prevSeconds - opts.currentPerImageSeconds) / prevSeconds) * 100
  if (Math.abs(deltaPct) < SAME_BAND_PCT) {
    return { kind: 'same', prevSeconds, tone: 'neutral' }
  }
  if (deltaPct > 0) {
    return { kind: 'faster', pct: Math.round(deltaPct), prevSeconds, tone: 'positive' }
  }
  return { kind: 'slower', pct: Math.round(-deltaPct), prevSeconds, tone: 'caution' }
}

/**
 * VRAM/memory row label for the System information section + the exported image,
 * following the same backend rule as the headline (`VRAM` / `Unified memory` /
 * `System RAM`).
 */
export function memoryRowLabelKey(tier: GpuTier): string {
  if (tier === 'apple') return 'performanceTest.unifiedMemory'
  if (tier === 'cpu_only') return 'performanceTest.systemRam'
  return 'performanceTest.vram'
}
