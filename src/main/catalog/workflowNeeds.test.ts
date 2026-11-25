import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  request: vi.fn(),
  listed: vi.fn(),
  builds: vi.fn(),
  missing: vi.fn()
}))

vi.mock('electron', () => ({ net: { fetch: mocks.fetch, request: mocks.request } }))
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
const RENAMED = 'https://huggingface.co/Comfy-Org/renamed/resolve/main/unet/ltx_fp8.safetensors'
const CDN = 'https://cdn.example.test/ltx_fp8.safetensors'

interface Answer {
  status: number
  headers?: Record<string, string[]>
  to?: string
}

let answers: Record<string, Answer> = {}

function answerSizeRequests(): void {
  mocks.request.mockImplementation(({ url }: { url: string }) => {
    let followed = false
    const answer = (at: string): void => {
      const { status, headers = {}, to } = answers[at] ?? { status: 404 }
      if (to === undefined) {
        request.emit('response', { statusCode: status, headers })
        return
      }
      followed = false
      request.emit('redirect', status, 'HEAD', to, headers)
      if (followed) queueMicrotask(() => answer(to))
      else if (!request.abort.mock.calls.length) request.emit('error', new Error('cancelled'))
    }
    const request = Object.assign(new EventEmitter(), {
      end: () => queueMicrotask(() => answer(url)),
      abort: vi.fn(),
      followRedirect: () => {
        followed = true
      }
    })
    return request
  })
}

const GRAPH = {
  nodes: [
    {
      id: 1,
      type: 'VAELoader',
      widgets_values: ['ltx_vae.safetensors'],
      properties: { models: [{ name: 'ltx_vae.safetensors', url: VAE, directory: 'vae' }] }
    },
    {
      id: 2,
      type: 'UNETLoader',
      widgets_values: ['ltx_fp8.safetensors', 'default'],
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
  mocks.fetch.mockImplementation(async () => Response.json(GRAPH))
  answers = {
    [UNET]: { status: 302, to: CDN, headers: { 'X-Linked-Size': ['33700000000'] } },
    [VAE]: { status: 302, to: CDN }
  }
  answerSizeRequests()
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
        sandbox: ['vae/ltx_vae.safetensors', 'diffusion_models/ltx_fp8.safetensors']
      }
    })
  })

  it('needs only the models the loaders select, as ComfyUI reads them', async () => {
    const turbo = 'https://huggingface.co/Comfy-Org/z_image/resolve/main/z_image_bf16.safetensors'
    const enhancer = {
      nodes: [{ id: 9, type: 'Img2Img', mode: 0 }],
      links: [],
      models: [{ name: 'ae.safetensors', url: VAE, directory: 'vae' }],
      definitions: {
        subgraphs: [
          {
            name: 'Img2Img',
            nodes: [
              {
                id: 127,
                type: 'UNETLoader',
                widgets_values: ['z_image_turbo_bf16.safetensors', 'default'],
                properties: {
                  models: [
                    { name: 'z_image_bf16.safetensors', url: turbo, directory: 'diffusion_models' }
                  ]
                }
              },
              {
                id: 128,
                type: 'UNETLoader',
                mode: 4,
                widgets_values: ['ltx_fp8.safetensors', 'default'],
                properties: {
                  models: [
                    { name: 'ltx_fp8.safetensors', url: UNET, directory: 'diffusion_models' }
                  ]
                }
              },
              { id: 130, type: 'VAELoader', widgets_values: ['ae.safetensors'] }
            ]
          }
        ]
      }
    }
    mocks.fetch.mockImplementation(async () => Response.json(enhancer))

    const needs = await catalogWorkflowNeeds('ltx')

    expect(needs?.models.map(({ filename }) => filename)).toEqual(['ae.safetensors'])
    expect(needs?.missingByBuild.sandbox).toEqual(['vae/ae.safetensors'])
  })

  it('asks for the graph and each size once while the answers are known', async () => {
    await catalogWorkflowNeeds('ltx')
    await catalogWorkflowNeeds('ltx')

    const unetLookups = mocks.request.mock.calls.filter(([{ url }]) => url === UNET)
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(unetLookups).toHaveLength(1)
  })

  it('does not ask again for a size it could not get until a few minutes have passed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      answers[UNET] = { status: 401 }
      const lookups = (): number =>
        mocks.request.mock.calls.filter(([{ url }]) => url === UNET).length

      expect((await catalogWorkflowNeeds('ltx'))?.models[1]?.sizeBytes).toBeNull()
      await catalogWorkflowNeeds('ltx')
      expect(lookups(), 'a gated repository is not asked on every page open').toBe(1)

      await vi.advanceTimersByTimeAsync(5 * 60_000)
      await catalogWorkflowNeeds('ltx')
      expect(lookups()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the size without following Hugging Face to the file host', async () => {
    await catalogWorkflowNeeds('ltx')

    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ url: UNET, method: 'HEAD', redirect: 'manual' })
    )
    expect(mocks.request.mock.calls.map(([{ url }]) => url)).not.toContain(CDN)
  })

  it('follows a renamed Hugging Face repository to the size', async () => {
    answers = {
      [UNET]: { status: 307, to: RENAMED },
      [RENAMED]: { status: 302, to: CDN, headers: { 'x-linked-size': ['33700000000'] } },
      [VAE]: { status: 200, headers: { 'content-length': ['1200'] } }
    }

    expect((await catalogWorkflowNeeds('ltx'))?.models.map(({ sizeBytes }) => sizeBytes)).toEqual([
      1200, 33700000000
    ])
  })

  it('answers nothing for a workflow Explore is not showing', async () => {
    expect(await catalogWorkflowNeeds('https://example.com')).toBeNull()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('fails, rather than needing nothing, when the graph cannot be downloaded', async () => {
    mocks.fetch.mockRejectedValue(new Error('offline'))

    await expect(catalogWorkflowNeeds('ltx')).rejects.toThrow('offline')
  })

  it('needs nothing for a workflow that has no graph to open locally', async () => {
    mocks.listed.mockReturnValue({ card: { id: 'partner' }, editorGraphUrl: null })

    expect(await catalogWorkflowNeeds('partner')).toEqual({
      graph: null,
      models: [],
      missingByBuild: {}
    })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('keeps every model the graph needs even past the size lookups it makes', async () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      name: `model-${index}.safetensors`,
      url: `https://huggingface.co/Comfy-Org/repo/resolve/main/model-${index}.safetensors`,
      directory: 'checkpoints'
    }))
    const big = {
      nodes: [
        {
          id: 1,
          type: 'Loader',
          widgets_values: many.map(({ name }) => name),
          properties: { models: many }
        }
      ],
      links: []
    }
    mocks.fetch.mockImplementation(async () => Response.json(big))
    answers = {}

    const needs = await catalogWorkflowNeeds('ltx')

    expect(needs?.models).toHaveLength(30)
    expect(needs?.missingByBuild.sandbox).toHaveLength(30)
    expect(mocks.request).toHaveBeenCalledTimes(24)
  })
})
