import { describe, expect, it } from 'vitest'

import {
  buildCeilingLines,
  buildMultiSeriesChart,
  buildOpTimeline,
  buildRadialGauge,
  buildSeriesChart,
  niceTicks,
  projectX,
  projectY
} from './benchmarkCharts'

describe('buildSeriesChart', () => {
  it('returns null when fewer than two finite points survive', () => {
    expect(buildSeriesChart([])).toBeNull()
    expect(buildSeriesChart([5])).toBeNull()
    expect(buildSeriesChart([null, 5, null])).toBeNull()
    expect(buildSeriesChart([Number.NaN, Number.POSITIVE_INFINITY])).toBeNull()
  })

  it('maps a rising series to descending y (0 = top of the view box)', () => {
    const chart = buildSeriesChart([0, 10], { width: 100, height: 50 })
    expect(chart).not.toBeNull()
    expect(chart!.points).toEqual([
      { index: 0, value: 0, x: 0, y: 50 },
      { index: 1, value: 10, x: 100, y: 0 }
    ])
    expect(chart!.min).toBe(0)
    expect(chart!.max).toBe(10)
    expect(chart!.path).toBe('M 0 50 L 100 0')
  })

  it('closes the area path down to the baseline', () => {
    const chart = buildSeriesChart([0, 10], { width: 100, height: 50 })
    expect(chart!.areaPath).toBe('M 0 50 L 0 50 L 100 0 L 100 50 Z')
  })

  it('preserves the original index for gapped series so callers can dim steps', () => {
    const chart = buildSeriesChart([null, 4, null, 8], { width: 60, height: 40 })
    expect(chart!.points.map((point) => point.index)).toEqual([1, 3])
  })

  it('honors explicit x positions (e.g. sample tMs)', () => {
    const chart = buildSeriesChart([2, 4, 6], {
      width: 100,
      height: 10,
      xValues: [0, 500, 2000]
    })
    expect(chart!.points.map((point) => point.x)).toEqual([0, 25, 100])
  })

  it('respects a forced y-axis floor and ceiling', () => {
    const chart = buildSeriesChart([5, 5], { width: 10, height: 100, minY: 0, maxY: 10 })
    // Flat series at 5 of a 0..10 axis sits at the vertical middle.
    expect(chart!.points.every((point) => point.y === 50)).toBe(true)
    expect(chart!.min).toBe(0)
    expect(chart!.max).toBe(10)
  })

  it('emits evenly spaced ticks only when at least two are requested', () => {
    const noTicks = buildSeriesChart([0, 10], { tickCount: 1 })
    expect(noTicks!.ticks).toEqual([])
    const chart = buildSeriesChart([0, 10], { height: 100, tickCount: 3, minY: 0, maxY: 10 })
    expect(chart!.ticks).toEqual([
      { value: 0, y: 100 },
      { value: 5, y: 50 },
      { value: 10, y: 0 }
    ])
  })

  it('does not divide by zero on a flat series', () => {
    const chart = buildSeriesChart([7, 7, 7], { width: 30, height: 20 })
    expect(chart).not.toBeNull()
    expect(chart!.points.every((point) => Number.isFinite(point.y))).toBe(true)
  })

  it('exposes the x-domain (minX/maxX) so callers can project axis ticks', () => {
    const chart = buildSeriesChart([2, 4, 6], { xValues: [0, 500, 2000] })!
    expect(chart.minX).toBe(0)
    expect(chart.maxX).toBe(2000)
  })
})

describe('projectX', () => {
  it('projects a value onto the chart x-axis (same normalization)', () => {
    const chart = buildSeriesChart([0, 10], { width: 100, xValues: [0, 20] })!
    expect(projectX(chart, 0)).toBe(0)
    expect(projectX(chart, 20)).toBe(100)
    expect(projectX(chart, 10)).toBe(50)
  })

  it('clamps values outside the x-domain into the view box', () => {
    const chart = buildSeriesChart([0, 10], { width: 100, xValues: [0, 20] })!
    expect(projectX(chart, -5)).toBe(0)
    expect(projectX(chart, 40)).toBe(100)
  })
})

describe('niceTicks', () => {
  it('returns round, ascending tick values spanning the range', () => {
    expect(niceTicks(0, 32, 4)).toEqual([0, 10, 20, 30])
    expect(niceTicks(0, 2.6, 5)).toEqual([0, 0.5, 1, 1.5, 2, 2.5])
  })

  it('handles a flat or degenerate range without looping forever', () => {
    expect(niceTicks(5, 5)).toEqual([5])
    expect(niceTicks(Number.NaN, 10)).toEqual([])
  })
})

describe('buildRadialGauge', () => {
  it('clamps the fraction to [0, 1] and emits two arc paths', () => {
    const gauge = buildRadialGauge({ fraction: 0.97, size: 128, strokeWidth: 12 })
    expect(gauge.fraction).toBe(0.97)
    expect(gauge.radius).toBe(52)
    expect(gauge.trackPath.startsWith('M ')).toBe(true)
    expect(gauge.valuePath.startsWith('M ')).toBe(true)
    expect(buildRadialGauge({ fraction: 2 }).fraction).toBe(1)
    expect(buildRadialGauge({ fraction: -1 }).fraction).toBe(0)
  })

  it('emits an empty value path at fraction 0 (nothing to draw)', () => {
    const gauge = buildRadialGauge({ fraction: 0 })
    expect(gauge.valuePath).toBe('')
    expect(gauge.trackPath).not.toBe('')
  })

  it('coerces a non-finite fraction to 0 instead of producing NaN geometry', () => {
    const gauge = buildRadialGauge({ fraction: Number.NaN })
    expect(gauge.fraction).toBe(0)
    expect(gauge.valuePath).toBe('')
  })
})

describe('projectY', () => {
  it('projects a reference value onto the chart y-axis (same normalization)', () => {
    const chart = buildSeriesChart([0, 10], { height: 100, minY: 0, maxY: 10 })!
    expect(projectY(chart, 0)).toBe(100) // min → bottom
    expect(projectY(chart, 10)).toBe(0) // max → top
    expect(projectY(chart, 5)).toBe(50) // midpoint
  })

  it('clamps values above max to the top and below min to the bottom', () => {
    const chart = buildSeriesChart([2, 8], { height: 100, minY: 2, maxY: 8 })!
    expect(projectY(chart, 20)).toBe(0) // above max clamps to top
    expect(projectY(chart, -5)).toBe(100) // below min clamps to bottom
  })

  it('does not divide by zero on an all-equal series', () => {
    const chart = buildSeriesChart([7, 7, 7], { height: 40 })!
    const y = projectY(chart, 7)
    expect(Number.isFinite(y)).toBe(true)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y).toBeLessThanOrEqual(40)
  })
})

describe('buildMultiSeriesChart', () => {
  it('returns null when no series has two finite points', () => {
    expect(buildMultiSeriesChart([])).toBeNull()
    expect(buildMultiSeriesChart([{ values: [] }, { values: [5] }])).toBeNull()
    expect(buildMultiSeriesChart([{ values: [null, Number.NaN] }])).toBeNull()
  })

  it('shares axes across series and does not stretch a shorter series to the full width', () => {
    // Two series on a shared x = step index: one of length 8, one of length 20.
    const long = Array.from({ length: 20 }, (_, i) => i + 1)
    const short = [1, 2, 3, 4, 5, 6, 7, 8]
    const chart = buildMultiSeriesChart([{ values: long }, { values: short }], {
      width: 190,
      height: 100
    })!
    expect(chart.series).toHaveLength(2)
    expect(chart.minX).toBe(0)
    expect(chart.maxX).toBe(19)
    // The long series spans the full width.
    const longPoints = chart.series[0]!.points
    expect(longPoints[0]!.x).toBe(0)
    expect(longPoints[longPoints.length - 1]!.x).toBe(190)
    // The short series ENDS EARLY at (7 / 19) * 190, not stretched to 190.
    const shortPoints = chart.series[1]!.points
    expect(shortPoints[shortPoints.length - 1]!.x).toBeCloseTo((7 / 19) * 190, 1)
    expect(shortPoints[shortPoints.length - 1]!.x).toBeLessThan(190)
  })

  it('keeps an empty series in the result with an empty path so color indexing stays stable', () => {
    const chart = buildMultiSeriesChart([{ values: [10, 20, 30] }, { values: [] }])!
    expect(chart.series).toHaveLength(2)
    expect(chart.series[1]!.points).toEqual([])
    expect(chart.series[1]!.path).toBe('')
    expect(chart.series[1]!.areaPath).toBe('')
  })
})

describe('buildCeilingLines', () => {
  it('projects one dashed ceiling per unique value, sorted ascending', () => {
    const chart = buildSeriesChart([0, 32], { height: 100, minY: 0, maxY: 32 })!
    const lines = buildCeilingLines(chart, [32, 24, 32, 24])
    expect(lines.map((line) => line.value)).toEqual([24, 32])
    expect(lines[0]!.y).toBe(projectY(chart, 24))
    expect(lines[1]!.y).toBe(projectY(chart, 32))
  })

  it('drops non-finite ceilings and returns [] when none are finite', () => {
    const chart = buildSeriesChart([0, 10], { height: 100, minY: 0, maxY: 10 })!
    expect(buildCeilingLines(chart, [null, undefined, Number.NaN])).toEqual([])
  })
})

describe('buildOpTimeline', () => {
  it('sorts ops by time desc, shares against the total, widths against the largest shown', () => {
    const timeline = buildOpTimeline(
      [
        { label: 'KSampler', value: 710 },
        { label: 'VAEDecode', value: 120 },
        { label: 'CLIPTextEncode', value: 170 }
      ],
      { topN: 2 }
    )
    expect(timeline.total).toBe(1000)
    expect(timeline.max).toBe(710)
    expect(timeline.bars.map((bar) => bar.label)).toEqual(['KSampler', 'CLIPTextEncode'])
    // Share is of the full 1000ms total even though VAEDecode is hidden.
    expect(timeline.bars[0]!.share).toBe(0.71)
    expect(timeline.bars[1]!.share).toBe(0.17)
    // Width is relative to the largest shown bar.
    expect(timeline.bars[0]!.widthFraction).toBe(1)
    expect(timeline.bars[1]!.widthFraction).toBe(round2(170 / 710))
  })

  it('drops null / non-positive ops and yields no bars for an empty panel', () => {
    expect(buildOpTimeline([]).bars).toEqual([])
    expect(
      buildOpTimeline([
        { label: 'a', value: null },
        { label: 'b', value: 0 }
      ]).bars
    ).toEqual([])
  })
})

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
