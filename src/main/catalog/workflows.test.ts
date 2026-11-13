import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/fetch', () => ({ fetchJSON: vi.fn() }))

import { fetchJSON } from '../lib/fetch'
import {
  HOME_WORKFLOW_LIMIT,
  _resetCatalogWorkflowsForTest,
  hubUrlForListedWorkflow,
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
        category: null,
        useCase: null,
        models: [],
        runsOn: null,
        rank: null
      }
    ])
  })

  it('tags each workflow with the kind of media it makes', async () => {
    serveCatalog({
      desktop: [
        catalogItem({ uid: 'from-outputs', data: { outputs: [{ kind: 'video' }] } }),
        catalogItem({ uid: 'from-generation', data: { generation_type: 'edit-images' } }),
        catalogItem({ uid: 'untagged' })
      ],
      everything: []
    })

    const workflows = await listHomeWorkflows('en')

    expect(workflows.map((workflow) => workflow.category)).toEqual(['video', 'image', null])
  })

  it("reads each workflow's Hub use case, models, where it runs and its rank", async () => {
    const website = {
      category: 'upscale',
      categoryLabel: { en: 'Upscale & restore', 'zh-CN': '放大与修复' },
      categoryOrder: 3,
      models: ['SeedVR2', 'SeedVR2', 7],
      type: 'CLOUD',
      recommendedRank: 2
    }
    serveCatalog({
      desktop: [
        catalogItem({ uid: 'hub-facts', data: { compatibility: { website } } }),
        catalogItem({ uid: 'odd', data: { compatibility: { website: { type: 'GPU' } } } })
      ],
      everything: []
    })

    const [facts, odd] = await listHomeWorkflows('zh-CN')

    expect(facts).toMatchObject({
      useCase: { id: 'upscale', label: '放大与修复', order: 3 },
      models: ['SeedVR2'],
      runsOn: 'cloud',
      rank: 2
    })
    expect(odd).toMatchObject({ useCase: null, models: [], runsOn: null, rank: null })
  })

  it('falls back to the English use case label for a locale the catalog lacks', async () => {
    serveCatalog({
      desktop: [
        catalogItem({
          uid: 'labelled',
          data: {
            compatibility: {
              website: { category: 'upscale', categoryLabel: { en: 'Upscale & restore' } }
            }
          }
        })
      ],
      everything: []
    })

    const [workflow] = await listHomeWorkflows('fr')

    expect(workflow!.useCase).toEqual({ id: 'upscale', label: 'Upscale & restore', order: 0 })
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
})
