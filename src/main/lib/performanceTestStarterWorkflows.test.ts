import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./fetch', () => ({ fetchJSON: vi.fn() }))
vi.mock('../sources/standalone/templateCatalog', () => ({ loadTemplateCatalog: vi.fn() }))

import { fetchJSON } from './fetch'
import { loadTemplateCatalog } from '../sources/standalone/templateCatalog'
import {
  getPerformanceTestStarterOptions,
  loadPerformanceTestStarterArtifacts,
  performanceTestStarterArtifactUrls
} from './performanceTestStarterWorkflows'

const HASH = 'a'.repeat(64)
const freeTemplate = {
  id: 'image_z_image_turbo',
  modality: 'image' as const,
  recommended: true,
  title: 'Z-Image-Turbo: Text to Image',
  name: 'Z-Image-Turbo',
  task: 'Text to Image',
  description: 'Generate an image.',
  sizeBytes: 42,
  apiNode: false,
  thumbnailUrl: 'https://example.com/image.webp',
  category: 'Image'
}
const paidTemplate = {
  ...freeTemplate,
  id: 'api_paid_image',
  title: 'Paid image',
  apiNode: true
}
const unpairedTemplate = {
  ...freeTemplate,
  id: 'image_without_api',
  title: 'No API artifact'
}

describe('performance test starter workflows', () => {
  beforeEach(() => {
    vi.mocked(fetchJSON).mockReset()
    vi.mocked(loadTemplateCatalog).mockReset()
    vi.mocked(loadTemplateCatalog).mockResolvedValue([freeTemplate, paidTemplate, unpairedTemplate])
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('offers only free catalogue entries with validated API index records', async () => {
    vi.mocked(fetchJSON).mockResolvedValue({
      schemaVersion: 1,
      workflows: {
        [freeTemplate.id]: { sourceSha256: HASH, apiSha256: HASH },
        [paidTemplate.id]: { sourceSha256: HASH, apiSha256: HASH },
        malformed: { sourceSha256: 'not-a-hash', apiSha256: HASH }
      }
    })

    await expect(getPerformanceTestStarterOptions()).resolves.toEqual([
      expect.objectContaining({
        value: freeTemplate.id,
        label: freeTemplate.title,
        recommended: true,
        data: expect.objectContaining({ apiNode: false, modality: 'image', sizeBytes: 42 })
      })
    ])
  })

  it('fails closed when the API artifact index is unavailable or malformed', async () => {
    vi.mocked(fetchJSON).mockRejectedValueOnce(new Error('offline'))
    await expect(getPerformanceTestStarterOptions()).resolves.toEqual([])

    vi.mocked(fetchJSON).mockResolvedValueOnce({ schemaVersion: 2, workflows: {} })
    await expect(getPerformanceTestStarterOptions()).resolves.toEqual([])
  })

  it('uses API workflow fixtures from assets in development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.mocked(fetchJSON).mockRejectedValue(new Error('No upstream API workflow index'))

    await expect(getPerformanceTestStarterOptions()).resolves.toEqual([
      expect.objectContaining({ value: 'image_z_image_turbo' })
    ])
  })

  it('loads a development API workflow fixture while downloading its editor workflow', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const editorWorkflow = { nodes: [] }
    vi.mocked(fetchJSON).mockImplementation(async (url) => {
      if (String(url).includes('/templates/')) return editorWorkflow
      throw new Error('No upstream API workflow artifact')
    })

    await expect(loadPerformanceTestStarterArtifacts('image_z_image_turbo')).resolves.toEqual({
      template: freeTemplate,
      editorWorkflow,
      apiWorkflow: expect.objectContaining({
        '9': expect.objectContaining({ class_type: 'SaveImage' })
      })
    })
  })

  it('loads the editor and paired API artifacts for an eligible template', async () => {
    const editorWorkflow = { nodes: [] }
    const apiWorkflow = { '1': { class_type: 'KSampler', inputs: {} } }
    vi.mocked(fetchJSON).mockImplementation(async (url) => {
      if (url === performanceTestStarterArtifactUrls.index) {
        return {
          schemaVersion: 1,
          workflows: { [freeTemplate.id]: { sourceSha256: HASH, apiSha256: HASH } }
        }
      }
      if (String(url).includes('/templates/')) return editorWorkflow
      return apiWorkflow
    })
    await expect(loadPerformanceTestStarterArtifacts(freeTemplate.id)).resolves.toEqual({
      template: freeTemplate,
      editorWorkflow,
      apiWorkflow
    })
    expect(fetchJSON).toHaveBeenCalledWith(
      `https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/${freeTemplate.id}.json`,
      { refresh: true }
    )
    expect(fetchJSON).toHaveBeenCalledWith(
      `${performanceTestStarterArtifactUrls.base}/${freeTemplate.id}.json`,
      { refresh: true }
    )
  })

  it('rejects paid, unpaired, and unknown templates before artifact download', async () => {
    vi.mocked(fetchJSON).mockResolvedValue({
      schemaVersion: 1,
      workflows: {
        [freeTemplate.id]: { sourceSha256: HASH, apiSha256: HASH },
        [paidTemplate.id]: { sourceSha256: HASH, apiSha256: HASH }
      }
    })

    await expect(loadPerformanceTestStarterArtifacts(paidTemplate.id)).rejects.toThrow(
      'unavailable for performance testing'
    )
    await expect(loadPerformanceTestStarterArtifacts(unpairedTemplate.id)).rejects.toThrow(
      'unavailable for performance testing'
    )
  })
})
