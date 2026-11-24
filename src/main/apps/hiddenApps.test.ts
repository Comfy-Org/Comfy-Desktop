import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appsLocation: {
    url: 'https://comfy.org/apps/',
    origin: 'https://comfy.org',
    scopePath: '/apps/'
  }
}))

vi.mock('electron', () => ({ session: {} }))
vi.mock('../cloud/config', () => ({
  CLOUD_CONFIG: { issuer: 'https://cloud.comfy.org', apiBase: 'https://cloud.comfy.org/api' }
}))
vi.mock('./appsConfig', () => ({ currentAppsLocation: () => mocks.appsLocation }))
vi.mock('../devplatform/session', () => ({ getCloudSession: vi.fn() }))
vi.mock('./draftLinks', () => ({ cloudIdentity: vi.fn(), signedInAccount: vi.fn() }))
vi.mock('./appsCatalog', () => ({ listApps: vi.fn() }))

import {
  forgetHiddenApps,
  hiddenPageUrlOf,
  listHiddenApps,
  pageUrlForHiddenApp,
  pictureForHiddenApp,
  titleForHiddenApp
} from './hiddenApps'
import type { HiddenAppsDeps } from './hiddenApps'
import type { SignedInAccount } from './draftApps'

const CATALOG = 'https://cloud.comfy.org/api/v1/catalog'
const STAFF_OWNER = '["staff-subject","ws-1"]'
const OTHER_OWNER = '["other-subject","ws-2"]'
const STAFF: SignedInAccount = { email: 'staff@comfy.org', signInProvider: 'google.com' }
const TOKEN = 'grant-access-token'
const UID = '0b0e6b7a-6a43-4f43-9d8e-1f2a3b4c5d6e'
const VERSION = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_STILL_BYTES = 2 * 1024 * 1024

type PageAnswer = () => Response | Promise<Response>

let account: SignedInAccount | null
let owner: string | null
let published: string[]
let clock: number
let catalogPages: Map<string, PageAnswer>
let livePages: Set<string>
let stills: Map<string, PageAnswer>

const fetchMock = vi.fn(async (url: string, _init: RequestInit): Promise<Response> => {
  if (url.startsWith(`${CATALOG}/staff-apps?`)) {
    const answer = catalogPages.get(new URL(url).searchParams.get('cursor') ?? '')
    if (!answer) throw new Error(`No catalog page for ${url}`)
    return answer()
  }
  if (url.startsWith(`${CATALOG}/staff-apps/`)) {
    return (await stills.get(url)?.()) ?? new Response(null, { status: 404 })
  }
  if (url.startsWith('https://comfy.org/')) {
    return new Response(null, { status: livePages.has(url) ? 200 : 404 })
  }
  throw new Error(`Unexpected request to ${url}`)
})

function deps(overrides: Partial<HiddenAppsDeps> = {}): HiddenAppsDeps {
  return {
    signedInAccount: async () => account,
    accessToken: async () => TOKEN,
    cloudIdentity: () => owner,
    publishedAppIds: async () => published,
    fetch: fetchMock,
    now: () => clock,
    ...overrides
  }
}

function row(slug: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: UID,
    slug,
    title: `Title of ${slug}`,
    description: `About ${slug}`,
    enabled: true,
    status: 'live',
    on_desktop: true,
    on_hub: true,
    ...fields
  }
}

function pageOf(items: unknown[], nextCursor?: string): PageAnswer {
  return () =>
    Response.json({
      has_more: nextCursor !== undefined,
      items,
      ...(nextCursor ? { next_cursor: nextCursor } : {})
    })
}

function picturePath(): string {
  return `/staff-apps/${UID}/picture/${VERSION}`
}

function withPicture(path: string): Record<string, unknown> {
  return { picture: path }
}

function pageUrl(slug: string): string {
  return `https://comfy.org/apps/${slug}/desktop.html`
}

function catalogCalls(): string[] {
  return fetchMock.mock.calls
    .map(([url]) => url)
    .filter((url) => url.startsWith(`${CATALOG}/staff-apps?`))
}

function holdCatalog(): Promise<(response: Response) => void> {
  return new Promise((reached) => {
    catalogPages.set(
      '',
      () =>
        new Promise<Response>((answer) => {
          reached(answer)
        })
    )
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  forgetHiddenApps()
  account = STAFF
  owner = STAFF_OWNER
  published = ['remove-background']
  clock = 1_000_000
  catalogPages = new Map([['', pageOf([row('explore-worlds')])]])
  livePages = new Set()
  stills = new Map()
  mocks.appsLocation = {
    url: 'https://comfy.org/apps/',
    origin: 'https://comfy.org',
    scopePath: '/apps/'
  }
})

describe('who sees hidden apps', () => {
  it.each([
    ['an account outside Comfy', { email: 'someone@gmail.com', signInProvider: 'google.com' }],
    [
      'a Comfy address signed in with a password',
      { email: 'staff@comfy.org', signInProvider: 'password' }
    ],
    ['an account with no email', { signInProvider: 'google.com' }],
    ['no account', null]
  ])('never reads the catalog for %s', async (_label, who) => {
    account = who

    expect(await listHiddenApps(deps())).toEqual({ apps: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never asks who is signed in, or reads the catalog, while signed out of Cloud', async () => {
    owner = null
    const signedInAccount = vi.fn(async () => STAFF)

    expect(await listHiddenApps(deps({ signedInAccount }))).toEqual({ apps: [] })
    expect(signedInAccount).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("reads the comfy.org staff list of app pages with the person's own Cloud token", async () => {
    await listHiddenApps(deps())

    const [url, init] = fetchMock.mock.calls[0]!
    const asked = new URL(url)
    expect(asked.origin + asked.pathname).toBe(`${CATALOG}/staff-apps`)
    expect([...asked.searchParams.keys()]).toEqual(['limit'])
    expect(asked.searchParams.get('limit')).toBe('100')
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` })
    expect(init.redirect).toBe('error')
  })

  it('reads nothing when Cloud gives no token', async () => {
    expect(await listHiddenApps(deps({ accessToken: async () => null }))).toEqual({ apps: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([401, 403])('shows no hidden apps when the catalog refuses with %i', async (status) => {
    catalogPages.set('', () => Response.json({ code: 'FORBIDDEN' }, { status }))

    expect(await listHiddenApps(deps())).toEqual({ apps: [] })
    expect(catalogCalls()).toHaveLength(1)
  })

  it.each([404, 429, 500, 503])(
    'shows no hidden apps yet, and says to ask again, when the catalog answers %i',
    async (status) => {
      catalogPages.set('', () => Response.json({ code: 'UNAVAILABLE' }, { status }))

      expect(await listHiddenApps(deps())).toEqual({ apps: [], stale: true })
      expect(catalogCalls()).toHaveLength(1)
    }
  )

  it('says to ask again when the catalog cannot be reached or answers with no list', async () => {
    catalogPages.set('', () => Promise.reject(new Error('offline')))
    expect(await listHiddenApps(deps())).toEqual({ apps: [], stale: true })

    forgetHiddenApps()
    catalogPages.set('', () => Response.json({ items: 'none' }))
    expect(await listHiddenApps(deps())).toEqual({ apps: [], stale: true })
  })

  it('asks a refusing catalog again only after 30 seconds', async () => {
    catalogPages.set('', () => new Response(null, { status: 403 }))
    await listHiddenApps(deps())

    clock += 29_000
    await listHiddenApps(deps())
    expect(catalogCalls()).toHaveLength(1)

    clock += 2_000
    await listHiddenApps(deps())
    expect(catalogCalls()).toHaveLength(2)
  })
})

describe('the hidden apps listed', () => {
  it('lists every app page that is not on the published list, once each', async () => {
    catalogPages.set(
      '',
      pageOf([
        row('remove-background'),
        row('explore-worlds'),
        'not a row',
        row(''),
        row('Not A Slug!'),
        row('explore-worlds', { title: 'A second row for the same page' }),
        row('relight', { status: 'not_live', enabled: false })
      ])
    )

    const { apps } = await listHiddenApps(deps())

    expect(apps.map((app) => app.id)).toEqual(['explore-worlds', 'relight'])
    expect(apps[0]).toEqual({
      id: 'explore-worlds',
      title: 'Title of explore-worlds',
      description: 'About explore-worlds',
      covers: [],
      reasons: [],
      page: 'missing'
    })
  })

  it.each([
    ['turned off', { enabled: false }, ['off']],
    ['never published', { status: 'not_live' }, ['draft']],
    ['only on the Hub', { on_desktop: false }, ['hub_only']],
    ['published with newer edits', { status: 'unpublished' }, ['unpublished']],
    [
      'off, never published and not for Desktop',
      { enabled: false, status: 'not_live', on_desktop: false },
      ['off', 'draft', 'hub_only']
    ]
  ])('says why a page %s is hidden', async (_label, fields, reasons) => {
    catalogPages.set('', pageOf([row('relight', fields)]))

    const { apps } = await listHiddenApps(deps())

    expect(apps[0]?.reasons).toEqual(reasons)
  })

  it('uses the slug as the title when a page has none', async () => {
    catalogPages.set('', pageOf([row('relight', { title: '  ' })]))

    expect((await listHiddenApps(deps())).apps[0]?.title).toBe('relight')
  })

  it('reads every page of the list by its cursor, with the same filters', async () => {
    catalogPages = new Map([
      ['', pageOf([row('first')], 'cursor-2')],
      ['cursor-2', pageOf([row('second')], 'cursor-3')],
      ['cursor-3', pageOf([row('third')])]
    ])

    const { apps } = await listHiddenApps(deps())

    expect(apps.map((app) => app.id)).toEqual(['first', 'second', 'third'])
    const asked = catalogCalls().map((url) => new URL(url).searchParams)
    expect(asked.map((params) => params.get('cursor'))).toEqual([null, 'cursor-2', 'cursor-3'])
    expect(asked.every((params) => params.get('limit') === '100')).toBe(true)
  })

  it('says to ask again when a later page of the list fails', async () => {
    catalogPages = new Map([
      ['', pageOf([row('first')], 'cursor-2')],
      ['cursor-2', () => new Response(null, { status: 409 })]
    ])

    expect(await listHiddenApps(deps())).toEqual({ apps: [], stale: true })
  })

  it('says to ask again when the published list cannot be read', async () => {
    const publishedAppIds = async (): Promise<string[]> => {
      throw new Error('offline')
    }

    expect(await listHiddenApps(deps({ publishedAppIds }))).toEqual({ apps: [], stale: true })
  })
})

describe('the page a hidden app opens', () => {
  it('opens a page only when the apps site answers 200 for it', async () => {
    catalogPages.set('', pageOf([row('explore-worlds'), row('relight')]))
    livePages.add(pageUrl('explore-worlds'))

    const { apps } = await listHiddenApps(deps())

    expect(apps.map((app) => [app.id, app.page])).toEqual([
      ['explore-worlds', 'live'],
      ['relight', 'missing']
    ])
    expect(pageUrlForHiddenApp('explore-worlds', deps())).toBe(pageUrl('explore-worlds'))
    expect(pageUrlForHiddenApp('relight', deps())).toBeNull()
    const pageCheck = fetchMock.mock.calls.find(([url]) => url === pageUrl('explore-worlds'))
    expect(pageCheck?.[1]).toMatchObject({ method: 'HEAD', redirect: 'manual' })
    expect(pageCheck?.[1].headers).toBeUndefined()
  })

  it.each([
    ['is not found', () => new Response(null, { status: 404 })],
    ['is gone', () => new Response(null, { status: 410 })],
    ['redirects', () => new Response(null, { status: 308, headers: { location: '/elsewhere' } })]
  ])('counts a page that %s as no page', async (_label, answer) => {
    const fetch = vi.fn(async (url: string, init: RequestInit) =>
      url === pageUrl('explore-worlds') ? answer() : fetchMock(url, init)
    )

    const listed = await listHiddenApps(deps({ fetch }))

    expect(listed).toEqual({ apps: [expect.objectContaining({ page: 'missing' })] })
    expect(pageUrlForHiddenApp('explore-worlds', deps())).toBeNull()
  })

  it.each([
    ['times out', () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
    ['cannot be reached', () => Promise.reject(new Error('getaddrinfo ENOTFOUND comfy.org'))],
    ['is rate limited', () => new Response(null, { status: 429 })],
    ['is unavailable', () => new Response(null, { status: 503 })],
    ['fails on the server', () => new Response(null, { status: 500 })]
  ])(
    'says a page that %s could not be checked, and checks it again 30 seconds later',
    async (_label, answer) => {
      let pageAnswer: () => Response | Promise<Response> = answer
      const fetch = vi.fn(async (url: string, init: RequestInit) =>
        url === pageUrl('explore-worlds') ? pageAnswer() : fetchMock(url, init)
      )

      const listed = await listHiddenApps(deps({ fetch }))

      expect(listed).toEqual({
        apps: [expect.objectContaining({ page: 'unchecked' })],
        stale: true
      })
      expect(pageUrlForHiddenApp('explore-worlds', deps())).toBeNull()

      pageAnswer = () => new Response(null, { status: 200 })
      clock += 29_000
      expect((await listHiddenApps(deps({ fetch }))).apps[0]?.page).toBe('unchecked')
      clock += 2_000
      expect(await listHiddenApps(deps({ fetch }))).toEqual({
        apps: [expect.objectContaining({ page: 'live' })]
      })
      expect(pageUrlForHiddenApp('explore-worlds', deps())).toBe(pageUrl('explore-worlds'))
    }
  )

  it('keeps a page it opened before when a later check of it cannot get through', async () => {
    livePages.add(pageUrl('explore-worlds'))
    await listHiddenApps(deps())
    clock += 121_000
    const fetch = vi.fn(async (url: string, init: RequestInit) =>
      url === pageUrl('explore-worlds') ? new Response(null, { status: 503 }) : fetchMock(url, init)
    )

    const listed = await listHiddenApps(deps({ fetch }))

    expect(listed).toEqual({ apps: [expect.objectContaining({ page: 'live' })], stale: true })
    expect(pageUrlForHiddenApp('explore-worlds', deps())).toBe(pageUrl('explore-worlds'))
  })

  it('opens nothing for an app that is not on the current hidden list', async () => {
    livePages.add(pageUrl('explore-worlds'))
    await listHiddenApps(deps())

    expect(pageUrlForHiddenApp('remove-background', deps())).toBeNull()
    expect(pageUrlForHiddenApp('never-listed', deps())).toBeNull()
  })

  it('opens nothing once the page has left the apps scope Desktop uses', async () => {
    livePages.add(pageUrl('explore-worlds'))
    await listHiddenApps(deps())

    mocks.appsLocation = {
      url: 'https://example.com/apps/',
      origin: 'https://example.com',
      scopePath: '/apps/'
    }

    expect(pageUrlForHiddenApp('explore-worlds', deps())).toBeNull()
  })

  it('builds the page address inside the apps scope only', () => {
    expect(hiddenPageUrlOf('relight', mocks.appsLocation)).toBe(pageUrl('relight'))
    expect(
      hiddenPageUrlOf('relight', {
        url: 'https://comfy.org/tools/',
        origin: 'https://comfy.org',
        scopePath: '/tools/'
      })
    ).toBeNull()
  })

  it('names and pictures a running hidden app from the current list', async () => {
    stills.set(
      `${CATALOG}${picturePath()}`,
      () => new Response(PNG, { headers: { 'content-type': 'image/png' } })
    )
    catalogPages.set('', pageOf([row('explore-worlds', withPicture(picturePath()))]))
    await listHiddenApps(deps())

    expect(titleForHiddenApp('explore-worlds', deps())).toBe('Title of explore-worlds')
    expect(pictureForHiddenApp('explore-worlds', deps())).toMatch(/^data:image\/png;base64,/)
    expect(titleForHiddenApp('relight', deps())).toBeNull()
  })
})

describe('the still on a hidden app card', () => {
  it("loads the card picture with the person's token and hands it over as a data URL", async () => {
    stills.set(
      `${CATALOG}${picturePath()}`,
      () => new Response(PNG, { headers: { 'content-type': 'image/png; charset=binary' } })
    )
    catalogPages.set('', pageOf([row('explore-worlds', withPicture(picturePath()))]))

    const { apps } = await listHiddenApps(deps())

    const still = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`
    expect(apps[0]?.covers).toEqual([{ url: still, stillUrl: still }])
    const asked = fetchMock.mock.calls.find(([url]) => url.includes('/picture/'))
    expect(asked?.[1].headers).toEqual({ Authorization: `Bearer ${TOKEN}` })
    expect(asked?.[1].redirect).toBe('error')
  })

  it.each([
    [
      'a web page',
      () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
    ],
    [
      'an SVG drawing',
      () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })
    ],
    ['a file with no type', () => new Response(PNG)],
    ['a refusal', () => new Response(null, { status: 403 })],
    [
      'a picture that says it is too big',
      () =>
        new Response(PNG, {
          headers: { 'content-type': 'image/png', 'content-length': String(MAX_STILL_BYTES + 1) }
        })
    ],
    [
      'a picture that turns out too big',
      () =>
        new Response(new Uint8Array(MAX_STILL_BYTES + 1), {
          headers: { 'content-type': 'image/png' }
        })
    ],
    [
      'an empty picture',
      () => new Response(new Uint8Array(0), { headers: { 'content-type': 'image/png' } })
    ],
    ['a failed download', () => Promise.reject(new Error('offline'))]
  ])('shows the card with no picture when the still is %s', async (_label, answer) => {
    stills.set(`${CATALOG}${picturePath()}`, answer)
    catalogPages.set('', pageOf([row('explore-worlds', withPicture(picturePath()))]))

    const { apps } = await listHiddenApps(deps())

    expect(apps.map((app) => [app.id, app.covers])).toEqual([['explore-worlds', []]])
  })

  it.each([
    ['a path outside the staff pictures', withPicture('/preview-media/121/' + UID + '/' + VERSION)],
    ['a picture path with more after it', withPicture(picturePath() + '/../raw')],
    ['an address on another site', withPicture('https://example.com/picture.png')],
    ['a picture that is not a path', { picture: { src: picturePath() } }],
    ['no picture at all', {}]
  ])('downloads nothing for %s', async (_label, fields) => {
    catalogPages.set('', pageOf([row('explore-worlds', fields)]))

    const { apps } = await listHiddenApps(deps())

    expect(apps[0]?.covers).toEqual([])
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith(`${CATALOG}/staff-apps/`))).toBe(
      false
    )
  })
})

describe('keeping the hidden list', () => {
  it('reads the list once for asks that come together', async () => {
    await Promise.all([listHiddenApps(deps()), listHiddenApps(deps())])

    expect(catalogCalls()).toHaveLength(1)
  })

  it('keeps the list for two minutes, then reads it again', async () => {
    await listHiddenApps(deps())
    clock += 119_000
    await listHiddenApps(deps())
    expect(catalogCalls()).toHaveLength(1)

    clock += 2_000
    await listHiddenApps(deps())
    expect(catalogCalls()).toHaveLength(2)
  })

  it.each([
    ['answers 503', () => new Response(null, { status: 503 })],
    ['answers 500', () => new Response(null, { status: 500 })],
    ['cannot be reached', () => Promise.reject(new Error('offline'))],
    ['answers with no list', () => Response.json({ items: 'none' })]
  ])(
    'keeps the last good list, and the page a running app uses, when a refresh %s',
    async (_label, answer) => {
      livePages.add(pageUrl('explore-worlds'))
      const good = await listHiddenApps(deps())
      clock += 121_000
      catalogPages.set('', answer)

      expect(await listHiddenApps(deps())).toEqual({ ...good, stale: true })
      expect(pageUrlForHiddenApp('explore-worlds', deps())).toBe(pageUrl('explore-worlds'))
      expect(titleForHiddenApp('explore-worlds', deps())).toBe('Title of explore-worlds')
    }
  )

  it('asks the catalog again 30 seconds after a failed refresh, and is fresh once it answers', async () => {
    await listHiddenApps(deps())
    clock += 121_000
    catalogPages.set('', () => new Response(null, { status: 503 }))
    await listHiddenApps(deps())

    clock += 29_000
    await listHiddenApps(deps())
    expect(catalogCalls()).toHaveLength(2)

    clock += 2_000
    catalogPages.set('', pageOf([row('explore-worlds')]))
    expect(await listHiddenApps(deps())).toEqual({
      apps: [expect.objectContaining({ id: 'explore-worlds' })]
    })
    expect(catalogCalls()).toHaveLength(3)
  })

  it.each([401, 403])(
    'drops the last good list when a refresh is refused with %i',
    async (status) => {
      livePages.add(pageUrl('explore-worlds'))
      await listHiddenApps(deps())
      clock += 121_000
      catalogPages.set('', () => new Response(null, { status }))

      expect(await listHiddenApps(deps())).toEqual({ apps: [] })
      expect(pageUrlForHiddenApp('explore-worlds', deps())).toBeNull()
    }
  )

  it('reads the list again, and opens nothing from the old one, once the account changes', async () => {
    livePages.add(pageUrl('explore-worlds'))
    await listHiddenApps(deps())

    owner = OTHER_OWNER
    account = { email: 'someone@gmail.com', signInProvider: 'google.com' }

    expect(pageUrlForHiddenApp('explore-worlds', deps())).toBeNull()
    expect(titleForHiddenApp('explore-worlds', deps())).toBeNull()
    expect(await listHiddenApps(deps())).toEqual({ apps: [] })
    expect(catalogCalls()).toHaveLength(1)

    owner = STAFF_OWNER
    account = STAFF
    expect(pageUrlForHiddenApp('explore-worlds', deps())).toBeNull()
  })

  it('drops the list and its stills when Desktop forgets them', async () => {
    livePages.add(pageUrl('explore-worlds'))
    stills.set(
      `${CATALOG}${picturePath()}`,
      () => new Response(PNG, { headers: { 'content-type': 'image/png' } })
    )
    catalogPages.set('', pageOf([row('explore-worlds', withPicture(picturePath()))]))
    await listHiddenApps(deps())

    forgetHiddenApps()

    expect(pageUrlForHiddenApp('explore-worlds', deps())).toBeNull()
    expect(pictureForHiddenApp('explore-worlds', deps())).toBeNull()
    await listHiddenApps(deps())
    expect(catalogCalls()).toHaveLength(2)
  })

  it('throws away a list that arrives after the account changed', async () => {
    const held = holdCatalog()
    livePages.add(pageUrl('explore-worlds'))

    const asked = listHiddenApps(deps())
    const answer = await held
    owner = OTHER_OWNER
    answer(await pageOf([row('explore-worlds')])())

    expect(await asked).toEqual({ apps: [] })
    owner = STAFF_OWNER
    expect(pageUrlForHiddenApp('explore-worlds', deps())).toBeNull()
  })

  it('throws away a list that arrives after Desktop forgot the hidden apps', async () => {
    const held = holdCatalog()
    livePages.add(pageUrl('explore-worlds'))

    const asked = listHiddenApps(deps())
    const answer = await held
    forgetHiddenApps()
    answer(await pageOf([row('explore-worlds')])())
    await asked

    expect(pageUrlForHiddenApp('explore-worlds', deps())).toBeNull()
  })
})
