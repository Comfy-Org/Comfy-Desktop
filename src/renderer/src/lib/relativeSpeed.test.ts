import { describe, expect, it } from 'vitest'
import {
  calculateRelativeSpeedFactor,
  getRelativeSpeedKind,
  getRelativeSpeedOffset,
  getRelativeSpeedScale
} from './relativeSpeed'

describe('relative speed', () => {
  it('calculates baseline duration divided by run duration', () => {
    expect(calculateRelativeSpeedFactor(3, 2)).toBe(1.5)
    expect(calculateRelativeSpeedFactor(3, 6)).toBe(0.5)
  })

  it('treats missing and zero durations as unavailable', () => {
    expect(calculateRelativeSpeedFactor(null, 2)).toBeNull()
    expect(calculateRelativeSpeedFactor(2, null)).toBeNull()
    expect(calculateRelativeSpeedFactor(0, 2)).toBeNull()
    expect(calculateRelativeSpeedFactor(2, 0)).toBeNull()
  })

  it('distinguishes the selected baseline from another equally fast run', () => {
    expect(getRelativeSpeedKind(1, true)).toBe('baseline')
    expect(getRelativeSpeedKind(1, false)).toBe('same')
  })

  it('clamps visualization offsets to the chart bounds', () => {
    expect(getRelativeSpeedOffset(4, 1)).toBe(1)
    expect(getRelativeSpeedOffset(0.25, 1)).toBe(-1)
    expect(getRelativeSpeedOffset(1.5, 1)).toBeCloseTo(Math.log2(1.5))
    expect(getRelativeSpeedOffset(null, 1)).toBe(0)
  })

  it('scales the axis to the largest factor so bigger gaps stay distinguishable', () => {
    expect(getRelativeSpeedScale([1, 1.5, 0.75, null])).toBe(1)
    expect(getRelativeSpeedScale([1, 4, 0.5])).toBe(2)
    expect(getRelativeSpeedScale([1, 0.125])).toBe(3)

    const scale = getRelativeSpeedScale([1, 2, 4])
    expect(getRelativeSpeedOffset(4, scale)).toBe(1)
    expect(getRelativeSpeedOffset(2, scale)).toBe(0.5)
    expect(getRelativeSpeedOffset(0.5, scale)).toBe(-0.5)
  })
})
