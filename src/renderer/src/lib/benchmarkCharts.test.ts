import { describe, expect, it } from 'vitest'

import { buildSeriesChart, projectY } from './benchmarkCharts'

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
