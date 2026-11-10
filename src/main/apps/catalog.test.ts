import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

const { catalogUrl, listCatalogApps, toCatalogApp } = await import('./catalog')

const LIST = 'https://apps.example/apps/'
const fetchMock = vi.fn()

function item(uid: string, data: Record<string, unknown>) {
  return { uid, data }
}

function pageApp(uid: string, title: string, order: number) {
  return item(uid, {
    title,
    description: `${title} description`,
    sort_order: order,
    compatibility: { desktop: { page: `/apps/${uid}/desktop.html` } },
    website_media: { '$.static_thumb': `/catalog-media/${uid}/v1` }
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('catalogUrl', () => {
  it('asks the Cloud catalog for the apps of the Desktop surface', () => {
    const url = new URL(catalogUrl())
    expect(url.origin + url.pathname).toBe('https://cloud.comfy.org/api/v1/catalog/items')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      type: 'app',
      surface: 'desktop_starters',
      limit: '100'
    })
  })
})

describe('toCatalogApp', () => {
  it('takes the title, description, thumbnail and Desktop page of an app', () => {
    expect(toCatalogApp(pageApp('studio', 'Cinematic Studio', 2), LIST)).toEqual({
      id: 'studio',
      title: 'Cinematic Studio',
      description: 'Cinematic Studio description',
      thumbnailUrl: 'https://comfy.org/catalog-media/studio/v1',
      url: 'https://apps.example/apps/studio/desktop.html'
    })
  })

  it('opens a steps app on its route of the apps list', () => {
    const app = toCatalogApp(
      item('make image', { title: 'Make an image', implementation_ref: 'steps' }),
      LIST
    )
    expect(app?.url).toBe('https://apps.example/apps/#/make%20image')
    expect(app?.description).toBe('')
    expect(app?.thumbnailUrl).toBeNull()
  })

  it('falls back to the hero poster and ignores media outside the catalog', () => {
    const poster = item('a', {
      title: 'A',
      implementation_ref: 'steps',
      website_media: { '$.hero_poster': '/catalog-media/a/poster' }
    })
    const outside = item('b', {
      title: 'B',
      implementation_ref: 'steps',
      website_media: { '$.static_thumb': 'https://evil.example/x.png' }
    })
    expect(toCatalogApp(poster, LIST)?.thumbnailUrl).toBe(
      'https://comfy.org/catalog-media/a/poster'
    )
    expect(toCatalogApp(outside, LIST)?.thumbnailUrl).toBeNull()
  })

  it('skips an app without a title or a page Desktop can open', () => {
    expect(toCatalogApp(item('a', { implementation_ref: 'steps' }), LIST)).toBeNull()
    expect(
      toCatalogApp(item('b', { title: 'Hub only', implementation_ref: 'studio' }), LIST)
    ).toBeNull()
    expect(
      toCatalogApp(
        item('c', {
          title: 'Elsewhere',
          compatibility: { desktop: { page: 'https://evil.example/app' } }
        }),
        LIST
      )
    ).toBeNull()
  })
})

describe('listCatalogApps', () => {
  it('lists the apps Desktop can open in catalog order', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        items: [
          pageApp('b', 'Second', 1),
          item('x', { title: 'Hub only' }),
          pageApp('a', 'First', 0)
        ]
      })
    )
    const apps = await listCatalogApps(LIST)
    expect(apps.map((app) => app.title)).toEqual(['First', 'Second'])
  })

  it('fails when the catalog does not answer', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }))
    await expect(listCatalogApps(LIST)).rejects.toThrow('HTTP 503')
  })
})
