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
  /** Total/ceiling in GB (1 decimal): total VRAM, unified memory, or system RAM. */
  totalGb: number | null
  /** Peak as a whole-number percent of total, or null when total is unknown/0. */
  percent: number | null
  /** peak/total as a 0..1 fraction for the radial gauge, or null when unknown. */
  fraction: number | null
  /** i18n key for the headline label (`vramPeak` / `memoryPeak` / `systemRamPeak`). */
  headlineKey: string
  /** Factual "of X GB (Y%)" line, or null when total is unknown. Never a verdict. */
  secondLine: VramPeakSecondLine | null
  /** Neutral factual note key (e.g. unified memory), or null. */
  noteKey: string | null
  tone: BenchmarkTone
}

/** Megabytes → gigabytes rounded to 1 decimal. Null for missing/non-finite input. */
export function toGb(mb: number | null | undefined): number | null {
  if (mb == null || !Number.isFinite(mb)) return null
  return Math.round((mb / 1024) * 10) / 10
}

/**
 * Backend-aware VRAM-peak block (design §3 / §6.3). Presents the peak
 * **factually** against its ceiling — "of X GB (Y%)" — and never editorializes:
 * a benchmark legitimately peaks near 100%, so this is not a warning and the tone
 * stays neutral. "VRAM" on dedicated GPUs, "unified memory" on Apple, "system
 * RAM" on CPU; it never claims a VRAM budget against shared memory. Genuinely
 * abnormal conditions (offload / throttle) are surfaced separately by the view.
 */
export function vramPeakView(opts: {
  tier: GpuTier
  peakMb: number | null | undefined
  totalMb: number | null | undefined
  ramMb: number | null | undefined
}): VramPeakView {
  const peakGb = toGb(opts.peakMb)
  const notMeasured = peakGb == null

  // The ceiling depends on the backend: dedicated VRAM, unified memory (Apple),
  // or system RAM (CPU). Percent/fraction are computed from the raw MB values.
  const totalMb =
    opts.tier === 'cpu_only'
      ? opts.ramMb
      : (opts.totalMb ?? (opts.tier === 'apple' ? opts.ramMb : null))
  const totalGb = toGb(totalMb)
  const hasRatio =
    opts.peakMb != null &&
    Number.isFinite(opts.peakMb) &&
    totalMb != null &&
    Number.isFinite(totalMb) &&
    totalMb > 0
  const fraction = hasRatio ? (opts.peakMb as number) / (totalMb as number) : null
  const percent = fraction != null ? Math.round(fraction * 100) : null

  const headlineKey =
    opts.tier === 'apple'
      ? 'performanceTest.memoryPeak'
      : opts.tier === 'cpu_only'
        ? 'performanceTest.systemRamPeak'
        : 'performanceTest.vramPeak'
  const noteKey = opts.tier === 'apple' ? 'performanceTest.unifiedMemoryNote' : null

  let secondLine: VramPeakSecondLine | null = null
  if (!notMeasured && totalGb != null && percent != null) {
    const key =
      opts.tier === 'cpu_only' ? 'performanceTest.vramPeakOfRam' : 'performanceTest.vramPeakOfTotal'
    secondLine = { key, params: { total: totalGb, percent } }
  }

  return {
    notMeasured,
    peakGb,
    totalGb,
    percent,
    fraction,
    headlineKey,
    secondLine,
    noteKey,
    tone: 'neutral'
  }
}

export type CompareResult =
  | { kind: 'faster'; pct: number; prevSeconds: number; tone: BenchmarkTone }
  | { kind: 'slower'; pct: number; prevSeconds: number; tone: BenchmarkTone }
  | { kind: 'same'; prevSeconds: number; tone: BenchmarkTone }
  | { kind: 'first'; tone: BenchmarkTone }
  | { kind: 'differentGpu'; tone: BenchmarkTone }

/** Delta is "same" inside this band, so we don't cry wolf over run-to-run noise. */
export const SAME_BAND_PCT = 2

/** Which direction the current value moved relative to the baseline. */
export type DeltaDirection = 'up' | 'down' | 'none'

/**
 * Outcome of a Compare delta, keyed to the design's honesty rules (§4.2/§4.3):
 * - `better` / `worse`: a real change, scored by the metric's good direction.
 * - `same`: inside the ±`SAME_BAND_PCT` dead-band, or a neutral metric (no good
 *   direction, e.g. GPU util) — rendered muted, never colored.
 * - `notComparable`: a per-run metric across different workflows (`✕`).
 */
export type DeltaOutcome = 'better' | 'worse' | 'same' | 'notComparable'

export interface MetricDelta {
  direction: DeltaDirection
  /** Signed percent change `(current - baseline) / baseline * 100`, or null when
   *  the baseline is 0 / non-finite (percent would be meaningless). */
  pct: number | null
  /** Signed absolute difference `current - baseline`. */
  abs: number
  outcome: DeltaOutcome
}

/**
 * Compute a Compare delta chip's facts (design §4.2). Pure + outcome-based: the
 * color is decided by the metric's good direction, NOT by the sign, so the view
 * only has to map `outcome → chip class`.
 *
 * - Returns `null` when either side is missing/non-finite — the view renders the
 *   muted `—` (not-measured) chip, which takes precedence over everything else
 *   (matches the mockup's ordering).
 * - `comparable: false` (a per-run metric across different workflows) yields
 *   `notComparable` (the `✕` chip) — but only once both values are present.
 * - `lowerIsBetter: null` marks a neutral metric (e.g. GPU util): always `same`
 *   (muted), carrying the signed `abs`/`direction` so the view can still show the
 *   raw movement without implying a verdict.
 * - Otherwise within ±`SAME_BAND_PCT` is `same`; past it, `better`/`worse` by the
 *   metric's good direction.
 */
export function computeMetricDelta(opts: {
  baseline: number | null | undefined
  current: number | null | undefined
  lowerIsBetter: boolean | null
  comparable?: boolean
}): MetricDelta | null {
  const { baseline, current } = opts
  if (
    baseline == null ||
    current == null ||
    !Number.isFinite(baseline) ||
    !Number.isFinite(current)
  ) {
    return null
  }
  const abs = current - baseline
  const direction: DeltaDirection = abs > 0 ? 'up' : abs < 0 ? 'down' : 'none'
  const pct = baseline !== 0 ? (abs / baseline) * 100 : null

  if (opts.comparable === false) {
    return { direction, pct, abs, outcome: 'notComparable' }
  }
  // Neutral metric: never scored good/bad.
  if (opts.lowerIsBetter === null) {
    return { direction, pct, abs, outcome: 'same' }
  }
  // Dead-band (percent-based). When the baseline is 0 we fall back to "any nonzero
  // absolute change is a real change" since percent is undefined.
  if (pct != null) {
    if (Math.abs(pct) < SAME_BAND_PCT) return { direction, pct, abs, outcome: 'same' }
  } else if (abs === 0) {
    return { direction, pct, abs, outcome: 'same' }
  }
  const better = opts.lowerIsBetter ? current < baseline : current > baseline
  return { direction, pct, abs, outcome: better ? 'better' : 'worse' }
}

/**
 * Compare the current run's median sec/image to the newest prior run of the
 * SAME benchmark on the SAME hardware (design §5.1). `priorBenchmarks` is
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
      benchmark.workflowName === opts.workflowName && benchmark.medianJobDurationSeconds != null
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
