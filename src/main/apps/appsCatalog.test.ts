import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/fetch', () => ({ fetchJSON: vi.fn() }))
vi.mock('./appsConfig', () => ({
  currentAppsLocation: () => ({
    url: 'https://comfy.org/apps/',
    origin: 'https://comfy.org',
    scopePath: '/apps/'
  })
}))

import { fetchJSON } from '../lib/fetch'
import { _resetAppsCatalogForTest, listApps, pageUrlForListedApp } from './appsCatalog'

const mockedFetchJSON = vi.mocked(fetchJSON)

function websiteApp(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'remove-background',
    page: '/apps/remove-background/desktop.html',
    title: 'Remove Background',
    blurb: 'Cut the subject out of a picture or video.',
    cover: '/catalog-media/cover-1/v2',
    order: 3,
    examples: [],
    source: 'catalog',
    ...over
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetAppsCatalogForTest()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the apps Desktop lists', () => {
  it("come from the website's own list, in its order, with each cover on the site", async () => {
    mockedFetchJSON.mockResolvedValue([
      websiteApp(),
      websiteApp({ id: 'sdr-to-hdr', page: '/apps/sdr-to-hdr/desktop.html', title: 'SDR to HDR' })
    ])

    expect(await listApps()).toEqual([
      {
        id: 'remove-background',
        title: 'Remove Background',
        description: 'Cut the subject out of a picture or video.',
        coverUrl: 'https://comfy.org/catalog-media/cover-1/v2'
      },
      {
        id: 'sdr-to-hdr',
        title: 'SDR to HDR',
        description: 'Cut the subject out of a picture or video.',
        coverUrl: 'https://comfy.org/catalog-media/cover-1/v2'
      }
    ])
    expect(mockedFetchJSON).toHaveBeenCalledWith('https://comfy.org/apps/apps.json', {
      refresh: true
    })
  })

  it("open at the page the website names, or at the list's own route for an app it draws itself", async () => {
    mockedFetchJSON.mockResolvedValue([
      websiteApp(),
      websiteApp({ id: 'upscale', page: undefined, title: 'Upscale 4x' })
    ])
    await listApps()

    expect(pageUrlForListedApp('remove-background')).toBe(
      'https://comfy.org/apps/remove-background/desktop.html'
    )
    expect(pageUrlForListedApp('upscale')).toBe('https://comfy.org/apps/#/upscale')
    expect(pageUrlForListedApp('never-listed')).toBeNull()
  })

  it('show a card without a picture when the cover is missing or on another site', async () => {
    mockedFetchJSON.mockResolvedValue([
      websiteApp({ id: 'no-cover', cover: undefined }),
      websiteApp({ id: 'foreign-cover', cover: 'https://tracker.example/pixel.png' }),
      websiteApp({ id: 'no-blurb', blurb: 7 })
    ])

    expect(await listApps()).toEqual([
      expect.objectContaining({ id: 'no-cover', coverUrl: null }),
      expect.objectContaining({ id: 'foreign-cover', coverUrl: null }),
      expect.objectContaining({ id: 'no-blurb', description: '' })
    ])
  })

  it.each([
    ['has no title', websiteApp({ title: '   ' })],
    ['has an id that is not a slug', websiteApp({ id: '../login' })],
    ['has no id', websiteApp({ id: undefined })],
    ['opens a page outside the apps site', websiteApp({ page: 'https://evil.example/apps/x' })],
    ['opens the rest of comfy.org', websiteApp({ page: '/login/' })],
    ['opens the list itself', websiteApp({ page: '/apps/' })],
    ['names a page that is not an address', websiteApp({ page: 42 })],
    ['is not an object', 'remove-background']
  ])('leave out an entry that %s', async (_why, entry) => {
    mockedFetchJSON.mockResolvedValue([entry, websiteApp({ id: 'kept', title: 'Kept' })])

    expect((await listApps()).map((app) => app.id)).toEqual(['kept'])
  })

  it('keep the first of two entries with the same id', async () => {
    mockedFetchJSON.mockResolvedValue([
      websiteApp({ title: 'First' }),
      websiteApp({ title: 'Second' })
    ])

    expect((await listApps()).map((app) => app.title)).toEqual(['First'])
  })

  it('are asked for once while a request is in flight, and again only after five minutes', async () => {
    vi.useFakeTimers()
    mockedFetchJSON.mockResolvedValue([websiteApp()])

    await Promise.all([listApps(), listApps()])
    await listApps()
    expect(mockedFetchJSON).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    await listApps()
    expect(mockedFetchJSON).toHaveBeenCalledTimes(2)
  })

  it('stay as last seen when the website cannot be reached later', async () => {
    vi.useFakeTimers()
    mockedFetchJSON.mockResolvedValueOnce([websiteApp()])
    await listApps()
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    mockedFetchJSON.mockRejectedValueOnce(new Error('offline'))

    expect((await listApps()).map((app) => app.id)).toEqual(['remove-background'])
    expect(pageUrlForListedApp('remove-background')).not.toBeNull()
  })

  it('fail to load when the website has never answered', async () => {
    mockedFetchJSON.mockRejectedValue(new Error('offline'))

    await expect(listApps()).rejects.toThrow('offline')
  })

  it('fail to load when the website answers with something that is not a list', async () => {
    mockedFetchJSON.mockResolvedValue({ apps: [] })

    await expect(listApps()).rejects.toThrow('not a list')
  })

  it('fail to load when the website takes longer than eight seconds', async () => {
    vi.useFakeTimers()
    mockedFetchJSON.mockReturnValue(new Promise(() => {}))
    const pending = listApps()
    const outcome = expect(pending).rejects.toThrow('timed out')

    await vi.advanceTimersByTimeAsync(8000)

    await outcome
  })
})
