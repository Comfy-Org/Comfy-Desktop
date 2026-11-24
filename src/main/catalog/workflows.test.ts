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

function serveCatalog(pages: { desktop: unknown[]; everything: unknown[] }): void {
  mockedFetchJSON.mockImplementation(async (url) => {
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

  it("falls back to the catalog's own order while no workflow is marked for Desktop", async () => {
    serveCatalog({
      desktop: [],
      everything: [catalogItem({ uid: 'first' }), catalogItem({ uid: 'second' })]
    })

    const workflows = await listHomeWorkflows('en')

    expect(workflows.map((workflow) => workflow.id)).toEqual(['first', 'second'])
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
    mockedFetchJSON.mockResolvedValue({ code: 'invalid', message: 'invalid catalog query' })

    await expect(listHomeWorkflows('en')).rejects.toThrow()
  })

  it('asks the catalog once while several pages wait for the same list', async () => {
    serveCatalog({ desktop: [catalogItem({})], everything: [] })

    await Promise.all([listHomeWorkflows('en'), listHomeWorkflows('en'), listHomeWorkflows('en')])
    await listHomeWorkflows('en')

    expect(mockedFetchJSON).toHaveBeenCalledTimes(1)
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
    mockedFetchJSON
      .mockImplementationOnce(() => new Promise((resolve) => (answerEnglish = resolve)))
      .mockResolvedValue({ items: [catalogItem({ uid: 'chinese-card' })] })

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
