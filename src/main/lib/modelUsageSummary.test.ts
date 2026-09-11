import { describe, expect, it } from 'vitest'

import { createModelUsageSummary, parseModelLoadObservation } from './modelUsageSummary'

describe('parseModelLoadObservation', () => {
  it('classifies supported runtime model signals', () => {
    expect(parseModelLoadObservation('Requested to load MiniMaxH3')).toEqual({
      modelClass: 'MiniMaxH3',
      trigger: 'requested',
      targetDevice: null
    })
    expect(
      parseModelLoadObservation(
        'Model MiniMaxH3TEModel_ prepared for dynamic VRAM loading. 7671MB Staged.'
      )
    ).toEqual({
      modelClass: 'MiniMaxH3TEModel_',
      trigger: 'dynamic_prepare',
      targetDevice: null
    })
    expect(parseModelLoadObservation('Creating deepclone of MiniMaxH3 for cuda:1.')).toEqual({
      modelClass: 'MiniMaxH3',
      trigger: 'deepclone',
      targetDevice: 'cuda:1'
    })
    expect(
      parseModelLoadObservation('Reusing loaded multigpu deepclone of MiniMaxH3 for xpu:2')
    ).toEqual({
      modelClass: 'MiniMaxH3',
      trigger: 'deepclone',
      targetDevice: 'xpu:2'
    })
  })

  it('rejects model paths, filenames, and unrelated lines', () => {
    expect(
      parseModelLoadObservation('Requested to load C:\\Users\\me\\private.safetensors')
    ).toBeNull()
    expect(parseModelLoadObservation('Requested to load private-model.safetensors')).toBeNull()
    expect(parseModelLoadObservation('Requested to load MiniMaxH3 and free memory')).toBeNull()
    expect(parseModelLoadObservation('unrelated noise')).toBeNull()
  })
})

describe('createModelUsageSummary', () => {
  it('drains deterministic aligned arrays grouped by UTC observation date', () => {
    const summary = createModelUsageSummary()
    const firstDay = Date.parse('2026-08-18T23:59:00Z')
    const secondDay = Date.parse('2026-08-19T00:01:00Z')
    summary.recordLine('Requested to load MiniMaxH3', firstDay)
    summary.recordLine('Requested to load MiniMaxH3', secondDay)
    summary.recordLine('Requested to load MiniMaxH3', secondDay)
    summary.recordLine('Creating deepclone of MiniMaxH3 for cuda:1.', secondDay)

    expect(summary.drainProperties()).toEqual({
      model_usage_schema_version: 1,
      model_observation_semantics: 'runtime_load_log_v1',
      model_observation_dates: ['2026-08-18', '2026-08-19', '2026-08-19'],
      model_classes: ['MiniMaxH3', 'MiniMaxH3', 'MiniMaxH3'],
      model_load_triggers: ['requested', 'deepclone', 'requested'],
      model_target_devices: [null, 'cuda:1', null],
      model_load_counts: [1, 1, 2],
      model_usage_truncated: false
    })
    expect(summary.drainProperties()).toBeNull()
  })

  it('caps distinct model tuples across drains and marks affected deltas as truncated', () => {
    const summary = createModelUsageSummary()
    for (let index = 0; index < 60; index++) {
      summary.recordLine(`Requested to load Model${index}`)
    }
    expect(summary.drainProperties()?.model_classes).toHaveLength(60)

    summary.recordLine('Requested to load OverflowModel')
    summary.recordLine('Requested to load Model0')

    const properties = summary.drainProperties()
    expect(properties?.model_classes).toEqual(['Model0'])
    expect(properties?.model_classes).not.toContain('OverflowModel')
    expect(properties?.model_load_counts).toEqual([1])
    expect(properties?.model_usage_truncated).toBe(true)
  })
})
