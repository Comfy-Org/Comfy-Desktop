// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchJSON = vi.fn()
const netFetch = vi.fn()

vi.mock('electron', () => ({ net: { fetch: (...args: unknown[]) => netFetch(...args) } }))
vi.mock('../lib/fetch', () => ({ fetchJSON: (...args: unknown[]) => fetchJSON(...args) }))

import {
  _resetAppsCatalogForTest,
  appCover,
  catalogApps,
  catalogListUrl,
  loadApps,
  toListing,
  websiteApps
} from './appsCatalog'

const CLOUD = 'https://cloud.example'
const SITE = 'https://apps.example'
const THUMB = {
  src: 'media',
  id: '52545867-279e-4f97-bd63-6c7ea23a3aa0',
  file_version_uid: 'd88bb50c-26ca-4e85-8bbc-a8d8d2e30b7e'
}

function catalogItem(data: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: '49c01985-5321-475d-bb49-2316d19882d1',
    kind: 'APP',
    data: {
      type: 'app',
      slug: 'doodle-to-image',
      title: 'Doodle to Image',
      description: 'Draw the shapes, say what it is, and get a finished picture.',
      sort_order: 17,
      static_thumb: THUMB,
      compatibility: {
        website: { href: '/hub/apps/doodle-to-image/' },
        desktop: {
          page: '/apps/doodle-to-image/desktop.html',
          runs_on: ['cloud', 'local'],
          accent: ['#f472b6', '#d7fd52']
        }
      },
      ...data
    }
  }
}

function websiteApp(app: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 1,
    id: 'doodle-to-image',
    order: 17,
    title: 'Doodle to Image',
    blurb: 'Draw the shapes, say what it is, and get a finished picture.',
    accent: ['#f472b6', '#d7fd52'],
    cover: '/apps/covers/doodle-to-image.jpg',
    page: '/apps/doodle-to-image/desktop.html',
    steps: [],
    examples: [],
    ...app
  }
}

const doodle = {
  id: 'doodle-to-image',
  title: 'Doodle to Image',
  description: 'Draw the shapes, say what it is, and get a finished picture.',
  page: '/apps/doodle-to-image/desktop.html',
  accent: ['#f472b6', '#d7fd52'],
  sortOrder: 17
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetAppsCatalogForTest()
})

describe('catalogApps', () => {
  it('maps a catalog app item to a card with its catalog cover', () => {
    expect(catalogApps({ items: [catalogItem()] }, CLOUD)).toEqual([
      {
        ...doodle,
        runsOn: ['cloud', 'local'],
        coverUrl: `${CLOUD}/api/v1/catalog/media/${THUMB.id}/${THUMB.file_version_uid}`
      }
    ])
  })

  it('uses an image hero when there is no static thumbnail, and skips a video hero', () => {
    const hero = { ...THUMB, id: '7ed0385c-4fda-4bf5-8594-8bfa525e2f84' }
    const [image] = catalogApps(
      {
        items: [
          catalogItem({
            static_thumb: undefined,
            hero,
            website_media_types: { '$.hero': 'image/jpeg' }
          })
        ]
      },
      CLOUD
    )
    const [video] = catalogApps(
      {
        items: [
          catalogItem({
            static_thumb: undefined,
            hero,
            website_media_types: { '$.hero': 'video/mp4' }
          })
        ]
      },
      CLOUD
    )

    expect(image!.coverUrl).toBe(
      `${CLOUD}/api/v1/catalog/media/${hero.id}/${hero.file_version_uid}`
    )
    expect(video!.coverUrl).toBeNull()
  })

  it('skips items with no Desktop page, a page outside the apps folder, or a bad slug', () => {
    const items = [
      catalogItem({ slug: 'hub-only', compatibility: { website: { href: '/hub/apps/x/' } } }),
      catalogItem({
        slug: 'elsewhere',
        compatibility: { desktop: { page: 'https://evil.example/' } }
      }),
      catalogItem({ slug: 'Bad Slug' }),
      catalogItem({ slug: 'a-model', type: 'model' })
    ]

    expect(catalogApps({ items }, CLOUD)).toEqual([])
  })

  it('reads Comfy Cloud only when runs_on is missing, and drops unknown places and colors', () => {
    const [app] = catalogApps(
      {
        items: [
          catalogItem({
            compatibility: {
              desktop: {
                page: '/apps/x/desktop.html',
                runs_on: ['moon'],
                accent: ['red', 'url(x)']
              }
            }
          })
        ]
      },
      CLOUD
    )

    expect(app!.runsOn).toEqual(['cloud'])
    expect(app!.accent).toBeNull()
  })

  it('refuses a cover reference that is not a catalog media id', () => {
    const [app] = catalogApps(
      {
        items: [
          catalogItem({ static_thumb: { src: 'media', id: '../../x', file_version_uid: 'y' } })
        ]
      },
      CLOUD
    )

    expect(app!.coverUrl).toBeNull()
  })

  it('sorts by sort order, then title, and keeps the first copy of a slug', () => {
    const items = [
      catalogItem({ slug: 'b', title: 'Bravo', sort_order: 2 }),
      catalogItem({ slug: 'a', title: 'Alpha', sort_order: 2 }),
      catalogItem({ slug: 'z', title: 'Zulu', sort_order: 1 }),
      catalogItem({ slug: 'a', title: 'Alpha again', sort_order: 0 }),
      catalogItem({ slug: 'n', title: 'No order', sort_order: undefined })
    ]

    expect(catalogApps({ items }, CLOUD).map((app) => app.title)).toEqual([
      'Zulu',
      'Alpha',
      'Bravo',
      'No order'
    ])
  })

  it('returns nothing for a body with no items list', () => {
    expect(catalogApps({ generation: 1 }, CLOUD)).toEqual([])
    expect(catalogApps(null, CLOUD)).toEqual([])
  })
})

describe('websiteApps', () => {
  it('maps a website apps.json entry to the same card shape', () => {
    expect(websiteApps([websiteApp()], SITE)).toEqual([
      { ...doodle, runsOn: ['cloud'], coverUrl: `${SITE}/apps/covers/doodle-to-image.jpg` }
    ])
  })

  it('opens a steps app through the website runner', () => {
    const [app] = websiteApps(
      [websiteApp({ id: 'make-image', page: undefined, steps: [{}] })],
      SITE
    )

    expect(app!.page).toBe('/apps/#/make-image')
  })

  it('reads runs_on when the website lists it', () => {
    const [app] = websiteApps([websiteApp({ runs_on: ['local', 'cloud'] })], SITE)

    expect(app!.runsOn).toEqual(['cloud', 'local'])
  })

  it('skips entries with neither a page nor steps, and covers outside the apps folder', () => {
    const apps = websiteApps(
      [
        websiteApp({ id: 'nothing', page: undefined, steps: undefined }),
        websiteApp({ id: 'outside', cover: 'https://evil.example/x.jpg' })
      ],
      SITE
    )

    expect(apps.map((app) => [app.id, app.coverUrl])).toEqual([['outside', null]])
  })

  it('returns nothing for a body that is not a list', () => {
    expect(websiteApps({ apps: [] }, SITE)).toEqual([])
  })
})

describe('loadApps', () => {
  const sources = { catalogOrigin: CLOUD, appsOrigin: SITE }

  afterEach(() => {
    fetchJSON.mockReset()
  })

  function serve(catalog: unknown[] | Error, site: unknown): void {
    const pages = catalog instanceof Error ? catalog : [...catalog]
    fetchJSON.mockImplementation(async (url: string) => {
      if (url.startsWith(`${SITE}/`)) {
        if (site instanceof Error) throw site
        return site
      }
      if (pages instanceof Error) throw pages
      return pages.shift() ?? { items: [] }
    })
  }

  it('asks the catalog for Desktop apps', () => {
    expect(catalogListUrl(CLOUD)).toBe(
      `${CLOUD}/api/v1/catalog/items?type=app&surface=desktop_starters&limit=100`
    )
  })

  it('uses the catalog when it has apps', async () => {
    serve([{ items: [catalogItem()], has_more: false }], [])

    const loaded = await loadApps(sources)

    expect(loaded.source).toBe('catalog')
    expect(loaded.apps.map((app) => app.id)).toEqual(['doodle-to-image'])
  })

  it('takes the page and places from the website list when the catalog item has none', async () => {
    serve(
      [{ items: [catalogItem({ compatibility: { website: { href: '/hub/apps/x/' } } })] }],
      [websiteApp({ runs_on: ['cloud', 'local'] })]
    )

    const loaded = await loadApps(sources)

    expect(loaded.source).toBe('catalog')
    expect(loaded.apps).toHaveLength(1)
    expect(loaded.apps[0]?.page).toBe('/apps/doodle-to-image/desktop.html')
    expect(loaded.apps[0]?.runsOn).toEqual(['cloud', 'local'])
  })

  it('follows the next page of the catalog', async () => {
    serve(
      [
        { items: [catalogItem()], has_more: true, next_cursor: 'c2' },
        { items: [catalogItem({ slug: 'sticker', title: 'Sticker' })] }
      ],
      []
    )

    const loaded = await loadApps(sources)

    expect(fetchJSON).toHaveBeenCalledWith(catalogListUrl(CLOUD, 'c2'))
    expect(loaded.apps.map((app) => app.id)).toEqual(['doodle-to-image', 'sticker'])
  })

  it('falls back to the website apps.json when the catalog has no apps', async () => {
    serve([{ items: [], has_more: false }], [websiteApp()])

    const loaded = await loadApps(sources)

    expect(fetchJSON).toHaveBeenCalledWith(`${SITE}/apps/apps.json`)
    expect(loaded.source).toBe('website')
    expect(loaded.apps.map((app) => app.id)).toEqual(['doodle-to-image'])
  })

  it('falls back to the website apps.json when the catalog cannot be reached', async () => {
    serve(new Error('offline'), [websiteApp()])

    expect((await loadApps(sources)).source).toBe('website')
  })

  it('fails when neither source has apps, so the panel shows Coming soon', async () => {
    serve([{ items: [] }], new Error('offline'))
    await expect(loadApps(sources)).rejects.toThrow()

    serve([{ items: [] }], [])
    await expect(loadApps(sources)).rejects.toThrow()
  })

  it('fails without asking the website when no apps address is set', async () => {
    serve([{ items: [] }], [])

    await expect(loadApps({ catalogOrigin: CLOUD, appsOrigin: null })).rejects.toThrow()
    expect(fetchJSON).toHaveBeenCalledOnce()
  })
})

describe('appCover', () => {
  function image(type: string, bytes = [1, 2, 3]): Response {
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': type } })
  }

  it('hands the panel a listed cover as a data address and keeps the address out of the card', async () => {
    const listing = toListing({ source: 'website', apps: websiteApps([websiteApp()], SITE) })
    netFetch.mockResolvedValueOnce(image('image/jpeg'))

    expect(listing.apps[0]).toMatchObject({ id: 'doodle-to-image', hasCover: true })
    expect(listing.apps[0]).not.toHaveProperty('coverUrl')
    expect(await appCover('doodle-to-image')).toBe('data:image/jpeg;base64,AQID')
    expect(netFetch).toHaveBeenCalledWith(`${SITE}/apps/covers/doodle-to-image.jpg`)
  })

  it('reads each cover once', async () => {
    toListing({ source: 'website', apps: websiteApps([websiteApp()], SITE) })
    netFetch.mockResolvedValueOnce(image('image/jpeg'))

    await appCover('doodle-to-image')
    await appCover('doodle-to-image')

    expect(netFetch).toHaveBeenCalledOnce()
  })

  it('fetches nothing for an app that was not listed', async () => {
    expect(await appCover('https://evil.example/x.jpg')).toBeNull()
    expect(await appCover(42)).toBeNull()
    expect(netFetch).not.toHaveBeenCalled()
  })

  it('returns no cover for a file that is not an image, and tries again next time', async () => {
    toListing({ source: 'website', apps: websiteApps([websiteApp()], SITE) })
    netFetch.mockResolvedValueOnce(image('text/html')).mockResolvedValueOnce(image('image/jpeg'))

    expect(await appCover('doodle-to-image')).toBeNull()
    expect(await appCover('doodle-to-image')).toBe('data:image/jpeg;base64,AQID')
  })
})
