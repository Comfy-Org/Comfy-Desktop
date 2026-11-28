import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/fetch', () => ({ fetchJSON: vi.fn() }))

import { fetchJSON } from '../lib/fetch'
import {
  HOME_WORKFLOW_LIMIT,
  _resetCatalogWorkflowsForTest,
  hubUrlForListedWorkflow,
  listCatalogWorkflows,
  listedWorkflow,
  listHomeWorkflows
} from './workflows'

const mockedFetchJSON = vi.mocked(fetchJSON)

function catalogItem(over: {
  uid?: string
  slug?: unknown
  data?: Record<string, unknown>
}): Record<string, unknown> {
  const uid = over.uid ?? 'upscale-uid'
  return {
    uid,
    slug: 'slug' in over ? over.slug : `/hub/workflows/${uid}`,
    data: {
      title: 'Upscale and restore detail',
      description: 'Enlarge an image and restore fine detail.',
      website_media: { '$.static_thumb': `/catalog-media/${uid}/v1` },
      website_media_types: { '$.static_thumb': 'image/webp' },
      translations: {
        'zh-CN': { title: '放大图像并修复细节', description: '放大图像并修复精细细节。' }
      },
      ...over.data
    }
  }
}

const UPSCALE_TEMPLATE = { name: 'upscale_and_restore', title: 'Upscale and restore detail' }

function templateIndex(templates: Record<string, unknown>[] = [UPSCALE_TEMPLATE]): unknown {
  return [{ title: 'Image', templates }]
}

function isTemplateIndexRequest(url: string): boolean {
  return new URL(url).pathname === '/templates/index.json'
}

function catalogRequests(): string[] {
  return mockedFetchJSON.mock.calls
    .map(([url]) => url)
    .filter((url) => new URL(url).pathname === '/api/v1/catalog/items')
}

function serveCatalog(pages: {
  desktop: unknown[]
  everything: unknown[]
  templates?: Record<string, unknown>[]
}): void {
  mockedFetchJSON.mockImplementation(async (url) => {
    if (isTemplateIndexRequest(url)) return templateIndex(pages.templates)
    const surface = new URL(url).searchParams.get('surface')
    return { items: surface === 'desktop_starters' ? pages.desktop : pages.everything }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetCatalogWorkflowsForTest()
})

describe('Home example workflows from the Comfy content catalog', () => {
  it('shows the workflows the catalog marks for Desktop', async () => {
    serveCatalog({
      desktop: [catalogItem({ uid: 'picked-for-desktop' })],
      everything: [catalogItem({ uid: 'hub-only' })]
    })

    expect(await listHomeWorkflows('en')).toEqual([
      {
        id: 'picked-for-desktop',
        title: 'Upscale and restore detail',
        description: 'Enlarge an image and restore fine detail.',
        thumbnailUrl: 'https://comfy.org/catalog-media/picked-for-desktop/v1',
        canOpenLocal: false,
        canOpenCloud: false,
        minComfyUIVersion: null,
        hubUrl: 'https://comfy.org/hub/workflows/picked-for-desktop',
        longDescription: null,
        author: null,
        generationType: null,
        useCases: [],
        models: [],
        uses: null,
        license: null,
        publishedAt: null,
        media: [],
        tutorialUrl: null
      }
    ])
  })

  it('carries what Explore filters and the workflow page show', async () => {
    serveCatalog({
      desktop: [
        catalogItem({
          uid: 'ltx',
          data: {
            long_description: 'Turn one picture into a short clip.',
            website_author: { name: 'ComfyUI' },
            generation_type: 'animate-images',
            compatibility: {
              website: { categories: ['generate-video', 'edit-video'], models: ['LTX-2.3'] }
            },
            usage: 17826,
            open_source: true,
            date: '2026-01-16',
            documentation_url: 'https://docs.comfy.org/tutorials/ltx',
            website_media: {
              '$.examples[0].media': '/catalog-media/ltx/example',
              '$.hero': '/catalog-media/ltx/hero',
              '$.static_thumb': '/catalog-media/ltx/thumb'
            },
            website_media_types: {
              '$.examples[0].media': 'video/mp4',
              '$.hero': 'image/webp',
              '$.static_thumb': 'image/webp'
            },
            website_media_sizes: { '$.hero': [400, 400] }
          }
        })
      ],
      everything: []
    })

    const [workflow] = await listHomeWorkflows('en')

    expect(workflow).toMatchObject({
      longDescription: 'Turn one picture into a short clip.',
      author: 'ComfyUI',
      generationType: 'animate-images',
      useCases: ['generate-video', 'edit-video'],
      models: ['LTX-2.3'],
      uses: 17826,
      license: 'open-source',
      publishedAt: '2026-01-16',
      tutorialUrl: 'https://docs.comfy.org/tutorials/ltx',
      media: [
        {
          url: 'https://comfy.org/catalog-media/ltx/example',
          kind: 'video',
          width: null,
          height: null
        },
        { url: 'https://comfy.org/catalog-media/ltx/hero', kind: 'image', width: 400, height: 400 }
      ]
    })
  })

  it('leaves out tutorial links that leave Comfy and media that is not a picture or video', async () => {
    serveCatalog({
      desktop: [
        catalogItem({
          uid: 'odd',
          data: {
            documentation_url: 'https://example.com/tutorial',
            website_media: {
              '$.hero': '/catalog-media/odd/hero',
              '$.static_thumb': '/catalog-media/odd/t'
            },
            website_media_types: { '$.hero': 'application/json', '$.static_thumb': 'image/webp' }
          }
        })
      ],
      everything: []
    })

    const [workflow] = await listHomeWorkflows('en')

    expect(workflow?.tutorialUrl).toBeNull()
    expect(workflow?.media).toEqual([])
  })

  it("falls back to the catalog's templates in its own order while none is marked for Desktop", async () => {
    serveCatalog({
      desktop: [],
      everything: [catalogItem({ uid: 'first' }), catalogItem({ uid: 'second' })]
    })

    const workflows = await listHomeWorkflows('en')

    expect(workflows.map((workflow) => workflow.id)).toEqual(['first', 'second'])
  })

  it('shows only official templates, never the workflows people published to the Hub', async () => {
    serveCatalog({
      desktop: [],
      everything: [
        catalogItem({ uid: 'published-to-hub', data: { title: 'My upscaler with extra packs' } }),
        catalogItem({ uid: 'template' })
      ]
    })

    const workflows = await listHomeWorkflows('en')

    expect(workflows.map((workflow) => workflow.id)).toEqual(['template'])
  })

  it('falls back to the templates when what the catalog marks for Desktop is not one', async () => {
    serveCatalog({
      desktop: [catalogItem({ uid: 'hub-pick', data: { title: 'A Hub favourite' } })],
      everything: [catalogItem({ uid: 'template' })]
    })

    const workflows = await listHomeWorkflows('en')

    expect(workflows.map((workflow) => workflow.id)).toEqual(['template'])
  })

  it('leaves out a template that needs custom nodes, whether the template list or the catalog says so', async () => {
    serveCatalog({
      templates: [
        UPSCALE_TEMPLATE,
        { name: 'video_ltx_i2v', title: 'LTX: Image to Video', requiresCustomNodes: ['kjnodes'] }
      ],
      desktop: [],
      everything: [
        catalogItem({ uid: 'listed-as-custom', data: { title: 'LTX: Image to Video' } }),
        catalogItem({
          uid: 'catalog-says-custom',
          data: { requires_custom_nodes: ['comfyui_essentials'] }
        }),
        catalogItem({ uid: 'native', data: { requires_custom_nodes: [] } })
      ]
    })

    const workflows = await listHomeWorkflows('en')

    expect(workflows.map((workflow) => workflow.id)).toEqual(['native'])
  })

  it('goes by the template name the catalog gives before the title', async () => {
    serveCatalog({
      templates: [
        { name: 'template_qwen_multiangle', title: 'Qwen: Multiple Angles' },
        { name: 'video_wan_s2v', title: 'Make your character talk', requiresCustomNodes: ['wan'] },
        { name: 'image_talking_card', title: 'Make a character talk' }
      ],
      desktop: [],
      everything: [
        catalogItem({
          uid: 'renamed-template',
          data: { template_name: 'template_qwen_multiangle', title: 'See a new angle' }
        }),
        catalogItem({
          uid: 'custom-by-name',
          data: { template_name: 'video_wan_s2v', title: 'Make a character talk' }
        })
      ]
    })

    const workflows = await listHomeWorkflows('en')

    expect(workflows.map((workflow) => workflow.id)).toEqual(['renamed-template'])
  })

  it('leaves out a title that several templates share when any of them needs custom nodes', async () => {
    serveCatalog({
      templates: [
        { name: 'image_flux_dev', title: 'Flux Dev' },
        { name: 'image_flux_dev_lora', title: 'flux dev', requiresCustomNodes: ['lora-pack'] }
      ],
      desktop: [],
      everything: [catalogItem({ uid: 'ambiguous', data: { title: 'Flux Dev' } })]
    })

    expect(await listHomeWorkflows('en')).toEqual([])
  })

  it('reads further catalog pages until the Home row is full, and stops after a few', async () => {
    mockedFetchJSON.mockImplementation(async (url) => {
      if (isTemplateIndexRequest(url)) return templateIndex()
      const cursor = Number(new URL(url).searchParams.get('cursor') ?? 0)
      return {
        items: [
          catalogItem({ uid: `hub-${cursor}`, data: { title: 'Not a template' } }),
          ...(cursor === 1 ? [catalogItem({ uid: 'template-on-page-two' })] : [])
        ],
        has_more: true,
        next_cursor: String(cursor + 1)
      }
    })

    const workflows = await listHomeWorkflows('en')

    expect(workflows.map((workflow) => workflow.id)).toEqual(['template-on-page-two'])
    expect(catalogRequests()).toHaveLength(3)
  })

  it('reports a failure when the template list cannot be read', async () => {
    mockedFetchJSON.mockImplementation(async (url) => {
      if (isTemplateIndexRequest(url)) throw new Error('templates offline')
      return { items: [catalogItem({})] }
    })

    await expect(listHomeWorkflows('en')).rejects.toThrow('templates offline')
  })

  it('never shows more cards than the Home row holds', async () => {
    serveCatalog({
      desktop: Array.from({ length: HOME_WORKFLOW_LIMIT + 5 }, (_, index) =>
        catalogItem({ uid: `workflow-${index}` })
      ),
      everything: []
    })

    expect(await listHomeWorkflows('en')).toHaveLength(HOME_WORKFLOW_LIMIT)
  })

  it('shows the title and description in the app language when the catalog has them', async () => {
    serveCatalog({ desktop: [catalogItem({})], everything: [] })

    const [workflow] = await listHomeWorkflows('zh')

    expect(workflow).toMatchObject({
      title: '放大图像并修复细节',
      description: '放大图像并修复精细细节。'
    })
  })

  it('leaves out records that have no title or no Comfy Hub page to open', async () => {
    serveCatalog({
      desktop: [
        catalogItem({ uid: 'untitled', data: { title: '   ' } }),
        catalogItem({ uid: 'elsewhere', slug: 'https://example.com/hub/workflows/elsewhere' }),
        catalogItem({ uid: 'not-a-workflow-page', slug: '/hub/apps/not-a-workflow-page' }),
        catalogItem({ uid: 'missing-slug', slug: undefined }),
        'not-a-record',
        catalogItem({ uid: 'good' })
      ],
      everything: []
    })

    const workflows = await listHomeWorkflows('en')

    expect(workflows.map((workflow) => workflow.id)).toEqual(['good'])
  })

  it('shows a card without a picture when the catalog only has a video or an off-site image', async () => {
    serveCatalog({
      desktop: [
        catalogItem({
          uid: 'video-only',
          data: {
            website_media: { '$.thumbnail': '/catalog-media/video-only/v1' },
            website_media_types: { '$.thumbnail': 'video/mp4' }
          }
        }),
        catalogItem({
          uid: 'off-site',
          data: {
            website_media: { '$.static_thumb': 'https://example.com/tracker.png' },
            website_media_types: { '$.static_thumb': 'image/png' }
          }
        })
      ],
      everything: []
    })

    const workflows = await listHomeWorkflows('en')

    expect(workflows.map((workflow) => workflow.thumbnailUrl)).toEqual([null, null])
  })

  it('keeps showing the last list when the catalog stops answering', async () => {
    vi.useFakeTimers()
    try {
      serveCatalog({ desktop: [catalogItem({ uid: 'loaded-earlier' })], everything: [] })
      await listHomeWorkflows('en')

      vi.advanceTimersByTime(60 * 60 * 1000)
      mockedFetchJSON.mockRejectedValue(new Error('offline'))

      const workflows = await listHomeWorkflows('en')

      expect(workflows.map((workflow) => workflow.id)).toEqual(['loaded-earlier'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a failure when the catalog has never answered', async () => {
    mockedFetchJSON.mockRejectedValue(new Error('offline'))

    await expect(listHomeWorkflows('en')).rejects.toThrow('offline')
  })

  it('reports a failure when the catalog answers with something that is not a list', async () => {
    mockedFetchJSON.mockImplementation(async (url) =>
      isTemplateIndexRequest(url)
        ? templateIndex()
        : { code: 'invalid', message: 'invalid catalog query' }
    )

    await expect(listHomeWorkflows('en')).rejects.toThrow('Catalog response has no items list')
  })

  it('reports a failure when the template list is not a list', async () => {
    mockedFetchJSON.mockImplementation(async (url) =>
      isTemplateIndexRequest(url) ? { templates: [] } : { items: [catalogItem({})] }
    )

    await expect(listHomeWorkflows('en')).rejects.toThrow('Template index is not a list')
  })

  it('asks the catalog and the template list once while several pages wait for the same list', async () => {
    serveCatalog({ desktop: [catalogItem({})], everything: [] })

    await Promise.all([listHomeWorkflows('en'), listHomeWorkflows('en'), listHomeWorkflows('en')])
    await listHomeWorkflows('en')

    expect(catalogRequests()).toHaveLength(1)
    expect(mockedFetchJSON.mock.calls.filter(([url]) => isTemplateIndexRequest(url))).toHaveLength(
      1
    )
  })
})

describe('opening an example workflow', () => {
  it('opens the Comfy Hub page of a workflow that Home is showing', async () => {
    serveCatalog({ desktop: [catalogItem({ uid: 'shown' })], everything: [] })
    await listHomeWorkflows('en')

    expect(hubUrlForListedWorkflow('shown')).toBe('https://comfy.org/hub/workflows/shown')
  })

  it('drops query strings and fragments the catalog put on a Hub page address', async () => {
    serveCatalog({
      desktop: [catalogItem({ uid: 'tagged', slug: '/hub/workflows/tagged?next=evil#frag' })],
      everything: []
    })
    await listHomeWorkflows('en')

    expect(hubUrlForListedWorkflow('tagged')).toBe('https://comfy.org/hub/workflows/tagged')
  })

  it('opens nothing for an id Home is not showing', async () => {
    serveCatalog({ desktop: [catalogItem({ uid: 'shown' })], everything: [] })
    await listHomeWorkflows('en')

    expect(hubUrlForListedWorkflow('https://example.com')).toBeNull()
  })

  it('opens nothing before Home has loaded the list', () => {
    expect(hubUrlForListedWorkflow('shown')).toBeNull()
  })

  it('opens a card from a list that arrived while the language was being switched', async () => {
    let answerEnglish: (page: unknown) => void = () => {}
    let catalogAnswers = 0
    mockedFetchJSON.mockImplementation((url) => {
      if (isTemplateIndexRequest(url)) return Promise.resolve(templateIndex())
      catalogAnswers += 1
      return catalogAnswers === 1
        ? new Promise((resolve) => (answerEnglish = resolve))
        : Promise.resolve({ items: [catalogItem({ uid: 'chinese-card' })] })
    })

    const english = listHomeWorkflows('en')
    await listHomeWorkflows('zh')
    answerEnglish({ items: [catalogItem({ uid: 'english-card' })] })

    expect((await english).map((card) => card.id)).toEqual(['english-card'])
    expect(hubUrlForListedWorkflow('english-card')).toBe(
      'https://comfy.org/hub/workflows/english-card'
    )
    expect(hubUrlForListedWorkflow('chinese-card')).toBe(
      'https://comfy.org/hub/workflows/chinese-card'
    )
  })
})

describe('the dedicated workflow catalog', () => {
  it('fetches following pages, even after an empty page, and makes their cards available to open', async () => {
    mockedFetchJSON
      .mockResolvedValueOnce({
        items: [catalogItem({ uid: 'first' })],
        has_more: true,
        next_cursor: 'page-2'
      })
      .mockResolvedValueOnce({ items: [], has_more: true, next_cursor: 'page-3' })
      .mockResolvedValueOnce({
        items: [catalogItem({ uid: 'first' }), catalogItem({ uid: 'last' })]
      })

    expect((await listCatalogWorkflows('en')).map(({ id }) => id)).toEqual(['first', 'last'])
    expect(
      mockedFetchJSON.mock.calls.map(([url]) => new URL(url).searchParams.get('cursor'))
    ).toEqual([null, 'page-2', 'page-3'])
    expect(hubUrlForListedWorkflow('last')).toBe('https://comfy.org/hub/workflows/last')
  })

  it('stops when the catalog hands back a cursor it already gave', async () => {
    mockedFetchJSON
      .mockResolvedValueOnce({
        items: [catalogItem({ uid: 'a' })],
        has_more: true,
        next_cursor: 'p2'
      })
      .mockResolvedValueOnce({
        items: [catalogItem({ uid: 'b' })],
        has_more: true,
        next_cursor: 'p3'
      })
      .mockResolvedValue({ items: [catalogItem({ uid: 'c' })], has_more: true, next_cursor: 'p2' })

    await expect(listCatalogWorkflows('en')).rejects.toThrow('did not finish')
    expect(mockedFetchJSON).toHaveBeenCalledTimes(3)
  })

  it('keeps every Hub workflow, template or not, without asking for the template list', async () => {
    mockedFetchJSON.mockResolvedValue({
      items: [catalogItem({ uid: 'hub-pick', data: { title: 'A Hub favourite' } })]
    })

    expect((await listCatalogWorkflows('en')).map((workflow) => workflow.id)).toEqual(['hub-pick'])
    expect(mockedFetchJSON.mock.calls.some(([url]) => isTemplateIndexRequest(url))).toBe(false)
  })

  it('stops after a hundred pages when the catalog never says it is done', async () => {
    let page = 0
    mockedFetchJSON.mockImplementation(async () => ({
      items: [catalogItem({ uid: `w${page}` })],
      has_more: true,
      next_cursor: `p${++page}`
    }))

    await expect(listCatalogWorkflows('en')).rejects.toThrow('did not finish')
    expect(mockedFetchJSON).toHaveBeenCalledTimes(101)
  })

  it('retains the minimum version and exposes only supported launch routes', async () => {
    const prompt = { '1': { class_type: 'SaveImage', inputs: {} } }
    mockedFetchJSON.mockResolvedValue({
      items: [
        catalogItem({
          uid: 'launchable',
          data: {
            min_comfyui_version: 'v0.3.66',
            website_media: { '$.workflow_files[0].file': '/catalog-media/graph/version' },
            website_media_types: { '$.workflow_files[0].file': 'application/json' },
            compatibility: { website: { type: 'CLOUD', workflow: { cloud: { workflow: prompt } } } }
          }
        }),
        catalogItem({
          uid: 'unsafe',
          data: {
            website_media: { '$.workflow_files[0].file': '/catalog-media/../graph' },
            website_media_types: { '$.workflow_files[0].file': 'application/json' },
            compatibility: {
              website: {
                workflow: {
                  cloud: {
                    workflow: { '1': { class_type: 'Example', inputs: { api_key_comfy_org: 'x' } } }
                  }
                }
              }
            }
          }
        })
      ]
    })

    expect(await listCatalogWorkflows('en')).toMatchObject([
      { id: 'launchable', canOpenLocal: true, canOpenCloud: true, minComfyUIVersion: '0.3.66' },
      { id: 'unsafe', canOpenLocal: false, canOpenCloud: false, minComfyUIVersion: null }
    ])
    expect(listedWorkflow('launchable')).toMatchObject({
      editorGraphUrl: 'https://cloud.comfy.org/api/v1/catalog/media/graph/version',
      cloudPrompt: prompt
    })
  })
})

it('takes the catalog’s own word on whether a workflow runs on Comfy Cloud', async () => {
  const graphMedia = {
    website_media: { '$.workflow_files[0].file': '/catalog-media/moss-image/v1' },
    website_media_types: { '$.workflow_files[0].file': 'application/json' }
  }
  mockedFetchJSON.mockResolvedValue({
    items: [
      catalogItem({ uid: 'moss-image', data: { ...graphMedia, works_on_cloud: true } }),
      catalogItem({
        uid: 'local-only',
        data: {
          ...graphMedia,
          works_on_cloud: false,
          cloud_share_url: 'https://cloud.comfy.org/?share=1785e38f230a'
        }
      })
    ]
  })

  expect(await listCatalogWorkflows('en')).toMatchObject([
    { id: 'moss-image', canOpenLocal: true, canOpenCloud: true },
    { id: 'local-only', canOpenLocal: true, canOpenCloud: false }
  ])
})

it('uses a legacy workflow-version graph and its Cloud share as launch metadata', async () => {
  mockedFetchJSON.mockResolvedValue({
    items: [
      catalogItem({
        uid: 'shared-workflow',
        data: {
          website_media: {
            '$.workflow_versions[0].download': '/catalog-media/shared-graph/version'
          },
          website_media_types: { '$.workflow_versions[0].download': 'application/json' },
          cloud_share_url: 'https://cloud.comfy.org/?share=1785e38f230a'
        }
      })
    ]
  })

  expect(await listCatalogWorkflows('en')).toMatchObject([
    { id: 'shared-workflow', canOpenLocal: true, canOpenCloud: true }
  ])
  expect(listedWorkflow('shared-workflow')?.editorGraphUrl).toBe(
    'https://cloud.comfy.org/api/v1/catalog/media/shared-graph/version'
  )
})
