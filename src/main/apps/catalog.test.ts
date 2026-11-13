import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { catalogUrl, listCatalogApps, toCatalogApp } from './catalog'

const LIST = 'https://apps.example/apps/'
const fetchMock = vi.fn()

function item(uid: string, data: Record<string, unknown>) {
  return { uid, data }
}

function catalogApp(slug: string, title: string, order: number) {
  return item(`uid-${slug}`, {
    title,
    slug,
    description: `${title} description`,
    sort_order: order,
    website_media: { '$.static_thumb': `/catalog-media/${slug}/v1` }
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

  it('reads the production catalog even when Desktop runs against another Cloud', async () => {
    vi.stubEnv('COMFY_CLOUD_ISSUER', 'https://stagingcloud.comfy.org')
    vi.resetModules()
    const { catalogUrl: stagingCatalogUrl } = await import('./catalog')
    expect(new URL(stagingCatalogUrl()).origin).toBe('https://cloud.comfy.org')
    vi.unstubAllEnvs()
  })
})

describe('toCatalogApp', () => {
  it('takes the title, description and thumbnail, and opens the app on its slug route', () => {
    expect(toCatalogApp(catalogApp('text-to-image', 'Text to Image', 2), LIST)).toEqual({
      id: 'uid-text-to-image',
      title: 'Text to Image',
      description: 'Text to Image description',
      thumbnailUrl: 'https://comfy.org/catalog-media/text-to-image/v1',
      url: 'https://apps.example/apps/#/text-to-image'
    })
  })

  it('keeps an odd slug inside the route', () => {
    const app = toCatalogApp(item('a', { title: 'A', slug: 'a b/../c' }), LIST)
    expect(app?.url).toBe('https://apps.example/apps/#/a%20b%2F..%2Fc')
    expect(app?.description).toBe('')
    expect(app?.thumbnailUrl).toBeNull()
  })

  it('falls back to the hero poster and ignores media outside the catalog', () => {
    const poster = item('a', {
      title: 'A',
      slug: 'a',
      website_media: { '$.hero_poster': '/catalog-media/a/poster' }
    })
    const outside = item('b', {
      title: 'B',
      slug: 'b',
      website_media: { '$.static_thumb': 'https://evil.example/x.png' }
    })
    expect(toCatalogApp(poster, LIST)?.thumbnailUrl).toBe(
      'https://comfy.org/catalog-media/a/poster'
    )
    expect(toCatalogApp(outside, LIST)?.thumbnailUrl).toBeNull()
  })

  it('ignores media that climbs out of the catalog folder', () => {
    const climbing = item('a', {
      title: 'A',
      slug: 'a',
      website_media: {
        '$.static_thumb': '/catalog-media/../account/delete',
        '$.hero_poster': '/catalog-media/a/poster'
      }
    })
    expect(toCatalogApp(climbing, LIST)?.thumbnailUrl).toBe(
      'https://comfy.org/catalog-media/a/poster'
    )
  })

  it('skips an app without a title or a slug', () => {
    expect(toCatalogApp(item('a', { slug: 'a' }), LIST)).toBeNull()
    expect(toCatalogApp(item('b', { title: 'No slug' }), LIST)).toBeNull()
    expect(toCatalogApp(item('c', { title: 'Blank slug', slug: ' ' }), LIST)).toBeNull()
  })
})

describe('listCatalogApps', () => {
  it('lists the apps in catalog order and leaves out ones it cannot open', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        items: [
          catalogApp('product-ads', 'Second', 1),
          item('x', { title: 'No slug' }),
          catalogApp('genjutsu', 'First', 0)
        ]
      })
    )
    const apps = await listCatalogApps(LIST)
    expect(apps.map((app) => app.title)).toEqual(['First', 'Second'])
  })

  it('skips entries that are not objects and lists each app once', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        items: [
          null,
          'genjutsu',
          catalogApp('genjutsu', 'First', 0),
          catalogApp('genjutsu', 'Again', 1)
        ]
      })
    )
    const apps = await listCatalogApps(LIST)
    expect(apps.map((app) => app.title)).toEqual(['First'])
  })

  it('keeps an empty catalog empty', async () => {
    fetchMock.mockResolvedValue(Response.json({ items: [] }))
    await expect(listCatalogApps(LIST)).resolves.toEqual([])
  })

  it('fails when the catalog answers without an item list', async () => {
    fetchMock.mockResolvedValue(Response.json({ items: null }))
    await expect(listCatalogApps(LIST)).rejects.toThrow('no item list')
    fetchMock.mockResolvedValue(Response.json(null))
    await expect(listCatalogApps(LIST)).rejects.toThrow('no item list')
  })

  it('fails when the catalog does not answer', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }))
    await expect(listCatalogApps(LIST)).rejects.toThrow('HTTP 503')
  })
})
