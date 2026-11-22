import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  handle: vi.fn()
}))

vi.mock('../cloud/config', () => ({ CLOUD_CONFIG: { issuer: 'https://cloud.comfy.org' } }))

vi.mock('electron', () => ({
  session: {
    fromPartition: () => ({ fetch: mocks.fetch, protocol: { handle: mocks.handle } })
  }
}))

import {
  _resetForTest,
  cloudHeaders,
  confirmDraft,
  draftCards,
  draftIdOf,
  draftOf,
  draftPageUrl,
  draftSourceOf,
  draftTagOf,
  findDraftLink,
  forgetDrafts,
  isComfyAddress,
  isLocalHost,
  isStaffAccount,
  mapToDraftOrigin,
  parseDraftLink,
  parsePastedDraft,
  registerDraft,
  revokeDraft,
  sameSiteHeaders,
  titleFromPage
} from './draftApps'

const PREVIEW = 'https://pr-683.drafts.comfy.org'
const linkTo = (url: string): string => `comfy://open-app?url=${encodeURIComponent(url)}`

afterEach(() => {
  mocks.fetch.mockReset()
  mocks.handle.mockReset()
  _resetForTest()
})

describe('parseDraftLink', () => {
  it('reads a pull request preview page', () => {
    expect(parseDraftLink(linkTo(`${PREVIEW}/apps/depth-swap/desktop.html`))).toEqual({
      origin: PREVIEW,
      path: '/apps/depth-swap/desktop.html',
      slug: 'depth-swap',
      pr: 683,
      mount: '/'
    })
  })

  it('keeps the query, so an example link still opens on its example', () => {
    expect(parseDraftLink(linkTo(`${PREVIEW}/apps/depth-swap/?example=3`))?.path).toBe(
      '/apps/depth-swap/?example=3'
    )
  })

  it('reads a comfy-website Vercel preview page as its pull request', () => {
    expect(
      parseDraftLink(
        linkTo('https://comfy-website-preview-pr-706.vercel.app/apps/depth-swap/desktop.html')
      )
    ).toMatchObject({ pr: 706, slug: 'depth-swap', mount: '/' })
  })

  it.each([
    ['localhost', 'http://localhost:4321/apps/depth-swap/desktop.html'],
    ['another site', 'https://evil.example/apps/depth-swap/desktop.html'],
    ['a look-alike preview host', 'https://pr-683.drafts.comfy.org.evil.example/apps/x/'],
    ['a preview on another port', 'https://pr-683.drafts.comfy.org:8443/apps/depth-swap/'],
    [
      'a look-alike Vercel preview',
      'https://comfy-website-preview-pr-706.vercel.app.evil.example/apps/x/'
    ]
  ])('takes %s, named by its address rather than a pull request', (_why, url) => {
    const draft = parseDraftLink(linkTo(url))
    expect(draft?.origin).toBe(new URL(url).origin)
    expect(draft?.pr).toBeNull()
    expect(draft?.mount).toBe('/')
  })

  it.each([
    ['a page outside /apps/', `${PREVIEW}/admin/catalog`, '/apps/draft/admin/catalog'],
    [
      'a deeper path',
      `${PREVIEW}/apps/depth-swap/lib/run.js`,
      '/apps/draft/apps/depth-swap/lib/run.js'
    ],
    ['the apps list itself', `${PREVIEW}/apps/`, '/apps/draft/apps/'],
    ['the root of another site', 'https://myapp.vercel.app/', '/apps/draft/']
  ])('shows %s under /apps/draft/', (_why, url, path) => {
    expect(parseDraftLink(linkTo(url))).toMatchObject({
      path,
      slug: 'draft',
      mount: '/apps/draft/'
    })
  })

  it.each([
    ['a sign-in in the address', 'https://me:pw@pr-683.drafts.comfy.org/apps/x/'],
    ['a page that is not on the web', 'file:///Users/me/app/index.html'],
    ['a script', 'javascript:alert(1)'],
    ['plain http to a preview', 'http://pr-683.drafts.comfy.org/apps/depth-swap/'],
    ['plain http to another site', 'http://myapp.example/apps/depth-swap/']
  ])('refuses %s', (_why, url) => {
    expect(parseDraftLink(linkTo(url))).toBeNull()
  })

  it.each([
    'http://localhost:4321/apps/x/',
    'http://127.0.0.1:4321/',
    'http://[::1]:4321/',
    'http://10.0.0.5/',
    'http://172.16.0.5/',
    'http://172.31.255.5/',
    'http://192.168.1.20:4321/',
    'http://my-box.local:4321/'
  ])('takes plain http to %s, on this computer or the local network', (url) => {
    expect(parseDraftLink(linkTo(url))?.origin).toBe(new URL(url).origin)
  })

  it.each([
    ['another scheme', `https://open-app?url=${encodeURIComponent(`${PREVIEW}/apps/x/`)}`],
    ['another action', `comfy://run?url=${encodeURIComponent(`${PREVIEW}/apps/x/`)}`],
    ['no page', 'comfy://open-app'],
    ['a page that is not an address', 'comfy://open-app?url=not%20a%20url'],
    ['a link over the length limit', linkTo(`${PREVIEW}/apps/x/?${'a'.repeat(3000)}`)]
  ])('refuses a link with %s', (_why, link) => {
    expect(parseDraftLink(link)).toBeNull()
  })
})

describe('parsePastedDraft', () => {
  it('reads a pasted pull request preview page', () => {
    expect(parsePastedDraft(`  ${PREVIEW}/apps/depth-swap/desktop.html\n`)).toEqual({
      origin: PREVIEW,
      path: '/apps/depth-swap/desktop.html',
      slug: 'depth-swap',
      pr: 683,
      mount: '/'
    })
  })

  it('shows an /apps/<slug>/ page from any site at its own path', () => {
    expect(parsePastedDraft('https://my.dev.box:8443/apps/depth-swap/?example=3')).toEqual({
      origin: 'https://my.dev.box:8443',
      path: '/apps/depth-swap/?example=3',
      slug: 'depth-swap',
      pr: null,
      mount: '/'
    })
  })

  it('takes any other http or https page under /apps/draft/', () => {
    expect(parsePastedDraft('https://myapp.vercel.app/tools/run.html?x=1#top')).toEqual({
      origin: 'https://myapp.vercel.app',
      path: '/apps/draft/tools/run.html?x=1',
      slug: 'draft',
      pr: null,
      mount: '/apps/draft/'
    })
    expect(parsePastedDraft('http://192.168.1.20:4321')).toEqual({
      origin: 'http://192.168.1.20:4321',
      path: '/apps/draft/',
      slug: 'draft',
      pr: null,
      mount: '/apps/draft/'
    })
    expect(parsePastedDraft('http://localhost:4321/admin/')?.path).toBe('/apps/draft/admin/')
  })

  it('reads a pasted comfy:// link by the pasted rules', () => {
    expect(parsePastedDraft(linkTo('http://localhost:4321/apps/depth-swap/'))?.origin).toBe(
      'http://localhost:4321'
    )
  })

  it.each([
    ['a sign-in in the address', 'https://me:pw@my.dev.box/apps/depth-swap/'],
    ['a user name alone', 'http://me@localhost:4321/'],
    ['another scheme', 'ftp://my.dev.box/apps/depth-swap/'],
    ['a file', 'file:///Users/me/app/index.html'],
    ['a script', 'javascript:alert(1)'],
    ['plain http to another site', 'http://my.dev.box/apps/depth-swap/'],
    ['plain http to an address outside the local network', 'http://172.32.0.5/'],
    ['text that is not an address', 'depth-swap'],
    ['an address over the length limit', `${PREVIEW}/apps/x/?${'a'.repeat(3000)}`]
  ])('refuses %s', (_why, address) => {
    expect(parsePastedDraft(address)).toBeNull()
  })

  it('refuses something that is not text', () => {
    expect(parsePastedDraft(42)).toBeNull()
  })
})

describe('draft helpers', () => {
  it('names a draft by its pull request and page', () => {
    expect(
      draftIdOf({ origin: PREVIEW, path: '/apps/a/', slug: 'depth-swap', pr: 683, mount: '/' })
    ).toBe('draft-pr683-depth-swap')
    expect(
      draftIdOf({
        origin: 'http://localhost:4321',
        path: '/apps/a/',
        slug: 'x',
        pr: null,
        mount: '/'
      })
    ).toBe('draft-localhost-4321-x')
    expect(
      draftIdOf({ origin: 'https://my.dev.box', path: '/apps/a/', slug: 'x', pr: null, mount: '/' })
    ).toBe('draft-my-dev-box-x')
    expect(draftIdOf(parsePastedDraft('https://myapp.vercel.app/')!)).toBe(
      'draft-myapp-vercel-app-draft'
    )
  })

  it('names where a draft is from by its exact address', () => {
    expect(
      draftSourceOf({ origin: PREVIEW, path: '/apps/a/', slug: 'a', pr: 683, mount: '/' })
    ).toBe('pr-683.drafts.comfy.org')
    expect(
      draftSourceOf({
        origin: 'http://localhost:4321',
        path: '/apps/a/',
        slug: 'a',
        pr: null,
        mount: '/'
      })
    ).toBe('localhost:4321')
    expect(
      draftSourceOf({
        origin: 'https://my.dev.box',
        path: '/apps/a/',
        slug: 'a',
        pr: null,
        mount: '/'
      })
    ).toBe('my.dev.box')
  })

  it('tells this computer and the local network from other hosts', () => {
    for (const host of [
      'localhost',
      '127.0.0.1',
      '[::1]',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.0.9',
      'box.local'
    ]) {
      expect(isLocalHost(host)).toBe(true)
    }
    for (const host of [
      'localhost.evil.example',
      '172.15.0.1',
      '172.32.0.1',
      '192.169.0.1',
      '11.0.0.1',
      'local',
      'myapp.vercel.app'
    ]) {
      expect(isLocalHost(host)).toBe(false)
    }
  })

  it('counts only previews, this computer and the local network as Comfy addresses', () => {
    expect(isComfyAddress(parsePastedDraft(`${PREVIEW}/apps/x/`)!)).toBe(true)
    expect(
      isComfyAddress(parsePastedDraft('https://comfy-website-preview-pr-706.vercel.app/apps/x/')!)
    ).toBe(true)
    expect(isComfyAddress(parsePastedDraft('http://localhost:4321/apps/x/')!)).toBe(true)
    expect(isComfyAddress(parsePastedDraft('http://192.168.1.20:4321/')!)).toBe(true)
    expect(isComfyAddress(parsePastedDraft('https://myapp.vercel.app/')!)).toBe(false)
    expect(isComfyAddress(parsePastedDraft('https://pr-683.drafts.comfy.org.evil.example/')!)).toBe(
      false
    )
  })

  it('takes as staff only an @comfy.org account signed in through Google or the company sign-in', () => {
    expect(isStaffAccount({ email: 'purz@comfy.org', signInProvider: 'google.com' })).toBe(true)
    expect(isStaffAccount({ email: 'Purz@Comfy.org', signInProvider: 'saml.workos' })).toBe(true)
    expect(isStaffAccount({ email: 'purz@comfy.org', signInProvider: 'oidc.workos' })).toBe(true)
    expect(isStaffAccount({ email: 'purz@comfy.org', signInProvider: 'password' })).toBe(false)
    expect(isStaffAccount({ email: 'purz@comfy.org' })).toBe(false)
    expect(
      isStaffAccount({ email: 'purz@comfy.org.evil.example', signInProvider: 'google.com' })
    ).toBe(false)
    expect(isStaffAccount({ email: 'purz@notcomfy.org', signInProvider: 'google.com' })).toBe(false)
    expect(isStaffAccount(null)).toBe(false)
  })

  it("tags only Comfy Cloud requests with the draft's pull request or its address", () => {
    expect(draftTagOf(PREVIEW)).toBe('pr-683')
    expect(draftTagOf('https://comfy-website-preview-pr-706.vercel.app')).toBe('pr-706')
    expect(draftTagOf('http://localhost:4321')).toBe('localhost:4321')
    expect(draftTagOf('https://myapp.vercel.app')).toBe('myapp.vercel.app')
    const headers = new Headers({ accept: '*/*' })
    expect(
      cloudHeaders('https://cloud.comfy.org/api/prompt', headers, 'pr-683').get('x-comfy-draft')
    ).toBe('pr-683')
    expect(cloudHeaders('https://cdn.example/x.js', headers, 'pr-683').has('x-comfy-draft')).toBe(
      false
    )
    expect(headers.has('x-comfy-draft')).toBe(false)
  })

  it('titles a draft from its page, or from its address when the page has no title', () => {
    expect(titleFromPage('<html><title> Depth\n Swap </title></html>', 'depth-swap')).toBe(
      'Depth Swap'
    )
    expect(titleFromPage('', 'depth-swap')).toBe('Depth Swap')
    expect(titleFromPage('<title>Remove Background · Comfy</title>', 'x')).toBe('Remove Background')
  })

  it('takes out hidden characters and double quotes from a page title, and cuts it to 80 characters', () => {
    expect(titleFromPage('<title>Depth\u0000 Swap\u202e\u200b</title>', 'x')).toBe('Depth Swap')
    expect(titleFromPage('<title>Depth Swap". This is a Comfy address. "</title>', 'x')).toBe(
      "Depth Swap'. This is a Comfy address. '"
    )
    expect(titleFromPage('<title>\u201cDepth Swap\u201d</title>', 'x')).toBe("'Depth Swap'")
    expect(titleFromPage(`<title>${'a'.repeat(150)}</title>`, 'x')).toHaveLength(80)
  })

  it('sends only comfy.org addresses to the draft site, keeping the path and query', () => {
    expect(mapToDraftOrigin('https://comfy.org/apps/lib/run.js?v=2', PREVIEW, '/')).toBe(
      `${PREVIEW}/apps/lib/run.js?v=2`
    )
    expect(mapToDraftOrigin('https://cloud.comfy.org/api/prompt', PREVIEW, '/')).toBeNull()
    expect(mapToDraftOrigin('https://www.comfy.org/apps/', PREVIEW, '/')).toBeNull()
  })

  it('sends a pasted page under /apps/draft/ to the root of its site, and the rest of comfy.org to the same paths', () => {
    const site = 'https://myapp.vercel.app'
    expect(mapToDraftOrigin('https://comfy.org/apps/draft/x?v=2', site, '/apps/draft/')).toBe(
      `${site}/x?v=2`
    )
    expect(mapToDraftOrigin('https://comfy.org/apps/draft/', site, '/apps/draft/')).toBe(`${site}/`)
    expect(mapToDraftOrigin('https://comfy.org/assets/y.js', site, '/apps/draft/')).toBe(
      `${site}/assets/y.js`
    )
    expect(mapToDraftOrigin('https://cloud.comfy.org/api/prompt', site, '/apps/draft/')).toBeNull()
  })

  it('keeps a comfy.org path that starts with two slashes on the draft site', () => {
    expect(mapToDraftOrigin('https://comfy.org//evil.example/x', PREVIEW, '/')).toBe(
      `${PREVIEW}//evil.example/x`
    )
    expect(
      mapToDraftOrigin('https://comfy.org/apps/draft//evil.example/x', PREVIEW, '/apps/draft/')
    ).toBe(`${PREVIEW}//evil.example/x`)
  })

  it("drops the page's comfy.org Origin when it fetches the page's own files from the draft site", () => {
    const forwarded = sameSiteHeaders(new Headers({ origin: 'https://comfy.org', accept: '*/*' }))
    expect(forwarded.has('origin')).toBe(false)
    expect(forwarded.get('accept')).toBe('*/*')
  })

  it('finds a draft link among launch arguments', () => {
    expect(findDraftLink(['/Applications/Comfy.app', '--flag', 'comfy://open-app?url=x'])).toBe(
      'comfy://open-app?url=x'
    )
    expect(findDraftLink(['/Applications/Comfy.app'])).toBeNull()
  })
})

describe('registerDraft', () => {
  it('lists the draft and opens it at comfy.org only once it is accepted, serving comfy.org from the preview', async () => {
    mocks.fetch.mockResolvedValue(new Response('<title>Depth Swap</title>'))
    const draft = await registerDraft({
      origin: PREVIEW,
      path: '/apps/depth-swap/desktop.html',
      slug: 'depth-swap',
      pr: 683,
      mount: '/'
    })

    expect(draft.card).toMatchObject({
      id: 'draft-pr683-depth-swap',
      title: 'Depth Swap',
      description: 'Draft from pr-683.drafts.comfy.org'
    })
    expect(draftOf(draft.id)?.origin).toBe(PREVIEW)
    expect(draftPageUrl(draft.id)).toBeNull()
    expect(draftCards()).toEqual([])

    expect(confirmDraft(draft.id)?.id).toBe('draft-pr683-depth-swap')
    expect(draftPageUrl(draft.id)).toBe('https://comfy.org/apps/depth-swap/desktop.html')
    expect(draftCards().map((card) => card.id)).toEqual(['draft-pr683-depth-swap'])
    expect(mocks.handle).toHaveBeenCalledWith('https', expect.any(Function))
  })

  it('still lists a draft whose page could not be read, titled from its address', async () => {
    mocks.fetch.mockRejectedValue(new Error('offline'))
    const draft = await registerDraft({
      origin: PREVIEW,
      path: '/apps/depth-swap/',
      slug: 'depth-swap',
      pr: 683,
      mount: '/'
    })
    expect(draft.card.title).toBe('Depth Swap')
  })

  it('asks again next time once the person has moved on to another app', async () => {
    mocks.fetch.mockResolvedValue(new Response('<title>Depth Swap</title>'))
    const draft = await registerDraft({
      origin: PREVIEW,
      path: '/apps/depth-swap/',
      slug: 'depth-swap',
      pr: 683,
      mount: '/'
    })
    confirmDraft(draft.id)

    revokeDraft(draft.id)

    expect(draftPageUrl(draft.id)).toBeNull()
    expect(draftCards()).toEqual([])
    const again = await registerDraft({
      origin: PREVIEW,
      path: '/apps/depth-swap/',
      slug: 'depth-swap',
      pr: 683,
      mount: '/'
    })
    expect(again.accepted).toBe(false)
  })

  it.each([
    ['another site', 'https://evil.example', '/apps/depth-swap/', '/'],
    ['another page', PREVIEW, '/apps/depth-swap/desktop.html', '/'],
    ['another query', PREVIEW, '/apps/depth-swap/?example=3', '/']
  ])('asks again when the same draft now comes from %s', async (_why, origin, path, mount) => {
    mocks.fetch.mockResolvedValue(new Response(''))
    const first = await registerDraft({
      origin: PREVIEW,
      path: '/apps/depth-swap/',
      slug: 'depth-swap',
      pr: 683,
      mount: '/'
    })
    confirmDraft(first.id)

    const moved = await registerDraft({ origin, path, slug: 'depth-swap', pr: 683, mount })

    expect(moved.id).toBe(first.id)
    expect(moved.accepted).toBe(false)
    expect(draftCards()).toEqual([])
  })

  it('stays accepted when the same draft comes from the same address again', async () => {
    mocks.fetch.mockResolvedValue(new Response(''))
    const link = {
      origin: PREVIEW,
      path: '/apps/depth-swap/',
      slug: 'depth-swap',
      pr: 683,
      mount: '/'
    }
    confirmDraft((await registerDraft(link)).id)

    expect((await registerDraft(link)).accepted).toBe(true)
  })

  it('forgets every draft, so none is listed and none can be accepted', async () => {
    mocks.fetch.mockResolvedValue(new Response(''))
    const draft = await registerDraft(parsePastedDraft(`${PREVIEW}/apps/depth-swap/`)!)
    confirmDraft(draft.id)

    forgetDrafts()

    expect(draftCards()).toEqual([])
    expect(draftOf(draft.id)).toBeNull()
    expect(confirmDraft(draft.id)).toBeNull()
  })

  it('opens a pasted page under comfy.org/apps/draft/, titled from the page on its own site', async () => {
    mocks.fetch.mockResolvedValue(new Response('<title>My App</title>'))
    const draft = await registerDraft(parsePastedDraft('https://myapp.vercel.app/tools/?x=1')!)

    expect(mocks.fetch).toHaveBeenCalledWith('https://myapp.vercel.app/tools/?x=1', {
      bypassCustomProtocolHandlers: true
    })
    expect(draft.card).toMatchObject({
      id: 'draft-myapp-vercel-app-draft',
      title: 'My App',
      description: 'Draft from myapp.vercel.app'
    })
    confirmDraft(draft.id)
    expect(draftPageUrl(draft.id)).toBe('https://comfy.org/apps/draft/tools/?x=1')
  })

  it('gives two drafts from one site their own session when they are shown at different paths', async () => {
    mocks.fetch.mockResolvedValue(new Response(''))
    await registerDraft(parsePastedDraft('https://my.dev.box/apps/depth-swap/')!)
    await registerDraft(parsePastedDraft('https://my.dev.box/apps/depth-swap/desktop.html')!)
    expect(mocks.handle).toHaveBeenCalledTimes(1)

    await registerDraft(parsePastedDraft('https://my.dev.box/')!)
    expect(mocks.handle).toHaveBeenCalledTimes(2)
  })

  it('knows no page for an app that is not a draft', () => {
    expect(draftPageUrl('remove-background')).toBeNull()
  })
})
