import { describe, expect, it, vi } from 'vitest'

import {
  createVramPeakAccumulator,
  fetchSystemStats,
  type SystemStatsResponse
} from './systemStatsSampler'

const MB = 1024 * 1024
const stats = (
  type: string,
  totalMb: number,
  freeMb: number,
  index: number | null = 0
): SystemStatsResponse => ({
  devices: [{ type, index, vram_total: totalMb * MB, vram_free: freeMb * MB }]
})

describe('createVramPeakAccumulator', () => {
  it('tracks the max used memory across samples', () => {
    const acc = createVramPeakAccumulator()
    acc.sample(stats('cuda', 12288, 8000)) // used 4288
    acc.sample(stats('cuda', 12288, 2000)) // used 10288  <- peak
    acc.sample(stats('cuda', 12288, 6000)) // used 6288
    const snap = acc.snapshot()
    expect(snap.peakVramMb).toBe(10288)
    expect(snap.vramTotalMb).toBe(12288)
    expect(snap.backend).toBe('cuda')
    expect(snap.vramIsUnified).toBe(false)
    expect(snap.sampleCount).toBe(3)
  })

  it('flags unified memory on mps and cpu', () => {
    const mps = createVramPeakAccumulator()
    mps.sample(stats('mps', 24576, 6000, null))
    expect(mps.snapshot().vramIsUnified).toBe(true)
    const cpu = createVramPeakAccumulator()
    cpu.sample(stats('cpu', 16384, 4000, null))
    expect(cpu.snapshot().vramIsUnified).toBe(true)
  })

  it('is a no-op on null / empty / device-less samples', () => {
    const acc = createVramPeakAccumulator()
    acc.sample(null)
    acc.sample(undefined)
    acc.sample({})
    acc.sample({ devices: [] })
    const snap = acc.snapshot()
    expect(snap.peakVramMb).toBeNull()
    expect(snap.sampleCount).toBe(0)
    expect(snap.backend).toBeNull()
    expect(snap.vramIsUnified).toBeNull()
  })

  it('counts a device sample even without usable memory numbers, peak stays null', () => {
    const acc = createVramPeakAccumulator()
    acc.sample({ devices: [{ type: 'cuda' }] })
    const snap = acc.snapshot()
    expect(snap.sampleCount).toBe(1)
    expect(snap.backend).toBe('cuda')
    expect(snap.peakVramMb).toBeNull()
  })
})

describe('fetchSystemStats', () => {
  const url = 'http://127.0.0.1:8188'

  it('returns the parsed body on a 200', async () => {
    const body = stats('cuda', 12288, 8000)
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => body })
    await expect(fetchSystemStats(url, fetchImpl as unknown as typeof fetch)).resolves.toEqual(body)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('returns null on a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false })
    await expect(fetchSystemStats(url, fetchImpl as unknown as typeof fetch)).resolves.toBeNull()
  })

  it('returns null when the request throws (offline / abort / bad body)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'))
    await expect(fetchSystemStats(url, fetchImpl as unknown as typeof fetch)).resolves.toBeNull()
  })
})
