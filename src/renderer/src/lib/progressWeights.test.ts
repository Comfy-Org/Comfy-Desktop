import { describe, it, expect } from 'vitest'
import { fingerprintSteps, getPhaseWeights } from './progressWeights'
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

  it('weights a standalone install by how long each of its four steps takes', () => {
    const w = getPhaseWeights(steps('download', 'extract', 'setup', 'update'))
    expect(w).toEqual({ download: 0.4, extract: 0.2, setup: 0.3, update: 0.1 })
    expect(sum(w)).toBeCloseTo(1.0, 5)
  })

  it('gives the whole bar to the other steps when a standalone install has no version step', () => {
    const w = getPhaseWeights(steps('download', 'extract', 'setup'))
    expect(w).toEqual({ download: 0.45, extract: 0.2, setup: 0.35 })
    expect(sum(w)).toBeCloseTo(1.0, 5)
  })

  it('leaves room for the two restore steps when a snapshot is restored after the install', () => {
    const restored = getPhaseWeights(
      steps('download', 'extract', 'setup', 'restore-nodes', 'restore-pip')
    )
    expect(sum(restored)).toBeCloseTo(1.0, 5)
    expect(restored['restore-nodes']).toBe(0.18)
    expect(restored['restore-pip']).toBe(0.12)
    expect(restored.download).toBeGreaterThan(restored.setup!)

    const restoredAndUpdated = getPhaseWeights(
      steps('download', 'extract', 'setup', 'update', 'restore-nodes', 'restore-pip')
    )
    expect(sum(restoredAndUpdated)).toBeCloseTo(1.0, 5)
    expect(restoredAndUpdated.update).toBe(0.1)
    expect(restoredAndUpdated['restore-nodes']).toBe(0.15)
  })

  it('uses the curated table for a comfybuilder build install', () => {
    const w = getPhaseWeights(steps('download', 'extract', 'models'))
    expect(sum(w)).toBeCloseTo(1.0, 5)
    expect(w.download).toBeGreaterThan(w.extract)
    expect(w.download).toBeGreaterThan(w.models)
  })

  it('falls back to equal weights for an unknown weightless fingerprint', () => {
    const w = getPhaseWeights(steps('a', 'b', 'c', 'd'))
    expect(w).toEqual({ a: 0.25, b: 0.25, c: 0.25, d: 0.25 })
  })

  it('returns an empty map for no steps', () => {
    expect(getPhaseWeights([])).toEqual({})
  })
})
