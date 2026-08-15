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
  it('returns deterministic aligned arrays with aggregated tuple counts', () => {
    const summary = createModelUsageSummary()
    summary.recordLine('Requested to load MiniMaxH3')
    summary.recordLine('Creating deepclone of MiniMaxH3 for cuda:2.')
    summary.recordLine('Requested to load MiniMaxH3')
    summary.recordLine('Model MiniMaxH3 prepared for dynamic VRAM loading. 100MB Staged.')
    summary.recordLine('Creating deepclone of MiniMaxH3 for cuda:1.')
    summary.recordLine('Creating deepclone of MiniMaxH3 for cuda:1.')

    expect(summary.properties()).toEqual({
      model_usage_schema_version: 1,
      model_observation_semantics: 'runtime_load_log_v1',
      model_classes: ['MiniMaxH3', 'MiniMaxH3', 'MiniMaxH3', 'MiniMaxH3'],
      model_load_triggers: ['deepclone', 'deepclone', 'dynamic_prepare', 'requested'],
      model_target_devices: ['cuda:1', 'cuda:2', null, null],
      model_load_counts: [2, 1, 1, 2],
      model_usage_truncated: false
    })
  })

  it('caps distinct tuples and marks the summary as truncated', () => {
    const summary = createModelUsageSummary()
    for (let index = 0; index < 60; index++) {
      summary.recordLine(`Requested to load Model${index}`)
    }
    summary.recordLine('Requested to load OverflowModel')
    summary.recordLine('Requested to load Model0')

    const properties = summary.properties()
    expect(properties.model_classes).toHaveLength(60)
    expect(properties.model_classes).not.toContain('OverflowModel')
    expect(properties.model_load_counts).toContain(2)
    expect(properties.model_usage_truncated).toBe(true)
  })
})
