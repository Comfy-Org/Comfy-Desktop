<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, FolderOpen, ImageDown, Trash2 } from 'lucide-vue-next'
import BrandBackground from '../components/BrandBackground.vue'
import BrandedPageHeader from '../components/BrandedPageHeader.vue'
import CollapsibleSectionToggle from '../components/CollapsibleSectionToggle.vue'
import TemplatePickerStep from '../components/TemplatePickerStep.vue'
import BaseModal from '../components/ui/BaseModal.vue'
import BaseSelect, { type BaseSelectOption } from '../components/ui/BaseSelect.vue'
import { useWorkspaceInstallScope } from '../composables/useWorkspaceInstallScope'
import { useAuthStore } from '../stores/authStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type {
  ActionResult,
  FieldOption,
  PerformanceTestBenchmark,
  PerformanceTestResultsSummary,
  RunPerformanceTestWorkflowResult
} from '../types/ipc'
import {
  createResultsPng,
  createPerformanceTestResultsSvg,
  type PerformanceTestImageMetric
} from '../lib/performanceTestResultsSvg'
import {
  compareToPrevious,
  perImageSeconds,
  tierFromHardware,
  toGb,
  vramPeakView,
  type BenchmarkTone,
  type CompareResult
} from '../lib/benchmarkMetrics'
import {
  buildRadialGauge,
  buildSeriesChart,
  niceTicks,
  projectX,
  projectY,
  type AxisTick,
  type SeriesChart
} from '../lib/benchmarkCharts'
import { emitTelemetryAction } from '../lib/telemetry'
import DevPlatformAccountChip from './devplatform/DevPlatformAccountChip.vue'
import DevPlatformWorkspaceSelector from './devplatform/DevPlatformWorkspaceSelector.vue'

type BenchmarkModality = 'image' | 'video' | 'audio'

interface ConfigChip {
  readonly key: string
  readonly text: string
  readonly tone: BenchmarkTone
}

interface PerformanceTestRunTelemetry {
  readonly installationId: string
  readonly warmupRuns: number
  readonly measuredRuns: number
  readonly startedAtMs: number
}

const { t } = useI18n()
const authStore = useAuthStore()
const installationStore = useInstallationStore()
const sessionStore = useSessionStore()
const { selectedWorkspaceId, scopedInstallations } = useWorkspaceInstallScope(
  toRef(installationStore, 'installations')
)
const performanceTestInstallations = computed(() =>
  scopedInstallations.value.filter(
    (installation) =>
      installation.sourceCategory !== 'cloud' &&
      (authStore.isSignedIn || installation.status === 'installed')
  )
)
const instanceOptions = computed<BaseSelectOption[]>(() =>
  performanceTestInstallations.value.map((installation) => ({
    value: installation.id,
    label: installation.name,
    description: [installation.sourceLabel, installation.version].filter(Boolean).join(' · ')
  }))
)
const selectedInstallationId = ref<string | null>(null)
const workflowFilePath = ref<string | null>(null)
const workflowDisplayName = ref<string | null>(null)
const pendingStarterWorkflowLabel = ref<string | null>(null)
const starterWorkflowInstallationId = ref<string | null>(null)
const workflowImportError = ref<string | null>(null)
const starterWorkflowOptions = ref<FieldOption[]>([])
const selectedStarterWorkflowId = ref<string | null>(null)
const isStarterPickerOpen = ref(false)
const isStarterPickerLoading = ref(false)
const isWorkflowDragging = ref(false)
const isWorkflowImporting = ref(false)
const isWorkflowDeleting = ref(false)
const isLaunching = ref(false)
const isStopping = ref(false)
const isWorkflowLocked = computed(() => isLaunching.value || isStopping.value)
const isExportingResults = ref(false)
const exportResultsError = ref<string | null>(null)
const logsExpanded = ref(true)
const resultsExpanded = ref(true)
const detailsExpanded = ref(false)
/** Modality of the currently-selected workflow (from the catalog option). */
const workflowModality = ref<BenchmarkModality | null>(null)
/** Modality that produced the current result — drives the modality-aware hero. */
const resultModality = ref<BenchmarkModality | null>(null)
/** Prior runs (newest-first) for the inline compare delta. */
const priorBenchmarks = ref<PerformanceTestBenchmark[]>([])
const warmupRuns = ref('1')
const measuredRuns = ref('5')
const logInstallationId = ref<string | null>(null)
const performanceTestInstallationId = ref<string | null>(null)
const logsElement = ref<HTMLElement | null>(null)
const performanceTestResult = ref<RunPerformanceTestWorkflowResult | null>(null)
const progressSessionId = ref<string | null>(null)
const completedProgressRuns = ref(0)
const totalProgressRuns = ref(0)
const progressPercent = computed(() =>
  totalProgressRuns.value > 0
    ? Math.round((completedProgressRuns.value / totalProgressRuns.value) * 100)
    : 0
)
const performanceTestLogs = computed(() => {
  if (!logInstallationId.value) return ''
  return sessionStore.getSession(logInstallationId.value)?.output ?? ''
})
const resultsFolderPath = computed(() => {
  const resultPath =
    performanceTestResult.value?.resultsSummaryPath ?? performanceTestResult.value?.resultPath
  if (!resultPath) return null
  const separatorIndex = Math.max(resultPath.lastIndexOf('/'), resultPath.lastIndexOf('\\'))
  return separatorIndex > 0 ? resultPath.slice(0, separatorIndex) : null
})
const computeDeviceNames = computed(() =>
  (performanceTestResult.value?.hardware?.devices ?? [])
    .flatMap((device) => (device.deviceName ? [device.deviceName] : []))
    .join(', ')
)
const aggregateChart = computed(() => {
  const statistics = performanceTestResult.value?.statistics
  if (!statistics) return []

  const aggregates = [
    {
      label: t('performanceTest.fastestRun'),
      value: statistics.fastest.durationSeconds
    },
    {
      label: t('performanceTest.slowestRun'),
      value: statistics.slowest.durationSeconds
    },
    {
      label: t('performanceTest.averageRunDuration'),
      value: statistics.averageDurationSeconds
    },
    {
      label: t('performanceTest.medianRunDuration'),
      value: statistics.medianDurationSeconds
    }
  ]
  const maximum = Math.max(...aggregates.map(({ value }) => value), 0)

  return aggregates.map((aggregate) => ({
    ...aggregate,
    width: maximum > 0 ? `${(aggregate.value / maximum) * 100}%` : '0%'
  }))
})

// --- Results view (design §3–§7) -------------------------------------------
// Desktop relies solely on the ComfyUI-core capture. When `coreBenchmark` is
// present we render the full results dashboard; when a run completed but core
// wrote no capture we show a calm "needs capture" state (see the template) — we
// no longer fall back to the old duration / `/system_stats` rendering. Within the
// rich view, an individual null leaf still degrades to a muted "— not measured".
const coreBenchmark = computed(() => performanceTestResult.value?.coreBenchmark ?? null)
const resultsSummary = computed(() => performanceTestResult.value?.resultsSummary ?? null)
/** A run finished (a summary exists), regardless of whether core captured metrics. */
const hasResult = computed(() => resultsSummary.value !== null)
/** Core wrote a capture — the only source the results dashboard renders from. */
const hasCoreResult = computed(() => coreBenchmark.value !== null)

const medianSeconds = computed<number | null>(() => {
  const stats = performanceTestResult.value?.statistics
  if (stats?.medianDurationSeconds != null) return stats.medianDurationSeconds
  return resultsSummary.value?.medianJobDurationSeconds ?? null
})
const measuredRunCount = computed<number>(
  () =>
    resultsSummary.value?.measuredJobCount ??
    performanceTestResult.value?.statistics?.measuredJobCount ??
    0
)
const heroImageCount = computed<number | null>(() => coreBenchmark.value?.run.imageCount ?? null)

/** Modality of the run that produced the current result (image | video | audio). */
const heroModality = computed<BenchmarkModality | null>(() => resultModality.value)

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
const steadyItPerS = computed<number | null>(
  () => coreBenchmark.value?.sampling.steadyStateItPerS ?? null
)

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
  const stats = performanceTestResult.value?.statistics
  if (!stats) return null
  return {
    fastest: stats.fastest.durationSeconds,
    slowest: stats.slowest.durationSeconds,
    average: stats.averageDurationSeconds,
    measured: stats.measuredJobCount,
    failed: resultsSummary.value?.failedRunCount ?? performanceTestResult.value?.failedRuns ?? 0
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

const compareResult = computed<CompareResult | null>(() => {
  const summary = resultsSummary.value
  if (!summary) return null
  const count = heroImageCount.value ?? 0
  const imagesPerRun = count > 0 ? count : 1
  // Key on the SAME field priors are stored under (see `toPerformanceTestBenchmark`
  // in performanceTestWorkflows.ts) so both sides of the match come from one
  // producer — otherwise rich runs compare gpuModel vs deviceName and falsely
  // report `differentGpu` for the same GPU (esp. AMD/DirectML/multi-GPU).
  const hardwareName = summary.hardware?.deviceName ?? summary.hardware?.deviceType ?? null
  return compareToPrevious({
    currentPerImageSeconds: perImageSeconds(medianSeconds.value, imagesPerRun),
    imagesPerRun,
    workflowName: summary.workflowName,
    hardwareName,
    priorBenchmarks: priorBenchmarks.value
  })
})
const compareView = computed(() => {
  const compare = compareResult.value
  if (!compare) return null
  switch (compare.kind) {
    case 'faster':
      return {
        key: 'performanceTest.compareFaster',
        params: { pct: compare.pct, prev: formatHeroSeconds(compare.prevSeconds) },
        tone: compare.tone,
        dir: 'up' as const
      }
    case 'slower':
      return {
        key: 'performanceTest.compareSlower',
        params: { pct: compare.pct, prev: formatHeroSeconds(compare.prevSeconds) },
        tone: compare.tone,
        dir: 'down' as const
      }
    case 'same':
      return {
        key: 'performanceTest.compareSame',
        params: { prev: formatHeroSeconds(compare.prevSeconds) },
        tone: 'neutral' as const,
        dir: 'flat' as const
      }
    case 'differentGpu':
      return {
        key: 'performanceTest.compareDifferentGpu',
        params: {},
        tone: 'neutral' as const,
        dir: 'flat' as const
      }
    case 'first':
    default:
      return {
        key: 'performanceTest.compareFirst',
        params: {},
        tone: 'neutral' as const,
        dir: 'flat' as const
      }
  }
})

function toModality(value: unknown): BenchmarkModality | null {
  return value === 'image' || value === 'video' || value === 'audio' ? value : null
}
/** Hero seconds: 2 decimals below 10 s, 1 decimal at/above (matches the spec). */
function formatHeroSeconds(seconds: number): string {
  return seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)
}
function toneClass(tone: BenchmarkTone): string {
  if (tone === 'positive') return 'is-positive'
  if (tone === 'caution') return 'is-caution'
  return ''
}

const workflowFileName = computed(
  () =>
    pendingStarterWorkflowLabel.value ??
    workflowDisplayName.value ??
    workflowFilePath.value?.split(/[\\/]/).pop() ??
    ''
)
const performanceTestSessionId = (installationId: string): string =>
  `performance-test:${installationId}`
const canRun = computed(() => {
  const installationId = selectedInstallationId.value
  const sessionId = installationId ? performanceTestSessionId(installationId) : ''
  return Boolean(
    installationId &&
    workflowFilePath.value &&
    !isLaunching.value &&
    !isStopping.value &&
    !isWorkflowImporting.value &&
    !isWorkflowDeleting.value &&
    !sessionStore.isLaunching(sessionId)
  )
})
const canStop = computed(() => {
  return Boolean(performanceTestInstallationId.value && !isStopping.value)
})
let activeLaunchPromise: Promise<ActionResult> | null = null
let activeRunTelemetry: PerformanceTestRunTelemetry | null = null
let runToken = 0
const unsubscribePerformanceTestProgress = window.api.onPerformanceTestProgress((progress) => {
  if (progress.sessionId !== progressSessionId.value) return
  completedProgressRuns.value = progress.completedRuns
  totalProgressRuns.value = progress.totalRuns
})
onUnmounted(unsubscribePerformanceTestProgress)

watch(selectedWorkspaceId, () => {
  selectedInstallationId.value = null
})

watch(selectedInstallationId, (installationId) => {
  if (
    starterWorkflowInstallationId.value &&
    starterWorkflowInstallationId.value !== installationId &&
    workflowFilePath.value
  ) {
    void deleteWorkflow()
  }
})

function correctRunCount(
  value: string,
  minimum: number,
  maximum: number,
  fallback: number
): string {
  const rawValue = String(value).trim()
  const parsedValue = rawValue === '' ? Number.NaN : Number(rawValue)
  return String(
    Number.isFinite(parsedValue)
      ? Math.min(maximum, Math.max(minimum, Math.round(parsedValue)))
      : fallback
  )
}

function correctWarmupRuns(): void {
  warmupRuns.value = correctRunCount(warmupRuns.value, 1, 5, 1)
}

function correctMeasuredRuns(): void {
  measuredRuns.value = correctRunCount(measuredRuns.value, 1, 100, 5)
}

function secondsToMilliseconds(seconds: number | null | undefined): number | null {
  return seconds == null ? null : seconds * 1000
}

async function importWorkflow(sourcePath?: string): Promise<void> {
  if (isWorkflowImporting.value || isWorkflowDeleting.value || isWorkflowLocked.value) return
  isWorkflowImporting.value = true
  workflowImportError.value = null
  try {
    const result = await window.api.importPerformanceTestWorkflow(sourcePath)
    if (result.ok && result.filePath) {
      workflowFilePath.value = result.filePath
      workflowDisplayName.value = null
      starterWorkflowInstallationId.value = null
      selectedStarterWorkflowId.value = null
      workflowModality.value = null
    } else if (!result.canceled) {
      workflowImportError.value = result.message || t('performanceTest.importFailed')
    }
  } catch (error) {
    workflowImportError.value = (error as Error)?.message || t('performanceTest.importFailed')
  } finally {
    isWorkflowImporting.value = false
  }
}

async function openStarterWorkflowPicker(): Promise<void> {
  const installationId = selectedInstallationId.value
  if (!installationId || isWorkflowLocked.value || isWorkflowImporting.value) return
  if (!navigator.onLine) {
    workflowImportError.value = t('performanceTest.exampleWorkflowsOffline')
    return
  }
  isStarterPickerLoading.value = true
  workflowImportError.value = null
  try {
    starterWorkflowOptions.value =
      await window.api.getPerformanceTestStarterWorkflows(installationId)
    if (starterWorkflowOptions.value.length === 0) {
      workflowImportError.value = t('performanceTest.noStarterWorkflows')
      return
    }
    const recommended = starterWorkflowOptions.value.find((option) => option.recommended)
    selectedStarterWorkflowId.value =
      starterWorkflowOptions.value.find(
        (option) => option.value === selectedStarterWorkflowId.value
      )?.value ??
      recommended?.value ??
      starterWorkflowOptions.value[0]!.value
    isStarterPickerOpen.value = true
  } catch (error) {
    workflowImportError.value = (error as Error)?.message || t('performanceTest.importFailed')
  } finally {
    isStarterPickerLoading.value = false
  }
}

async function prepareStarterWorkflow(): Promise<void> {
  const installationId = selectedInstallationId.value
  const templateId = selectedStarterWorkflowId.value
  const option = starterWorkflowOptions.value.find(({ value }) => value === templateId)
  if (!installationId || !templateId || !option || isWorkflowImporting.value) return

  const previousPath = workflowFilePath.value
  isStarterPickerOpen.value = false
  isWorkflowImporting.value = true
  workflowImportError.value = null
  pendingStarterWorkflowLabel.value = option.label
  try {
    const result = await window.api.preparePerformanceTestStarterWorkflow(
      installationId,
      templateId
    )
    if (!result.ok || !result.filePath) {
      throw new Error(
        result.offline
          ? t('performanceTest.exampleWorkflowsOffline')
          : result.message || t('performanceTest.importFailed')
      )
    }
    if (selectedInstallationId.value !== installationId) {
      await window.api.deletePerformanceTestWorkflow(result.filePath).catch(() => {})
      return
    }
    workflowFilePath.value = result.filePath
    workflowDisplayName.value = result.templateLabel || option.label
    starterWorkflowInstallationId.value = installationId
    workflowModality.value = toModality(option.data?.modality)
    if (previousPath && previousPath !== result.filePath) {
      await window.api.deletePerformanceTestWorkflow(previousPath).catch(() => {})
    }
  } catch (error) {
    workflowImportError.value = (error as Error)?.message || t('performanceTest.importFailed')
  } finally {
    pendingStarterWorkflowLabel.value = null
    isWorkflowImporting.value = false
  }
}

async function deleteWorkflow(): Promise<void> {
  const filePath = workflowFilePath.value
  if (!filePath || isWorkflowDeleting.value || isWorkflowLocked.value) return
  isWorkflowDeleting.value = true
  workflowImportError.value = null
  try {
    const result = await window.api.deletePerformanceTestWorkflow(filePath)
    if (result.ok) {
      if (workflowFilePath.value === filePath) {
        workflowFilePath.value = null
        workflowDisplayName.value = null
        starterWorkflowInstallationId.value = null
        selectedStarterWorkflowId.value = null
        workflowModality.value = null
      }
      if (result.status === 'preserved') {
        workflowImportError.value = result.message || t('performanceTest.deleteFailed')
      }
    } else {
      workflowImportError.value = result.message || t('performanceTest.deleteFailed')
    }
  } catch (error) {
    workflowImportError.value = (error as Error)?.message || t('performanceTest.deleteFailed')
  } finally {
    isWorkflowDeleting.value = false
  }
}

async function dropWorkflow(event: DragEvent): Promise<void> {
  isWorkflowDragging.value = false
  const file = event.dataTransfer?.files[0]
  if (!file) return
  const sourcePath = window.api.getPathForFile(file)
  if (!sourcePath) return
  await importWorkflow(sourcePath)
}

async function runPerformanceTest(): Promise<void> {
  const installationId = selectedInstallationId.value
  const filePath = workflowFilePath.value
  if (
    !installationId ||
    !filePath ||
    isLaunching.value ||
    isStopping.value ||
    isWorkflowImporting.value ||
    isWorkflowDeleting.value
  )
    return

  correctWarmupRuns()
  correctMeasuredRuns()
  const warmups = Number(warmupRuns.value)
  const runs = Number(measuredRuns.value)
  const sessionId = performanceTestSessionId(installationId)
  const token = ++runToken
  const runTelemetry: PerformanceTestRunTelemetry = {
    installationId,
    warmupRuns: warmups,
    measuredRuns: runs,
    startedAtMs: performance.now()
  }
  activeRunTelemetry = runTelemetry
  emitTelemetryAction('comfy.desktop.performance_test.started', {
    installation_id: installationId,
    warmup_runs: warmups,
    measured_runs: runs,
    total_runs: warmups + runs
  })
  isLaunching.value = true
  performanceTestResult.value = null
  resultModality.value = null
  priorBenchmarks.value = []
  progressSessionId.value = sessionId
  completedProgressRuns.value = 0
  totalProgressRuns.value = warmups + runs
  try {
    if (sessionStore.isRunning(sessionId)) await window.api.stopComfyUI(sessionId)
    logInstallationId.value = sessionId
    performanceTestInstallationId.value = installationId
    sessionStore.startSession(sessionId)
    const launchPromise = window.api.runAction(installationId, 'launch', {
      launchModeOverride: 'console',
      autoPortOnConflict: true,
      sessionIdOverride: sessionId
    })
    activeLaunchPromise = launchPromise
    const result = await launchPromise
    activeLaunchPromise = null
    if (token !== runToken) return
    if (!result.ok && !result.cancelled) {
      sessionStore.appendOutput(sessionId, result.message || t('performanceTest.launchFailed'))
    }
    if (!result.ok) {
      performanceTestInstallationId.value = null
      return
    }

    sessionStore.appendOutput(
      sessionId,
      `\n${t('performanceTest.submittingRuns', {
        count: runs,
        warmupCount: warmups
      })}\n`
    )
    try {
      const submission = await window.api.runPerformanceTestWorkflow(
        sessionId,
        filePath,
        runs,
        warmups
      )
      if (submission.ok) {
        performanceTestResult.value = submission
        resultModality.value = workflowModality.value
        void loadPriorBenchmarks(submission)
        if (activeRunTelemetry === runTelemetry) {
          activeRunTelemetry = null
          const summary = submission.resultsSummary
          const statistics = submission.statistics
          const hardware = submission.hardware
          emitTelemetryAction('comfy.desktop.performance_test.completed', {
            installation_id: runTelemetry.installationId,
            warmup_runs: runTelemetry.warmupRuns,
            measured_runs: runTelemetry.measuredRuns,
            successful_runs:
              summary?.measuredJobCount ??
              statistics?.measuredJobCount ??
              Math.max(0, submission.submitted - (submission.failedRuns ?? 0)),
            failed_runs: summary?.failedRunCount ?? submission.failedRuns ?? 0,
            duration_ms: performance.now() - runTelemetry.startedAtMs,
            fastest_run_duration_ms: secondsToMilliseconds(
              summary?.fastestJobDurationSeconds ?? statistics?.fastest.durationSeconds
            ),
            average_run_duration_ms: secondsToMilliseconds(
              summary?.averageJobDurationSeconds ?? statistics?.averageDurationSeconds
            ),
            median_run_duration_ms: secondsToMilliseconds(
              summary?.medianJobDurationSeconds ?? statistics?.medianDurationSeconds
            ),
            slowest_run_duration_ms: secondsToMilliseconds(
              summary?.slowestJobDurationSeconds ?? statistics?.slowest.durationSeconds
            ),
            deviceType: hardware?.deviceType ?? null,
            deviceIndex: hardware?.deviceIndex ?? null,
            deviceName: hardware?.deviceName ?? null,
            backend: hardware?.backend ?? null,
            devicesDeviceType: hardware?.devices.map((device) => device.deviceType) ?? [],
            devicesDeviceIndex: hardware?.devices.map((device) => device.deviceIndex) ?? [],
            devicesDeviceName: hardware?.devices.map((device) => device.deviceName) ?? [],
            devicesBackend: hardware?.devices.map((device) => device.backend) ?? [],
            vramMb: hardware?.vramMb ?? null,
            ramMb: hardware?.ramMb ?? null,
            pytorchVersion: hardware?.pytorchVersion ?? null,
            xformersVersion: hardware?.xformersVersion ?? null,
            cudaDeviceSet: hardware?.cudaDeviceSet ?? null
          })
        }
      }
      sessionStore.appendOutput(
        sessionId,
        submission.ok
          ? `${t('performanceTest.completedRuns', {
              count: submission.submitted,
              failed: submission.failedRuns,
              path: submission.resultPath
            })}\n`
          : `${submission.message || t('performanceTest.submitFailed')}\n`
      )
      if (submission.ok) await stopPerformanceTest()
    } catch (error) {
      sessionStore.appendOutput(
        sessionId,
        `${(error as Error)?.message || t('performanceTest.submitFailed')}\n`
      )
    }
  } catch (error) {
    sessionStore.appendOutput(
      sessionId,
      (error as Error)?.message || t('performanceTest.launchFailed')
    )
    performanceTestInstallationId.value = null
  } finally {
    const logs = sessionStore.getSession(sessionId)?.output
    if (logs !== undefined) {
      try {
        const savedLogs = await window.api.savePerformanceTestLogs(filePath, logs)
        if (!savedLogs.ok) {
          console.error('Failed to save performance test logs:', savedLogs.message)
        }
      } catch (error) {
        console.error('Failed to save performance test logs:', error)
      }
    }
    activeLaunchPromise = null
    if (activeRunTelemetry === runTelemetry) activeRunTelemetry = null
    progressSessionId.value = null
    isLaunching.value = false
  }
}

function formatDuration(seconds: number): string {
  return `${seconds.toFixed(3)} s`
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

function openResultsFolder(): void {
  if (resultsFolderPath.value) void window.api.openPath(resultsFolderPath.value)
}

/** Load prior runs for the inline compare delta, excluding the just-finished run. */
async function loadPriorBenchmarks(submission: RunPerformanceTestWorkflowResult): Promise<void> {
  try {
    const list = await window.api.listPerformanceTestBenchmarks(
      resultsFolderPath.value ?? undefined
    )
    const currentCreatedAt = submission.resultsSummary?.createdAt ?? null
    priorBenchmarks.value = list.benchmarks.filter(
      (benchmark) => benchmark.createdAt !== currentCreatedAt
    )
  } catch {
    priorBenchmarks.value = []
  }
}

async function exportResultsImage(): Promise<void> {
  const summaryPath = performanceTestResult.value?.resultsSummaryPath
  const defaultPath = resultsFolderPath.value
  if (!summaryPath || !defaultPath) return
  isExportingResults.value = true
  exportResultsError.value = null
  try {
    const summary = await window.api.readPerformanceTestResultsSummary(summaryPath)
    const hardware = summary.hardware
    const fastest = summary.fastestJobDurationSeconds
    const slowest = summary.slowestJobDurationSeconds
    const average = summary.averageJobDurationSeconds
    const median = summary.medianJobDurationSeconds
    if (!hardware || fastest === null || slowest === null || average === null || median === null) {
      throw new Error(t('performanceTest.exportImageFailed'))
    }
    const hardwareRows: PerformanceTestImageMetric[] = [
      {
        label: t('performanceTest.device'),
        value: hardware.devices.flatMap((device) => device.deviceName ?? []).join(', ')
      }
    ]
    if (hardware.vramMb != null)
      hardwareRows.push({ label: t('performanceTest.vram'), value: formatMemory(hardware.vramMb) })
    if (hardware.ramMb != null)
      hardwareRows.push({ label: t('performanceTest.ram'), value: formatMemory(hardware.ramMb) })
    if (hardware.pytorchVersion)
      hardwareRows.push({
        label: t('performanceTest.pytorchVersion'),
        value: hardware.pytorchVersion
      })
    if (hardware.xformersVersion)
      hardwareRows.push({
        label: t('performanceTest.xformersVersion'),
        value: hardware.xformersVersion
      })

    const svg = createPerformanceTestResultsSvg({
      title: t('performanceTest.imageTitle', { workflowName: summary.workflowName }),
      aggregateTitle: t('performanceTest.runDurationChart'),
      systemInformationTitle: t('performanceTest.systemInformation'),
      testDateTime: new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(summary.createdAt)),
      metrics: [
        {
          label: t('performanceTest.measuredRunCount'),
          value: String(summary.measuredJobCount)
        },
        {
          label: t('performanceTest.failedRunCount'),
          value: String(summary.failedRunCount)
        },
        {
          label: t('performanceTest.fastestRun'),
          value: formatDuration(fastest),
          durationSeconds: fastest
        },
        {
          label: t('performanceTest.slowestRun'),
          value: formatDuration(slowest),
          durationSeconds: slowest
        },
        {
          label: t('performanceTest.averageRunDuration'),
          value: formatDuration(average),
          durationSeconds: average
        },
        {
          label: t('performanceTest.medianRunDuration'),
          value: formatDuration(median),
          durationSeconds: median
        }
      ],
      hardware: hardwareRows,
      system: [
        { label: t('performanceTest.cpu'), value: summary.systemInfo.cpu_model },
        { label: t('performanceTest.cpuCores'), value: String(summary.systemInfo.cpu_cores) },
        { label: t('performanceTest.architecture'), value: summary.systemInfo.arch },
        {
          label: t('performanceTest.operatingSystem'),
          value: formatOperatingSystem(summary.systemInfo)
        }
      ]
    })
    const png = await createResultsPng(svg)
    const exported = await window.api.exportResultsImage(png, 'performance-test', defaultPath)
    if (!exported.ok && !exported.canceled) {
      exportResultsError.value = exported.message || t('performanceTest.exportImageFailed')
    }
  } catch (error) {
    exportResultsError.value = (error as Error)?.message || t('performanceTest.exportImageFailed')
  } finally {
    isExportingResults.value = false
  }
}

async function stopPerformanceTest(): Promise<void> {
  const installationId = performanceTestInstallationId.value
  if (!installationId || !canStop.value) return
  const sessionId = performanceTestSessionId(installationId)
  runToken += 1

  isStopping.value = true
  try {
    await window.api.cancelOperation(sessionId)
    if (activeLaunchPromise) {
      await activeLaunchPromise.catch(() => undefined)
    }
    await window.api.stopComfyUI(sessionId)
    if (performanceTestInstallationId.value === installationId)
      performanceTestInstallationId.value = null
  } catch (error) {
    sessionStore.appendOutput(
      sessionId,
      `\n${(error as Error)?.message || t('performanceTest.stopFailed')}\n`
    )
  } finally {
    isStopping.value = false
  }
}

async function stopPerformanceTestFromUser(): Promise<void> {
  const telemetry = activeRunTelemetry
  if (telemetry) {
    activeRunTelemetry = null
    emitTelemetryAction('comfy.desktop.performance_test.stopped', {
      installation_id: telemetry.installationId,
      warmup_runs: telemetry.warmupRuns,
      measured_runs: telemetry.measuredRuns,
      completed_runs: completedProgressRuns.value,
      total_runs: telemetry.warmupRuns + telemetry.measuredRuns,
      duration_ms: performance.now() - telemetry.startedAtMs
    })
  }
  await stopPerformanceTest()
}

async function toggleLogs(): Promise<void> {
  logsExpanded.value = !logsExpanded.value
  if (logsExpanded.value) {
    await nextTick()
    if (logsElement.value) logsElement.value.scrollTop = logsElement.value.scrollHeight
  }
}

watch(performanceTestLogs, async () => {
  const logs = logsElement.value
  const shouldFollow = !logs || logs.scrollHeight - logs.scrollTop - logs.clientHeight <= 24
  await nextTick()
  if (shouldFollow && logsElement.value) {
    logsElement.value.scrollTop = logsElement.value.scrollHeight
  }
})
</script>

<template>
  <BrandBackground class="performance-test" data-testid="performance-test">
    <div class="performance-test__layout">
      <div class="performance-test__intro">
        <BrandedPageHeader
          :title="t('performanceTest.title')"
          :description="t('performanceTest.description')"
          logo-test-id="performance-test-logo"
        />
        <div class="performance-test__content">
          <div class="performance-test__columns">
            <section class="performance-test__column">
              <h2>{{ t('performanceTest.selectInstance') }}</h2>
              <div class="performance-test__selection-row">
                <span class="performance-test__selection-label">
                  {{ t('performanceTest.workspaceLabel') }}
                </span>
                <div class="performance-test__selection-control performance-test__workspace-select">
                  <DevPlatformWorkspaceSelector v-model="selectedWorkspaceId" />
                </div>
              </div>
              <div class="performance-test__selection-row">
                <span class="performance-test__selection-label">
                  {{ t('performanceTest.instanceLabel') }}
                </span>
                <div class="performance-test__selection-control performance-test__instance-select">
                  <BaseSelect
                    :model-value="selectedInstallationId ?? ''"
                    :options="instanceOptions"
                    :placeholder="t('performanceTest.selectInstancePlaceholder')"
                    :aria-label="t('performanceTest.selectInstancePlaceholder')"
                    :disabled="instanceOptions.length === 0"
                    @update:model-value="selectedInstallationId = $event"
                  />
                </div>
              </div>
            </section>

            <section class="performance-test__column">
              <h2>{{ t('performanceTest.chooseWorkflow') }}</h2>
              <button
                class="performance-test__starter-workflow brand-secondary"
                type="button"
                :disabled="
                  !selectedInstallationId ||
                  isWorkflowLocked ||
                  isWorkflowImporting ||
                  isStarterPickerLoading
                "
                @click="openStarterWorkflowPicker"
              >
                {{
                  isStarterPickerLoading
                    ? t('performanceTest.loadingStarterWorkflows')
                    : t('performanceTest.chooseStarterWorkflow')
                }}
              </button>
              <div class="performance-test__workflow-divider">
                <span>{{ t('performanceTest.orImportApiWorkflow') }}</span>
              </div>
              <div
                class="performance-test__drop-zone"
                :class="{
                  'performance-test__drop-zone--dragging': isWorkflowDragging,
                  'performance-test__drop-zone--selected':
                    workflowFilePath || pendingStarterWorkflowLabel
                }"
                :aria-busy="isWorkflowImporting || isWorkflowDeleting"
                @dragenter.prevent="isWorkflowDragging = !isWorkflowLocked"
                @dragover.prevent="isWorkflowDragging = !isWorkflowLocked"
                @dragleave.prevent="isWorkflowDragging = false"
                @drop.prevent="dropWorkflow"
              >
                <button
                  class="performance-test__drop-content"
                  type="button"
                  :disabled="isWorkflowLocked"
                  @click="importWorkflow()"
                >
                  <span v-if="!workflowFilePath && !pendingStarterWorkflowLabel">
                    {{
                      isWorkflowImporting
                        ? t('performanceTest.importingWorkflow')
                        : t('performanceTest.dropWorkflowHint')
                    }}
                  </span>
                  <span v-else class="performance-test__workflow-file">
                    <strong>{{ workflowFileName }}</strong>
                    <code v-if="pendingStarterWorkflowLabel">
                      {{ t('performanceTest.preparingStarterWorkflow') }}
                    </code>
                    <code v-else>{{ workflowFilePath }}</code>
                  </span>
                </button>
                <button
                  v-if="workflowFilePath && !isWorkflowLocked"
                  class="performance-test__delete-workflow"
                  type="button"
                  :aria-label="t('performanceTest.deleteWorkflow')"
                  :title="t('performanceTest.deleteWorkflow')"
                  :disabled="isWorkflowDeleting"
                  @click="deleteWorkflow"
                >
                  <Trash2 :size="18" aria-hidden="true" />
                </button>
              </div>
              <p v-if="workflowImportError" class="performance-test__workflow-error" role="alert">
                {{ workflowImportError }}
              </p>
            </section>

            <section class="performance-test__column">
              <h2>{{ t('performanceTest.measurementSettings') }}</h2>
              <div class="performance-test__setting">
                <label for="performance-test-warmup-runs">
                  {{ t('performanceTest.warmupRuns') }}
                </label>
                <div class="brand-input performance-test__setting-input">
                  <input
                    id="performance-test-warmup-runs"
                    v-model="warmupRuns"
                    type="number"
                    min="1"
                    max="5"
                    step="1"
                    @change="correctWarmupRuns"
                    @blur="correctWarmupRuns"
                  />
                </div>
              </div>
              <div class="performance-test__setting">
                <label for="performance-test-measured-runs">
                  {{ t('performanceTest.measuredRuns') }}
                </label>
                <div class="brand-input performance-test__setting-input">
                  <input
                    id="performance-test-measured-runs"
                    v-model="measuredRuns"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    @change="correctMeasuredRuns"
                    @blur="correctMeasuredRuns"
                  />
                </div>
              </div>
              <div class="performance-test__run-actions">
                <button
                  class="danger-solid performance-test__stop"
                  type="button"
                  :disabled="!canStop"
                  @click="stopPerformanceTestFromUser"
                >
                  {{ isStopping ? t('performanceTest.stopping') : t('performanceTest.stop') }}
                </button>
                <button
                  class="brand-primary performance-test__run"
                  type="button"
                  :disabled="!canRun"
                  @click="runPerformanceTest"
                >
                  {{ isLaunching ? t('performanceTest.running') : t('performanceTest.run') }}
                </button>
              </div>
            </section>
          </div>

          <section class="performance-test__results-section">
            <CollapsibleSectionToggle
              :expanded="resultsExpanded"
              :label="t('performanceTest.results')"
              @toggle="resultsExpanded = !resultsExpanded"
            />
            <div v-show="resultsExpanded" class="performance-test__results">
              <div v-if="isLaunching && totalProgressRuns > 0" class="performance-test__progress">
                <div class="performance-test__progress-heading">
                  <span>{{ t('performanceTest.runProgress') }}</span>
                  <span>
                    {{
                      t('performanceTest.runProgressCount', {
                        completed: completedProgressRuns,
                        total: totalProgressRuns
                      })
                    }}
                  </span>
                </div>
                <div
                  class="performance-test__progress-track"
                  role="progressbar"
                  :aria-label="t('performanceTest.runProgress')"
                  :aria-valuenow="completedProgressRuns"
                  aria-valuemin="0"
                  :aria-valuemax="totalProgressRuns"
                >
                  <i :style="{ width: `${progressPercent}%` }" />
                </div>
              </div>
              <template v-else-if="hasCoreResult">
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
                      <span v-if="heroDateText" class="benchmark-context__fact">{{
                        heroDateText
                      }}</span>
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
                        <span class="benchmark-hero__value">{{
                          formatHeroSeconds(heroSeconds)
                        }}</span>
                        <span class="benchmark-hero__unit">{{ t(heroUnitKey) }}</span>
                      </p>
                      <p v-else class="benchmark-hero__metric benchmark-hero__metric--muted">
                        {{ t('performanceTest.notMeasured') }}
                      </p>
                      <p v-if="steadyItPerS != null" class="benchmark-hero__itps num">
                        {{ t('performanceTest.heroItPerS', { value: steadyItPerS.toFixed(2) }) }}
                      </p>
                      <p
                        v-if="compareView"
                        class="benchmark-hero__delta"
                        :class="toneClass(compareView.tone)"
                      >
                        <ArrowUp v-if="compareView.dir === 'up'" :size="14" aria-hidden="true" />
                        <ArrowDown
                          v-else-if="compareView.dir === 'down'"
                          :size="14"
                          aria-hidden="true"
                        />
                        <span>{{ t(compareView.key, compareView.params) }}</span>
                      </p>
                    </div>
                    <dl v-if="hasEfficiencyLine" class="benchmark-eff">
                      <div v-if="energyWhPerImage != null" class="benchmark-eff__item">
                        <dt>{{ t('performanceTest.energyPerImageLabel') }}</dt>
                        <dd class="num">
                          {{
                            t('performanceTest.energyPerImage', {
                              value: energyWhPerImage.toFixed(2)
                            })
                          }}
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
                      {{
                        t('performanceTest.nodeTotal', {
                          value: formatHeroSeconds(nodeTotalMs / 1000)
                        })
                      }}
                    </span>
                  </header>
                  <ul class="benchmark-timeline">
                    <li
                      v-for="node in coreNodeTimeline"
                      :key="node.key"
                      class="benchmark-timeline__row"
                      :class="{ 'is-dominant': node.dominant }"
                    >
                      <span class="benchmark-timeline__label" :title="node.label">{{
                        node.label
                      }}</span>
                      <span class="benchmark-timeline__bar" aria-hidden="true">
                        <i
                          :class="{ 'is-dominant': node.dominant }"
                          :style="{ width: node.width }"
                        />
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
              </template>
              <div v-else-if="hasResult" class="benchmark-empty">
                <p class="benchmark-empty__text">{{ t('performanceTest.needsCapture') }}</p>
              </div>
              <p v-else class="performance-test__results-placeholder">
                {{ t('performanceTest.resultsPlaceholder') }}
              </p>

              <section v-if="hasCoreResult" class="performance-test__details">
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

                  <section v-if="performanceTestResult?.statistics" class="benchmark-card">
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

                  <template v-if="performanceTestResult?.hardware">
                    <h3 class="performance-test__details-heading">
                      {{ t('performanceTest.systemInformation') }}
                    </h3>
                    <div class="performance-test__system-groups">
                      <section class="performance-test__system-group">
                        <dl
                          class="performance-test__result-list performance-test__result-list--compact"
                        >
                          <div>
                            <dt>{{ t('performanceTest.device') }}</dt>
                            <dd>{{ computeDeviceNames }}</dd>
                          </div>
                          <div v-if="performanceTestResult.hardware.vramMb != null">
                            <dt>{{ t('performanceTest.vram') }}</dt>
                            <dd>{{ formatMemory(performanceTestResult.hardware.vramMb) }}</dd>
                          </div>
                          <div v-if="performanceTestResult.hardware.ramMb != null">
                            <dt>{{ t('performanceTest.ram') }}</dt>
                            <dd>{{ formatMemory(performanceTestResult.hardware.ramMb) }}</dd>
                          </div>
                          <div v-if="performanceTestResult.hardware.pytorchVersion">
                            <dt>{{ t('performanceTest.pytorchVersion') }}</dt>
                            <dd>{{ performanceTestResult.hardware.pytorchVersion }}</dd>
                          </div>
                          <div v-if="performanceTestResult.hardware.xformersVersion">
                            <dt>{{ t('performanceTest.xformersVersion') }}</dt>
                            <dd>{{ performanceTestResult.hardware.xformersVersion }}</dd>
                          </div>
                        </dl>
                      </section>

                      <section
                        v-if="performanceTestResult.systemInfo"
                        class="performance-test__system-group"
                      >
                        <dl
                          class="performance-test__result-list performance-test__result-list--compact"
                        >
                          <div>
                            <dt>{{ t('performanceTest.cpu') }}</dt>
                            <dd>{{ performanceTestResult.systemInfo.cpu_model }}</dd>
                          </div>
                          <div>
                            <dt>{{ t('performanceTest.cpuCores') }}</dt>
                            <dd>{{ performanceTestResult.systemInfo.cpu_cores }}</dd>
                          </div>
                          <div>
                            <dt>{{ t('performanceTest.architecture') }}</dt>
                            <dd>{{ performanceTestResult.systemInfo.arch }}</dd>
                          </div>
                          <div>
                            <dt>{{ t('performanceTest.operatingSystem') }}</dt>
                            <dd>{{ formatOperatingSystem(performanceTestResult.systemInfo) }}</dd>
                          </div>
                        </dl>
                      </section>
                    </div>
                  </template>
                </div>
              </section>

              <div v-if="resultsFolderPath" class="performance-test__results-actions">
                <span v-if="exportResultsError" class="performance-test__export-error">
                  {{ exportResultsError }}
                </span>
                <button
                  class="secondary performance-test__open-results"
                  type="button"
                  @click="openResultsFolder"
                >
                  <FolderOpen :size="16" aria-hidden="true" />
                  {{ t('performanceTest.openResultsFolder') }}
                </button>
                <button
                  v-if="
                    performanceTestResult?.statistics &&
                    performanceTestResult.systemInfo &&
                    performanceTestResult.hardware
                  "
                  class="secondary performance-test__export-results"
                  type="button"
                  :disabled="isExportingResults"
                  @click="exportResultsImage"
                >
                  <ImageDown :size="16" aria-hidden="true" />
                  {{
                    isExportingResults
                      ? t('performanceTest.exportingImage')
                      : t('performanceTest.exportResultsImage')
                  }}
                </button>
              </div>
            </div>
          </section>
          <section
            class="performance-test__logs-section"
            :class="{ 'performance-test__logs-section--collapsed': !logsExpanded }"
          >
            <CollapsibleSectionToggle
              :expanded="logsExpanded"
              :label="t('settings.logs')"
              @toggle="toggleLogs"
            />
            <div
              v-show="logsExpanded"
              ref="logsElement"
              class="performance-test__logs scroll-visible"
              aria-live="polite"
            >
              {{ performanceTestLogs || t('performanceTest.logsPlaceholder') }}
            </div>
          </section>
        </div>
      </div>

      <div class="performance-test__account">
        <DevPlatformAccountChip />
      </div>
    </div>

    <BaseModal
      :open="isStarterPickerOpen"
      size="xl"
      :aria-label="t('performanceTest.starterWorkflowPickerTitle')"
      content-class="performance-test__starter-modal"
      @close="isStarterPickerOpen = false"
    >
      <template #header>
        <div>
          <h2>{{ t('performanceTest.starterWorkflowPickerTitle') }}</h2>
          <p>{{ t('performanceTest.starterWorkflowPickerDescription') }}</p>
        </div>
      </template>
      <TemplatePickerStep
        :options="starterWorkflowOptions"
        none-value="none"
        :selected-value="selectedStarterWorkflowId"
        :disk-space="null"
        :disk-space-loading="false"
        compact
        @select="selectedStarterWorkflowId = $event.value"
      />
      <template #footer>
        <button class="brand-secondary" type="button" @click="isStarterPickerOpen = false">
          {{ t('common.cancel') }}
        </button>
        <button
          class="brand-primary"
          type="button"
          :disabled="!selectedStarterWorkflowId"
          @click="prepareStarterWorkflow"
        >
          {{ t('performanceTest.useStarterWorkflow') }}
        </button>
      </template>
    </BaseModal>
  </BrandBackground>
</template>

<style scoped>
.performance-test {
  min-height: 0;
}

.performance-test :deep(.brand-outer-frame),
.performance-test :deep(.brand-inner-frame) {
  min-height: 0;
}

.performance-test__layout {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.performance-test__intro {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  min-height: 100%;
  gap: 24px;
  text-align: left;
}

.performance-test__columns {
  display: grid;
  grid-template-columns: minmax(240px, 3fr) repeat(2, minmax(0, 3.5fr));
  gap: 24px;
  width: 100%;
  min-height: 0;
  flex: 0 0 auto;
}

.performance-test__content {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  min-height: 0;
}

.performance-test__column {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
}

.performance-test__column h2 {
  margin: 0;
  color: var(--neutral-200);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.4;
}

.performance-test__setting {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.performance-test__setting label {
  flex: 0 0 68px;
  color: var(--neutral-200);
  font-size: 13px;
  white-space: nowrap;
}

.performance-test__setting-input {
  box-sizing: border-box;
  flex: 0 1 260px;
  width: 260px;
  min-width: 180px;
  min-height: 30px;
  margin-left: auto;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: var(--takeover-fs-caption);
}

.performance-test__selection-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.performance-test__selection-label {
  flex: 0 0 68px;
  color: var(--neutral-200);
  font-size: 13px;
}

.performance-test__selection-control {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  max-width: 320px;
}

.performance-test__workspace-select :deep(.workspace-selector) {
  width: 100%;
}

.performance-test__workspace-select :deep(.workspace-selector__face) {
  --dp-avatar-size: 20px;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 4px 8px;
}

.performance-test__instance-select :deep(.ui-select-trigger) {
  height: 30px;
  padding: 4px 8px;
}

.performance-test__starter-workflow {
  width: 100%;
  min-height: 34px;
}

.performance-test__workflow-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  color: var(--text-faint);
  font-size: 11px;
  text-transform: uppercase;
}

.performance-test__workflow-divider::before,
.performance-test__workflow-divider::after {
  flex: 1;
  height: 1px;
  background: var(--chooser-surface-border);
  content: '';
}

.performance-test__starter-modal h2 {
  margin: 0;
}

.performance-test__starter-modal p {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}

.performance-test__drop-zone,
.performance-test__logs {
  padding: 20px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: var(--chooser-surface-bg);
  color: var(--text-muted);
}

.performance-test__drop-zone {
  position: relative;
  flex: 0 0 auto;
  width: 100%;
  min-height: 104px;
  padding: 0;
  border-width: 1px;
  border-style: dotted;
  transition:
    border-color 120ms ease,
    background-color 120ms ease;
}

.performance-test__drop-zone:hover,
.performance-test__drop-zone:focus-within,
.performance-test__drop-zone--dragging {
  border-color: var(--chooser-surface-border-hover);
  background: var(--chooser-surface-bg-hover);
}

.performance-test__drop-zone:focus-within {
  outline: none;
}

.performance-test__drop-content {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 102px;
  padding: 20px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: center;
  cursor: pointer;
}

.performance-test__drop-zone--selected .performance-test__drop-content {
  justify-content: flex-start;
  padding-right: 56px;
  text-align: left;
}

.performance-test__workflow-file {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.performance-test__workflow-file strong {
  overflow: hidden;
  color: var(--text-primary);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.performance-test__workflow-file code {
  overflow-wrap: anywhere;
  color: var(--text-faint);
  font-size: 11px;
  font-family: inherit;
}

.performance-test__delete-workflow {
  position: absolute;
  top: 50%;
  right: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transform: translateY(-50%);
}

.performance-test__delete-workflow:hover {
  background: var(--chooser-surface-bg-hover);
  color: var(--accent-danger, #d92d20);
}

.performance-test__workflow-error {
  margin: -8px 0 0;
  color: var(--accent-danger, #d92d20);
  font-size: 12px;
  line-height: 1.4;
}

.performance-test__run-actions {
  display: flex;
  align-self: flex-end;
  gap: 8px;
  margin-top: auto;
}

.performance-test__run,
.performance-test__stop {
  min-width: 96px;
}

.performance-test__logs {
  flex: 0 0 clamp(210px, 37.5vh, 360px);
  min-height: 0;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.performance-test__logs-section {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  min-height: 0;
}

.performance-test__logs-section--collapsed {
  flex: 0 0 auto;
}

.performance-test__results-section {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

.performance-test__results {
  padding: 20px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: var(--chooser-surface-bg);
  color: var(--text-muted);
  font-size: 13px;
}

.performance-test__results-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.performance-test__progress {
  display: grid;
  gap: 12px;
}

.performance-test__progress-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: var(--neutral-200);
}

.performance-test__progress-heading span:first-child {
  color: var(--text-primary);
}

.performance-test__progress-track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--chooser-surface-border);
}

.performance-test__progress-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--comfy-yellow);
  transition: width 180ms ease;
}

.performance-test__open-results,
.performance-test__export-results {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.performance-test__export-error {
  margin-right: auto;
  color: var(--danger);
  font-size: 12px;
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

.performance-test__summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
}

.performance-test__timing-list {
  align-content: start;
}

.performance-test__summary-column > .performance-test__result-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.performance-test__result-workflow {
  grid-column: 1 / -1;
}

.performance-test__summary .performance-test__result-list dt,
.performance-test__summary .performance-test__result-list dd {
  text-align: right;
}

.performance-test__summary-column .performance-test__result-list dt,
.performance-test__summary-column .performance-test__result-list dd {
  text-align: left;
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

.performance-test__result-list--compact {
  grid-template-columns: minmax(0, 1fr);
  gap: 8px 24px;
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

.performance-test__results
  h3
  + .performance-test__result-list:not(.performance-test__result-list--compact)
  dd {
  color: var(--text-muted);
  font-size: 13px;
  line-height: inherit;
}

.performance-test__results h3 {
  margin: 20px 0 12px;
  color: var(--neutral-200);
  font-size: 13px;
  font-weight: 400;
}

.performance-test__results-placeholder {
  margin: 0;
}

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

.performance-test__account {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 2;
  display: flex;
  justify-content: flex-end;
  max-width: min(340px, 45%);
}

@media (max-width: 900px) {
  .performance-test__columns {
    grid-template-columns: minmax(0, 1fr);
  }

  .benchmark-hero {
    grid-template-columns: minmax(0, 1fr);
  }

  .performance-test__summary {
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
