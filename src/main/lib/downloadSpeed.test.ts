import { describe, it, expect } from 'vitest'
import { createSpeedMeter } from './downloadSpeed'

const MB = 1_000_000

describe('createSpeedMeter', () => {
  it('reports nothing until it has a second of samples', () => {
    const meter = createSpeedMeter()
    expect(meter.read(0)).toBeUndefined()
    meter.record(0, 0)
    meter.record(5 * MB, 500)
    expect(meter.read(500)).toBeUndefined()
    meter.record(10 * MB, 1000)
    expect(meter.read(1000)).toBeCloseTo(10 * MB)
  })

  it('reports a steady rate', () => {
    const meter = createSpeedMeter()
    for (let at = 0; at <= 10_000; at += 100) meter.record((at / 1000) * 12 * MB, at)
    expect(meter.read(10_000)).toBeCloseTo(12 * MB)
  })

  it('counts from the first sample, not from zero, when bytes were already downloaded', () => {
    const meter = createSpeedMeter()
    meter.record(249 * MB, 0)
    meter.record(259 * MB, 1000)
    expect(meter.read(1000)).toBeCloseTo(10 * MB)
  })

  it('falls while no bytes arrive and reaches 0 once the window passes the last byte', () => {
    const meter = createSpeedMeter()
    for (let at = 0; at <= 4000; at += 250) meter.record((at / 1000) * 10 * MB, at)
    expect(meter.read(4000)).toBeCloseTo(10 * MB)
    const during = meter.read(6000)!
    expect(during).toBeGreaterThan(0)
    expect(during).toBeLessThan(10 * MB)
    expect(meter.read(10_000)).toBe(0)
  })

  it('reaches 0 after a stall when the last two chunks arrived close together', () => {
    const meter = createSpeedMeter()
    meter.record(1 * MB, 0)
    meter.record(2 * MB, 100)
    expect(meter.read(6000)).toBe(0)
  })

  it('averages bursts over the window', () => {
    const meter = createSpeedMeter()
    let bytes = 0
    for (let at = 0; at <= 30_000; at += 250) {
      const sending = Math.floor(at / 2500) % 2 === 0
      if (sending) bytes += 6 * MB
      meter.record(bytes, at)
    }
    const read = meter.read(30_000)!
    expect(read).toBeGreaterThan(9 * MB)
    expect(read).toBeLessThan(15 * MB)
  })

  it('starts over when the byte count goes backwards', () => {
    const meter = createSpeedMeter()
    meter.record(0, 0)
    meter.record(100 * MB, 2000)
    meter.record(1 * MB, 2500)
    expect(meter.read(2500)).toBeUndefined()
    meter.record(6 * MB, 3500)
    expect(meter.read(3500)).toBeCloseTo(5 * MB)
  })

  it('forgets everything on reset', () => {
    const meter = createSpeedMeter()
    meter.record(0, 0)
    meter.record(10 * MB, 1000)
    meter.reset()
    expect(meter.read(1000)).toBeUndefined()
    meter.record(50 * MB, 11_000)
    meter.record(52 * MB, 12_000)
    expect(meter.read(12_000)).toBeCloseTo(2 * MB)
  })
})
