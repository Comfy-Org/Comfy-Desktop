<script setup lang="ts">
/**
 * Compare view (design §4): 2–5 runs become columns, including DIFFERENT workflows,
 * handled honestly. The headline new capability.
 *
 * Honesty rules baked in:
 *   - No editorializing. Values are always neutral plum; the ONLY colored element is
 *     a delta chip, scored by OUTCOME (`--success`/`--danger`) via `computeMetricDelta`.
 *   - Cross-workflow: per-run metrics (sec/image, duration, steps) are NOT comparable
 *     across different work — their delta cells show a muted `✕` and the header carries
 *     a neutral note. Per-workload metrics (it/s, VRAM, energy, power, temp) stay fair.
 *   - Charts never stretch a short run or draw a shared VRAM ceiling across mixed GPUs.
 *
 * Data comes from the nav store's resolved `compareRuns` objects (oldest-first) so this
 * view never re-lists from disk.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  buildCeilingLines,
  buildMultiSeriesChart,
  buildOpTimeline,
  niceTicks,
  projectX,
  projectY,
  type MultiSeriesChart,
  type MultiSeriesInput
} from '../lib/benchmarkCharts'
import { buildBenchmarkCsv, buildBenchmarkJson } from '../lib/benchmarkExport'
import { computeMetricDelta, secPerImageOf, toGb, type MetricDelta } from '../lib/benchmarkMetrics'
import { exportBaseName, seriesColors } from '../lib/benchmarkShared'
import { createResultsPng } from '../lib/performanceTestResultsSvg'
import { useBenchmarkNavStore } from '../stores/benchmarkNavStore'
import type { PerformanceTestBenchmark } from '../types/ipc'

const { t } = useI18n()
const benchmarkNav = useBenchmarkNavStore()

// Ceiling hues when GPUs differ: one dashed line per distinct VRAM total. A VRAM
// total is a neutral fact, never a verdict, so this palette stays neutral (plum +
// a graded gray ramp) — NO `--danger` (reserved for delta chips + abnormal flags,
// spec §6). ≥5 distinct entries so up to 5 GPU ceilings never share a hue.
const ceilingColors = [
  'var(--accent-plum)',
  'var(--neutral-300)',
  'var(--text-faint)',
  'var(--neutral-200)',
  'var(--neutral-500)'
]

const runs = computed(() => benchmarkNav.compareRuns)
const runCount = computed(() => runs.value.length)

function num(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null
}

function workflowKeyOf(run: PerformanceTestBenchmark): string {
  return run.workflowName || run.coreBenchmark?.run?.benchmarkId || run.id
}

interface Column {
  run: PerformanceTestBenchmark
  color: string
  isBaseline: boolean
  workflowKey: string
  needsCapture: boolean
  subtitle: string
}

function gpuShort(run: PerformanceTestBenchmark): string {
  return run.coreBenchmark?.device?.gpuModel ?? run.hardwareName ?? t('benchmarks.unknownHardware')
}

function columnSubtitle(run: PerformanceTestBenchmark): string {
  const gpu = gpuShort(run)
  const totalGb = toGb(run.coreBenchmark?.device?.totalVramMb)
  return totalGb != null ? `${gpu} · ${totalGb} GB` : gpu
}

const baselineRun = computed<PerformanceTestBenchmark | null>(() => {
  const id = benchmarkNav.baselineRunId
  return runs.value.find((run) => run.id === id) ?? runs.value[0] ?? null
})
const baselineWorkflowKey = computed(() =>
  baselineRun.value ? workflowKeyOf(baselineRun.value) : null
)

const columns = computed<Column[]>(() =>
  runs.value.map((run, index) => ({
    run,
    color: seriesColors[index % seriesColors.length]!,
    isBaseline: run.id === baselineRun.value?.id,
    workflowKey: workflowKeyOf(run),
    needsCapture: run.coreBenchmark == null,
    subtitle: columnSubtitle(run)
  }))
)

const distinctWorkflows = computed(() => new Set(columns.value.map((column) => column.workflowKey)))
const sameWorkflow = computed(() => distinctWorkflows.value.size <= 1)
const isSingleRun = computed(() => runCount.value === 1)

function setBaseline(event: Event): void {
  benchmarkNav.setBaseline((event.target as HTMLSelectElement).value)
}

// --- value accessors (defensive; `coreBenchmark` is null on needs-capture runs).
// sec/image comes from the shared `secPerImageOf` helper so History, Compare and the
// data export agree on the captured-else-median/imageCount rule. ---
interface MetricDef {
  labelKey: string
  value: (run: PerformanceTestBenchmark) => number | null
  /** Suffix shown after the value (muted), e.g. `GB`, `Wh`, `s`. */
  unit: string
  decimals: number
  /** `null` marks a neutral metric (no good direction → never colored). */
  lowerIsBetter: boolean | null
  deltaMode: 'pct' | 'abs'
  /** Unit inside an absolute-mode chip, e.g. ` GB`, ` W`, ` °C`. */
  absSuffix?: string
  /** Per-run metrics are workflow-dependent → not comparable across workflows. */
  perRun?: boolean
}

const perWorkloadDefs: MetricDef[] = [
  {
    labelKey: 'rowSteadyStateItPerS',
    value: (run) => num(run.steadyStateItPerS),
    unit: '',
    decimals: 2,
    lowerIsBetter: false,
    deltaMode: 'pct'
  },
  {
    labelKey: 'rowVramPeak',
    value: (run) => toGb(run.coreBenchmark?.resources?.peak?.vramUsedMb),
    unit: 'GB',
    decimals: 1,
    lowerIsBetter: true,
    deltaMode: 'abs',
    absSuffix: ' GB'
  },
  {
    labelKey: 'rowEnergyPerImage',
    value: (run) => num(run.coreBenchmark?.summary?.energyWhPerImage),
    unit: 'Wh',
    decimals: 2,
    lowerIsBetter: true,
    deltaMode: 'pct'
  },
  {
    labelKey: 'rowPeakPower',
    value: (run) => num(run.coreBenchmark?.resources?.peak?.powerW),
    unit: 'W',
    decimals: 0,
    lowerIsBetter: true,
    deltaMode: 'abs',
    absSuffix: ' W'
  },
  {
    labelKey: 'rowPeakTemp',
    value: (run) => num(run.coreBenchmark?.resources?.peak?.temperatureC),
    unit: '°C',
    decimals: 0,
    lowerIsBetter: true,
    deltaMode: 'abs',
    absSuffix: ' °C'
  },
  {
    labelKey: 'rowPeakGpuUtil',
    value: (run) => num(run.coreBenchmark?.resources?.peak?.vramUtilPercent),
    unit: '%',
    decimals: 0,
    lowerIsBetter: null,
    deltaMode: 'abs',
    absSuffix: ' %'
  }
]

const perRunDefs: MetricDef[] = [
  {
    labelKey: 'rowSecPerImage',
    value: secPerImageOf,
    unit: 's',
    decimals: 2,
    lowerIsBetter: true,
    deltaMode: 'pct',
    perRun: true
  },
  {
    labelKey: 'rowMedianRunDuration',
    value: (run) => num(run.medianJobDurationSeconds),
    unit: 's',
    decimals: 2,
    lowerIsBetter: true,
    deltaMode: 'pct',
    perRun: true
  },
  {
    labelKey: 'rowSteps',
    value: (run) => num(run.coreBenchmark?.workflow?.steps),
    unit: '',
    decimals: 0,
    lowerIsBetter: null,
    deltaMode: 'abs',
    perRun: true
  }
]

interface ChipVM {
  cls: 'good' | 'bad' | 'same' | 'na'
  text: string
  title?: string
}
interface NumCellVM {
  display: string
  unit: string
  isBaseline: boolean
  chip: ChipVM | null
}
interface MetricRowVM {
  key: string
  label: string
  cells: NumCellVM[]
}
interface BandVM {
  key: string
  title: string
  rows: MetricRowVM[]
}

function fmt(value: number, decimals: number): string {
  return value.toFixed(decimals)
}
function signedAbs(abs: number, def: MetricDef): string {
  const sign = abs > 0 ? '+' : ''
  return `${sign}${fmt(abs, def.decimals)}${def.absSuffix ?? ''}`
}

function chipFor(def: MetricDef, delta: MetricDelta | null): ChipVM | null {
  if (delta == null) return { cls: 'na', text: '—', title: t('benchmarks.compare.notMeasured') }
  if (delta.outcome === 'notComparable') {
    return { cls: 'na', text: '✕', title: t('benchmarks.compare.notCompared') }
  }
  if (delta.outcome === 'same') {
    // Neutral metrics may still carry a real movement; others collapse to ≈.
    if (def.lowerIsBetter === null && Number(delta.abs.toFixed(def.decimals)) !== 0) {
      return { cls: 'same', text: signedAbs(delta.abs, def) }
    }
    return { cls: 'same', text: '≈' }
  }
  const cls = delta.outcome === 'better' ? 'good' : 'bad'
  const arrow = delta.direction === 'up' ? '▲' : '▼'
  if (def.deltaMode === 'pct') {
    const pctText =
      delta.pct != null ? `${Math.abs(delta.pct).toFixed(0)}%` : signedAbs(delta.abs, def)
    return { cls, text: `${arrow} ${pctText}`, title: signedAbs(delta.abs, def) }
  }
  const title =
    delta.pct != null ? `${delta.pct > 0 ? '+' : ''}${delta.pct.toFixed(1)}%` : undefined
  return { cls, text: `${arrow} ${signedAbs(delta.abs, def)}`, title }
}

function cellFor(def: MetricDef, column: Column): NumCellVM {
  const value = def.value(column.run)
  const display = value == null ? '—' : fmt(value, def.decimals)
  if (column.isBaseline) {
    return { display, unit: value == null ? '' : def.unit, isBaseline: true, chip: null }
  }
  const comparable = def.perRun ? column.workflowKey === baselineWorkflowKey.value : true
  const delta = computeMetricDelta({
    baseline: baselineRun.value ? def.value(baselineRun.value) : null,
    current: value,
    lowerIsBetter: def.lowerIsBetter,
    comparable
  })
  return {
    display,
    unit: value == null ? '' : def.unit,
    isBaseline: false,
    chip: chipFor(def, delta)
  }
}

function bandFor(key: string, defs: MetricDef[]): BandVM {
  return {
    key,
    title: t(`benchmarks.compare.${key}`),
    rows: defs.map((def) => ({
      key: def.labelKey,
      label: t(`benchmarks.compare.${def.labelKey}`),
      cells: columns.value.map((column) => cellFor(def, column))
    }))
  }
}

const metricBands = computed<BandVM[]>(() => [
  bandFor('bandPerWorkload', perWorkloadDefs),
  bandFor('bandPerRun', perRunDefs)
])

// --- configuration band (string values; cells that differ from baseline flagged) ---
function cudaCudnn(run: PerformanceTestBenchmark): string {
  const device = run.coreBenchmark?.device
  const cuda = device?.cudaVersion
  const cudnn = device?.cudnnVersion
  if (!cuda && !cudnn) return '—'
  return `${cuda ?? '—'} / ${cudnn ?? '—'}`
}
function gpuConfig(run: PerformanceTestBenchmark): string {
  const model = run.coreBenchmark?.device?.gpuModel ?? run.hardwareName
  if (!model) return '—'
  const totalGb = toGb(run.coreBenchmark?.device?.totalVramMb)
  return totalGb != null ? `${model} ${totalGb}GB` : model
}
function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

interface ConfigDef {
  labelKey: string
  get: (run: PerformanceTestBenchmark) => string
  /** Whether a per-column difference from the baseline is highlighted (`⟵ differs`).
   *  Only the genuine config fields that can explain an A/B delta are diffable; Date
   *  always differs run-to-run, so flagging it is pure noise. */
  diffable: boolean
}
const configDefs: ConfigDef[] = [
  { labelKey: 'rowGpu', get: gpuConfig, diffable: true },
  {
    labelKey: 'rowWeightDtype',
    get: (run) => run.coreBenchmark?.device?.weightDtype ?? '—',
    diffable: true
  },
  {
    labelKey: 'rowAttention',
    get: (run) => run.coreBenchmark?.device?.attentionImpl ?? '—',
    diffable: true
  },
  { labelKey: 'rowCudaCudnn', get: cudaCudnn, diffable: true },
  {
    labelKey: 'rowComfyui',
    get: (run) => run.coreBenchmark?.device?.comfyuiVersion ?? '—',
    diffable: true
  },
  { labelKey: 'rowDate', get: (run) => formatDate(run.createdAt), diffable: false }
]

interface ConfigCellVM {
  display: string
  isBaseline: boolean
  differs: boolean
}
interface ConfigRowVM {
  key: string
  label: string
  cells: ConfigCellVM[]
}
const configBand = computed<ConfigRowVM[]>(() =>
  configDefs.map((def) => {
    const baselineValue = baselineRun.value ? def.get(baselineRun.value) : null
    return {
      key: def.labelKey,
      label: t(`benchmarks.compare.${def.labelKey}`),
      cells: columns.value.map((column) => {
        const display = def.get(column.run)
        return {
          display,
          isBaseline: column.isBaseline,
          differs:
            def.diffable && !column.isBaseline && baselineValue != null && display !== baselineValue
        }
      })
    }
  })
)

// --- op-timeline (design §4.4) ---
interface OpBar {
  key: string
  label: string
  percent: number
  width: number
  dominant: boolean
}
interface OpPanel {
  key: string
  color: string
  label: string
  bars: OpBar[]
}
function opNodesOf(run: PerformanceTestBenchmark): { label: string; value: number | null }[] {
  return (run.coreBenchmark?.nodes ?? []).map((node) => ({
    label: node.classType ?? node.nodeId ?? '—',
    value: node.elapsedMs
  }))
}
const opPanels = computed<OpPanel[]>(() =>
  columns.value.map((column) => {
    const timeline = buildOpTimeline(opNodesOf(column.run), { topN: 6 })
    return {
      key: column.run.id,
      color: column.color,
      label: column.run.workflowName,
      bars: timeline.bars.map((bar, index) => ({
        key: `${bar.index}-${bar.label}`,
        label: bar.label,
        percent: Math.round(bar.share * 100),
        width: Math.round(bar.widthFraction * 100),
        dominant: index === 0
      }))
    }
  })
)

interface OpDiffRow {
  key: string
  label: string
  aPercent: number
  aWidth: number
  bPercent: number
  bWidth: number
  faster: boolean
}
interface OpDiff {
  rows: OpDiffRow[]
  aLabel: string
  bLabel: string
  aColor: string
  bColor: string
}
const opDiff = computed<OpDiff | null>(() => {
  if (!sameWorkflow.value || columns.value.length !== 2) return null
  const [a, b] = columns.value
  if (!a || !b) return null
  // Per node, carry BOTH the share (fraction of that run's own total → bar size/label)
  // and the raw elapsed ms (absolute time → faster/slower verdict).
  const statsMap = (run: PerformanceTestBenchmark): Map<string, { share: number; ms: number }> => {
    const map = new Map<string, { share: number; ms: number }>()
    buildOpTimeline(opNodesOf(run)).bars.forEach((bar) =>
      map.set(bar.label, { share: bar.share, ms: bar.value })
    )
    return map
  }
  const ma = statsMap(a.run)
  const mb = statsMap(b.run)
  if (ma.size === 0 && mb.size === 0) return null
  const labels = [...new Set([...ma.keys(), ...mb.keys()])]
  const maxShare = Math.max(
    ...labels.map((label) => Math.max(ma.get(label)?.share ?? 0, mb.get(label)?.share ?? 0)),
    0.0001
  )
  const rows: OpDiffRow[] = labels
    .map((label) => {
      const sa = ma.get(label)?.share ?? 0
      const sb = mb.get(label)?.share ?? 0
      // Faster/slower is decided on ABSOLUTE elapsed ms, not share: a node can grow in
      // ms yet shrink in share (if the run's total grew more), so share would mislead.
      const msA = ma.get(label)?.ms ?? 0
      const msB = mb.get(label)?.ms ?? 0
      return {
        key: label,
        label,
        aPercent: Math.round(sa * 100),
        aWidth: Math.round((sa / maxShare) * 100),
        bPercent: Math.round(sb * 100),
        bWidth: Math.round((sb / maxShare) * 100),
        faster: msB < msA
      }
    })
    .sort((x, y) => Math.max(y.aPercent, y.bPercent) - Math.max(x.aPercent, x.bPercent))
  return {
    rows,
    aLabel: a.run.workflowName,
    bLabel: b.run.workflowName,
    aColor: a.color,
    bColor: b.color
  }
})
const showOpCard = computed(() =>
  opDiff.value
    ? opDiff.value.rows.length > 0
    : opPanels.value.some((panel) => panel.bars.length > 0)
)

// --- overlaid line charts (per-step it/s, VRAM over time, power/temp) ---
const CHART_W = 540
const CHART_H = 280
interface AxisTick {
  value: number
  pos: number
}
interface MultiAxed {
  chart: MultiSeriesChart
  width: number
  height: number
  padL: number
  padT: number
  plotW: number
  plotH: number
  xTicks: AxisTick[]
  yTicks: AxisTick[]
}
function axeMulti(
  seriesList: MultiSeriesInput[],
  opts: {
    width: number
    height: number
    pad: { l: number; r: number; t: number; b: number }
    minY?: number
    maxY?: number
    xTickCount?: number
    yTickCount?: number
  }
): MultiAxed | null {
  const plotW = opts.width - opts.pad.l - opts.pad.r
  const plotH = opts.height - opts.pad.t - opts.pad.b
  const chart = buildMultiSeriesChart(seriesList, {
    width: plotW,
    height: plotH,
    minY: opts.minY,
    maxY: opts.maxY
  })
  if (!chart) return null
  const eps = 1e-6
  const yTicks = niceTicks(chart.min, chart.max, opts.yTickCount ?? 4)
    .filter((value) => value >= chart.min - eps && value <= chart.max + eps)
    .map((value) => ({ value, pos: projectY(chart, value) }))
  const xTicks = niceTicks(chart.minX, chart.maxX, opts.xTickCount ?? 5)
    .filter((value) => value >= chart.minX - eps && value <= chart.maxX + eps)
    .map((value) => ({ value, pos: projectX(chart, value) }))
  return {
    chart,
    width: opts.width,
    height: opts.height,
    padL: opts.pad.l,
    padT: opts.pad.t,
    plotW,
    plotH,
    xTicks,
    yTicks
  }
}

const stepChart = computed<MultiAxed | null>(() => {
  const seriesList = columns.value.map((column) => {
    const steps = column.run.coreBenchmark?.sampling?.perStepItPerS ?? []
    return { values: steps, xValues: steps.map((_, index) => index + 1) }
  })
  return axeMulti(seriesList, {
    width: CHART_W,
    height: CHART_H,
    pad: { l: 46, r: 18, t: 16, b: 34 },
    minY: 0,
    yTickCount: 5,
    xTickCount: 5
  })
})

const vramCeilingsGb = computed(() =>
  columns.value.map((column) => toGb(column.run.coreBenchmark?.device?.totalVramMb))
)
const vramChart = computed<MultiAxed | null>(() => {
  const seriesList = columns.value.map((column) => {
    const series = column.run.coreBenchmark?.resources?.series ?? []
    return {
      values: series.map((sample) => toGb(sample.vramUsedMb)),
      xValues: series.map((sample, index) => (sample.tMs ?? index * 1000) / 1000)
    }
  })
  const values = seriesList
    .flatMap((series) => series.values)
    .filter((value): value is number => value != null && Number.isFinite(value))
  if (values.length === 0) return null
  const ceilings = vramCeilingsGb.value.filter((value): value is number => value != null)
  const maxY = Math.max(...values, ...ceilings)
  return axeMulti(seriesList, {
    width: CHART_W,
    height: CHART_H,
    pad: { l: 46, r: 72, t: 16, b: 34 },
    minY: 0,
    maxY,
    yTickCount: 4,
    xTickCount: 5
  })
})
const vramCeilingLines = computed(() => {
  const chart = vramChart.value
  if (!chart) return []
  return buildCeilingLines(chart.chart, vramCeilingsGb.value).map((line, index) => ({
    value: line.value,
    y: line.y,
    color: ceilingColors[index % ceilingColors.length]!
  }))
})

const hasPowerTemp = computed(() =>
  columns.value.some((column) => {
    const peak = column.run.coreBenchmark?.resources?.peak
    return num(peak?.powerW) != null || num(peak?.temperatureC) != null
  })
)
const POWER_PAD = { l: 46, r: 46, t: 16, b: 34 }
const powerChart = computed<MultiAxed | null>(() => {
  const seriesList = columns.value.map((column) => {
    const series = column.run.coreBenchmark?.resources?.series ?? []
    return {
      values: series.map((sample) => sample.powerW),
      xValues: series.map((sample, index) => (sample.tMs ?? index * 1000) / 1000)
    }
  })
  return axeMulti(seriesList, {
    width: CHART_W,
    height: CHART_H,
    pad: POWER_PAD,
    minY: 0,
    yTickCount: 4,
    xTickCount: 5
  })
})
const tempChart = computed<MultiAxed | null>(() => {
  const seriesList = columns.value.map((column) => {
    const series = column.run.coreBenchmark?.resources?.series ?? []
    return {
      values: series.map((sample) => sample.temperatureC),
      xValues: series.map((sample, index) => (sample.tMs ?? index * 1000) / 1000)
    }
  })
  return axeMulti(seriesList, {
    width: CHART_W,
    height: CHART_H,
    pad: POWER_PAD,
    yTickCount: 4,
    xTickCount: 5
  })
})

// Power + temp share one time x-axis; take ticks from whichever chart exists so the
// overlay draws x-axis labels like the other time-series charts (design consistency).
const powerTempXTicks = computed<AxisTick[]>(
  () => powerChart.value?.xTicks ?? tempChart.value?.xTicks ?? []
)

const legend = computed(() =>
  columns.value.map((column) => ({
    key: column.run.id,
    color: column.color,
    label: column.run.workflowName
  }))
)

// --- export (design §5) ---
const isExportingImage = ref(false)
const exportError = ref<string | null>(null)

// Outside-click close for the "Export data ▾" <details> menu — same global
// pointerdown pattern as History, so clicking anywhere else collapses the dropdown.
function closeMenusOnOutsideClick(event: PointerEvent): void {
  const target = event.target
  if (!(target instanceof Node)) return
  for (const element of document.querySelectorAll<HTMLDetailsElement>(
    'details.benchmark-compare__menu[open]'
  )) {
    if (!element.contains(target)) element.open = false
  }
}
document.addEventListener('pointerdown', closeMenusOnOutsideClick, true)
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeMenusOnOutsideClick, true))

function closeAllMenus(): void {
  for (const element of document.querySelectorAll<HTMLDetailsElement>(
    'details.benchmark-compare__menu[open]'
  )) {
    element.open = false
  }
}

async function exportData(format: 'csv' | 'json'): Promise<void> {
  closeAllMenus()
  if (runs.value.length === 0) return
  exportError.value = null
  const contents = format === 'csv' ? buildBenchmarkCsv(runs.value) : buildBenchmarkJson(runs.value)
  try {
    const result = await window.api.exportBenchmarkData(
      contents,
      exportBaseName(runCount.value, format)
    )
    if (!result.ok && !result.canceled) {
      exportError.value = result.message || t('benchmarks.exportDataFailed')
    }
  } catch (error) {
    exportError.value = (error as Error)?.message || t('benchmarks.exportDataFailed')
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** Build a self-contained comparison SVG (header context + note + three-band table).
 *  The cross-workflow note travels with the artifact (design §5.2 honesty). */
function buildComparisonSvg(): string {
  const cols = columns.value
  const labelW = 190
  const colW = 184
  const marginX = 40
  const rowH = 30
  const headerH = 150
  const width = marginX * 2 + labelW + colW * cols.length
  const noteText = sameWorkflow.value
    ? t('benchmarks.compare.modeSameWorkflow')
    : t('benchmarks.compare.crossWorkflowNote')

  const allRows = [
    { band: t('benchmarks.compare.bandPerWorkload'), rows: metricBands.value[0]!.rows },
    { band: t('benchmarks.compare.bandPerRun'), rows: metricBands.value[1]!.rows }
  ]
  // Hardcoded hexes mirror the design tokens --success (#00cd72), --danger (#e05858)
  // and --text-faint (#8a8688): the exported SVG is a standalone raster with no CSS
  // custom properties, so the token values are inlined here to keep chips on-brand.
  const chipColor = (cls: ChipVM['cls']): string =>
    cls === 'good' ? '#00cd72' : cls === 'bad' ? '#e05858' : '#8a8688'

  let y = headerH
  const body: string[] = []
  for (const group of allRows) {
    body.push(
      `<rect x="${marginX}" y="${y - 20}" width="${width - marginX * 2}" height="26" fill="#150f1a" />`,
      `<text x="${marginX + 12}" y="${y - 2}" class="band">${escapeXml(group.band)}</text>`
    )
    y += rowH
    for (const row of group.rows) {
      body.push(
        `<text x="${marginX + 12}" y="${y}" class="rowlabel">${escapeXml(row.label)}</text>`
      )
      row.cells.forEach((cell, index) => {
        const cx = marginX + labelW + colW * index + 12
        body.push(
          `<text x="${cx}" y="${y}" class="value">${escapeXml(cell.display)}${
            cell.unit ? ` ${escapeXml(cell.unit)}` : ''
          }</text>`
        )
        if (cell.chip) {
          body.push(
            `<text x="${cx + 92}" y="${y}" class="chip" fill="${chipColor(cell.chip.cls)}">${escapeXml(
              cell.chip.text
            )}</text>`
          )
        } else if (cell.isBaseline) {
          body.push(
            `<text x="${cx + 92}" y="${y}" class="base">${escapeXml(t('benchmarks.compare.baselineTag'))}</text>`
          )
        }
      })
      y += rowH
    }
  }

  // Configuration band.
  body.push(
    `<rect x="${marginX}" y="${y - 20}" width="${width - marginX * 2}" height="26" fill="#150f1a" />`,
    `<text x="${marginX + 12}" y="${y - 2}" class="band">${escapeXml(t('benchmarks.compare.bandConfiguration'))}</text>`
  )
  y += rowH
  for (const row of configBand.value) {
    body.push(`<text x="${marginX + 12}" y="${y}" class="rowlabel">${escapeXml(row.label)}</text>`)
    row.cells.forEach((cell, index) => {
      const cx = marginX + labelW + colW * index + 12
      body.push(
        `<text x="${cx}" y="${y}" class="value">${escapeXml(cell.display)}${
          cell.differs ? ' ⟵' : ''
        }</text>`
      )
    })
    y += rowH
  }
  const height = y + 40

  const headers = cols
    .map((column, index) => {
      const hx = marginX + labelW + colW * index + 12
      return [
        `<circle cx="${hx + 5}" cy="100" r="5" fill="${column.color}" />`,
        `<text x="${hx + 16}" y="104" class="colwf">${escapeXml(column.run.workflowName)}</text>`,
        `<text x="${hx}" y="122" class="colsub">${escapeXml(column.subtitle)}</text>`,
        column.isBaseline
          ? `<text x="${hx}" y="138" class="base">${escapeXml(t('benchmarks.compare.baselineTag'))}</text>`
          : ''
      ].join('')
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .bg { fill: #100c13; }
    .title { fill: #ffffff; font: 700 24px Inter, system-ui, sans-serif; }
    .note { fill: #c2bfb9; font: 400 13px Inter, system-ui, sans-serif; }
    .band { fill: #ffffff; font: 600 12px Inter, system-ui, sans-serif; }
    .rowlabel { fill: #8a8688; font: 500 13px Inter, system-ui, sans-serif; }
    .value { fill: #ffffff; font: 600 13px Inter, system-ui, sans-serif; }
    .chip { font: 600 12px Inter, system-ui, sans-serif; }
    .colwf { fill: #ffffff; font: 700 14px Inter, system-ui, sans-serif; }
    .colsub { fill: #8a8688; font: 400 11px Inter, system-ui, sans-serif; }
    .base { fill: #f2ff59; font: 600 11px Inter, system-ui, sans-serif; }
  </style>
  <rect width="${width}" height="${height}" class="bg" />
  <text x="${marginX}" y="48" class="title">${escapeXml(t('benchmarks.compare.title', { count: cols.length }))}</text>
  <text x="${marginX}" y="74" class="note">${escapeXml(noteText)}</text>
  ${headers}
  ${body.join('\n  ')}
</svg>`
}

async function exportImage(): Promise<void> {
  if (runs.value.length === 0) return
  isExportingImage.value = true
  exportError.value = null
  try {
    const svg = buildComparisonSvg()
    const png = await createResultsPng(svg)
    const result = await window.api.exportResultsImage(png, 'benchmark-comparison')
    if (!result.ok && !result.canceled) {
      exportError.value = result.message || t('benchmarks.exportImageFailed')
    }
  } catch (error) {
    exportError.value = (error as Error)?.message || t('benchmarks.exportImageFailed')
  } finally {
    isExportingImage.value = false
  }
}
</script>

<template>
  <section class="benchmark-compare">
    <header class="benchmark-compare__header">
      <button type="button" class="benchmark-compare__back" @click="benchmarkNav.backToHistory()">
        ← {{ t('benchmarks.compare.backToHistory') }}
      </button>
      <h1 class="benchmark-compare__title">
        {{ t('benchmarks.compare.title', { count: runCount }) }}
      </h1>
      <span class="benchmark-compare__spacer" />
      <button
        type="button"
        class="benchmark-compare__btn"
        :disabled="isExportingImage"
        @click="exportImage"
      >
        {{ t('benchmarks.compare.exportImage') }}
      </button>
      <details class="benchmark-compare__menu">
        <summary class="benchmark-compare__btn benchmark-compare__datatrigger" aria-haspopup="true">
          {{ t('benchmarks.compare.exportData') }} ▾
        </summary>
        <div class="benchmark-compare__pop" role="menu">
          <button
            type="button"
            data-testid="compare-export-csv"
            role="menuitem"
            @click="exportData('csv')"
          >
            {{ t('benchmarks.exportCsv') }}
          </button>
          <button
            type="button"
            data-testid="compare-export-json"
            role="menuitem"
            @click="exportData('json')"
          >
            {{ t('benchmarks.exportJson') }}
          </button>
        </div>
      </details>
    </header>

    <div class="benchmark-compare__controls">
      <label class="benchmark-compare__baseline">
        <span>{{ t('benchmarks.compare.baseline') }}:</span>
        <select class="benchmark-compare__select" :value="baselineRun?.id" @change="setBaseline">
          <option v-for="column in columns" :key="column.run.id" :value="column.run.id">
            {{ column.run.workflowName }} ({{ gpuShort(column.run) }})
          </option>
        </select>
      </label>
    </div>

    <p class="benchmark-compare__note" :class="{ 'benchmark-compare__note--same': sameWorkflow }">
      <span aria-hidden="true">{{ sameWorkflow ? '✓' : 'ⓘ' }}</span>
      {{
        sameWorkflow
          ? t('benchmarks.compare.modeSameWorkflow')
          : t('benchmarks.compare.crossWorkflowNote')
      }}
    </p>

    <p v-if="exportError" class="benchmark-compare__error" role="alert">{{ exportError }}</p>

    <p v-if="isSingleRun" class="benchmark-compare__pickmore">
      {{ t('benchmarks.compare.pickMore') }}
    </p>

    <!-- metrics table -->
    <div class="benchmark-compare__card">
      <table class="benchmark-compare__table">
        <thead>
          <tr>
            <th scope="col" class="benchmark-compare__th-metric">
              {{ t('benchmarks.compare.metric') }}
            </th>
            <th v-for="column in columns" :key="column.run.id" scope="col">
              <span class="benchmark-compare__colhead">
                <span class="benchmark-compare__colwf">
                  <span class="benchmark-compare__dot" :style="{ background: column.color }" />
                  {{ column.run.workflowName }}
                </span>
                <span class="benchmark-compare__colsub">{{ column.subtitle }}</span>
                <span v-if="column.isBaseline" class="benchmark-compare__basetag">
                  {{ t('benchmarks.compare.baselineTag') }}
                </span>
                <span v-if="column.needsCapture" class="benchmark-compare__nocap">
                  {{ t('benchmarks.compare.noCapture') }}
                </span>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="band in metricBands" :key="band.key">
            <tr class="benchmark-compare__band">
              <td :colspan="columns.length + 1">{{ band.title }}</td>
            </tr>
            <tr v-for="row in band.rows" :key="row.key">
              <th scope="row" class="benchmark-compare__rowlabel">{{ row.label }}</th>
              <td v-for="(cell, index) in row.cells" :key="index">
                <span class="benchmark-compare__value" :class="{ 'is-na': cell.display === '—' }">
                  {{ cell.display
                  }}<span v-if="cell.unit" class="benchmark-compare__unit"> {{ cell.unit }}</span>
                </span>
                <span v-if="cell.isBaseline" class="benchmark-compare__baseword">
                  {{ t('benchmarks.compare.baselineTag') }}
                </span>
                <span
                  v-else-if="cell.chip"
                  class="benchmark-compare__chip"
                  :class="`benchmark-compare__chip--${cell.chip.cls}`"
                  :title="cell.chip.title"
                >
                  {{ cell.chip.text }}
                </span>
              </td>
            </tr>
          </template>

          <tr class="benchmark-compare__band">
            <td :colspan="columns.length + 1">{{ t('benchmarks.compare.bandConfiguration') }}</td>
          </tr>
          <tr v-for="row in configBand" :key="row.key">
            <th scope="row" class="benchmark-compare__rowlabel">{{ row.label }}</th>
            <td v-for="(cell, index) in row.cells" :key="index">
              <span class="benchmark-compare__value" :class="{ 'is-na': cell.display === '—' }">
                {{ cell.display }}
              </span>
              <span
                v-if="cell.differs"
                class="benchmark-compare__diffmark"
                :title="t('benchmarks.compare.differs')"
                aria-hidden="true"
              >
                ⟵
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- op-timeline -->
    <section v-if="showOpCard" class="benchmark-compare__card benchmark-compare__chartcard">
      <header class="benchmark-compare__chead">
        <h3>{{ t('benchmarks.compare.chartOpTimeline') }}</h3>
      </header>
      <!-- same-workflow A/B diff: faster/slower per node -->
      <div v-if="opDiff" class="benchmark-compare__opdiff">
        <div v-for="row in opDiff.rows" :key="row.key" class="benchmark-compare__diffrow">
          <span class="benchmark-compare__barname" :title="row.label">{{ row.label }}</span>
          <div class="benchmark-compare__diffbars">
            <div class="benchmark-compare__dbar">
              <i :style="{ width: `${row.aWidth}%`, background: 'var(--neutral-500)' }" />
              <span class="benchmark-compare__barval num"
                >{{ row.aPercent }}% · {{ opDiff.aLabel }}</span
              >
            </div>
            <div class="benchmark-compare__dbar">
              <i
                :style="{
                  width: `${row.bWidth}%`,
                  background: row.faster ? 'var(--success)' : 'var(--danger)'
                }"
              />
              <span class="benchmark-compare__barval num"
                >{{ row.bPercent }}% · {{ opDiff.bLabel }}</span
              >
            </div>
          </div>
        </div>
      </div>
      <!-- cross-workflow: one panel per workflow, side by side -->
      <div
        v-else
        class="benchmark-compare__opgrid"
        :style="{ gridTemplateColumns: `repeat(${opPanels.length}, 1fr)` }"
      >
        <div v-for="panel in opPanels" :key="panel.key" class="benchmark-compare__oppanel">
          <p class="benchmark-compare__opname">
            <span class="benchmark-compare__dot" :style="{ background: panel.color }" />
            {{ panel.label }}
          </p>
          <div v-for="bar in panel.bars" :key="bar.key" class="benchmark-compare__barrow">
            <span class="benchmark-compare__barname" :title="bar.label">{{ bar.label }}</span>
            <div class="benchmark-compare__bartrack">
              <i :class="{ 'is-dominant': bar.dominant }" :style="{ width: `${bar.width}%` }" />
              <span class="benchmark-compare__barval num"
                ><b>{{ bar.percent }}%</b></span
              >
            </div>
          </div>
        </div>
      </div>
    </section>

    <div class="benchmark-compare__charts">
      <!-- per-step it/s overlay -->
      <section v-if="stepChart" class="benchmark-compare__card benchmark-compare__chartcard">
        <header class="benchmark-compare__chead">
          <h3>{{ t('benchmarks.compare.chartPerStepItPerS') }}</h3>
          <div class="benchmark-compare__legend">
            <span v-for="item in legend" :key="item.key" class="benchmark-compare__lg">
              <span class="benchmark-compare__sw" :style="{ background: item.color }" />{{
                item.label
              }}
            </span>
          </div>
        </header>
        <svg
          class="benchmark-compare__svg"
          :viewBox="`0 0 ${stepChart.width} ${stepChart.height}`"
          role="img"
        >
          <g :transform="`translate(${stepChart.padL} ${stepChart.padT})`">
            <line
              v-for="tick in stepChart.yTicks"
              :key="`sy-${tick.value}`"
              class="benchmark-compare__grid"
              x1="0"
              :x2="stepChart.plotW"
              :y1="tick.pos"
              :y2="tick.pos"
            />
            <template v-for="(series, index) in stepChart.chart.series" :key="`ss-${index}`">
              <path
                v-if="series.path"
                class="benchmark-compare__line"
                :style="{ stroke: seriesColors[index % seriesColors.length] }"
                :d="series.path"
              />
              <circle
                v-for="point in series.points"
                :key="`sp-${index}-${point.index}`"
                :cx="point.x"
                :cy="point.y"
                r="2.4"
                :fill="seriesColors[index % seriesColors.length]"
                :opacity="point.index === 0 ? 0.4 : 1"
              />
            </template>
          </g>
          <text
            v-for="tick in stepChart.yTicks"
            :key="`syl-${tick.value}`"
            class="benchmark-compare__axis num"
            :x="stepChart.padL - 8"
            :y="stepChart.padT + tick.pos + 3"
            text-anchor="end"
          >
            {{ tick.value }}
          </text>
          <text
            v-for="tick in stepChart.xTicks"
            :key="`sxl-${tick.value}`"
            class="benchmark-compare__axis num"
            :x="stepChart.padL + tick.pos"
            :y="stepChart.height - 12"
            text-anchor="middle"
          >
            {{ tick.value }}
          </text>
        </svg>
      </section>

      <!-- VRAM over time overlay with per-GPU ceilings -->
      <section v-if="vramChart" class="benchmark-compare__card benchmark-compare__chartcard">
        <header class="benchmark-compare__chead">
          <h3>{{ t('benchmarks.compare.chartVramOverTime') }}</h3>
          <div class="benchmark-compare__legend">
            <span v-for="item in legend" :key="item.key" class="benchmark-compare__lg">
              <span class="benchmark-compare__sw" :style="{ background: item.color }" />{{
                item.label
              }}
            </span>
          </div>
        </header>
        <svg
          class="benchmark-compare__svg"
          :viewBox="`0 0 ${vramChart.width} ${vramChart.height}`"
          role="img"
        >
          <g :transform="`translate(${vramChart.padL} ${vramChart.padT})`">
            <line
              v-for="tick in vramChart.yTicks"
              :key="`vy-${tick.value}`"
              class="benchmark-compare__grid"
              x1="0"
              :x2="vramChart.plotW"
              :y1="tick.pos"
              :y2="tick.pos"
            />
            <line
              v-for="line in vramCeilingLines"
              :key="`vc-${line.value}`"
              class="benchmark-compare__ceiling"
              x1="0"
              :x2="vramChart.plotW"
              :y1="line.y"
              :y2="line.y"
              :style="{ stroke: line.color }"
            />
            <template v-for="(series, index) in vramChart.chart.series" :key="`vs-${index}`">
              <path
                v-if="series.areaPath"
                class="benchmark-compare__area"
                :style="{ fill: seriesColors[index % seriesColors.length] }"
                :d="series.areaPath"
              />
              <path
                v-if="series.path"
                class="benchmark-compare__line"
                :style="{ stroke: seriesColors[index % seriesColors.length] }"
                :d="series.path"
              />
            </template>
          </g>
          <text
            v-for="tick in vramChart.yTicks"
            :key="`vyl-${tick.value}`"
            class="benchmark-compare__axis num"
            :x="vramChart.padL - 8"
            :y="vramChart.padT + tick.pos + 3"
            text-anchor="end"
          >
            {{ tick.value }}
          </text>
          <text
            v-for="line in vramCeilingLines"
            :key="`vcl-${line.value}`"
            class="benchmark-compare__axis num"
            :x="vramChart.padL + vramChart.plotW + 6"
            :y="vramChart.padT + line.y + 3"
            text-anchor="start"
            :style="{ fill: line.color }"
          >
            {{ line.value }} GB
          </text>
          <text
            v-for="tick in vramChart.xTicks"
            :key="`vxl-${tick.value}`"
            class="benchmark-compare__axis num"
            :x="vramChart.padL + tick.pos"
            :y="vramChart.height - 12"
            text-anchor="middle"
          >
            {{ tick.value }}s
          </text>
        </svg>
      </section>

      <!-- power / temp overlay (P1) -->
      <section
        v-if="hasPowerTemp && (powerChart || tempChart)"
        class="benchmark-compare__card benchmark-compare__chartcard benchmark-compare__chartcard--full"
      >
        <header class="benchmark-compare__chead">
          <h3>{{ t('benchmarks.compare.chartPowerTemp') }}</h3>
          <div class="benchmark-compare__legend">
            <span v-for="item in legend" :key="item.key" class="benchmark-compare__lg">
              <span class="benchmark-compare__sw" :style="{ background: item.color }" />{{
                item.label
              }}
            </span>
          </div>
        </header>
        <svg class="benchmark-compare__svg" :viewBox="`0 0 ${CHART_W} ${CHART_H}`" role="img">
          <g v-if="powerChart" :transform="`translate(${powerChart.padL} ${powerChart.padT})`">
            <line
              v-for="tick in powerChart.yTicks"
              :key="`py-${tick.value}`"
              class="benchmark-compare__grid"
              x1="0"
              :x2="powerChart.plotW"
              :y1="tick.pos"
              :y2="tick.pos"
            />
            <path
              v-for="(series, index) in powerChart.chart.series"
              v-show="series.path"
              :key="`ps-${index}`"
              class="benchmark-compare__line"
              :style="{ stroke: seriesColors[index % seriesColors.length] }"
              :d="series.path"
            />
          </g>
          <g v-if="tempChart" :transform="`translate(${tempChart.padL} ${tempChart.padT})`">
            <path
              v-for="(series, index) in tempChart.chart.series"
              v-show="series.path"
              :key="`ts-${index}`"
              class="benchmark-compare__line benchmark-compare__line--dashed"
              :style="{ stroke: seriesColors[index % seriesColors.length] }"
              :d="series.path"
            />
          </g>
          <text
            v-for="tick in powerChart?.yTicks ?? []"
            :key="`pyl-${tick.value}`"
            class="benchmark-compare__axis num"
            :x="POWER_PAD.l - 8"
            :y="POWER_PAD.t + tick.pos + 3"
            text-anchor="end"
          >
            {{ tick.value }}
          </text>
          <text
            v-for="tick in tempChart?.yTicks ?? []"
            :key="`tyl-${tick.value}`"
            class="benchmark-compare__axis num benchmark-compare__axis--temp"
            :x="CHART_W - POWER_PAD.r + 8"
            :y="POWER_PAD.t + tick.pos + 3"
            text-anchor="start"
          >
            {{ tick.value }}°
          </text>
          <text
            v-for="tick in powerTempXTicks"
            :key="`ptxl-${tick.value}`"
            class="benchmark-compare__axis num"
            :x="POWER_PAD.l + tick.pos"
            :y="CHART_H - 12"
            text-anchor="middle"
          >
            {{ tick.value }}s
          </text>
        </svg>
      </section>
    </div>
  </section>
</template>

<style scoped>
.benchmark-compare {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  color: var(--text);
}

.benchmark-compare__header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.benchmark-compare__spacer {
  flex: 1;
}

.benchmark-compare__back {
  border: 1px solid var(--chooser-surface-border);
  border-radius: 0.5rem;
  padding: 0.375rem 0.75rem;
  background: var(--chooser-surface-bg);
  color: var(--text);
  cursor: pointer;
}

.benchmark-compare__back:hover {
  border-color: var(--chooser-surface-border-hover);
  background: var(--chooser-surface-bg-hover);
}

.benchmark-compare__back:focus-visible,
.benchmark-compare__btn:focus-visible,
.benchmark-compare__select:focus-visible {
  outline: 2px solid var(--focus-ring);
}

.benchmark-compare__title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
}

.benchmark-compare__btn {
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 0.5rem;
  background: var(--chooser-surface-bg);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.benchmark-compare__btn:hover {
  border-color: var(--chooser-surface-border-hover);
  background: var(--chooser-surface-bg-hover);
}

.benchmark-compare__btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.benchmark-compare__menu {
  position: relative;
}

.benchmark-compare__datatrigger {
  display: inline-flex;
  align-items: center;
  list-style: none;
  cursor: pointer;
}

.benchmark-compare__datatrigger::-webkit-details-marker {
  display: none;
}

.benchmark-compare__pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 5;
  min-width: 170px;
  padding: 6px;
  border: 1px solid var(--chooser-surface-border-hover);
  border-radius: 0.5rem;
  background: var(--neutral-800);
  box-shadow: 0 12px 30px rgb(0 0 0 / 45%);
}

.benchmark-compare__pop button {
  display: flex;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.benchmark-compare__pop button:hover {
  background: var(--neutral-700);
}

.benchmark-compare__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
}

.benchmark-compare__baseline {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12.5px;
}

.benchmark-compare__select {
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 0.5rem;
  background: var(--chooser-surface-bg);
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.benchmark-compare__note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0;
  padding: 11px 14px;
  border: 1px solid var(--chooser-surface-border);
  border-left: 3px solid var(--accent-plum);
  border-radius: 0.5rem;
  background: var(--surface-recessed);
  color: var(--text-muted);
  font-size: 12.5px;
  line-height: 1.5;
}

.benchmark-compare__note--same {
  border-left-color: var(--success);
}

.benchmark-compare__error {
  margin: 0;
  color: var(--danger);
  font-size: 12.5px;
}

.benchmark-compare__pickmore {
  margin: 0;
  padding: 14px;
  border: 1px dashed var(--chooser-surface-border-hover);
  border-radius: 0.5rem;
  color: var(--text-muted);
  font-size: 12.5px;
}

.benchmark-compare__card {
  border: 1px solid var(--chooser-surface-border);
  border-radius: 12px;
  background: var(--surface-recessed);
  overflow: hidden;
}

.benchmark-compare__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.benchmark-compare__table th,
.benchmark-compare__table td {
  padding: 11px 16px;
  text-align: left;
  border-bottom: 1px solid var(--chooser-surface-border);
  white-space: nowrap;
  vertical-align: bottom;
}

.benchmark-compare__th-metric {
  color: var(--text-muted);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-weight: 600;
}

.benchmark-compare__colhead {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.benchmark-compare__colwf {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}

.benchmark-compare__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.benchmark-compare__colsub {
  color: var(--text-muted);
  font-size: 11.5px;
  font-weight: 400;
}

.benchmark-compare__basetag {
  color: var(--comfy-yellow);
  font-size: 11px;
  font-weight: 600;
}

.benchmark-compare__nocap {
  color: var(--text-faint);
  font-size: 11px;
}

.benchmark-compare__band td {
  background: var(--neutral-900);
  color: var(--text);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  padding: 9px 16px;
}

.benchmark-compare__rowlabel {
  color: var(--text-muted);
  font-weight: 500;
  font-size: 12.5px;
}

.benchmark-compare__value {
  color: var(--text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.benchmark-compare__value.is-na {
  color: var(--text-faint);
  font-weight: 400;
}

.benchmark-compare__unit {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 400;
}

.benchmark-compare__baseword {
  margin-left: 8px;
  color: var(--text-faint);
  font-size: 11px;
}

.benchmark-compare__chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 8px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  vertical-align: middle;
}

.benchmark-compare__chip--good {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--success);
}

.benchmark-compare__chip--bad {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

.benchmark-compare__chip--same {
  background: var(--neutral-700);
  color: var(--text-muted);
}

.benchmark-compare__chip--na {
  color: var(--text-faint);
  border: 1px dashed var(--chooser-surface-border-hover);
}

.benchmark-compare__diffmark {
  margin-left: 7px;
  color: var(--comfy-yellow);
  font-weight: 700;
}

/* charts */
.benchmark-compare__chartcard {
  padding: 18px 20px;
}

.benchmark-compare__charts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

@media (max-width: 900px) {
  .benchmark-compare__charts {
    grid-template-columns: 1fr;
  }
}

.benchmark-compare__chartcard--full {
  grid-column: 1 / -1;
}

.benchmark-compare__chead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.benchmark-compare__chead h3 {
  margin: 0;
  color: var(--neutral-200);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.benchmark-compare__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.benchmark-compare__lg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 11.5px;
}

.benchmark-compare__sw {
  width: 14px;
  height: 3px;
  border-radius: 2px;
}

.benchmark-compare__svg {
  display: block;
  width: 100%;
  height: auto;
}

.benchmark-compare__grid {
  stroke: var(--neutral-600);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.benchmark-compare__ceiling {
  stroke-width: 1.3;
  stroke-dasharray: 5 4;
  vector-effect: non-scaling-stroke;
}

.benchmark-compare__line {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.benchmark-compare__line--dashed {
  stroke-width: 1.6;
  stroke-dasharray: 4 3;
  opacity: 0.75;
}

.benchmark-compare__area {
  stroke: none;
  opacity: 0.1;
}

.benchmark-compare__axis {
  fill: var(--text-muted);
  font-size: 10px;
}

.benchmark-compare__axis--temp {
  fill: var(--danger);
}

/* op timeline */
.benchmark-compare__opgrid {
  display: grid;
  gap: 16px;
}

.benchmark-compare__oppanel .benchmark-compare__opname {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 10px;
  font-size: 12.5px;
  font-weight: 700;
}

.benchmark-compare__barrow {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 12px;
  align-items: center;
  margin-bottom: 7px;
}

.benchmark-compare__barname {
  overflow: hidden;
  font-size: 12px;
  color: var(--text);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.benchmark-compare__bartrack {
  display: flex;
  align-items: center;
  height: 22px;
}

.benchmark-compare__bartrack i {
  height: 22px;
  min-width: 2px;
  border-radius: 4px;
  background: var(--neutral-600);
}

.benchmark-compare__bartrack i.is-dominant {
  background: var(--comfy-yellow);
}

.benchmark-compare__barval {
  margin-left: 9px;
  color: var(--text-muted);
  font-size: 11.5px;
  white-space: nowrap;
}

.benchmark-compare__barval b {
  color: var(--text);
  font-weight: 600;
}

.benchmark-compare__diffrow {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 12px;
  align-items: center;
  margin-bottom: 11px;
}

.benchmark-compare__diffbars {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.benchmark-compare__dbar {
  display: flex;
  align-items: center;
  height: 16px;
}

.benchmark-compare__dbar i {
  height: 16px;
  min-width: 2px;
  border-radius: 3px;
}

.benchmark-compare__dbar .benchmark-compare__barval {
  margin-left: 8px;
  font-size: 11px;
}
</style>
