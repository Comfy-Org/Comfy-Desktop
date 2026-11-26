import { describe, expect, it } from 'vitest'
import type { CatalogWorkflow } from '../types/ipc'
import {
  activeFilterCount,
  filterWorkflows,
  NO_FILTERS,
  sortWorkflows,
  workflowFacets
} from './exploreWorkflows'

function workflow(over: Partial<CatalogWorkflow> & Pick<CatalogWorkflow, 'id'>): CatalogWorkflow {
  return {
    title: over.id,
    description: '',
    thumbnailUrl: null,
    canOpenLocal: true,
    canOpenCloud: false,
    minComfyUIVersion: null,
    hubUrl: `https://comfy.org/hub/workflows/${over.id}`,
    longDescription: null,
    author: null,
    generationType: null,
    useCases: [],
    models: [],
    uses: null,
    license: null,
    publishedAt: null,
    media: [],
    tutorialUrl: null,
    ...over
  }
}

const LTX = workflow({
  id: 'ltx',
  title: 'LTX-2.3: Image to Video',
  useCases: ['generate-video'],
  models: ['LTX-2.3'],
  publishedAt: '2026-01-16'
})
const BANANA = workflow({
  id: 'banana',
  title: 'Nano Banana: Text to Image',
  canOpenLocal: false,
  canOpenCloud: true,
  useCases: ['generate-images'],
  models: ['Nano Banana Pro'],
  publishedAt: '2025-05-01'
})
const UPSCALE = workflow({
  id: 'upscale',
  title: 'Clarity upscale',
  publishedAt: '2026-03-01',
  canOpenCloud: true,
  useCases: ['edit-images', 'generate-images'],
  models: ['SeedVR2']
})
const ALL = [LTX, BANANA, UPSCALE]

describe('Explore workflow filters', () => {
  it('offers each use case and model with how many workflows have it, most common first', () => {
    expect(workflowFacets(ALL)).toEqual({
      useCases: [
        { value: 'generate-images', count: 2 },
        { value: 'edit-images', count: 1 },
        { value: 'generate-video', count: 1 }
      ],
      models: [
        { value: 'LTX-2.3', count: 1 },
        { value: 'Nano Banana Pro', count: 1 },
        { value: 'SeedVR2', count: 1 }
      ]
    })
  })

  it('keeps only workflows that match every chosen filter and the search', () => {
    const images = { ...NO_FILTERS, useCase: 'generate-images' }
    expect(filterWorkflows(ALL, images, '').map(({ id }) => id)).toEqual(['banana', 'upscale'])
    expect(filterWorkflows(ALL, { ...images, runsOn: 'local' }, '').map(({ id }) => id)).toEqual([
      'upscale'
    ])
    expect(filterWorkflows(ALL, NO_FILTERS, 'seedvr').map(({ id }) => id)).toEqual(['upscale'])
    expect(filterWorkflows(ALL, { ...NO_FILTERS, model: 'LTX-2.3' }, 'banana')).toEqual([])
  })

  it('counts how many filter groups are in use', () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0)
    expect(activeFilterCount({ useCase: 'storyboards', model: null, runsOn: 'cloud' })).toBe(2)
  })

  it('sorts by the catalog’s own order, newest first or by name', () => {
    const order = (sort: 'popular' | 'newest' | 'name') =>
      sortWorkflows(ALL, sort, 'en').map(({ id }) => id)
    expect(order('popular')).toEqual(['ltx', 'banana', 'upscale'])
    expect(order('newest')).toEqual(['upscale', 'ltx', 'banana'])
    expect(order('name')).toEqual(['upscale', 'ltx', 'banana'])
  })
})
