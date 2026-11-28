import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  online: true,
  fetchStill: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
}))
const install = vi.hoisted(() => ({ id: null as string | null }))

vi.mock('electron', () => ({
  app: { getPath: () => '/user-data' },
  net: { isOnline: () => electron.online },
  session: { defaultSession: { fetch: electron.fetchStill } }
}))
vi.mock('../lib/deviceId', () => ({ savedInstallationId: () => install.id }))
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
import {
  _resetAppsCatalogForTest,
  listApps,
  pageTestGroupForListedApp,
  pageUrlForListedApp,
  pictureForListedApp,
  savedListBody
} from './appsCatalog'

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

const CROWN = {
  id: 'uses-credits',
  style: 'crown',
  text: { en: 'Uses credits', 'zh-CN': '使用积分' },
  description: {
    en: 'Runs a paid partner model on Comfy Cloud',
    'zh-CN': '在 Comfy Cloud 上运行付费合作模型'
  }
}
const NEW_CHIP = { id: 'new', style: 'chip', text: { en: 'New' } }

function badge(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...NEW_CHIP, ...over }
}

async function badgesListed(badges: unknown) {
  mockedFetchJSON.mockResolvedValue([websiteApp({ badges })])
  return (await listApps())[0]?.badges
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
  electron.online = true
  electron.fetchStill.mockReset().mockRejectedValue(new Error('offline'))
  install.id = null
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
      websiteApp({ id: 'sdr-to-hdr', page: '/apps/sdr-to-hdr/desktop.html', title: 'SDR to HDR' }),
      websiteApp({
        id: 'product-swap',
        page: '/apps/product-swap/desktop.html',
        title: 'Product Swap',
        badges: [CROWN]
      })
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
      },
      {
        id: 'product-swap',
        title: 'Product Swap',
        description: 'Cut the subject out of a picture or video.',
        covers: [{ url: 'https://comfy.org/catalog-media/cover-1/v2', stillUrl: null }],
        badges: [CROWN]
      }
    ])
    expect(mockedFetchJSON).toHaveBeenCalledWith('https://comfy.org/apps/apps.json', {
      refresh: true
    })
  })

  it('play the cover of an app the website set to always play, and leave every other app to play on hover', async () => {
    mockedFetchJSON.mockResolvedValue([
      websiteApp({ id: 'genjutsu', cover_playback: 'always' }),
      websiteApp({ id: 'sdr-to-hdr', cover_playback: 'hover' }),
      websiteApp({ id: 'product-swap', cover_playback: 'Always' }),
      websiteApp({ id: 'product-ads', cover_playback: true }),
      websiteApp({ id: 'extend-picture' })
    ])

    const [always, hover, capitalised, notText, unset] = await listApps()

    expect(always?.coverPlayback).toBe('always')
    for (const app of [hover, capitalised, notText, unset]) {
      expect(app).not.toHaveProperty('coverPlayback')
    }
  })

  it('carry the badges the website set, in its order, with only the English and Chinese words', async () => {
    const badges = await badgesListed([
      { ...CROWN, text: { ...CROWN.text, ja: 'クレジット' }, tone: 'gold' },
      badge({ id: 'video', style: 'label', text: { en: ' Video ' } })
    ])

    expect(badges).toEqual([CROWN, { id: 'video', style: 'label', text: { en: 'Video' } }])
  })

  it('leave an app without badges when the website set none, and with an empty list when it set an empty one', async () => {
    mockedFetchJSON.mockResolvedValue([
      websiteApp(),
      websiteApp({ id: 'sdr-to-hdr', badges: 'crown' }),
      websiteApp({ id: 'extend-picture', badges: [] })
    ])

    const [unset, notAList, none] = await listApps()

    expect(unset).not.toHaveProperty('badges')
    expect(notAList).not.toHaveProperty('badges')
    expect(none?.badges).toEqual([])
  })

  it.each([
    ['no English text', badge({ text: { 'zh-CN': '新' } })],
    ['English text that is blank', badge({ text: { en: '   ' } })],
    ['English text over 24 characters', badge({ text: { en: 'x'.repeat(25) } })],
    ['text that is not an object', badge({ text: 'New' })],
    ['a style Desktop does not draw', badge({ style: 'ribbon' })],
    ['no style', badge({ style: undefined })],
    ['no id', badge({ id: undefined })],
    ['an id with a space', badge({ id: 'new badge' })],
    ['an entry that is not an object', 'new']
  ])('drop a badge with %s', async (_case, dropped) => {
    expect(await badgesListed([dropped, CROWN])).toEqual([CROWN])
  })

  it('keep the first of two badges with the same id', async () => {
    const badges = await badgesListed([badge(), badge({ style: 'label', text: { en: 'Fresh' } })])

    expect(badges).toEqual([NEW_CHIP])
  })

  it('keep at most four badges, counting only the ones they keep', async () => {
    const badges = await badgesListed([
      badge({ id: 'one' }),
      badge({ id: 'bad', style: 'ribbon' }),
      badge({ id: 'two' }),
      badge({ id: 'three' }),
      badge({ id: 'four' }),
      badge({ id: 'five' })
    ])

    expect(badges?.map((kept) => kept.id)).toEqual(['one', 'two', 'three', 'four'])
  })

  it('keep the English words when the Chinese ones are missing, blank or too long', async () => {
    const badges = await badgesListed([
      badge({ id: 'one', text: { en: 'New', 'zh-CN': '' } }),
      badge({ id: 'two', text: { en: 'New', 'zh-CN': '新'.repeat(25) } }),
      badge({ id: 'three', text: { en: 'New', 'zh-CN': 7 } })
    ])

    expect(badges?.map((kept) => kept.text)).toEqual([{ en: 'New' }, { en: 'New' }, { en: 'New' }])
  })

  it('keep a badge without its description when the description has no English or runs over 160 characters', async () => {
    const badges = await badgesListed([
      badge({ id: 'one', description: { 'zh-CN': '新应用' } }),
      badge({ id: 'two', description: { en: 'x'.repeat(161) } }),
      badge({ id: 'three', description: 'Just added' }),
      badge({ id: 'four', description: { en: 'x'.repeat(160) } })
    ])

    expect(badges).toEqual([
      { ...NEW_CHIP, id: 'one' },
      { ...NEW_CHIP, id: 'two' },
      { ...NEW_CHIP, id: 'three' },
      { ...NEW_CHIP, id: 'four', description: { en: 'x'.repeat(160) } }
    ])
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

  it("give the still picture of a listed app for the title bar menu, and none for an app it can't show", async () => {
    mockedFetchJSON.mockResolvedValue([
      websiteApp({ still: '/catalog-media/still-1/v2' }),
      websiteApp({ id: 'no-cover', cover: undefined })
    ])
    await listApps()

    expect(pictureForListedApp('remove-background')).toBe(
      'https://comfy.org/catalog-media/still-1/v2'
    )
    expect(pictureForListedApp('no-cover')).toBeNull()
    expect(pictureForListedApp('never-listed')).toBeNull()
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

  it('leave out blank covers and stills instead of reading them as the apps page', async () => {
    mockedFetchJSON.mockResolvedValue([
      websiteApp({
        covers: [{ cover: '' }, { cover: '  ', still: '/catalog-media/s/v1' }],
        still: ' '
      }),
      websiteApp({ id: 'blank-still', covers: [{ cover: '/catalog-media/a/v1', still: '' }] })
    ])

    expect((await listApps()).map((app) => app.covers)).toEqual([
      [{ url: 'https://comfy.org/catalog-media/cover-1/v2', stillUrl: null }],
      [{ url: 'https://comfy.org/catalog-media/a/v1', stillUrl: null }]
    ])
  })

  it('count the 24 covers after leaving out repeats', async () => {
    const repeats = Array.from({ length: 24 }, () => ({ cover: '/catalog-media/a/v1' }))
    mockedFetchJSON.mockResolvedValue([
      websiteApp({ covers: [...repeats, { cover: '/catalog-media/b/v1' }] })
    ])

    expect((await listApps())[0]?.covers.map((cover) => cover.url)).toEqual([
      'https://comfy.org/catalog-media/a/v1',
      'https://comfy.org/catalog-media/b/v1'
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

  it('come from the saved list, badges checked again, when the website cannot be reached on a fresh start', async () => {
    vi.useFakeTimers()
    savedOnDisk(LIST_URL, [websiteApp({ badges: [CROWN, badge({ style: 'ribbon' })] })])
    mockedFetchJSON.mockRejectedValue(new Error('offline'))

    const saved = await afterAllTries(listApps())
    expect(saved.map((app) => [app.id, app.badges])).toEqual([['remove-background', [CROWN]]])
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

describe('the apps Desktop lists with no internet', () => {
  const STILL_BYTES = new Uint8Array([1, 2, 3])
  const MEGABYTE = 1024 * 1024

  function oversizedStill(): { response: Response; cancelled: () => boolean } {
    let sent = 0
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 5) controller.enqueue(new Uint8Array(MEGABYTE))
        else controller.close()
      },
      cancel() {
        cancelled = true
      }
    })
    return {
      response: new Response(body, { headers: { 'content-type': 'image/webp' } }),
      cancelled: () => cancelled
    }
  }

  function appWithStill(n: number): Record<string, unknown> {
    return websiteApp({
      id: `app-${n}`,
      page: `/apps/app-${n}/desktop.html`,
      still: `/catalog-media/still-${n}/v1`
    })
  }

  function savedWithStills(): void {
    savedOnDisk(LIST_URL, [
      websiteApp({
        covers: [
          { cover: '/catalog-media/hero/v1', still: '/catalog-media/hero-still/v1' },
          { cover: '/catalog-media/skate/v1', still: '/catalog-media/skate-still/v1' }
        ]
      })
    ])
  }

  function keptStill(url: string): Promise<Response> {
    if (url === 'https://comfy.org/catalog-media/hero-still/v1') {
      return Promise.resolve(
        new Response(STILL_BYTES, { headers: { 'content-type': 'image/webp' } })
      )
    }
    return Promise.reject(new Error('offline'))
  }

  it('show the first still Desktop kept as both the picture and the still, so an idle card shows it', async () => {
    electron.online = false
    savedWithStills()
    electron.fetchStill.mockImplementation(keptStill)
    mockedFetchJSON.mockRejectedValue(new Error('offline'))

    expect((await listApps())[0]?.covers).toEqual([
      { url: 'data:image/webp;base64,AQID', stillUrl: 'data:image/webp;base64,AQID' }
    ])
    expect(electron.fetchStill).toHaveBeenCalledWith(
      'https://comfy.org/catalog-media/hero-still/v1',
      { cache: 'force-cache', signal: expect.any(AbortSignal) }
    )
  })

  it('show a kept still for a later app after six earlier stills hang until their two seconds run out', async () => {
    vi.useFakeTimers()
    electron.online = false
    savedOnDisk(
      LIST_URL,
      Array.from({ length: 7 }, (_, n) => appWithStill(n))
    )
    electron.fetchStill.mockImplementation((url, init) => {
      const signal = init?.signal
      if (signal?.aborted) return Promise.reject(signal.reason)
      if (url === 'https://comfy.org/catalog-media/still-6/v1') {
        return Promise.resolve(
          new Response(STILL_BYTES, { headers: { 'content-type': 'image/webp' } })
        )
      }
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason))
      })
    })
    mockedFetchJSON.mockRejectedValue(new Error('offline'))

    const pending = listApps()
    await vi.advanceTimersByTimeAsync(2000)
    const apps = await pending

    expect(electron.fetchStill).toHaveBeenCalledTimes(7)
    expect(apps.find((app) => app.id === 'app-6')?.covers).toEqual([
      { url: 'data:image/webp;base64,AQID', stillUrl: 'data:image/webp;base64,AQID' }
    ])
  })

  it('list every app within five seconds when the kept stills all hang', async () => {
    vi.useFakeTimers()
    electron.online = false
    savedOnDisk(
      LIST_URL,
      Array.from({ length: 30 }, (_, n) => appWithStill(n))
    )
    electron.fetchStill.mockImplementation((_url, init) => {
      const signal = init?.signal
      if (signal?.aborted) return Promise.reject(signal.reason)
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason))
      })
    })
    mockedFetchJSON.mockRejectedValue(new Error('offline'))
    let listed: Awaited<ReturnType<typeof listApps>> | null = null
    void listApps().then((apps) => {
      listed = apps
    })

    await vi.advanceTimersByTimeAsync(5000)

    expect(listed).toHaveLength(30)
    expect(listed!.every((app) => app.covers.length === 0)).toBe(true)
  })

  it('show the kept stills, not the website covers, when the website goes away after a good load', async () => {
    vi.useFakeTimers()
    mockedFetchJSON.mockResolvedValueOnce([
      websiteApp({
        covers: [
          { cover: '/catalog-media/hero/v1', still: '/catalog-media/hero-still/v1' },
          { cover: '/catalog-media/skate/v1', still: '/catalog-media/skate-still/v1' }
        ]
      })
    ])
    await listApps()
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    electron.online = false
    electron.fetchStill.mockImplementation(keptStill)
    mockedFetchJSON.mockRejectedValue(new Error('offline'))

    expect((await listApps())[0]?.covers).toEqual([
      { url: 'data:image/webp;base64,AQID', stillUrl: 'data:image/webp;base64,AQID' }
    ])
  })

  it('look for only the first still of each app', async () => {
    electron.online = false
    savedWithStills()
    electron.fetchStill.mockImplementation(() =>
      Promise.resolve(new Response(STILL_BYTES, { headers: { 'content-type': 'image/webp' } }))
    )
    mockedFetchJSON.mockRejectedValue(new Error('offline'))

    await listApps()

    expect(electron.fetchStill.mock.calls.map(([url]) => url)).toEqual([
      'https://comfy.org/catalog-media/hero-still/v1'
    ])
  })

  it('leave out a kept still over two megabytes, and stop reading it', async () => {
    electron.online = false
    savedWithStills()
    const still = oversizedStill()
    electron.fetchStill.mockResolvedValue(still.response)
    mockedFetchJSON.mockRejectedValue(new Error('offline'))

    expect((await listApps())[0]?.covers).toEqual([])
    expect(still.cancelled()).toBe(true)
  })

  it('show a card without a picture when Desktop kept none of its stills', async () => {
    electron.online = false
    savedWithStills()
    mockedFetchJSON.mockRejectedValue(new Error('offline'))

    expect((await listApps())[0]?.covers).toEqual([])
  })

  it('leave out a kept answer that is not a picture', async () => {
    electron.online = false
    savedWithStills()
    electron.fetchStill.mockResolvedValue(
      new Response('<p>sign in</p>', { headers: { 'content-type': 'text/html' } })
    )
    mockedFetchJSON.mockRejectedValue(new Error('offline'))

    expect((await listApps())[0]?.covers).toEqual([])
  })

  it('are asked for once, without waiting to try again, when this computer is offline', async () => {
    electron.online = false
    savedWithStills()
    mockedFetchJSON.mockRejectedValue(new Error('offline'))

    expect((await listApps()).map((app) => app.id)).toEqual(['remove-background'])
    expect(mockedFetchJSON).toHaveBeenCalledTimes(1)
  })

  it('keep the first still of each app after a good load, so it can show later with no internet', async () => {
    mockedFetchJSON.mockResolvedValue([
      websiteApp({
        covers: [
          { cover: '/catalog-media/hero/v1', still: '/catalog-media/hero-still/v1' },
          { cover: '/catalog-media/skate/v1', still: '/catalog-media/skate-still/v1' }
        ]
      }),
      websiteApp({
        id: 'sdr-to-hdr',
        page: '/apps/sdr-to-hdr/desktop.html',
        covers: [{ cover: '/catalog-media/dance/v1' }, { cover: '/catalog-media/sun.png' }]
      })
    ])

    await listApps()

    expect(electron.fetchStill.mock.calls).toEqual([
      ['https://comfy.org/catalog-media/hero-still/v1', { signal: expect.any(AbortSignal) }],
      ['https://comfy.org/catalog-media/sun.png', { signal: expect.any(AbortSignal) }]
    ])
  })

  it('keep at most six stills downloading at once after a good load', async () => {
    mockedFetchJSON.mockResolvedValue(Array.from({ length: 10 }, (_, n) => appWithStill(n)))
    electron.fetchStill.mockImplementation(() => new Promise<Response>(() => {}))

    await listApps()

    expect(electron.fetchStill).toHaveBeenCalledTimes(6)
  })

  it('give a later still its own minute after six earlier stills hang until theirs run out', async () => {
    vi.useFakeTimers()
    mockedFetchJSON.mockResolvedValue(Array.from({ length: 7 }, (_, n) => appWithStill(n)))
    electron.fetchStill.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })
    )

    await listApps()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(electron.fetchStill).toHaveBeenCalledTimes(7)
    expect(electron.fetchStill.mock.calls[6]?.[1]?.signal?.aborted).toBe(false)
  })

  it('stop keeping a still over two megabytes after a good load', async () => {
    mockedFetchJSON.mockResolvedValue([appWithStill(1)])
    const still = oversizedStill()
    electron.fetchStill.mockResolvedValue(still.response)

    await listApps()

    await vi.waitFor(() => expect(still.cancelled()).toBe(true))
  })

  it('give the saved list as the website sent it, for the app pages to read', async () => {
    savedOnDisk(LIST_URL, [websiteApp()])

    expect(JSON.parse((await savedListBody(LIST_URL)) ?? 'null')).toEqual([websiteApp()])
  })

  it('give no saved list for another apps site, or when nothing is saved', async () => {
    savedOnDisk(LIST_URL, [websiteApp()])
    expect(await savedListBody('https://staging.comfy.org/apps/apps.json')).toBeNull()

    _resetAppsCatalogForTest()
    mockedReadSaved.mockResolvedValue({ kind: 'absent' })
    expect(await savedListBody(LIST_URL)).toBeNull()
  })
})

describe("an app's page_test in the list Desktop reads", () => {
  const KEY = 't2i-2026-12'
  const OWN_PAGE = 'https://comfy.org/apps/remove-background/desktop.html'
  const COMFY_PAGE = 'https://comfy.org/apps/prompt-to-image/desktop.html'
  const IN_VARIANT = 'install-a'
  const PAST_SHARES = 'install-1'

  function testedApp(pageTest: unknown): Record<string, unknown> {
    return websiteApp({ page_test: pageTest })
  }

  function comfyHalf(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      key: KEY,
      pages: { comfy: { page: '/apps/prompt-to-image/desktop.html', share: 50, ...over } }
    }
  }

  async function groupListed(pageTest: unknown, installationId: string | null = IN_VARIANT) {
    install.id = installationId
    mockedFetchJSON.mockResolvedValue([testedApp(pageTest)])
    await listApps()
    return pageTestGroupForListedApp('remove-background')
  }

  it("sends an install inside the shares to the variant's page", async () => {
    expect(await groupListed(comfyHalf())).toEqual({
      key: KEY,
      variant: 'comfy',
      pageUrl: COMFY_PAGE
    })
  })

  it("keeps an install past the shares on the card's own page, as control", async () => {
    expect(await groupListed(comfyHalf(), PAST_SHARES)).toEqual({
      key: KEY,
      variant: 'control',
      pageUrl: null
    })
  })

  it('gives an install the same group every time it asks', async () => {
    const first = await groupListed(comfyHalf())
    _resetAppsCatalogForTest()
    expect(await groupListed(comfyHalf())).toEqual(first)
  })

  it('gives no group when Desktop has no saved installation id', async () => {
    expect(await groupListed(comfyHalf(), null)).toBeNull()
    expect(pageUrlForListedApp('remove-background')).toBe(OWN_PAGE)
  })

  it("keeps the card's own page and card as they were", async () => {
    await groupListed(comfyHalf())

    expect(pageUrlForListedApp('remove-background')).toBe(OWN_PAGE)
    expect((await listApps())[0]).toEqual({
      id: 'remove-background',
      title: 'Remove Background',
      description: 'Cut the subject out of a picture or video.',
      covers: [{ url: 'https://comfy.org/catalog-media/cover-1/v2', stillUrl: null }]
    })
  })

  it('gives no group to an app with no page_test, or one never listed', async () => {
    install.id = IN_VARIANT
    mockedFetchJSON.mockResolvedValue([websiteApp()])
    await listApps()

    expect(pageTestGroupForListedApp('remove-background')).toBeNull()
    expect(pageTestGroupForListedApp('never-listed')).toBeNull()
  })

  it.each<[string, unknown]>([
    ['a bad key', { ...comfyHalf(), key: 'Not A Slug' }],
    [
      'a variant named control',
      { key: KEY, pages: { control: { page: '/apps/a.html', share: 50 } } }
    ],
    ['a share out of range', comfyHalf({ share: 0 })],
    [
      'shares over 100',
      {
        key: KEY,
        pages: {
          comfy: { page: '/apps/a.html', share: 51 },
          studio: { page: '/apps/b.html', share: 50 }
        }
      }
    ],
    [
      'more than four variants',
      {
        key: KEY,
        pages: Object.fromEntries(
          ['a', 'b', 'c', 'd', 'e'].map((name) => [name, { page: `/apps/${name}.html`, share: 5 }])
        )
      }
    ],
    ['a page on another site', comfyHalf({ page: 'https://evil.example/apps/x.html' })],
    ['a page outside the apps scope', comfyHalf({ page: '/blog/desktop.html' })],
    ['the list file as a page', comfyHalf({ page: '/apps/apps.json' })],
    ['the list file with a query as a page', comfyHalf({ page: '/apps/apps.json?v=2#top' })],
    ['the list page as a page', comfyHalf({ page: '/apps/#/' })]
  ])('is dropped whole for %s, and the app still opens its own page', async (_case, pageTest) => {
    expect(await groupListed(pageTest)).toBeNull()
    expect(pageUrlForListedApp('remove-background')).toBe(OWN_PAGE)
  })

  it('still splits installs when the list comes from the saved copy with no internet', async () => {
    vi.useFakeTimers()
    install.id = IN_VARIANT
    savedOnDisk(LIST_URL, [testedApp(comfyHalf())])
    mockedFetchJSON.mockRejectedValue(new Error('offline'))

    await afterAllTries(listApps())

    expect(pageTestGroupForListedApp('remove-background')).toEqual({
      key: KEY,
      variant: 'comfy',
      pageUrl: COMFY_PAGE
    })
  })
})
