<script setup lang="ts">
/**
 * Read-only single-run results dashboard (design §3–§8). Extracted verbatim from
 * PerformanceTestView so the live Run result AND the History "Open" detail screen
 * render the exact same hero / VRAM gauge / op-timeline / VRAM-over-time / per-step
 * it/s / power-temp / config-chips view from one source of truth.
 *
 * Presentational and read-only: no run controls, no IPC. It is handed the run's data
 * (the core capture, a recomputed steady-state it/s, the result summary context, an
 * optional statistics block, and an optional already-resolved inline compare delta)
 * and renders it. When `coreBenchmark` is null it shows the calm "needs capture" state.
 *
 * Copy is factual and neutral by hard rule (design §3.1) — do not editorialize.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp } from 'lucide-vue-next'
import CollapsibleSectionToggle from './CollapsibleSectionToggle.vue'
import type {
  CoreBenchmarkSummary,
  PerformanceTestResultsSummary,
  PerformanceTestStatistics
} from '../types/ipc'
import { tierFromHardware, toGb, vramPeakView, type BenchmarkTone } from '../lib/benchmarkMetrics'
import {
  buildRadialGauge,
  buildSeriesChart,
  niceTicks,
  projectX,
  projectY,
  type AxisTick,
  type SeriesChart
} from '../lib/benchmarkCharts'

export type BenchmarkModality = 'image' | 'video' | 'audio'

/** An already-resolved inline compare delta (e.g. "12% faster than last run"). The
 *  owner computes this against prior runs; the dashboard only renders it. */
export interface BenchmarkCompareView {
  readonly key: string
  readonly params: Record<string, unknown>
  readonly tone: BenchmarkTone
  readonly dir: 'up' | 'down' | 'flat'
}

interface ConfigChip {
  readonly key: string
  readonly text: string
  readonly tone: BenchmarkTone
}

const props = withDefaults(
  defineProps<{
    /** Rich per-run capture from ComfyUI core; null => render the needs-capture state. */
    coreBenchmark: CoreBenchmarkSummary | null
    /** Desktop-recomputed steady-state it/s (the headline it/s). */
    steadyStateItPerS: number | null
    /** Result summary context (workflow, date, hardware, system info, durations). */
    summary: PerformanceTestResultsSummary | null
    /** Run duration statistics (fastest/slowest/avg/median); drives the aggregate bars. */
    statistics?: PerformanceTestStatistics | null
    /** Run modality — drives the modality-aware hero unit. */
    modality?: BenchmarkModality | null
    /** Optional inline compare delta against a prior run. */
    compareView?: BenchmarkCompareView | null
  }>(),
  {
    statistics: null,
    modality: null,
    compareView: null
  }
)

const { t } = useI18n()

/** Details toggle is the dashboard's own read-only UI state. */
const detailsExpanded = ref(false)

const coreBenchmark = computed(() => props.coreBenchmark)
const resultsSummary = computed(() => props.summary)
const statistics = computed(() => props.statistics ?? null)

const computeDeviceNames = computed(() =>
  (resultsSummary.value?.hardware?.devices ?? [])
    .flatMap((device) => (device.deviceName ? [device.deviceName] : []))
    .join(', ')
)

const aggregateChart = computed(() => {
  const stats = statistics.value
  if (!stats) return []

  const aggregates = [
    { label: t('performanceTest.fastestRun'), value: stats.fastest.durationSeconds },
    { label: t('performanceTest.slowestRun'), value: stats.slowest.durationSeconds },
    { label: t('performanceTest.averageRunDuration'), value: stats.averageDurationSeconds },
    { label: t('performanceTest.medianRunDuration'), value: stats.medianDurationSeconds }
  ]
  const maximum = Math.max(...aggregates.map(({ value }) => value), 0)

  return aggregates.map((aggregate) => ({
    ...aggregate,
    width: maximum > 0 ? `${(aggregate.value / maximum) * 100}%` : '0%'
  }))
})

// --- Results view (design §3–§7) -------------------------------------------
const medianSeconds = computed<number | null>(() => {
  if (statistics.value?.medianDurationSeconds != null) return statistics.value.medianDurationSeconds
  return resultsSummary.value?.medianJobDurationSeconds ?? null
})
const measuredRunCount = computed<number>(
  () => resultsSummary.value?.measuredJobCount ?? statistics.value?.measuredJobCount ?? 0
)
const heroImageCount = computed<number | null>(() => coreBenchmark.value?.run.imageCount ?? null)

/** Modality of the run that produced the current result (image | video | audio). */
const heroModality = computed<BenchmarkModality | null>(() => props.modality ?? null)

/** The big hero number in seconds — sec/image when the image count is known,
 *  else seconds per run (never fabricated). Video/audio stay seconds-only. */
const heroSeconds = computed<number | null>(() => {
  const bench = coreBenchmark.value
  const median = medianSeconds.value
  if (heroModality.value === 'image' || heroModality.value == null) {
    if (bench?.summary.secPerImage != null) return bench.summary.secPerImage
    const count = heroImageCount.value
    if (count != null && count > 0 && median != null) return median / count
  }
  return median
})

const heroPerImageKnown = computed<boolean>(
  () => coreBenchmark.value?.summary.secPerImage != null || (heroImageCount.value ?? 0) > 0
)
const heroUnitKey = computed<string>(() => {
  if (heroModality.value === 'video') return 'performanceTest.heroUnitVideo'
  if (heroModality.value === 'audio') return 'performanceTest.heroUnitRun'
  return heroPerImageKnown.value ? 'performanceTest.heroUnitImage' : 'performanceTest.heroUnitRun'
})
const steadyItPerS = computed<number | null>(() => props.steadyStateItPerS)

const resultTier = computed(() =>
  tierFromHardware({
    backend: coreBenchmark.value?.device.backend ?? resultsSummary.value?.hardware?.backend,
    deviceType: resultsSummary.value?.hardware?.deviceType,
    vramMb: coreBenchmark.value?.device.totalVramMb ?? resultsSummary.value?.hardware?.vramMb
  })
)

const vramPeak = computed(() =>
  vramPeakView({
    tier: resultTier.value,
    peakMb: coreBenchmark.value?.resources.peak.vramUsedMb,
    totalMb: coreBenchmark.value?.device.totalVramMb ?? resultsSummary.value?.hardware?.vramMb,
    ramMb: coreBenchmark.value?.device.totalRamMb ?? resultsSummary.value?.hardware?.ramMb
  })
)

const coreThrottled = computed<boolean | null>(() => {
  const bench = coreBenchmark.value
  if (!bench) return null
  return bench.summary.throttled ?? bench.resources.peak.throttled
})
const energyWhPerImage = computed<number | null>(
  () => coreBenchmark.value?.summary.energyWhPerImage ?? null
)
const peakPowerW = computed<number | null>(() => coreBenchmark.value?.resources.peak.powerW ?? null)
const peakTempC = computed<number | null>(
  () => coreBenchmark.value?.resources.peak.temperatureC ?? null
)
const hasEfficiencyLine = computed<boolean>(
  () => energyWhPerImage.value != null || peakPowerW.value != null || peakTempC.value != null
)

const heroGpuName = computed<string | null>(
  () =>
    coreBenchmark.value?.device.gpuModel ??
    (computeDeviceNames.value || null) ??
    resultsSummary.value?.hardware?.deviceName ??
    null
)
const heroTotalVramGb = computed<number | null>(() =>
  toGb(coreBenchmark.value?.device.totalVramMb ?? resultsSummary.value?.hardware?.vramMb)
)
const heroDateText = computed<string>(() => {
  const iso = resultsSummary.value?.createdAt
  if (!iso) return ''
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso)
  )
})
/** Context-line fragment: "20 steps · euler" — only when both are known. */
const heroStepsText = computed<{ steps: number; sampler: string } | null>(() => {
  const workflow = coreBenchmark.value?.workflow
  if (!workflow || workflow.steps == null || !workflow.sampler) return null
  return { steps: workflow.steps, sampler: workflow.sampler }
})
/** Context-line fragment: "1 images · batch 1" — only when the batch size is known. */
const heroBatchText = computed<{ count: number; batch: number } | null>(() => {
  const run = coreBenchmark.value?.run
  if (!run || run.batchSize == null) return null
  return { count: run.imageCount ?? run.batchSize, batch: run.batchSize }
})
const heroComfyuiVersion = computed<string | null>(
  () => coreBenchmark.value?.device.comfyuiVersion ?? null
)
/** Genuinely abnormal: weights spilled to system RAM. Surfaced as a plain fact. */
const coreOffloaded = computed<boolean>(() => coreBenchmark.value?.device.offloaded === true)
const powerLimitW = computed<number | null>(
  () => coreBenchmark.value?.resources.peak.powerLimitW ?? null
)

const rangeStats = computed(() => {
  const stats = statistics.value
  if (!stats) return null
  return {
    fastest: stats.fastest.durationSeconds,
    slowest: stats.slowest.durationSeconds,
    average: stats.averageDurationSeconds,
    measured: stats.measuredJobCount,
    failed: resultsSummary.value?.failedRunCount ?? 0
  }
})

const configChips = computed<ConfigChip[]>(() => {
  const device = coreBenchmark.value?.device
  if (!device) return []
  const chips: ConfigChip[] = []
  const add = (key: string, text: string | null | undefined, tone: BenchmarkTone = 'neutral') => {
    if (text != null && String(text).length > 0) chips.push({ key, text: String(text), tone })
  }
  add('dtype', device.weightDtype)
  add('attention', device.attentionImpl)
  if (device.cudaVersion)
    add('cuda', t('performanceTest.chipCuda', { version: device.cudaVersion }))
  if (device.cudnnVersion)
    add('cudnn', t('performanceTest.chipCudnn', { version: device.cudnnVersion }))
  add('vramState', device.vramState)
  if (device.offloaded === true) add('offloaded', t('performanceTest.chipOffloaded'), 'caution')
  if (device.vramIsUnified === true) add('unified', t('performanceTest.chipUnifiedMemory'))
  if (device.isLaptop === true) add('laptop', t('performanceTest.chipLaptop'))
  if (device.pytorchVersion)
    add('torch', t('performanceTest.chipTorch', { version: device.pytorchVersion }))
  return chips
})

const nodeTotalMs = computed<number | null>(
  () => coreBenchmark.value?.durations.nodeTotalMs ?? null
)
const coreNodeTimeline = computed(() => {
  const nodes = coreBenchmark.value?.nodes ?? []
  const timed = nodes.filter((node) => node.elapsedMs != null && node.elapsedMs >= 0)
  if (timed.length === 0) return []
  const maximum = Math.max(...timed.map((node) => node.elapsedMs ?? 0))
  const totalMs = nodeTotalMs.value ?? timed.reduce((sum, node) => sum + (node.elapsedMs ?? 0), 0)
  return [...timed]
    .sort((a, b) => (b.elapsedMs ?? 0) - (a.elapsedMs ?? 0))
    .slice(0, 12)
    .map((node, index) => {
      const ms = node.elapsedMs ?? 0
      return {
        key: node.nodeId ?? `${node.classType ?? 'node'}-${index}`,
        label: node.classType || node.nodeId || '—',
        seconds: ms / 1000,
        percent: totalMs > 0 ? Math.round((ms / totalMs) * 100) : 0,
        width: maximum > 0 ? `${(ms / maximum) * 100}%` : '0%',
        dominant: index === 0
      }
    })
})

// Authoritative peak from core (may exceed any sampled value); drives both the
// card label AND the peak reference line so the two never contradict each other.
const vramPeakMb = computed<number | null>(
  () => coreBenchmark.value?.resources.peak.vramUsedMb ?? null
)

/**
 * A charted series inside a padded plot area: the pure geometry plus projected
 * axis ticks. The template renders gridlines/labels from `xTicks`/`yTicks` and
 * translates the plot group by `padL`/`padT`. All numbers come from the pure,
 * unit-tested `benchmarkCharts` helpers — the view only positions them.
 */
interface AxedChart {
  width: number
  height: number
  padL: number
  padT: number
  plotW: number
  plotH: number
  plot: SeriesChart
  xTicks: AxisTick[]
  yTicks: AxisTick[]
}
const CHART_PAD = { l: 46, r: 18, t: 14, b: 30 }
function buildAxedChart(
  values: ReadonlyArray<number | null | undefined>,
  opts: {
    width: number
    height: number
    pad?: { l: number; r: number; t: number; b: number }
    xValues?: ReadonlyArray<number | null | undefined>
    minY?: number
    maxY?: number
    yTickCount?: number
    xTickCount?: number
  }
): AxedChart | null {
  const pad = opts.pad ?? CHART_PAD
  const plotW = opts.width - pad.l - pad.r
  const plotH = opts.height - pad.t - pad.b
  const plot = buildSeriesChart(values, {
    width: plotW,
    height: plotH,
    xValues: opts.xValues,
    minY: opts.minY,
    maxY: opts.maxY
  })
  if (!plot) return null
  const epsilon = 1e-6
  const yTicks = niceTicks(plot.min, plot.max, opts.yTickCount ?? 4)
    .filter((value) => value >= plot.min - epsilon && value <= plot.max + epsilon)
    .map((value) => ({ value, pos: projectY(plot, value) }))
  const xTicks = niceTicks(plot.minX, plot.maxX, opts.xTickCount ?? 5)
    .filter((value) => value >= plot.minX - epsilon && value <= plot.maxX + epsilon)
    .map((value) => ({ value, pos: projectX(plot, value) }))
  return {
    width: opts.width,
    height: opts.height,
    padL: pad.l,
    padT: pad.t,
    plotW,
    plotH,
    plot,
    xTicks,
    yTicks
  }
}

// Radial VRAM-headroom gauge. High peaks are expected for a benchmark, so this is
// presented neutrally (plum), never as a danger dial.
const vramGauge = computed(() => {
  const fraction = vramPeak.value.fraction
  if (fraction == null) return null
  return buildRadialGauge({ fraction, size: 132, strokeWidth: 13 })
})

// VRAM over time — an area chart in GB (y) over seconds (x), with gridlines, tick
// labels, a total-memory ceiling line and the authoritative-peak line.
const vramChart = computed<AxedChart | null>(() => {
  const series = coreBenchmark.value?.resources.series ?? []
  if (series.length === 0) return null
  const valuesGb = series.map((sample) => toGb(sample.vramUsedMb))
  const xSeconds = series.map((sample, index) => (sample.tMs ?? index) / 1000)
  const finite = valuesGb.filter((v): v is number => v != null && Number.isFinite(v))
  if (finite.length < 2) return null
  const ceilingGb = toGb(coreBenchmark.value?.device.totalVramMb)
  const peakGb = toGb(vramPeakMb.value)
  const dataMax = Math.max(...finite)
  // Raise the axis top to fit the ceiling AND the authoritative peak so their
  // reference lines render at true height instead of clipping.
  const maxY = Math.max(dataMax, ceilingGb ?? dataMax, peakGb ?? dataMax)
  return buildAxedChart(valuesGb, {
    width: 720,
    height: 240,
    pad: { l: 46, r: 84, t: 16, b: 30 },
    xValues: xSeconds,
    minY: 0,
    maxY,
    yTickCount: 4,
    xTickCount: 6
  })
})
const vramCeilingGb = computed<number | null>(() => toGb(coreBenchmark.value?.device.totalVramMb))
const vramCeilingY = computed<number | null>(() => {
  const chart = vramChart.value
  if (!chart || vramCeilingGb.value == null) return null
  return projectY(chart.plot, vramCeilingGb.value)
})
const vramPeakGb = computed<number | null>(() => toGb(vramPeakMb.value))
const vramPeakY = computed<number | null>(() => {
  const chart = vramChart.value
  if (!chart || vramPeakGb.value == null) return null
  return projectY(chart.plot, vramPeakGb.value)
})
const vramBaselineGb = computed<number | null>(() =>
  toGb(coreBenchmark.value?.device.baseline.vramUsedMb)
)

// Per-step it/s line (Details), with a dashed steady-state reference.
const stepChart = computed<AxedChart | null>(() => {
  const steps = coreBenchmark.value?.sampling.perStepItPerS ?? []
  if (steps.filter((value) => value != null && Number.isFinite(value)).length < 2) return null
  const xValues = steps.map((_, index) => index + 1)
  return buildAxedChart(steps, {
    width: 460,
    height: 220,
    xValues,
    minY: 0,
    yTickCount: 5,
    xTickCount: 5
  })
})
const steadyLineY = computed<number | null>(() => {
  const chart = stepChart.value
  const steady = steadyItPerS.value
  if (!chart || steady == null) return null
  return projectY(chart.plot, steady)
})

// Power & temperature — a dual-axis card sharing one time (x) axis with an
// independent left (W) and right (°C) scale.
const POWER_TEMP_LAYOUT = { width: 460, height: 220, pad: { l: 44, r: 40, t: 16, b: 30 } }
const powerTempSeconds = computed<number[]>(() =>
  (coreBenchmark.value?.resources.series ?? []).map((sample, index) => (sample.tMs ?? index) / 1000)
)
const powerChart = computed<AxedChart | null>(() => {
  const series = coreBenchmark.value?.resources.series ?? []
  const values = series.map((sample) => sample.powerW)
  if (values.filter((value) => value != null && Number.isFinite(value)).length < 2) return null
  return buildAxedChart(values, {
    ...POWER_TEMP_LAYOUT,
    xValues: powerTempSeconds.value,
    minY: 0,
    yTickCount: 4,
    xTickCount: 4
  })
})
const tempChart = computed<AxedChart | null>(() => {
  const series = coreBenchmark.value?.resources.series ?? []
  const values = series.map((sample) => sample.temperatureC)
  if (values.filter((value) => value != null && Number.isFinite(value)).length < 2) return null
  return buildAxedChart(values, {
    ...POWER_TEMP_LAYOUT,
    xValues: powerTempSeconds.value,
    yTickCount: 4,
    xTickCount: 4
  })
})
/** The power/temp card reuses one geometry frame; either line may be absent. */
const powerTempFrame = computed<AxedChart | null>(() => powerChart.value ?? tempChart.value)
const showPowerTemp = computed<boolean>(() => powerTempFrame.value != null)

/** Hero seconds: 2 decimals below 10 s, 1 decimal at/above (matches the spec). */
function formatHeroSeconds(seconds: number): string {
  return seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)
}
function toneClass(tone: BenchmarkTone): string {
  if (tone === 'positive') return 'is-positive'
  if (tone === 'caution') return 'is-caution'
  return ''
}
function formatMemory(megabytes: number): string {
  return `${(toGb(megabytes) ?? 0).toFixed(1)} GB`
}
function formatOperatingSystem(info: PerformanceTestResultsSummary['systemInfo']): string {
  return (
    [info.os_distro, info.os_release].filter(Boolean).join(' ') ||
    `${info.platform} ${info.os_version}`
  )
}
</script>

<template>
  <template v-if="coreBenchmark">
    <header class="benchmark-context">
      <div class="benchmark-context__meta">
        <span class="benchmark-context__title">{{ resultsSummary?.workflowName }}</span>
        <span class="benchmark-context__facts num">
          <span v-if="heroGpuName" class="benchmark-context__fact">
            {{ heroGpuName
            }}<template v-if="heroTotalVramGb != null">
              · {{ t('performanceTest.gbValue', { value: heroTotalVramGb }) }}</template
            >
          </span>
          <span v-if="heroStepsText" class="benchmark-context__fact">{{
            t('performanceTest.contextSteps', heroStepsText)
          }}</span>
          <span v-if="heroBatchText" class="benchmark-context__fact">{{
            t('performanceTest.contextImages', heroBatchText)
          }}</span>
          <span v-if="heroDateText" class="benchmark-context__fact">{{ heroDateText }}</span>
          <span v-if="heroComfyuiVersion" class="benchmark-context__fact">{{
            t('performanceTest.contextComfyui', { version: heroComfyuiVersion })
          }}</span>
        </span>
      </div>
      <span class="benchmark-status">{{ t('performanceTest.statusCompleted') }}</span>
    </header>

    <div class="benchmark-hero">
      <section class="benchmark-card benchmark-hero__card">
        <header class="benchmark-card__head">
          <h3>{{ t('performanceTest.throughputTitle') }}</h3>
          <span class="benchmark-card__aside">{{
            t('performanceTest.heroMedianOf', { count: measuredRunCount })
          }}</span>
        </header>
        <div class="benchmark-hero__primary">
          <p v-if="heroSeconds != null" class="benchmark-hero__metric num">
            <span class="benchmark-hero__value">{{ formatHeroSeconds(heroSeconds) }}</span>
            <span class="benchmark-hero__unit">{{ t(heroUnitKey) }}</span>
          </p>
          <p v-else class="benchmark-hero__metric benchmark-hero__metric--muted">
            {{ t('performanceTest.notMeasured') }}
          </p>
          <p v-if="steadyItPerS != null" class="benchmark-hero__itps num">
            {{ t('performanceTest.heroItPerS', { value: steadyItPerS.toFixed(2) }) }}
          </p>
          <p v-if="compareView" class="benchmark-hero__delta" :class="toneClass(compareView.tone)">
            <ArrowUp v-if="compareView.dir === 'up'" :size="14" aria-hidden="true" />
            <ArrowDown v-else-if="compareView.dir === 'down'" :size="14" aria-hidden="true" />
            <span>{{ t(compareView.key, compareView.params) }}</span>
          </p>
        </div>
        <dl v-if="hasEfficiencyLine" class="benchmark-eff">
          <div v-if="energyWhPerImage != null" class="benchmark-eff__item">
            <dt>{{ t('performanceTest.energyPerImageLabel') }}</dt>
            <dd class="num">
              {{ t('performanceTest.energyPerImage', { value: energyWhPerImage.toFixed(2) }) }}
            </dd>
          </div>
          <div v-if="peakPowerW != null" class="benchmark-eff__item">
            <dt>{{ t('performanceTest.peakPowerLabel') }}</dt>
            <dd class="num">
              {{ Math.round(peakPowerW) }} W<template v-if="powerLimitW != null">
                / {{ Math.round(powerLimitW) }} W</template
              >
            </dd>
          </div>
          <div v-if="peakTempC != null" class="benchmark-eff__item">
            <dt>{{ t('performanceTest.peakTempLabel') }}</dt>
            <dd class="num">{{ Math.round(peakTempC) }} °C</dd>
          </div>
        </dl>
      </section>

      <section class="benchmark-card benchmark-hero__card benchmark-vram">
        <header class="benchmark-card__head">
          <h3>{{ t(vramPeak.headlineKey) }}</h3>
          <span v-if="vramPeak.totalGb != null" class="benchmark-card__aside num">
            {{ t('performanceTest.gbValue', { value: vramPeak.totalGb }) }}
          </span>
        </header>
        <div class="benchmark-vram__body">
          <div v-if="vramGauge" class="benchmark-vram__gauge">
            <svg
              :viewBox="`0 0 ${vramGauge.size} ${vramGauge.size}`"
              role="img"
              :aria-label="t(vramPeak.headlineKey)"
            >
              <path
                class="benchmark-vram__gauge-track"
                :d="vramGauge.trackPath"
                :stroke-width="vramGauge.strokeWidth"
              />
              <path
                v-if="vramGauge.valuePath"
                class="benchmark-vram__gauge-value"
                :d="vramGauge.valuePath"
                :stroke-width="vramGauge.strokeWidth"
              />
            </svg>
            <div v-if="vramPeak.percent != null" class="benchmark-vram__gauge-center">
              <span class="benchmark-vram__gauge-pct num">{{ vramPeak.percent }}%</span>
            </div>
          </div>
          <div class="benchmark-vram__figures">
            <p v-if="!vramPeak.notMeasured" class="benchmark-vram__value num">
              {{ t('performanceTest.gbValue', { value: vramPeak.peakGb }) }}
            </p>
            <p v-else class="benchmark-vram__value benchmark-vram__value--muted">
              {{ t('performanceTest.notMeasured') }}
            </p>
            <p v-if="vramPeak.secondLine" class="benchmark-vram__sub num">
              {{ t(vramPeak.secondLine.key, vramPeak.secondLine.params) }}
            </p>
            <p v-if="vramPeak.noteKey" class="benchmark-vram__sub">
              {{ t(vramPeak.noteKey) }}
            </p>
            <p v-if="coreOffloaded" class="benchmark-vram__note num">
              {{ t('performanceTest.offloadNote') }}
            </p>
            <p v-if="coreThrottled === true" class="benchmark-vram__note num">
              {{
                t('performanceTest.throttleNote', {
                  watts: peakPowerW != null ? Math.round(peakPowerW) : '—',
                  temp: peakTempC != null ? Math.round(peakTempC) : '—'
                })
              }}
            </p>
          </div>
        </div>
      </section>
    </div>

    <p v-if="rangeStats" class="benchmark-range num">
      {{
        t('performanceTest.rangeSummary', {
          fastest: formatHeroSeconds(rangeStats.fastest),
          slowest: formatHeroSeconds(rangeStats.slowest),
          average: formatHeroSeconds(rangeStats.average),
          measured: rangeStats.measured,
          failed: rangeStats.failed
        })
      }}
    </p>

    <section v-if="coreNodeTimeline.length" class="benchmark-card">
      <header class="benchmark-card__head">
        <h3>{{ t('performanceTest.opTimelineTitle') }}</h3>
        <span v-if="nodeTotalMs != null" class="benchmark-card__aside num">
          {{ t('performanceTest.nodeTotal', { value: formatHeroSeconds(nodeTotalMs / 1000) }) }}
        </span>
      </header>
      <ul class="benchmark-timeline">
        <li
          v-for="node in coreNodeTimeline"
          :key="node.key"
          class="benchmark-timeline__row"
          :class="{ 'is-dominant': node.dominant }"
        >
          <span class="benchmark-timeline__label" :title="node.label">{{ node.label }}</span>
          <span class="benchmark-timeline__bar" aria-hidden="true">
            <i :class="{ 'is-dominant': node.dominant }" :style="{ width: node.width }" />
          </span>
          <span class="benchmark-timeline__value num">
            {{
              t('performanceTest.nodeElapsed', {
                value: formatHeroSeconds(node.seconds),
                percent: node.percent
              })
            }}
          </span>
        </li>
      </ul>
    </section>

    <section v-if="vramChart" class="benchmark-card">
      <header class="benchmark-card__head">
        <h3>{{ t('performanceTest.vramOverTimeTitle') }}</h3>
        <span v-if="vramPeak.peakGb != null" class="benchmark-card__aside num">
          {{ t('performanceTest.vramPeakAside', { value: vramPeak.peakGb }) }}
        </span>
      </header>
      <svg
        class="benchmark-graph"
        :viewBox="`0 0 ${vramChart.width} ${vramChart.height}`"
        role="img"
        :aria-label="t('performanceTest.vramOverTimeTitle')"
      >
        <g :transform="`translate(${vramChart.padL} ${vramChart.padT})`">
          <line
            v-for="tick in vramChart.yTicks"
            :key="`vy-${tick.value}`"
            class="benchmark-graph__grid"
            x1="0"
            :x2="vramChart.plotW"
            :y1="tick.pos"
            :y2="tick.pos"
          />
          <line
            v-if="vramCeilingY != null"
            class="benchmark-graph__ceiling"
            x1="0"
            :x2="vramChart.plotW"
            :y1="vramCeilingY"
            :y2="vramCeilingY"
          />
          <path class="benchmark-graph__area" :d="vramChart.plot.areaPath" />
          <path
            class="benchmark-graph__line benchmark-graph__line--vram"
            :d="vramChart.plot.path"
          />
          <line
            v-if="vramPeakY != null"
            class="benchmark-graph__peak"
            x1="0"
            :x2="vramChart.plotW"
            :y1="vramPeakY"
            :y2="vramPeakY"
          />
        </g>
        <text
          v-for="tick in vramChart.yTicks"
          :key="`vyl-${tick.value}`"
          class="benchmark-graph__axis num"
          :x="vramChart.padL - 8"
          :y="vramChart.padT + tick.pos + 3"
          text-anchor="end"
        >
          {{ tick.value }}
        </text>
        <text
          v-for="tick in vramChart.xTicks"
          :key="`vxl-${tick.value}`"
          class="benchmark-graph__axis num"
          :x="vramChart.padL + tick.pos"
          :y="vramChart.height - 10"
          text-anchor="middle"
        >
          {{ tick.value }}s
        </text>
        <text
          v-if="vramCeilingGb != null && vramCeilingY != null"
          class="benchmark-graph__annot num"
          :x="vramChart.padL + vramChart.plotW + 6"
          :y="vramChart.padT + vramCeilingY + 3"
          text-anchor="start"
        >
          {{ t('performanceTest.vramCeiling', { value: vramCeilingGb }) }}
        </text>
      </svg>
      <p v-if="vramBaselineGb != null" class="benchmark-graph__caption num">
        {{ t('performanceTest.vramBaseline', { value: vramBaselineGb }) }}
      </p>
    </section>

    <section v-if="configChips.length" class="benchmark-card">
      <header class="benchmark-card__head">
        <h3>{{ t('performanceTest.runConfigTitle') }}</h3>
      </header>
      <ul class="benchmark-chips">
        <li
          v-for="chip in configChips"
          :key="chip.key"
          class="benchmark-chip"
          :class="toneClass(chip.tone)"
        >
          {{ chip.text }}
        </li>
      </ul>
    </section>

    <section class="performance-test__details">
      <CollapsibleSectionToggle
        :expanded="detailsExpanded"
        :label="t('performanceTest.detailsToggle')"
        @toggle="detailsExpanded = !detailsExpanded"
      />
      <div v-show="detailsExpanded" class="performance-test__details-body">
        <section v-if="stepChart" class="benchmark-card">
          <header class="benchmark-card__head">
            <h3>{{ t('performanceTest.perStepTitle') }}</h3>
            <span v-if="steadyItPerS != null" class="benchmark-card__aside">
              {{ t('performanceTest.heroItPerS', { value: steadyItPerS.toFixed(1) }) }}
            </span>
          </header>
          <svg
            class="benchmark-graph"
            :viewBox="`0 0 ${stepChart.width} ${stepChart.height}`"
            role="img"
            :aria-label="t('performanceTest.perStepTitle')"
          >
            <g :transform="`translate(${stepChart.padL} ${stepChart.padT})`">
              <line
                v-for="tick in stepChart.yTicks"
                :key="`sy-${tick.value}`"
                class="benchmark-graph__grid"
                x1="0"
                :x2="stepChart.plotW"
                :y1="tick.pos"
                :y2="tick.pos"
              />
              <line
                v-if="steadyLineY != null"
                class="benchmark-graph__reference"
                x1="0"
                :x2="stepChart.plotW"
                :y1="steadyLineY"
                :y2="steadyLineY"
              />
              <path
                class="benchmark-graph__line benchmark-graph__line--success"
                :d="stepChart.plot.path"
              />
              <circle
                v-for="point in stepChart.plot.points"
                :key="point.index"
                class="benchmark-graph__dot"
                :class="{ 'is-dim': point.index === 0 }"
                :cx="point.x"
                :cy="point.y"
                r="2.5"
              />
            </g>
            <text
              v-for="tick in stepChart.yTicks"
              :key="`syl-${tick.value}`"
              class="benchmark-graph__axis num"
              :x="stepChart.padL - 8"
              :y="stepChart.padT + tick.pos + 3"
              text-anchor="end"
            >
              {{ tick.value }}
            </text>
            <text
              v-for="tick in stepChart.xTicks"
              :key="`sxl-${tick.value}`"
              class="benchmark-graph__axis num"
              :x="stepChart.padL + tick.pos"
              :y="stepChart.height - 10"
              text-anchor="middle"
            >
              {{ tick.value }}
            </text>
          </svg>
          <p class="benchmark-graph__caption">
            {{ t('performanceTest.perStepCaption') }}
          </p>
        </section>

        <section v-if="showPowerTemp" class="benchmark-card">
          <header class="benchmark-card__head">
            <h3>{{ t('performanceTest.powerTempTitle') }}</h3>
          </header>
          <svg
            v-if="powerTempFrame"
            class="benchmark-graph"
            :viewBox="`0 0 ${powerTempFrame.width} ${powerTempFrame.height}`"
            role="img"
            :aria-label="t('performanceTest.powerTempTitle')"
          >
            <g :transform="`translate(${powerTempFrame.padL} ${powerTempFrame.padT})`">
              <line
                v-for="tick in (powerChart ?? powerTempFrame).yTicks"
                :key="`pty-${tick.value}`"
                class="benchmark-graph__grid"
                x1="0"
                :x2="powerTempFrame.plotW"
                :y1="tick.pos"
                :y2="tick.pos"
              />
              <path
                v-if="powerChart"
                class="benchmark-graph__line benchmark-graph__line--power"
                :d="powerChart.plot.path"
              />
              <path
                v-if="tempChart"
                class="benchmark-graph__line benchmark-graph__line--temp"
                :d="tempChart.plot.path"
              />
            </g>
            <template v-if="powerChart">
              <text
                v-for="tick in powerChart.yTicks"
                :key="`ptpl-${tick.value}`"
                class="benchmark-graph__axis benchmark-graph__axis--power num"
                :x="powerTempFrame.padL - 8"
                :y="powerTempFrame.padT + tick.pos + 3"
                text-anchor="end"
              >
                {{ tick.value }}
              </text>
            </template>
            <template v-if="tempChart">
              <text
                v-for="tick in tempChart.yTicks"
                :key="`pttl-${tick.value}`"
                class="benchmark-graph__axis benchmark-graph__axis--temp num"
                :x="powerTempFrame.padL + powerTempFrame.plotW + 8"
                :y="powerTempFrame.padT + tick.pos + 3"
                text-anchor="start"
              >
                {{ tick.value }}°
              </text>
            </template>
            <text
              v-for="tick in powerTempFrame.xTicks"
              :key="`ptxl-${tick.value}`"
              class="benchmark-graph__axis num"
              :x="powerTempFrame.padL + tick.pos"
              :y="powerTempFrame.height - 10"
              text-anchor="middle"
            >
              {{ tick.value }}s
            </text>
          </svg>
          <p class="benchmark-graph__legend">
            <span v-if="powerChart" class="benchmark-legend benchmark-legend--power">
              {{ t('performanceTest.powerLegend') }}
            </span>
            <span v-if="tempChart" class="benchmark-legend benchmark-legend--temp">
              {{ t('performanceTest.tempLegend') }}
            </span>
          </p>
        </section>

        <section v-if="statistics" class="benchmark-card">
          <header class="benchmark-card__head">
            <h3>{{ t('performanceTest.runDurationChart') }}</h3>
          </header>
          <div
            class="performance-test__aggregate-chart"
            role="img"
            :aria-label="t('performanceTest.runDurationChart')"
          >
            <div
              v-for="aggregate in aggregateChart"
              :key="aggregate.label"
              class="performance-test__aggregate-bar"
            >
              <span>{{ aggregate.label }}</span>
              <div aria-hidden="true">
                <i :style="{ width: aggregate.width }" />
              </div>
            </div>
          </div>
        </section>

        <template v-if="resultsSummary?.hardware">
          <h3 class="performance-test__details-heading">
            {{ t('performanceTest.systemInformation') }}
          </h3>
          <div class="performance-test__system-groups">
            <section class="performance-test__system-group">
              <dl class="performance-test__result-list performance-test__result-list--compact">
                <div>
                  <dt>{{ t('performanceTest.device') }}</dt>
                  <dd>{{ computeDeviceNames }}</dd>
                </div>
                <div v-if="resultsSummary.hardware.vramMb != null">
                  <dt>{{ t('performanceTest.vram') }}</dt>
                  <dd>{{ formatMemory(resultsSummary.hardware.vramMb) }}</dd>
                </div>
                <div v-if="resultsSummary.hardware.ramMb != null">
                  <dt>{{ t('performanceTest.ram') }}</dt>
                  <dd>{{ formatMemory(resultsSummary.hardware.ramMb) }}</dd>
                </div>
                <div v-if="resultsSummary.hardware.pytorchVersion">
                  <dt>{{ t('performanceTest.pytorchVersion') }}</dt>
                  <dd>{{ resultsSummary.hardware.pytorchVersion }}</dd>
                </div>
                <div v-if="resultsSummary.hardware.xformersVersion">
                  <dt>{{ t('performanceTest.xformersVersion') }}</dt>
                  <dd>{{ resultsSummary.hardware.xformersVersion }}</dd>
                </div>
              </dl>
            </section>

            <section v-if="resultsSummary.systemInfo" class="performance-test__system-group">
              <dl class="performance-test__result-list performance-test__result-list--compact">
                <div>
                  <dt>{{ t('performanceTest.cpu') }}</dt>
                  <dd>{{ resultsSummary.systemInfo.cpu_model }}</dd>
                </div>
                <div>
                  <dt>{{ t('performanceTest.cpuCores') }}</dt>
                  <dd>{{ resultsSummary.systemInfo.cpu_cores }}</dd>
                </div>
                <div>
                  <dt>{{ t('performanceTest.architecture') }}</dt>
                  <dd>{{ resultsSummary.systemInfo.arch }}</dd>
                </div>
                <div>
                  <dt>{{ t('performanceTest.operatingSystem') }}</dt>
                  <dd>{{ formatOperatingSystem(resultsSummary.systemInfo) }}</dd>
                </div>
              </dl>
            </section>
          </div>
        </template>
      </div>
    </section>
  </template>

  <div v-else class="benchmark-empty">
    <p class="benchmark-empty__text">{{ t('performanceTest.needsCapture') }}</p>
  </div>
</template>

<style scoped>
/* --- Rich results view (design §3–§8) --- */
.num {
  font-variant-numeric: tabular-nums lining-nums;
}

.benchmark-context {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin: 0 0 16px;
}

.benchmark-context__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.benchmark-context__title {
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.benchmark-context__facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.benchmark-context__fact:not(:last-child)::after {
  margin-left: 8px;
  color: var(--text-faint);
  content: '·';
}

.benchmark-status {
  flex: 0 0 auto;
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, var(--success) 26%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--success);
  font-size: 12px;
  font-weight: 600;
}

.benchmark-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: 16px;
}

.benchmark-hero__card {
  margin-top: 0;
}

.benchmark-hero__primary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.benchmark-hero__metric {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
}

.benchmark-hero__value {
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: 42px;
  line-height: 1;
}

.benchmark-hero__unit {
  color: var(--text-muted);
  font-size: 15px;
  font-weight: 600;
}

.benchmark-hero__metric--muted,
.benchmark-vram__value--muted {
  color: var(--text-faint);
  font-size: 20px;
  font-style: italic;
}

.benchmark-hero__itps {
  margin: 0;
  color: var(--success);
  font-size: 16px;
  font-weight: 600;
}

.benchmark-hero__delta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}

.benchmark-eff {
  display: flex;
  flex-wrap: wrap;
  gap: 20px 26px;
  margin: 18px 0 0;
  padding: 16px 0 0;
  border-top: 1px solid var(--chooser-surface-border);
}

.benchmark-eff__item {
  min-width: 0;
}

.benchmark-eff__item dt {
  order: 2;
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
}

.benchmark-eff__item dd {
  order: 1;
  margin: 0;
  color: var(--text-primary);
  font-size: 17px;
  font-weight: 600;
}

.benchmark-vram__body {
  display: flex;
  align-items: center;
  gap: 18px;
}

.benchmark-vram__gauge {
  position: relative;
  flex: 0 0 auto;
  width: 112px;
  height: 112px;
}

.benchmark-vram__gauge svg {
  display: block;
  width: 100%;
  height: 100%;
}

.benchmark-vram__gauge-track {
  fill: none;
  stroke: var(--neutral-600);
  stroke-linecap: round;
}

.benchmark-vram__gauge-value {
  fill: none;
  stroke: var(--accent-plum);
  stroke-linecap: round;
}

.benchmark-vram__gauge-center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.benchmark-vram__gauge-pct {
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: 24px;
}

.benchmark-vram__figures {
  min-width: 0;
}

.benchmark-vram__value {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: 26px;
  line-height: 1;
}

.benchmark-vram__sub {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.benchmark-vram__note {
  margin: 6px 0 0;
  color: var(--accent-plum);
  font-size: 12px;
}

.is-positive {
  color: var(--success);
}

.is-caution {
  color: var(--danger);
}

.benchmark-range {
  margin: 14px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.benchmark-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.benchmark-chip {
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--neutral-700);
  color: var(--neutral-200);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.benchmark-chip.is-caution {
  background: color-mix(in srgb, var(--accent-plum) 20%, transparent);
  color: var(--accent-plum);
}

.benchmark-empty {
  padding: 28px 20px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 10px;
  background: var(--surface-recessed);
  text-align: center;
}

.benchmark-empty__text {
  max-width: 46ch;
  margin: 0 auto;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.benchmark-card {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: var(--surface-recessed);
}

.benchmark-card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.benchmark-card__head h3 {
  margin: 0;
  color: var(--neutral-200);
  font-size: 13px;
  font-weight: 400;
}

.benchmark-card__aside {
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.benchmark-timeline {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.benchmark-timeline__row {
  display: grid;
  grid-template-columns: minmax(90px, 160px) minmax(60px, 1fr) auto;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.benchmark-timeline__label {
  overflow: hidden;
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.benchmark-timeline__row.is-dominant .benchmark-timeline__label {
  color: var(--comfy-yellow);
  font-weight: 600;
}

.benchmark-timeline__bar {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--neutral-800);
}

.benchmark-timeline__bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--neutral-300);
}

.benchmark-timeline__bar i.is-dominant {
  background: var(--comfy-yellow);
}

.benchmark-timeline__value {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.benchmark-graph {
  display: block;
  width: 100%;
  height: auto;
}

/* Plum area fill is the VRAM card's single accent (matches the mockup). */
.benchmark-graph__area {
  fill: color-mix(in srgb, var(--accent-plum) 15%, transparent);
  stroke: none;
}

.benchmark-graph__line {
  fill: none;
  stroke: var(--neutral-400);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.benchmark-graph__line--vram {
  stroke: var(--accent-plum);
}

.benchmark-graph__line--success {
  stroke: var(--success);
}

.benchmark-graph__line--power {
  stroke: var(--accent-plum);
}

.benchmark-graph__line--temp {
  stroke: var(--danger);
}

.benchmark-graph__grid {
  stroke: var(--neutral-600);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.benchmark-graph__axis {
  fill: var(--text-muted);
  font-size: 10px;
}

.benchmark-graph__axis--power {
  fill: var(--accent-plum);
}

.benchmark-graph__axis--temp {
  fill: var(--danger);
}

.benchmark-graph__annot {
  fill: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
}

.benchmark-graph__ceiling,
.benchmark-graph__reference {
  stroke: var(--neutral-400);
  stroke-width: 1;
  stroke-dasharray: 4 4;
  vector-effect: non-scaling-stroke;
}

/* Authoritative peak drawn as a neutral reference line at its true height, so it
   matches the "peak X GB" label instead of a dot sitting below it. */
.benchmark-graph__peak {
  fill: none;
  stroke: var(--neutral-500);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.benchmark-graph__dot {
  fill: var(--success);
}

.benchmark-graph__dot.is-dim {
  fill: var(--neutral-500);
}

.benchmark-graph__caption,
.benchmark-graph__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.benchmark-legend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.benchmark-legend::before {
  width: 12px;
  height: 2px;
  border-radius: 2px;
  content: '';
}

.benchmark-legend--power::before {
  background: var(--accent-plum);
}

.benchmark-legend--temp::before {
  background: var(--danger);
}

.performance-test__details {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 20px;
}

.performance-test__details-body {
  display: flex;
  flex-direction: column;
}

.performance-test__details-heading {
  margin: 20px 0 12px;
  color: var(--neutral-200);
  font-size: 13px;
  font-weight: 400;
}

.performance-test__aggregate-chart {
  display: grid;
  gap: 5px;
  margin-top: 32px;
}

.performance-test__aggregate-bar {
  display: grid;
  grid-template-columns: 110px minmax(40px, 1fr);
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.2;
}

.performance-test__aggregate-bar > div {
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--chooser-surface-border);
}

.performance-test__aggregate-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--comfy-yellow);
}

.performance-test__result-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 24px;
  margin: 0;
}

.performance-test__result-list div {
  min-width: 0;
}

.performance-test__result-list dt {
  color: var(--neutral-200);
}

.performance-test__result-list dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  font-size: 24px;
  line-height: 1.25;
}

.performance-test__result-list--compact {
  grid-template-columns: minmax(0, 1fr);
  gap: 8px 24px;
}

.performance-test__result-list--compact div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--chooser-surface-border);
}

.performance-test__result-list--compact dt {
  flex: 0 0 auto;
  font-size: 12px;
}

.performance-test__result-list--compact dd {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.3;
  text-align: right;
}

.performance-test__system-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.performance-test__system-group {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--chooser-surface-bg-hover) 45%, transparent);
}

@media (max-width: 900px) {
  .benchmark-hero {
    grid-template-columns: minmax(0, 1fr);
  }

  .performance-test__result-list--compact {
    grid-template-columns: minmax(0, 1fr);
  }

  .performance-test__system-groups {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
