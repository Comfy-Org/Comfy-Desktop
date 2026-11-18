import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/user-data' } }))
vi.mock('../lib/fetch', () => ({ fetchJSON: vi.fn() }))
vi.mock('../lib/safe-file', () => ({ readFileSafeAsync: vi.fn(), writeFileSafeAsync: vi.fn() }))
vi.mock('./appsConfig', () => ({
  currentAppsLocation: () => ({
    url: 'https://comfy.org/apps/',
    origin: 'https://comfy.org',
    scopePath: '/apps/'
  })
}))

import { fetchJSON } from '../lib/fetch'
import { readFileSafeAsync, writeFileSafeAsync } from '../lib/safe-file'
import { _resetAppsCatalogForTest, listApps, pageUrlForListedApp } from './appsCatalog'

const mockedFetchJSON = vi.mocked(fetchJSON)
const mockedReadSaved = vi.mocked(readFileSafeAsync)
const mockedWriteSaved = vi.mocked(writeFileSafeAsync)

const LIST_URL = 'https://comfy.org/apps/apps.json'
const SAVED_PATH = path.join('/user-data', 'apps-catalog.json')
const ALL_TRIES_MS = 1000 + 3000

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

function savedOnDisk(listUrl: string, apps: unknown[]): void {
  mockedReadSaved.mockResolvedValue({ kind: 'data', data: JSON.stringify({ listUrl, apps }) })
}

async function afterAllTries<T>(pending: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(ALL_TRIES_MS)
  return pending
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedFetchJSON.mockReset()
  mockedReadSaved.mockReset().mockResolvedValue({ kind: 'absent' })
  mockedWriteSaved.mockReset().mockResolvedValue(undefined)
  _resetAppsCatalogForTest()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
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
        covers: [{ url: 'https://comfy.org/catalog-media/cover-1/v2', stillUrl: null }]
      },
      {
        id: 'sdr-to-hdr',
        title: 'SDR to HDR',
        description: 'Cut the subject out of a picture or video.',
        covers: [{ url: 'https://comfy.org/catalog-media/cover-1/v2', stillUrl: null }]
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
      expect.objectContaining({ id: 'no-cover', covers: [] }),
      expect.objectContaining({ id: 'foreign-cover', covers: [] }),
      expect.objectContaining({ id: 'no-blurb', description: '' })
    ])
  })

  it("carry every cover the website rotates through, each with its still, in the website's order", async () => {
    mockedFetchJSON.mockResolvedValue([
      websiteApp({
        cover: '/catalog-media/skate/v1',
        still: '/catalog-media/skate-still/v1',
        covers: [
          { cover: '/catalog-media/hero/v1', still: '/catalog-media/hero-still/v1' },
          {
            cover: '/catalog-media/skate/v1',
            still: '/catalog-media/skate-still/v1',
            example: 'skate'
          },
          { cover: '/catalog-media/dance/v1' }
        ]
      })
    ])

    expect((await listApps())[0]?.covers).toEqual([
      {
        url: 'https://comfy.org/catalog-media/hero/v1',
        stillUrl: 'https://comfy.org/catalog-media/hero-still/v1'
      },
      {
        url: 'https://comfy.org/catalog-media/skate/v1',
        stillUrl: 'https://comfy.org/catalog-media/skate-still/v1'
      },
      { url: 'https://comfy.org/catalog-media/dance/v1', stillUrl: null }
    ])
  })

  it('fall back to the one cover and still when the website lists no covers it can show', async () => {
    mockedFetchJSON.mockResolvedValue([
      websiteApp({ id: 'older-site', still: '/catalog-media/still-1/v2' }),
      websiteApp({
        id: 'nothing-usable',
        covers: [null, 'cover', { cover: 'https://tracker.example/pixel.png' }, { cover: 7 }]
      })
    ])
    const own = {
      url: 'https://comfy.org/catalog-media/cover-1/v2',
      stillUrl: 'https://comfy.org/catalog-media/still-1/v2'
    }

    expect((await listApps()).map((app) => app.covers)).toEqual([
      [own],
      [{ url: own.url, stillUrl: null }]
    ])
  })

  it('leave out covers on another site and repeats, and stop at 24 covers', async () => {
    const many = Array.from({ length: 30 }, (_none, at) => ({ cover: `/catalog-media/c${at}/v1` }))
    mockedFetchJSON.mockResolvedValue([
      websiteApp({
        covers: [
          { cover: '/catalog-media/a/v1', still: 'https://tracker.example/still.png' },
          { cover: 'https://tracker.example/pixel.png' },
          { cover: '/catalog-media/a/v1' },
          { cover: '/catalog-media/b/v1' }
        ]
      }),
      websiteApp({ id: 'many', covers: many })
    ])

    const [app, crowded] = await listApps()
    expect(app?.covers).toEqual([
      { url: 'https://comfy.org/catalog-media/a/v1', stillUrl: null },
      { url: 'https://comfy.org/catalog-media/b/v1', stillUrl: null }
    ])
    expect(crowded?.covers).toHaveLength(24)
    expect(crowded?.covers[23]?.url).toBe('https://comfy.org/catalog-media/c23/v1')
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
    mockedFetchJSON.mockRejectedValue(new Error('offline'))

    expect((await afterAllTries(listApps())).map((app) => app.id)).toEqual(['remove-background'])
    expect(pageUrlForListedApp('remove-background')).not.toBeNull()
  })

  it('fail to load when the website has never answered and nothing is saved', async () => {
    vi.useFakeTimers()
    mockedFetchJSON.mockRejectedValue(new Error('offline'))
    const pending = listApps()
    const outcome = expect(pending).rejects.toThrow('offline')

    await vi.advanceTimersByTimeAsync(ALL_TRIES_MS)

    await outcome
    expect(mockedFetchJSON).toHaveBeenCalledTimes(3)
  })

  it('fail to load when the website answers with something that is not a list', async () => {
    vi.useFakeTimers()
    mockedFetchJSON.mockResolvedValue({ apps: [] })
    const pending = listApps()
    const outcome = expect(pending).rejects.toThrow('not a list')

    await vi.advanceTimersByTimeAsync(ALL_TRIES_MS)

    await outcome
    expect(mockedFetchJSON).toHaveBeenCalledTimes(3)
  })

  it('fail to load when every try takes longer than eight seconds', async () => {
    vi.useFakeTimers()
    mockedFetchJSON.mockReturnValue(new Promise(() => {}))
    const pending = listApps()
    const outcome = expect(pending).rejects.toThrow('timed out')

    await vi.advanceTimersByTimeAsync(3 * 8000 + ALL_TRIES_MS)

    await outcome
    expect(mockedFetchJSON).toHaveBeenCalledTimes(3)
  })

  it('are asked for again after a failed try, waiting one second and then three', async () => {
    vi.useFakeTimers()
    mockedFetchJSON
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([websiteApp()])
    const pending = listApps()

    await vi.advanceTimersByTimeAsync(999)
    expect(mockedFetchJSON).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mockedFetchJSON).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2999)
    expect(mockedFetchJSON).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)

    expect((await pending).map((app) => app.id)).toEqual(['remove-background'])
    expect(mockedFetchJSON).toHaveBeenCalledTimes(3)
  })

  it('are saved after a good load, with the list they came from', async () => {
    mockedFetchJSON.mockResolvedValue([websiteApp()])

    await listApps()

    expect(mockedWriteSaved).toHaveBeenCalledTimes(1)
    const [savedPath, contents] = mockedWriteSaved.mock.calls[0] ?? []
    expect(savedPath).toBe(SAVED_PATH)
    expect(JSON.parse(String(contents))).toEqual({ listUrl: LIST_URL, apps: [websiteApp()] })
  })

  it('still load when they cannot be saved', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockedWriteSaved.mockRejectedValue(new Error('disk full'))
    mockedFetchJSON.mockResolvedValue([websiteApp()])

    expect((await listApps()).map((app) => app.id)).toEqual(['remove-background'])
  })

  it('come from the saved list when the website cannot be reached on a fresh start', async () => {
    vi.useFakeTimers()
    savedOnDisk(LIST_URL, [websiteApp()])
    mockedFetchJSON.mockRejectedValue(new Error('offline'))

    expect((await afterAllTries(listApps())).map((app) => app.id)).toEqual(['remove-background'])
    expect(pageUrlForListedApp('remove-background')).toBe(
      'https://comfy.org/apps/remove-background/desktop.html'
    )
    expect(mockedReadSaved).toHaveBeenCalledWith(SAVED_PATH)

    mockedFetchJSON.mockResolvedValue([websiteApp({ id: 'fresh', title: 'Fresh' })])
    expect((await listApps()).map((app) => app.id)).toEqual(['fresh'])
  })

  it('ignore a list saved from another apps site', async () => {
    vi.useFakeTimers()
    savedOnDisk('https://staging.comfy.org/apps/apps.json', [websiteApp()])
    mockedFetchJSON.mockRejectedValue(new Error('offline'))
    const pending = listApps()
    const outcome = expect(pending).rejects.toThrow('offline')

    await vi.advanceTimersByTimeAsync(ALL_TRIES_MS)

    await outcome
  })

  it.each([
    ['is not JSON', { kind: 'data', data: '{' }],
    ['has no list', { kind: 'data', data: JSON.stringify({ listUrl: LIST_URL }) }],
    ['cannot be read', { kind: 'unreadable' }]
  ] as const)('fail to load when the saved list %s', async (_why, outcome) => {
    vi.useFakeTimers()
    mockedReadSaved.mockResolvedValue(outcome)
    mockedFetchJSON.mockRejectedValue(new Error('offline'))
    const pending = listApps()
    const rejected = expect(pending).rejects.toThrow('offline')

    await vi.advanceTimersByTimeAsync(ALL_TRIES_MS)

    await rejected
  })

  it('keep the last good list when the website later answers with an empty one', async () => {
    vi.useFakeTimers()
    mockedFetchJSON.mockResolvedValueOnce([websiteApp()])
    await listApps()
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    mockedFetchJSON.mockResolvedValue([])

    expect((await afterAllTries(listApps())).map((app) => app.id)).toEqual(['remove-background'])
    expect(mockedFetchJSON).toHaveBeenCalledTimes(4)
  })

  it('keep the saved list when the website answers with an empty one on a fresh start', async () => {
    vi.useFakeTimers()
    savedOnDisk(LIST_URL, [websiteApp()])
    mockedFetchJSON.mockResolvedValue([websiteApp({ id: '../bad' })])

    expect((await afterAllTries(listApps())).map((app) => app.id)).toEqual(['remove-background'])
    expect(mockedFetchJSON).toHaveBeenCalledTimes(3)
    expect(mockedWriteSaved).not.toHaveBeenCalled()
  })

  it('show a real empty list, asking again after thirty seconds', async () => {
    vi.useFakeTimers()
    mockedFetchJSON.mockResolvedValue([])

    expect(await listApps()).toEqual([])
    vi.advanceTimersByTime(30 * 1000 - 1)
    await listApps()
    expect(mockedFetchJSON).toHaveBeenCalledTimes(1)
    expect(mockedWriteSaved).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    await listApps()
    expect(mockedFetchJSON).toHaveBeenCalledTimes(2)
  })
})
