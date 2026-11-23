import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  listed: vi.fn(),
  builds: vi.fn(),
  missing: vi.fn()
}))

vi.mock('electron', () => ({ net: { fetch: mocks.fetch } }))
vi.mock('../lib/pythonEnv', () => ({ getActiveVenvDir: () => null }))
vi.mock('../sources/standalone/envPaths', () => ({ findSitePackages: () => null }))
vi.mock('../sources/standalone/curatedTemplates', () => ({ RAW_TEMPLATES_BASE: '' }))
vi.mock('../lib/fetch', () => ({ fetchJSON: vi.fn() }))
vi.mock('./workflows', () => ({ listedWorkflow: mocks.listed }))
vi.mock('../apps/localBuild', () => ({ usableLocalBuilds: mocks.builds }))
vi.mock('../lib/modelDownloadPaths', () => ({ missingModelFiles: mocks.missing }))

import { _forgetEditorGraphsForTest } from './editorGraph'
import { _forgetModelSizesForTest, catalogWorkflowNeeds } from './workflowNeeds'

const GRAPH_URL = 'https://cloud.comfy.org/api/v1/catalog/media/graph/version'
const VAE = 'https://huggingface.co/Comfy-Org/repo/resolve/main/vae/ltx_vae.safetensors'
const UNET = 'https://huggingface.co/Comfy-Org/repo/resolve/main/unet/ltx_fp8.safetensors'
const GRAPH = {
  nodes: [
    {
      id: 1,
      type: 'VAELoader',
      properties: { models: [{ name: 'ltx_vae.safetensors', url: VAE, directory: 'vae' }] }
    },
    {
      id: 2,
      type: 'UNETLoader',
      properties: {
        models: [{ name: 'ltx_fp8.safetensors', url: UNET, directory: 'diffusion_models' }]
      }
    }
  ],
  links: []
}

beforeEach(() => {
  vi.resetAllMocks()
  _forgetEditorGraphsForTest()
  _forgetModelSizesForTest()
  mocks.listed.mockImplementation((id: string) =>
    id === 'ltx' ? { card: { id: 'ltx' }, editorGraphUrl: GRAPH_URL } : undefined
  )
  mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === GRAPH_URL) return Response.json(GRAPH)
    expect(init?.method).toBe('HEAD')
    const size = url === UNET ? '33700000000' : null
    return new Response(null, {
      status: 302,
      headers: size ? { 'x-linked-size': size } : {}
    })
  })
  mocks.builds.mockResolvedValue([{ id: 'lab' }, { id: 'sandbox' }])
  mocks.missing.mockImplementation(async (build: string, models: { filename: string }[]) =>
    build === 'sandbox' ? models : []
  )
})

describe('what a catalog workflow needs', () => {
  it('lists the graph’s models with the sizes Hugging Face reports, and what each build is missing', async () => {
    expect(await catalogWorkflowNeeds('ltx')).toEqual({
      graph: GRAPH,
      models: [
        { filename: 'ltx_vae.safetensors', directory: 'vae', sizeBytes: null },
        { filename: 'ltx_fp8.safetensors', directory: 'diffusion_models', sizeBytes: 33700000000 }
      ],
      missingByBuild: {
        lab: [],
        sandbox: ['ltx_vae.safetensors', 'ltx_fp8.safetensors']
      }
    })
  })

  it('asks for the graph and each size once while the answers are known', async () => {
    await catalogWorkflowNeeds('ltx')
    await catalogWorkflowNeeds('ltx')

    const graphFetches = mocks.fetch.mock.calls.filter(([url]) => url === GRAPH_URL)
    const unetLookups = mocks.fetch.mock.calls.filter(([url]) => url === UNET)
    expect(graphFetches).toHaveLength(1)
    expect(unetLookups).toHaveLength(1)
  })

  it('answers nothing for a workflow Explore is not showing', async () => {
    expect(await catalogWorkflowNeeds('https://example.com')).toBeNull()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('needs nothing when the graph cannot be downloaded', async () => {
    mocks.fetch.mockRejectedValue(new Error('offline'))

    expect(await catalogWorkflowNeeds('ltx')).toEqual({
      graph: null,
      models: [],
      missingByBuild: {}
    })
  })
})
