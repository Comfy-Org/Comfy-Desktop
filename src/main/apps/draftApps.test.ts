import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const comfyApps = {
    url: 'https://comfy.org/apps/',
    origin: 'https://comfy.org',
    scopePath: '/apps/'
  }
  return {
    fetch: vi.fn(),
    handle: vi.fn(),
    comfyApps,
    appsLocation: comfyApps
  }
})

vi.mock('../cloud/config', () => ({ CLOUD_CONFIG: { issuer: 'https://cloud.comfy.org' } }))
vi.mock('./appsConfig', () => ({ currentAppsLocation: () => mocks.appsLocation }))

vi.mock('electron', () => ({
  session: {
    fromPartition: () => ({ fetch: mocks.fetch, protocol: { handle: mocks.handle } })
  }
}))

import {
  _resetForTest,
  cloudHeaders,
  confirmDraft,
  currentDrafts,
  draftAskedWith,
  draftCards,
  draftIdOf,
  draftOf,
  draftPageUrl,
  draftsBelongTo,
  draftSourceOf,
  draftTagOf,
  findDraftLink,
  forgetDrafts,
  hasDrafts,
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
import type { AskedDraft, DraftLink } from './draftApps'

const PREVIEW = 'https://pr-683.drafts.comfy.org'
const OWNER = '["staff-subject","ws-1"]'
const linkTo = (url: string): string => `comfy://open-app?url=${encodeURIComponent(url)}`
const DEPTH_SWAP: DraftLink = {
  origin: PREVIEW,
  path: '/apps/depth-swap/',
  slug: 'depth-swap',
  pr: 683,
  mount: '/'
}

async function register(
  link: DraftLink,
  owner = OWNER,
  isStillOwner = (): boolean => true
): Promise<AskedDraft> {
  const draft = await registerDraft(link, owner, isStillOwner)
  if (!draft) throw new Error('The draft was dropped')
  return draft
}

function pageThatNeverEnds(chunks: string[], cancel: () => void = () => {}): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      },
      cancel
    })
  )
}

afterEach(() => {
  mocks.fetch.mockReset()
  mocks.handle.mockReset()
  mocks.appsLocation = mocks.comfyApps
  vi.useRealTimers()
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
    ['plain http to another site', 'http://myapp.example/apps/depth-swap/'],
    ['plain http to a public IPv6 address', 'http://[2001:db8::1]/apps/depth-swap/']
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
    'http://[fd00::1]:4321/apps/x/',
    'http://[fc12:3456::7]/',
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
  it('names a draft by its pull request and page, then a hash of where it is served from', () => {
    expect(
      draftIdOf({ origin: PREVIEW, path: '/apps/a/', slug: 'depth-swap', pr: 683, mount: '/' })
    ).toMatch(/^draft-pr683-depth-swap-[0-9a-f]{8}$/)
    expect(
      draftIdOf({
        origin: 'http://localhost:4321',
        path: '/apps/a/',
        slug: 'x',
        pr: null,
        mount: '/'
      })
    ).toMatch(/^draft-localhost-4321-x-[0-9a-f]{8}$/)
    expect(
      draftIdOf({ origin: 'https://my.dev.box', path: '/apps/a/', slug: 'x', pr: null, mount: '/' })
    ).toMatch(/^draft-my-dev-box-x-[0-9a-f]{8}$/)
    expect(draftIdOf(parsePastedDraft('https://myapp.vercel.app/')!)).toMatch(
      /^draft-myapp-vercel-app-draft-[0-9a-f]{8}$/
    )
  })

  it('keeps one id for one draft, whatever page of it was opened', () => {
    expect(draftIdOf({ ...DEPTH_SWAP, path: '/apps/depth-swap/desktop.html' })).toBe(
      draftIdOf(DEPTH_SWAP)
    )
  })

  it.each([
    [
      'hosts whose names read alike',
      { origin: 'https://a.b.example', pr: null, mount: '/' },
      { origin: 'https://a-b.example', pr: null, mount: '/' }
    ],
    [
      'two previews of one pull request',
      { origin: PREVIEW, pr: 683, mount: '/' },
      { origin: 'https://comfy-website-preview-pr-683.vercel.app', pr: 683, mount: '/' }
    ],
    [
      'one site shown at two paths',
      { origin: 'https://my.dev.box', pr: null, mount: '/' },
      { origin: 'https://my.dev.box', pr: null, mount: '/apps/draft/' }
    ]
  ])('gives %s their own ids', (_why, first, second) => {
    expect(draftIdOf({ ...DEPTH_SWAP, ...first })).not.toBe(draftIdOf({ ...DEPTH_SWAP, ...second }))
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
      '[fd00::1]',
      '[fdff:ffff::ffff]',
      '[fc00::]',
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
      '[2001:db8::1]',
      '[fd::1]',
      '[fe00::1]',
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
    expect(isComfyAddress(parsePastedDraft('http://[fd00::1]:4321/')!)).toBe(true)
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
    const draft = await register({
      origin: PREVIEW,
      path: '/apps/depth-swap/desktop.html',
      slug: 'depth-swap',
      pr: 683,
      mount: '/'
    })

    expect(draft.card).toMatchObject({
      id: draft.id,
      title: 'Depth Swap',
      description: 'Draft from pr-683.drafts.comfy.org'
    })
    expect(draft.id).toMatch(/^draft-pr683-depth-swap-/)
    expect(draftOf(draft.id)?.origin).toBe(PREVIEW)
    expect(draftPageUrl(draft.id)).toBeNull()
    expect(draftCards()).toEqual([])

    expect(confirmDraft(draft.token)?.id).toBe(draft.id)
    expect(draftPageUrl(draft.id)).toBe('https://comfy.org/apps/depth-swap/desktop.html')
    expect(draftCards().map((card) => card.id)).toEqual([draft.id])
    expect(mocks.handle).toHaveBeenCalledWith('https', expect.any(Function))
  })

  it('still lists a draft whose page could not be read, titled from its address', async () => {
    mocks.fetch.mockRejectedValue(new Error('offline'))
    const draft = await register({
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
    const draft = await register({
      origin: PREVIEW,
      path: '/apps/depth-swap/',
      slug: 'depth-swap',
      pr: 683,
      mount: '/'
    })
    confirmDraft(draft.token)

    revokeDraft(draft.id)

    expect(draftPageUrl(draft.id)).toBeNull()
    expect(draftCards()).toEqual([])
    const again = await register({
      origin: PREVIEW,
      path: '/apps/depth-swap/',
      slug: 'depth-swap',
      pr: 683,
      mount: '/'
    })
    expect(again.accepted).toBe(false)
  })

  it.each([
    ['another page', PREVIEW, '/apps/depth-swap/desktop.html', '/'],
    ['another query', PREVIEW, '/apps/depth-swap/?example=3', '/']
  ])('asks again when the same draft now comes from %s', async (_why, origin, path, mount) => {
    mocks.fetch.mockResolvedValue(new Response(''))
    const first = await register({
      origin: PREVIEW,
      path: '/apps/depth-swap/',
      slug: 'depth-swap',
      pr: 683,
      mount: '/'
    })
    confirmDraft(first.token)

    const moved = await register({ origin, path, slug: 'depth-swap', pr: 683, mount })

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
    confirmDraft((await register(link)).token)

    expect((await register(link)).accepted).toBe(true)
  })

  it('keeps a draft from a host whose name reads alike apart from the one already accepted', async () => {
    mocks.fetch.mockResolvedValue(new Response(''))
    const first = await register(parsePastedDraft('https://a.b.example/apps/x/')!)
    confirmDraft(first.token)

    const lookalike = await register(parsePastedDraft('https://a-b.example/apps/x/')!)

    expect(lookalike.id).not.toBe(first.id)
    expect(lookalike.accepted).toBe(false)
    expect(draftOf(first.id)?.origin).toBe('https://a.b.example')
    expect(draftCards().map((card) => card.id)).toEqual([first.id])
  })

  it('accepts a draft only with the token its question was sent with, and only once', async () => {
    mocks.fetch.mockResolvedValue(new Response(''))
    const draft = await register(DEPTH_SWAP)
    const token = draft.token

    expect(confirmDraft('')).toBeNull()
    expect(confirmDraft('a-token-never-sent')).toBeNull()
    expect(draftAskedWith(token)).toBe(draftOf(draft.id))
    expect(confirmDraft(token)?.id).toBe(draft.id)
    expect(draftAskedWith(token)).toBeNull()
    expect(confirmDraft(token)).toBeNull()
  })

  it('refuses the token of a question a newer registration replaced', async () => {
    mocks.fetch.mockResolvedValue(new Response(''))
    const first = await register(DEPTH_SWAP)
    const second = await register({ ...DEPTH_SWAP, path: '/apps/depth-swap/?example=3' })

    expect(second.id).toBe(first.id)
    expect(second.token).not.toBe(first.token)
    expect(confirmDraft(first.token)).toBeNull()
    expect(draftPageUrl(first.id)).toBeNull()
    expect(confirmDraft(second.token)?.id).toBe(second.id)
    expect(draftPageUrl(second.id)).toBe('https://comfy.org/apps/depth-swap/?example=3')
  })

  it('forgets every draft, so none is listed and none can be accepted', async () => {
    mocks.fetch.mockResolvedValue(new Response(''))
    const draft = await register(parsePastedDraft(`${PREVIEW}/apps/depth-swap/`)!)
    const unanswered = await register(parsePastedDraft('https://my.dev.box/apps/x/')!)
    confirmDraft(draft.token)

    forgetDrafts()

    expect(draftCards()).toEqual([])
    expect(draftOf(draft.id)).toBeNull()
    expect(confirmDraft(unanswered.token)).toBeNull()
  })

  it('forgets only the drafts it is given that were not registered again since', async () => {
    mocks.fetch.mockResolvedValue(new Response(''))
    const replaced = await register(DEPTH_SWAP)
    const other = await register(parsePastedDraft('https://my.dev.box/apps/x/')!)
    const checked = currentDrafts()
    const newer = await register({ ...DEPTH_SWAP, path: '/apps/depth-swap/?example=3' })
    const added = await register(parsePastedDraft(`${PREVIEW}/apps/other/`)!)

    forgetDrafts(checked)

    expect(checked).toEqual([replaced, other])
    expect(draftOf(other.id)).toBeNull()
    expect(draftOf(replaced.id)).toBe(newer)
    expect(draftOf(added.id)).toBe(added)
  })

  it('opens a pasted page under comfy.org/apps/draft/, titled from the page on its own site', async () => {
    mocks.fetch.mockResolvedValue(new Response('<title>My App</title>'))
    const draft = await register(parsePastedDraft('https://myapp.vercel.app/tools/?x=1')!)

    expect(mocks.fetch).toHaveBeenCalledWith('https://myapp.vercel.app/tools/?x=1', {
      bypassCustomProtocolHandlers: true,
      signal: expect.any(AbortSignal)
    })
    expect(draft.card).toMatchObject({
      id: draft.id,
      title: 'My App',
      description: 'Draft from myapp.vercel.app'
    })
    expect(draft.id).toMatch(/^draft-myapp-vercel-app-draft-/)
    confirmDraft(draft.token)
    expect(draftPageUrl(draft.id)).toBe('https://comfy.org/apps/draft/tools/?x=1')
  })

  it('gives two drafts from one site their own session when they are shown at different paths', async () => {
    mocks.fetch.mockResolvedValue(new Response(''))
    await register(parsePastedDraft('https://my.dev.box/apps/depth-swap/')!)
    await register(parsePastedDraft('https://my.dev.box/apps/depth-swap/desktop.html')!)
    expect(mocks.handle).toHaveBeenCalledTimes(1)

    await register(parsePastedDraft('https://my.dev.box/')!)
    expect(mocks.handle).toHaveBeenCalledTimes(2)
  })

  it('knows no page for an app that is not a draft', () => {
    expect(draftPageUrl('remove-background')).toBeNull()
  })

  it('stops reading a page that never finishes after 5 seconds, titled from its address', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    mocks.fetch.mockResolvedValue(pageThatNeverEnds(['<html><head>'], cancel))

    const registering = register(DEPTH_SWAP)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(cancel).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect((await registering).card.title).toBe('Depth Swap')
    expect(cancel).toHaveBeenCalled()
  })

  it('gives up on a server that never answers after 5 seconds, and aborts its request', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    mocks.fetch.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      signal = init.signal
      return new Promise(() => {})
    })

    const registering = register(DEPTH_SWAP)
    await vi.advanceTimersByTimeAsync(5_000)

    expect((await registering).card.title).toBe('Depth Swap')
    expect(signal?.aborted).toBe(true)
  })

  it('takes the title from a page that is still sending, without waiting for its end', async () => {
    mocks.fetch.mockResolvedValue(pageThatNeverEnds(['<html><head><title>Depth', ' Swap</title>']))

    expect((await register(DEPTH_SWAP)).card.title).toBe('Depth Swap')
  })

  it('reads no more than 64 KB of a page looking for its title', async () => {
    let sent = 0
    mocks.fetch.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            sent += 1024
            controller.enqueue(new Uint8Array(1024).fill(97))
          }
        })
      )
    )

    expect((await register(DEPTH_SWAP)).card.title).toBe('Depth Swap')
    expect(sent).toBeLessThan(80 * 1024)
  })

  it('drops a draft whose account changed while its page was loading', async () => {
    mocks.fetch.mockResolvedValue(new Response('<title>Depth Swap</title>'))

    await expect(registerDraft(DEPTH_SWAP, OWNER, () => false)).resolves.toBeNull()

    expect(draftOf(draftIdOf(DEPTH_SWAP))).toBeNull()
  })

  it('asks again when another account registers a draft the first account accepted', async () => {
    mocks.fetch.mockResolvedValue(new Response(''))
    confirmDraft((await register(DEPTH_SWAP)).token)

    const again = await register(DEPTH_SWAP, '["other-subject","ws-2"]')

    expect(again.accepted).toBe(false)
    expect(draftCards()).toEqual([])
  })

  it('tells whether every draft belongs to the account and workspace now signed in', async () => {
    expect(draftsBelongTo(null)).toBe(true)
    mocks.fetch.mockResolvedValue(new Response(''))
    await register(DEPTH_SWAP)

    expect(draftsBelongTo(OWNER)).toBe(true)
    expect(draftsBelongTo('["staff-subject","ws-2"]')).toBe(false)
    expect(draftsBelongTo(null)).toBe(false)
  })

  it('tells whether any draft is registered', async () => {
    expect(hasDrafts()).toBe(false)
    mocks.fetch.mockResolvedValue(new Response(''))
    await register(DEPTH_SWAP)
    expect(hasDrafts()).toBe(true)
    forgetDrafts()
    expect(hasDrafts()).toBe(false)
  })
})

describe('a draft with a developer apps address', () => {
  const LOCAL_APPS = {
    url: 'http://localhost:4321/apps/',
    origin: 'http://localhost:4321',
    scopePath: '/apps/'
  }

  it('opens at the apps address Desktop is set to, the same as a published app', async () => {
    mocks.appsLocation = LOCAL_APPS
    mocks.fetch.mockResolvedValue(new Response('<title>Depth Swap</title>'))
    const draft = await register(DEPTH_SWAP)

    expect(mocks.fetch).toHaveBeenCalledWith(`${PREVIEW}/apps/depth-swap/`, expect.anything())
    confirmDraft(draft.token)
    expect(draftPageUrl(draft.id)).toBe('http://localhost:4321/apps/depth-swap/')
  })

  it('serves the set apps address from the draft site, and no longer comfy.org', () => {
    mocks.appsLocation = LOCAL_APPS
    expect(mapToDraftOrigin('http://localhost:4321/apps/lib/run.js?v=2', PREVIEW, '/')).toBe(
      `${PREVIEW}/apps/lib/run.js?v=2`
    )
    expect(mapToDraftOrigin('https://comfy.org/apps/lib/run.js', PREVIEW, '/')).toBeNull()
  })

  it('handles plain http requests in the draft session when the apps address is http', async () => {
    mocks.appsLocation = LOCAL_APPS
    mocks.fetch.mockResolvedValue(new Response(''))
    await register(DEPTH_SWAP)

    expect(mocks.handle).toHaveBeenCalledWith('https', expect.any(Function))
    expect(mocks.handle).toHaveBeenCalledWith('http', expect.any(Function))
  })
})
