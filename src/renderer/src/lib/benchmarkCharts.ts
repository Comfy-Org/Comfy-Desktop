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

  return { points, path, areaPath, ticks, min: minY, max: maxY, width, height }
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
