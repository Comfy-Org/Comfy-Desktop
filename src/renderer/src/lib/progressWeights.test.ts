import { describe, it, expect } from 'vitest'
import { CURATED_PHASE_WEIGHTS, fingerprintSteps, getPhaseWeights } from './progressWeights'
import type { ProgressStep } from '../types/ipc'

const steps = (...phases: string[]): ProgressStep[] =>
  phases.map((phase) => ({ phase, label: phase }))

const weighted = (entries: [string, number][]): ProgressStep[] =>
  entries.map(([phase, weight]) => ({ phase, label: phase, weight }))

const sum = (w: Record<string, number>): number => Object.values(w).reduce((a, b) => a + b, 0)

describe('fingerprintSteps', () => {
  it('is the sorted, |-joined phase ids (order-independent)', () => {
    expect(fingerprintSteps(steps('gpu', 'securityScan'))).toBe('gpu|securityScan')
    expect(fingerprintSteps(steps('securityScan', 'gpu'))).toBe('gpu|securityScan')
  })
})

describe('getPhaseWeights', () => {
  it('uses inline step weights when present (the launch path)', () => {
    const w = getPhaseWeights(
      weighted([
        ['gpu', 0.5],
        ['startingServer', 0.2],
        ['customNodes', 0.3]
      ])
    )
    expect(w).toEqual({ gpu: 0.5, startingServer: 0.2, customNodes: 0.3 })
  })

  it('normalizes inline weights so an injected step keeps the sum at 1.0', () => {
    // Base sums to 1.0; the repair injection adds 0.1 on top (total 1.1). The
    // bar must still span 0→1, with gpu staying the heaviest (B2 guard: it must
    // NOT collapse toward the 1/7 it would get from an equal split).
    const w = getPhaseWeights(
      weighted([
        ['repair', 0.1],
        ['launchStart', 0.05],
        ['securityScan', 0.05],
        ['mountLibraries', 0.05],
        ['gpu', 0.5],
        ['customNodes', 0.15],
        ['startingServer', 0.2]
      ])
    )
    expect(sum(w)).toBeCloseTo(1.0, 5)
    expect(w.gpu).toBeGreaterThan(0.3)
    expect(w.gpu).toBeGreaterThan(w.repair!)
  })

  it('degrades to an equal split when inline weights are all zero', () => {
    const w = getPhaseWeights(
      weighted([
        ['a', 0],
        ['b', 0]
      ])
    )
    expect(w).toEqual({ a: 0.5, b: 0.5 })
  })

  it('falls back to a curated table for weightless steps (install/adopt/migrate)', () => {
    const w = getPhaseWeights(steps('download', 'extract'))
    expect(sum(w)).toBeCloseTo(1.0, 5)
    expect(w.download).toBe(0.7)
    expect(w.extract).toBe(0.3)
  })

  it('falls back to equal weights for an unknown weightless fingerprint', () => {
    const w = getPhaseWeights(steps('a', 'b', 'c', 'd'))
    expect(w).toEqual({ a: 0.25, b: 0.25, c: 0.25, d: 0.25 })
  })

  it('returns an empty map for no steps', () => {
    expect(getPhaseWeights([])).toEqual({})
  })
})

describe('curated tables', () => {
  it.each(Object.keys(CURATED_PHASE_WEIGHTS))('%s sums to 1.0', (fingerprint) => {
    expect(sum(CURATED_PHASE_WEIGHTS[fingerprint]!)).toBeCloseTo(1.0, 5)
  })

  it.each(Object.entries(CURATED_PHASE_WEIGHTS))('%s is keyed by its own fingerprint', (fp, w) => {
    expect(fingerprintSteps(steps(...Object.keys(w)))).toBe(fp)
  })

  it('gives the standalone install more of the bar to `update` than `setup`', () => {
    // `update` hosts torch_deps_sync (p90 15min, p99 110min); `setup` hosts
    // env_create + package_copy (p50 17s combined). An `update` weight below
    // `setup` puts the longest stretch of a slow install in the bar's tail.
    const w = CURATED_PHASE_WEIGHTS['cleanup|download|extract|setup|update']!
    expect(w.update).toBeGreaterThan(w.setup!)
  })
})
