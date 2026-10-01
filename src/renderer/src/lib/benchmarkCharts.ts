/**
 * Pure geometry helpers for the inline-SVG charts on the Benchmarks results view
 * (design §4). Turns a numeric series (with `null` gaps) into normalized SVG
 * coordinates + path strings the template renders as `<svg><polyline/><path/>`.
 *
 * No charting dependency: the view owns the `<svg>` markup and styling; this file
 * owns the math and is unit-tested in `benchmarkCharts.test.ts`. All outputs are
 * rounded to 2 decimals for deterministic, jitter-free rendering.
 */

export interface ChartPoint {
  /** Original index in the input series (so callers can dim step 1, etc.). */
  index: number
  /** Pixel x within the [0, width] view box. */
  x: number
  /** Pixel y within the [0, height] view box (0 = top). */
  y: number
  /** The original (unscaled) data value. */
  value: number
}

export interface ChartTick {
  /** The data value at this gridline. */
  value: number
  /** Pixel y within the [0, height] view box. */
  y: number
}

export interface AxisTick {
  /** The data value at this tick. */
  value: number
  /** Pixel position along the axis (x for the x-axis, y for the y-axis). */
  pos: number
}

export interface SeriesChart {
  points: ChartPoint[]
  /** Open path through the points: `M x y L x y …` (for a line/polyline). */
  path: string
  /** Closed path filled down to the baseline (for an area fill). */
  areaPath: string
  /** Evenly spaced horizontal gridlines, or `[]` when `tickCount < 2`. */
  ticks: ChartTick[]
  /** The y-value mapped to the bottom of the view box. */
  min: number
  /** The y-value mapped to the top of the view box. */
  max: number
  /** The x-value mapped to the left edge of the view box. */
  minX: number
  /** The x-value mapped to the right edge of the view box. */
  maxX: number
  width: number
  height: number
}

export interface BuildSeriesChartOptions {
  width?: number
  height?: number
  /** Per-index x positions (e.g. sample `tMs`). Falls back to the array index. */
  xValues?: ReadonlyArray<number | null | undefined>
  /** Number of horizontal gridlines to emit (min 2 to draw any). */
  tickCount?: number
  /** Force the bottom of the y-axis (e.g. 0). Defaults to the data minimum. */
  minY?: number
  /** Force the top of the y-axis. Defaults to the data maximum. */
  maxY?: number
}

const DEFAULT_WIDTH = 240
const DEFAULT_HEIGHT = 64

/** Round to 2 decimals and normalize `-0` to `0` for stable output. */
function round(value: number): number {
  const rounded = Math.round(value * 100) / 100
  return Object.is(rounded, -0) ? 0 : rounded
}

/**
 * Build SVG geometry from a numeric series. Returns `null` when fewer than two
 * finite points survive (a line needs two) — callers hide the chart in that case
 * per the design's "— not measured" degrade rule.
 */
export function buildSeriesChart(
  series: ReadonlyArray<number | null | undefined>,
  options: BuildSeriesChartOptions = {}
): SeriesChart | null {
  const width = options.width ?? DEFAULT_WIDTH
  const height = options.height ?? DEFAULT_HEIGHT

  const raw: { index: number; x: number; value: number }[] = []
  series.forEach((value, index) => {
    if (value == null || !Number.isFinite(value)) return
    const rawX = options.xValues?.[index]
    const x = rawX != null && Number.isFinite(rawX) ? rawX : index
    raw.push({ index, x, value })
  })
  if (raw.length < 2) return null

  const xs = raw.map((point) => point.x)
  const ys = raw.map((point) => point.value)
  const minY = options.minY ?? Math.min(...ys)
  const maxY = options.maxY ?? Math.max(...ys)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1

  const points: ChartPoint[] = raw.map((point) => ({
    index: point.index,
    value: point.value,
    x: round(((point.x - minX) / spanX) * width),
    y: round(height - ((point.value - minY) / spanY) * height)
  }))

  const path = points.map((point, i) => `${i === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')

  const first = points[0]!
  const last = points[points.length - 1]!
  const areaPath =
    `M ${first.x} ${height} ` +
    points.map((point) => `L ${point.x} ${point.y}`).join(' ') +
    ` L ${last.x} ${height} Z`

  const ticks: ChartTick[] = []
  const tickCount = options.tickCount ?? 0
  if (tickCount >= 2) {
    for (let i = 0; i < tickCount; i++) {
      const value = minY + ((maxY - minY) * i) / (tickCount - 1)
      ticks.push({ value: round(value), y: round(height - ((value - minY) / spanY) * height) })
    }
  }

  return { points, path, areaPath, ticks, min: minY, max: maxY, minX, maxX, width, height }
}

/**
 * Project an arbitrary reference value (e.g. a VRAM ceiling or steady-state line)
 * onto a built chart's y-axis, using the SAME min/max/height normalization as
 * `buildSeriesChart`. Returns a clamped, 2-decimal-rounded y within `[0, height]`
 * so reference lines never escape the view box. Values above `max` clamp to the
 * top (`0`); values at/below `min` clamp to the bottom (`height`).
 */
export function projectY(
  chart: Pick<SeriesChart, 'min' | 'max' | 'height'>,
  value: number
): number {
  const span = chart.max - chart.min || 1
  const y = chart.height - ((value - chart.min) / span) * chart.height
  return round(Math.min(Math.max(y, 0), chart.height))
}

/**
 * Project a value onto a built chart's x-axis, using the SAME minX/maxX/width
 * normalization as `buildSeriesChart`. Clamped, 2-decimal-rounded x within
 * `[0, width]` so axis ticks never escape the view box.
 */
export function projectX(
  chart: Pick<SeriesChart, 'minX' | 'maxX' | 'width'>,
  value: number
): number {
  const span = chart.maxX - chart.minX || 1
  const x = ((value - chart.minX) / span) * chart.width
  return round(Math.min(Math.max(x, 0), chart.width))
}

/** Round a candidate step/range to a "nice" 1-2-5×10ⁿ value (axis-tick spacing). */
function niceNum(range: number, roundToNearest: boolean): number {
  if (!(range > 0)) return 0
  const exponent = Math.floor(Math.log10(range))
  const fraction = range / 10 ** exponent
  let niceFraction: number
  if (roundToNearest) {
    if (fraction < 1.5) niceFraction = 1
    else if (fraction < 3) niceFraction = 2
    else if (fraction < 7) niceFraction = 5
    else niceFraction = 10
  } else {
    if (fraction <= 1) niceFraction = 1
    else if (fraction <= 2) niceFraction = 2
    else if (fraction <= 5) niceFraction = 5
    else niceFraction = 10
  }
  return niceFraction * 10 ** exponent
}

/**
 * Generate "nice" round axis-tick values spanning `[min, max]` (the classic
 * Wilkinson/loose-label algorithm). Returns an ascending list of at most
 * ~`targetCount + 1` round numbers (e.g. `0, 8, 16, 24, 32`), each 2-decimal
 * rounded. The caller projects them onto the axis with `projectX`/`projectY` and
 * filters to the visible range. Returns `[]` on non-finite input.
 */
export function niceTicks(min: number, max: number, targetCount = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || targetCount < 1) return []
  if (min === max) return [round(min)]
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  const step = niceNum((hi - lo) / targetCount, true)
  if (!(step > 0)) return [round(lo), round(hi)]
  const start = Math.ceil(lo / step) * step
  const ticks: number[] = []
  // Guard the loop bound against floating drift with a half-step epsilon.
  for (let value = start; value <= hi + step * 0.5; value += step) {
    ticks.push(round(value))
  }
  return ticks
}

/** One input series for an overlaid multi-run chart. */
export interface MultiSeriesInput {
  /** The numeric series (null gaps allowed). */
  values: ReadonlyArray<number | null | undefined>
  /** Per-index x positions (e.g. step index or sample `tMs`). Falls back to the
   *  array index. */
  xValues?: ReadonlyArray<number | null | undefined>
}

/** One built series within a `MultiSeriesChart`. */
export interface MultiSeries {
  /** The series' position in the input list (so callers map it to a run / color). */
  index: number
  points: ChartPoint[]
  /** Open line path, or `''` when the series has fewer than two points. */
  path: string
  /** Closed area path down to the baseline, or `''` when fewer than two points. */
  areaPath: string
}

export interface MultiSeriesChart {
  series: MultiSeries[]
  /** Evenly spaced horizontal gridlines, or `[]` when `tickCount < 2`. */
  ticks: ChartTick[]
  min: number
  max: number
  minX: number
  maxX: number
  width: number
  height: number
}

/**
 * Build geometry for N overlaid series that SHARE one pair of axes (the Compare
 * view's per-step it/s overlay and VRAM-over-time overlay, design §4.4).
 *
 * The y-axis spans the min/max across every series; the x-axis spans the min/max
 * x across every series. Crucially, x is NOT normalized per series: when runs have
 * different step counts a shorter series simply ends earlier (its last point lands
 * before the right edge) rather than being stretched to match the longest — the
 * design's "step index, not normalized; lines end where their steps end" rule.
 *
 * Returns `null` when no series has at least two finite points (nothing to draw) —
 * callers hide the whole card. Individual empty / single-point series are kept in
 * the result with `path === ''` so the caller's color/legend indexing stays stable.
 */
export function buildMultiSeriesChart(
  seriesList: ReadonlyArray<MultiSeriesInput>,
  options: BuildSeriesChartOptions = {}
): MultiSeriesChart | null {
  const width = options.width ?? DEFAULT_WIDTH
  const height = options.height ?? DEFAULT_HEIGHT

  const perSeriesRaw = seriesList.map((input) => {
    const raw: { index: number; x: number; value: number }[] = []
    input.values.forEach((value, index) => {
      if (value == null || !Number.isFinite(value)) return
      const rawX = input.xValues?.[index]
      const x = rawX != null && Number.isFinite(rawX) ? rawX : index
      raw.push({ index, x, value })
    })
    return raw
  })

  const allPoints = perSeriesRaw.flat()
  if (allPoints.length === 0) return null
  if (!perSeriesRaw.some((raw) => raw.length >= 2)) return null

  const xs = allPoints.map((point) => point.x)
  const ys = allPoints.map((point) => point.value)
  const minY = options.minY ?? Math.min(...ys)
  const maxY = options.maxY ?? Math.max(...ys)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1

  const series: MultiSeries[] = perSeriesRaw.map((raw, index) => {
    const points: ChartPoint[] = raw.map((point) => ({
      index: point.index,
      value: point.value,
      x: round(((point.x - minX) / spanX) * width),
      y: round(height - ((point.value - minY) / spanY) * height)
    }))
    const path =
      points.length >= 2
        ? points.map((point, i) => `${i === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
        : ''
    const areaPath =
      points.length >= 2
        ? `M ${points[0]!.x} ${height} ` +
          points.map((point) => `L ${point.x} ${point.y}`).join(' ') +
          ` L ${points[points.length - 1]!.x} ${height} Z`
        : ''
    return { index, points, path, areaPath }
  })

  const ticks: ChartTick[] = []
  const tickCount = options.tickCount ?? 0
  if (tickCount >= 2) {
    for (let i = 0; i < tickCount; i++) {
      const value = minY + ((maxY - minY) * i) / (tickCount - 1)
      ticks.push({ value: round(value), y: round(height - ((value - minY) / spanY) * height) })
    }
  }

  return { series, ticks, min: minY, max: maxY, minX, maxX, width, height }
}

/**
 * Project a set of reference ceilings (e.g. distinct GPU `totalVramMb` values) onto
 * a built chart's y-axis. Deduplicates, sorts ascending, and clamps each via
 * `projectY`. Used by the VRAM-over-time overlay to draw ONE labelled dashed ceiling
 * per unique VRAM total (design §4.4: never a single shared ceiling when GPUs differ).
 * Returns `[]` when no finite ceiling is supplied.
 */
export function buildCeilingLines(
  chart: Pick<SeriesChart, 'min' | 'max' | 'height'>,
  values: ReadonlyArray<number | null | undefined>
): ChartTick[] {
  const unique = [
    ...new Set(values.filter((value): value is number => value != null && Number.isFinite(value)))
  ].sort((a, b) => a - b)
  return unique.map((value) => ({ value: round(value), y: projectY(chart, value) }))
}

/** One op (node) to lay out in an op-timeline panel. */
export interface OpTimelineInput {
  label: string
  /** Elapsed time for this op (ms). Null / non-positive ops are dropped. */
  value: number | null | undefined
}

/** One laid-out horizontal bar in an op-timeline panel. */
export interface OpTimelineBar {
  /** The op's position in the input list (stable key). */
  index: number
  label: string
  value: number
  /** Bar width as a fraction `[0, 1]` of the panel's largest bar. */
  widthFraction: number
  /** Share `[0, 1]` of the panel's total time (the "71%" label). */
  share: number
}

export interface OpTimeline {
  bars: OpTimelineBar[]
  /** Sum of every finite op value (ms) — the denominator for `share`. */
  total: number
  /** The largest shown op value (ms) — the denominator for `widthFraction`. */
  max: number
}

/**
 * Lay out one op-timeline panel: the "where the time went" horizontal bars for a
 * single workflow (design §4.4). Ops are sorted by elapsed time descending and
 * truncated to `topN`; `share` is relative to the FULL workflow total (so hidden
 * ops still count against the percentages), while `widthFraction` is relative to the
 * largest shown bar (so the dominant op fills the panel). Pure geometry — the view
 * owns the bar markup. An empty / all-null input yields `bars: []` so the caller can
 * hide the panel.
 */
export function buildOpTimeline(
  nodes: ReadonlyArray<OpTimelineInput>,
  options: { topN?: number } = {}
): OpTimeline {
  const finite = nodes
    .map((node, index) => ({ index, label: node.label, value: node.value }))
    .filter(
      (node): node is { index: number; label: string; value: number } =>
        typeof node.value === 'number' && Number.isFinite(node.value) && node.value > 0
    )
  const total = finite.reduce((sum, node) => sum + node.value, 0)
  const sorted = [...finite].sort((a, b) => b.value - a.value)
  const topN = options.topN ?? sorted.length
  const shown = sorted.slice(0, Math.max(0, topN))
  const max = shown.length > 0 ? shown[0]!.value : 0
  const bars: OpTimelineBar[] = shown.map((node) => ({
    index: node.index,
    label: node.label,
    value: node.value,
    widthFraction: max > 0 ? round(node.value / max) : 0,
    share: total > 0 ? round(node.value / total) : 0
  }))
  return { bars, total: round(total), max: round(max) }
}

export interface RadialGauge {
  size: number
  cx: number
  cy: number
  radius: number
  strokeWidth: number
  /** The input fraction clamped to `[0, 1]`. */
  fraction: number
  /** Full-sweep background arc path. */
  trackPath: string
  /** Value arc path from the start angle, or `''` when the fraction is 0. */
  valuePath: string
}

/**
 * Pure geometry for a radial-arc gauge (the VRAM-headroom dial). Produces two
 * SVG arc `d` strings — a full-sweep track and a value arc covering
 * `sweepAngle × fraction` — so the template just binds `:d`. Defaults to the
 * mockup's 270° dial starting at 135°. Angles are clockwise degrees; 0° points
 * up. The fraction is clamped to `[0, 1]` (a benchmark legitimately peaks near
 * 100%, never above).
 */
export function buildRadialGauge(opts: {
  fraction: number
  size?: number
  strokeWidth?: number
  startAngle?: number
  sweepAngle?: number
}): RadialGauge {
  const size = opts.size ?? 128
  const strokeWidth = opts.strokeWidth ?? 12
  const startAngle = opts.startAngle ?? 135
  const sweepAngle = opts.sweepAngle ?? 270
  const fraction = Number.isFinite(opts.fraction) ? Math.min(Math.max(opts.fraction, 0), 1) : 0
  const cx = size / 2
  const cy = size / 2
  const radius = round(size / 2 - strokeWidth)

  const polar = (deg: number): [number, number] => {
    const angle = ((deg - 90) * Math.PI) / 180
    return [round(cx + radius * Math.cos(angle)), round(cy + radius * Math.sin(angle))]
  }
  const arc = (from: number, to: number): string => {
    const [x1, y1] = polar(from)
    const [x2, y2] = polar(to)
    const largeArc = to - from > 180 ? 1 : 0
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`
  }

  return {
    size,
    cx,
    cy,
    radius,
    strokeWidth,
    fraction,
    trackPath: arc(startAngle, startAngle + sweepAngle),
    valuePath: fraction > 0 ? arc(startAngle, startAngle + sweepAngle * fraction) : ''
  }
}
