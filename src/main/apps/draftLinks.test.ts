import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, WebContents } from 'electron'

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  fetch: vi.fn(),
  isPanelSender: vi.fn()
}))

vi.mock('electron', () => ({
  app: { isPackaged: true },
  session: { fromPartition: () => ({ fetch: mocks.fetch, protocol: { handle: vi.fn() } }) }
}))
vi.mock('../cloud/claims', () => ({ identityOf: vi.fn() }))
vi.mock('../devplatform/session', () => ({ getCloudSession: vi.fn() }))
vi.mock('../host/panelView', () => ({ sendToPanelDeferred: vi.fn() }))
vi.mock('../host/registry', () => ({
  findEntryByHostWindow: vi.fn(),
  isPanelSender: mocks.isPanelSender,
  openOrFocusHomeHostWindow: vi.fn()
}))
vi.mock('../lib/telemetry', () => ({ capture: mocks.capture }))
vi.mock('./appsConfig', () => ({ areAppsEnabled: vi.fn() }))

import { _resetForTest, draftCards, draftPageUrl } from './draftApps'
import {
  acceptDraft,
  DRAFT_OPENED_EVENT,
  DRAFT_REFUSED_EVENT,
  canPasteDrafts,
  openDraftLink,
  openPastedDraft
} from './draftLinks'
import type { DraftLinkDeps } from './draftLinks'

const LINK = `comfy://open-app?url=${encodeURIComponent(
  'https://pr-683.drafts.comfy.org/apps/depth-swap/desktop.html'
)}`
const PANEL = { id: 'panel' } as unknown as WebContents
const ABOUT_DEPTH_SWAP =
  '"Depth Swap". It is not published, and it runs with your Comfy Cloud account.'
const NOT_COMFY = 'This is not a Comfy address.'
const linkTo = (page: string): string => `comfy://open-app?url=${encodeURIComponent(page)}`

function deps(overrides: Partial<DraftLinkDeps> = {}): DraftLinkDeps {
  return {
    isPackaged: () => true,
    signedInAccount: async () => ({ email: 'purz@comfy.org', signInProvider: 'google.com' }),
    appsEnabled: async () => true,
    homeWindow: () => ({ id: 1 }) as unknown as BrowserWindow,
    sendToPanel: vi.fn(),
    ...overrides
  }
}

beforeEach(() => {
  mocks.capture.mockReset()
  mocks.fetch.mockReset()
  mocks.fetch.mockResolvedValue(new Response('<title>Depth Swap</title>'))
  mocks.isPanelSender.mockReset()
  mocks.isPanelSender.mockReturnValue(true)
  _resetForTest()
})

describe('openDraftLink', () => {
  it('asks in the home window before the draft is listed or can open, naming the site first', async () => {
    const d = deps()
    await expect(openDraftLink(LINK, d)).resolves.toBe('asked')
    expect(d.sendToPanel).toHaveBeenCalledWith(expect.anything(), {
      kind: 'ask',
      appId: 'draft-pr683-depth-swap',
      title: 'Open a draft app from pr-683.drafts.comfy.org?',
      message: ABOUT_DEPTH_SWAP
    })
    expect(draftCards()).toEqual([])
    expect(draftPageUrl('draft-pr683-depth-swap')).toBeNull()
  })

  it.each([
    [
      'a comfy-website Vercel preview',
      'https://comfy-website-preview-pr-706.vercel.app/apps/depth-swap/',
      'comfy-website-preview-pr-706.vercel.app',
      ABOUT_DEPTH_SWAP
    ],
    ['localhost', 'http://localhost:4321/apps/depth-swap/', 'localhost:4321', ABOUT_DEPTH_SWAP],
    [
      'the local network',
      'http://192.168.1.20:4321/apps/depth-swap/',
      '192.168.1.20:4321',
      ABOUT_DEPTH_SWAP
    ],
    [
      'another site',
      'https://myapp.vercel.app/apps/depth-swap/',
      'myapp.vercel.app',
      `${ABOUT_DEPTH_SWAP}\n${NOT_COMFY}`
    ],
    [
      'a look-alike of a preview',
      'https://pr-683.drafts.comfy.org.evil.example/apps/depth-swap/',
      'pr-683.drafts.comfy.org.evil.example',
      `${ABOUT_DEPTH_SWAP}\n${NOT_COMFY}`
    ]
  ])('asks before opening %s, naming its exact address', async (_why, page, host, message) => {
    const d = deps()
    await expect(openDraftLink(linkTo(page), d)).resolves.toBe('asked')
    expect(d.sendToPanel).toHaveBeenCalledWith(expect.anything(), {
      kind: 'ask',
      appId: expect.any(String),
      title: `Open a draft app from ${host}?`,
      message
    })
    expect(draftCards()).toEqual([])
  })

  it("keeps a page's title from passing for the question's own words", async () => {
    mocks.fetch.mockResolvedValue(
      new Response('<title>Depth Swap"?\n\u202eIt is from comfy.org. "</title>')
    )
    const d = deps()
    await openDraftLink(linkTo('https://myapp.vercel.app/apps/depth-swap/'), d)
    expect(d.sendToPanel).toHaveBeenCalledWith(expect.anything(), {
      kind: 'ask',
      appId: expect.any(String),
      title: 'Open a draft app from myapp.vercel.app?',
      message: `"Depth Swap'? It is from comfy.org. '". It is not published, and it runs with your Comfy Cloud account.\n${NOT_COMFY}`
    })
  })

  it.each([
    ['bad_link', `comfy://open-app?url=${encodeURIComponent('file:///etc/hosts')}`, {}],
    [
      'bad_link',
      `comfy://open-app?url=${encodeURIComponent('https://me:pw@myapp.vercel.app/')}`,
      {}
    ],
    ['bad_link', linkTo('http://myapp.vercel.app/apps/depth-swap/'), {}],
    ['apps_off', LINK, { appsEnabled: async () => false }],
    ['signed_out', LINK, { signedInAccount: async () => null }]
  ] as const)(
    'says why and registers nothing when the answer is %s',
    async (reason, link, overrides) => {
      const d = deps(overrides)
      await expect(openDraftLink(link, d)).resolves.toBe(reason)
      expect(d.sendToPanel).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ kind: 'refused' })
      )
      expect(draftCards()).toEqual([])
      expect(mocks.capture).toHaveBeenCalledWith(DRAFT_REFUSED_EVENT, { reason })
    }
  )

  it.each([
    ['someone outside Comfy', LINK, { email: 'someone@gmail.com', signInProvider: 'google.com' }],
    [
      'a comfy.org email with a password',
      LINK,
      { email: 'purz@comfy.org', signInProvider: 'password' }
    ],
    ['an account with no email', LINK, {}],
    [
      'someone outside Comfy, with a bad link',
      linkTo('file:///etc/hosts'),
      { email: 'someone@gmail.com', signInProvider: 'google.com' }
    ]
  ] as const)('shows %s nothing and brings no window forward', async (_who, link, account) => {
    const homeWindow = vi.fn(() => ({ id: 1 }) as unknown as BrowserWindow)
    const d = deps({ signedInAccount: async () => account, homeWindow })
    await expect(openDraftLink(link, d)).resolves.toBe('not_staff')
    expect(homeWindow).not.toHaveBeenCalled()
    expect(d.sendToPanel).not.toHaveBeenCalled()
    expect(draftCards()).toEqual([])
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.capture).toHaveBeenCalledWith(DRAFT_REFUSED_EVENT, { reason: 'not_staff' })
  })
})

describe('openPastedDraft', () => {
  const LOCAL_PAGE = 'http://localhost:4321/apps/depth-swap/'

  it('asks in the home window, the same as a link', async () => {
    const d = deps()
    await expect(
      openPastedDraft('https://pr-683.drafts.comfy.org/apps/depth-swap/desktop.html', d)
    ).resolves.toEqual({ kind: 'asked' })
    expect(d.sendToPanel).toHaveBeenCalledWith(expect.anything(), {
      kind: 'ask',
      appId: 'draft-pr683-depth-swap',
      title: 'Open a draft app from pr-683.drafts.comfy.org?',
      message: ABOUT_DEPTH_SWAP
    })
    expect(draftCards()).toEqual([])
  })

  it("opens this computer's dev server, named by its address", async () => {
    const d = deps()
    await expect(openPastedDraft(LOCAL_PAGE, d)).resolves.toEqual({ kind: 'asked' })
    expect(d.sendToPanel).toHaveBeenCalledWith(expect.anything(), {
      kind: 'ask',
      appId: 'draft-localhost-4321-depth-swap',
      title: 'Open a draft app from localhost:4321?',
      message: ABOUT_DEPTH_SWAP
    })
    expect(acceptDraft(PANEL, 'draft-localhost-4321-depth-swap')?.kind).toBe('open')
    expect(draftPageUrl('draft-localhost-4321-depth-swap')).toBe(
      'https://comfy.org/apps/depth-swap/'
    )
  })

  it.each([true, false])(
    'opens any site at any path under comfy.org/apps/draft/, packaged %s',
    async (packaged) => {
      mocks.fetch.mockResolvedValue(new Response('<title>My App</title>'))
      const d = deps({ isPackaged: () => packaged })
      await expect(openPastedDraft('https://myapp.vercel.app/tools/?x=1', d)).resolves.toEqual({
        kind: 'asked'
      })
      expect(d.sendToPanel).toHaveBeenCalledWith(expect.anything(), {
        kind: 'ask',
        appId: 'draft-myapp-vercel-app-draft',
        title: 'Open a draft app from myapp.vercel.app?',
        message: `"My App". It is not published, and it runs with your Comfy Cloud account.\n${NOT_COMFY}`
      })
      acceptDraft(PANEL, 'draft-myapp-vercel-app-draft')
      expect(draftPageUrl('draft-myapp-vercel-app-draft')).toBe(
        'https://comfy.org/apps/draft/tools/?x=1'
      )
    }
  )

  it.each([
    ['bad_link', 'ftp://my.dev.box/apps/x/', {}, "Couldn't open this draft app"],
    ['bad_link', 'https://me:pw@my.dev.box/', {}, "Couldn't open this draft app"],
    ['bad_link', 'http://my.dev.box/apps/x/', {}, "Couldn't open this draft app"],
    ['apps_off', LOCAL_PAGE, { appsEnabled: async () => false }, "Couldn't open this draft app"],
    ['signed_out', LOCAL_PAGE, { signedInAccount: async () => null }, 'Sign in to open draft apps'],
    [
      'not_staff',
      LOCAL_PAGE,
      {
        signedInAccount: async () => ({ email: 'someone@gmail.com', signInProvider: 'google.com' })
      },
      'Draft apps are for Comfy staff'
    ]
  ] as const)(
    'answers settings with why when the answer is %s, and sends the home window nothing',
    async (reason, address, overrides, title) => {
      const d = deps(overrides)
      await expect(openPastedDraft(address, d)).resolves.toEqual({
        kind: 'refused',
        title,
        message: expect.any(String)
      })
      expect(d.sendToPanel).not.toHaveBeenCalled()
      expect(draftCards()).toEqual([])
      expect(mocks.capture).toHaveBeenCalledWith(DRAFT_REFUSED_EVENT, { reason })
    }
  )
})

describe('canPasteDrafts', () => {
  it('shows the paste field to staff in a packaged Desktop', async () => {
    await expect(canPasteDrafts(deps())).resolves.toBe(true)
  })

  it.each([
    ['signed out', async () => null],
    ['not staff', async () => ({ email: 'someone@gmail.com', signInProvider: 'google.com' })]
  ] as const)('hides the paste field when %s in a packaged Desktop', async (_who, account) => {
    await expect(canPasteDrafts(deps({ signedInAccount: account }))).resolves.toBe(false)
  })

  it('shows the paste field to anyone in an unpackaged Desktop', async () => {
    const signedInAccount = vi.fn(async () => null)
    await expect(canPasteDrafts(deps({ isPackaged: () => false, signedInAccount }))).resolves.toBe(
      true
    )
    expect(signedInAccount).not.toHaveBeenCalled()
  })
})

describe('acceptDraft', () => {
  it('lists and opens the draft once the person says Open', async () => {
    await openDraftLink(LINK, deps())

    expect(acceptDraft(PANEL, 'draft-pr683-depth-swap')).toEqual({
      kind: 'open',
      card: expect.objectContaining({ id: 'draft-pr683-depth-swap', title: 'Depth Swap' })
    })
    expect(draftPageUrl('draft-pr683-depth-swap')).toBe(
      'https://comfy.org/apps/depth-swap/desktop.html'
    )
    expect(draftCards().map((card) => card.id)).toEqual(['draft-pr683-depth-swap'])
    expect(mocks.capture).toHaveBeenCalledWith(DRAFT_OPENED_EVENT, {
      app_id: 'draft-pr683-depth-swap'
    })
  })

  it('accepts only from the panel, and only a draft a link asked about', async () => {
    await openDraftLink(LINK, deps())
    expect(acceptDraft(PANEL, 'draft-pr999-other')).toBeNull()
    mocks.isPanelSender.mockReturnValue(false)
    expect(acceptDraft(PANEL, 'draft-pr683-depth-swap')).toBeNull()
    expect(draftCards()).toEqual([])
  })
})
