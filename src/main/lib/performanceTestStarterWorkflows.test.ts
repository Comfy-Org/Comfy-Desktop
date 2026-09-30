import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./fetch', () => ({ fetchJSON: vi.fn() }))

import benchmarkTemplates from '../../../assets/benchmark-templates.json'
import { fetchJSON } from './fetch'
import {
  ExampleWorkflowsUnreachableError,
  getPerformanceTestStarterOptions,
  loadPerformanceTestStarterArtifacts
} from './performanceTestStarterWorkflows'

const REPO = 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main'
const INDEX_URL = `${REPO}/templates/index.json`
const bundledIds = benchmarkTemplates.templates.map(({ id }) => id)
const liveIndex = [
  {
    title: 'Image',
    type: 'image',
    templates: [
      {
        name: 'image_z_image_int8',
        title: 'Z-Image Int8 Live: Text to Image',
        description: 'Live description.',
        size: 123,
        mediaSubtype: 'webp',
        tags: ['Image', 'Text to Image']
      }
    ]
  }
]

describe('performance test starter workflows', () => {
  beforeEach(() => {
    vi.mocked(fetchJSON).mockReset()
  })

  it('offers every bundled benchmark with metadata and cover from its parent template', async () => {
    vi.mocked(fetchJSON).mockImplementation(async (url) => {
      if (url === INDEX_URL) return liveIndex
      throw new Error(`unexpected fetch ${url}`)
    })

    const options = await getPerformanceTestStarterOptions()

    expect(options.map(({ value }) => value)).toEqual(bundledIds)
    expect(options.find(({ value }) => value === 'image_z_image_int8')).toEqual({
      value: 'image_z_image_int8',
      label: 'Z-Image Int8 Live: Text to Image',
      description: 'Live description.',
      recommended: false,
      data: {
        modality: 'image',
        category: 'Image',
        name: 'Z-Image Int8 Live',
        task: 'Text to Image',
        thumbnailUrl: `${REPO}/templates/image_z_image_int8-1.webp`,
        sizeBytes: 123,
        apiNode: false
      }
    })
  })

  it('falls back to the bundled snapshots when the template index is unreachable', async () => {
    vi.mocked(fetchJSON).mockRejectedValue(new Error('offline'))

    const options = await getPerformanceTestStarterOptions()
    const snapshot = benchmarkTemplates.templates[0]!

    expect(options.map(({ value }) => value)).toEqual(bundledIds)
    expect(options[0]).toMatchObject({
      value: snapshot.id,
      label: snapshot.snapshot.title,
      data: {
        sizeBytes: snapshot.snapshot.sizeBytes,
        thumbnailUrl: `${REPO}/templates/${snapshot.id}-1.${snapshot.snapshot.mediaSubtype}`
      }
    })
  })

  it('pairs the parent editor workflow from templates/ with the API prompt from benchmarks/', async () => {
    const editorWorkflow = { nodes: [] }
    const apiWorkflow = { '1': { class_type: 'KSampler', inputs: {} } }
    vi.mocked(fetchJSON).mockImplementation(async (url) => {
      if (url === INDEX_URL) return liveIndex
      if (url === `${REPO}/templates/image_z_image_int8.json`) return editorWorkflow
      if (url === `${REPO}/benchmarks/image_z_image_int8.json`) return apiWorkflow
      throw new Error(`unexpected fetch ${url}`)
    })

    await expect(loadPerformanceTestStarterArtifacts('image_z_image_int8')).resolves.toEqual({
      template: expect.objectContaining({ id: 'image_z_image_int8', sizeBytes: 123 }),
      editorWorkflow,
      apiWorkflow
    })
    expect(fetchJSON).toHaveBeenCalledWith(`${REPO}/templates/image_z_image_int8.json`, {
      refresh: true
    })
    expect(fetchJSON).toHaveBeenCalledWith(`${REPO}/benchmarks/image_z_image_int8.json`, {
      refresh: true
    })
  })

  it('reports an unreachable repository separately from an HTTP error', async () => {
    let artifactError: Error
    vi.mocked(fetchJSON).mockImplementation(async (url) => {
      if (url === INDEX_URL) return liveIndex
      throw artifactError
    })

    artifactError = new Error('net::ERR_NAME_NOT_RESOLVED')
    await expect(loadPerformanceTestStarterArtifacts('image_z_image_int8')).rejects.toBeInstanceOf(
      ExampleWorkflowsUnreachableError
    )

    artifactError = new Error('HTTP 404')
    await expect(loadPerformanceTestStarterArtifacts('image_z_image_int8')).rejects.toThrow(
      'HTTP 404'
    )
  })

  it('rejects an id outside the benchmark list before downloading anything', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(liveIndex)

    await expect(loadPerformanceTestStarterArtifacts('image_z_image_turbo')).rejects.toThrow(
      'unavailable for performance testing'
    )
    expect(fetchJSON).toHaveBeenCalledTimes(1)
    expect(fetchJSON).toHaveBeenCalledWith(INDEX_URL)
  })
})
