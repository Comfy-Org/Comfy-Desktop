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
vi.mock('./appsConfig', () => ({
  currentAppsLocation: () => ({
    url: 'https://comfy.org/apps/',
    origin: 'https://comfy.org',
    scopePath: '/apps/'
  })
}))

import { getCloudSession } from '../devplatform/session'
import type { DraftAppRequest } from '../../types/ipc'
import {
  _resetForTest,
  draftCards,
  draftOf,
  draftPageUrl,
  hasDrafts,
  parseStaffDraftPage,
  revokeDraft
} from './draftApps'
import {
  acceptDraft,
  cloudIdentity,
  DRAFT_OPENED_EVENT,
  DRAFT_REFUSED_EVENT,
  canPasteDrafts,
  draftsStillAllowed,
  isDraftStillAllowed,
  openDraftLink,
  openPastedDraft,
  openStaffDraft
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
const STAFF = '["staff-subject","ws-1"]'
const OTHER_ACCOUNT = '["other-subject","ws-9"]'
const STAFF_ACCOUNT = { email: 'purz@comfy.org', signInProvider: 'google.com' }
const OUTSIDER_ACCOUNT = { email: 'someone@gmail.com', signInProvider: 'google.com' }

type DraftQuestion = Extract<DraftAppRequest, { kind: 'ask' }>

const DEPTH_SWAP_ID = expect.stringMatching(/^draft-pr683-depth-swap-[0-9a-f]{8}$/)

function questionSentBy(d: DraftLinkDeps): DraftQuestion {
  const sent = vi.mocked(d.sendToPanel).mock.calls.at(-1)?.[1]
  if (sent?.kind !== 'ask') throw new Error('No draft app question was sent')
  return sent
}

async function askedAbout(link: string, d: DraftLinkDeps = deps()): Promise<DraftQuestion> {
  await openDraftLink(link, d)
  return questionSentBy(d)
}

function deps(overrides: Partial<DraftLinkDeps> = {}): DraftLinkDeps {
  return {
    isPackaged: () => true,
    signedInAccount: async () => STAFF_ACCOUNT,
    cloudIdentity: () => STAFF,
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
      appId: DEPTH_SWAP_ID,
      token: expect.any(String),
      title: 'Open a draft app from pr-683.drafts.comfy.org?',
      message: ABOUT_DEPTH_SWAP
    })
    expect(draftCards()).toEqual([])
    expect(draftPageUrl(questionSentBy(d).appId)).toBeNull()
  })

  it('sends a new token with every question, even for the same draft', async () => {
    const first = await askedAbout(LINK)
    const second = await askedAbout(LINK)

    expect(second.appId).toBe(first.appId)
    expect(second.token).not.toBe(first.token)
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
      token: expect.any(String),
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
      token: expect.any(String),
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
      appId: DEPTH_SWAP_ID,
      token: expect.any(String),
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
      appId: expect.stringMatching(/^draft-localhost-4321-depth-swap-/),
      token: expect.any(String),
      title: 'Open a draft app from localhost:4321?',
      message: ABOUT_DEPTH_SWAP
    })
    const question = questionSentBy(d)
    expect((await acceptDraft(PANEL, question.token, d))?.kind).toBe('open')
    expect(draftPageUrl(question.appId)).toBe('https://comfy.org/apps/depth-swap/')
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
        appId: expect.stringMatching(/^draft-myapp-vercel-app-draft-/),
        token: expect.any(String),
        title: 'Open a draft app from myapp.vercel.app?',
        message: `"My App". It is not published, and it runs with your Comfy Cloud account.\n${NOT_COMFY}`
      })
      const question = questionSentBy(d)
      await acceptDraft(PANEL, question.token, d)
      expect(draftPageUrl(question.appId)).toBe('https://comfy.org/apps/draft/tools/?x=1')
    }
  )

  it.each([
    ['bad_link', 'ftp://my.dev.box/apps/x/', {}, "Couldn't open this draft app"],
    ['bad_link', 'https://me:pw@my.dev.box/', {}, "Couldn't open this draft app"],
    ['bad_link', 'http://my.dev.box/apps/x/', {}, "Couldn't open this draft app"],
    ['signed_out', LOCAL_PAGE, { signedInAccount: async () => null }, 'Sign in to open draft apps'],
    [
      'not_staff',
      LOCAL_PAGE,
      {
        signedInAccount: async () => ({ email: 'someone@gmail.com', signInProvider: 'google.com' })
      },
      'Draft apps are for Comfy staff'
    ]
  ] as [string, string, Partial<DraftLinkDeps>, string][])(
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

describe('openStaffDraft', () => {
  const COMPOSE_SCENE = parseStaffDraftPage(
    'https://comfy-website-preview-pr-445.vercel.app/apps/compose-scene/desktop.html',
    'compose-scene'
  )!

  beforeEach(() => {
    mocks.fetch.mockResolvedValue(new Response('<title>Compose Scene</title>'))
  })

  it('answers the Development page with the same question as a link, and sends the home window nothing', async () => {
    const d = deps()
    const question = await openStaffDraft(COMPOSE_SCENE, d)

    expect(question).toEqual({
      kind: 'ask',
      appId: expect.stringMatching(/^draft-pr445-compose-scene-[0-9a-f]{8}$/),
      token: expect.any(String),
      title: 'Open a draft app from comfy-website-preview-pr-445.vercel.app?',
      message: '"Compose Scene". It is not published, and it runs with your Comfy Cloud account.'
    })
    expect(d.sendToPanel).not.toHaveBeenCalled()
    expect(draftCards()).toEqual([])
    if (question.kind !== 'ask') throw new Error('No draft app question was asked')
    expect(draftPageUrl(question.appId)).toBeNull()
  })

  it('opens the draft at comfy.org once the person says Open', async () => {
    const d = deps()
    const question = await openStaffDraft(COMPOSE_SCENE, d)
    if (question.kind !== 'ask') throw new Error('No draft app question was asked')

    expect((await acceptDraft(PANEL, question.token, d))?.kind).toBe('open')
    expect(draftPageUrl(question.appId)).toBe('https://comfy.org/apps/compose-scene/desktop.html')
    expect(mocks.capture).toHaveBeenCalledWith(DRAFT_OPENED_EVENT, { app_id: question.appId })
  })

  it.each([
    ['signed_out', { signedInAccount: async () => null }, 'Sign in to open draft apps'],
    [
      'not_staff',
      { signedInAccount: async () => OUTSIDER_ACCOUNT },
      'Draft apps are for Comfy staff'
    ],
    [
      'not_staff',
      { signedInAccount: async () => ({ email: 'purz@comfy.org', signInProvider: 'password' }) },
      'Draft apps are for Comfy staff'
    ]
  ] as [string, Partial<DraftLinkDeps>, string][])(
    'refuses with why when the answer is %s, and registers no draft',
    async (reason, overrides, title) => {
      const d = deps(overrides)
      await expect(openStaffDraft(COMPOSE_SCENE, d)).resolves.toEqual({
        kind: 'refused',
        title,
        message: expect.any(String)
      })
      expect(hasDrafts()).toBe(false)
      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(mocks.capture).toHaveBeenCalledWith(DRAFT_REFUSED_EVENT, { reason })
    }
  )

  it('refuses when the account changes while the draft page loads', async () => {
    let identity: string | null = STAFF
    mocks.fetch.mockImplementation(async () => {
      identity = OTHER_ACCOUNT
      return new Response('<title>Compose Scene</title>')
    })

    await expect(
      openStaffDraft(COMPOSE_SCENE, deps({ cloudIdentity: () => identity }))
    ).resolves.toEqual({
      kind: 'refused',
      title: "Couldn't open this draft app",
      message: 'The Comfy Cloud account changed while the draft app was loading. Try again.'
    })
    expect(hasDrafts()).toBe(false)
  })
})

describe('canPasteDrafts', () => {
  it('shows the paste field to staff in a packaged Desktop', async () => {
    await expect(canPasteDrafts(deps())).resolves.toBe(true)
  })

  it.each([
    ['signed out', async () => null],
    ['not staff', async () => ({ email: 'someone@gmail.com', signInProvider: 'google.com' })]
  ] as [string, DraftLinkDeps['signedInAccount']][])(
    'hides the paste field when %s in a packaged Desktop',
    async (_who, account) => {
      await expect(canPasteDrafts(deps({ signedInAccount: account }))).resolves.toBe(false)
    }
  )

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
    const d = deps()
    const { appId, token } = await askedAbout(LINK, d)

    expect(await acceptDraft(PANEL, token, d)).toEqual({
      kind: 'open',
      card: expect.objectContaining({ id: appId, title: 'Depth Swap' })
    })
    expect(draftPageUrl(appId)).toBe('https://comfy.org/apps/depth-swap/desktop.html')
    expect(draftCards().map((card) => card.id)).toEqual([appId])
    expect(mocks.capture).toHaveBeenCalledWith(DRAFT_OPENED_EVENT, { app_id: appId })
  })

  it('accepts only from the panel, and only with the token a question was sent with', async () => {
    const d = deps()
    const { appId, token } = await askedAbout(LINK, d)
    expect(await acceptDraft(PANEL, appId, d)).toBeNull()
    expect(await acceptDraft(PANEL, 'a-token-never-sent', d)).toBeNull()
    expect(await acceptDraft(PANEL, 42, d)).toBeNull()
    mocks.isPanelSender.mockReturnValue(false)
    expect(await acceptDraft(PANEL, token, d)).toBeNull()
    expect(draftCards()).toEqual([])
  })

  it('opens what the first question showed or nothing, when a look-alike host asked after it', async () => {
    const first = await askedAbout(linkTo('https://a.b.example/apps/x/'))
    const lookalike = await askedAbout(linkTo('https://a-b.example/apps/x/'))
    expect(lookalike.appId).not.toBe(first.appId)

    expect(await acceptDraft(PANEL, first.token, deps())).toEqual({
      kind: 'open',
      card: expect.objectContaining({ id: first.appId })
    })
    expect(draftOf(first.appId)?.origin).toBe('https://a.b.example')
    expect(draftPageUrl(lookalike.appId)).toBeNull()
  })

  it('refuses the Open of a question that a newer registration of the same draft replaced', async () => {
    const first = await askedAbout(LINK)
    const replaced = await askedAbout(
      linkTo('https://pr-683.drafts.comfy.org/apps/depth-swap/?example=3')
    )
    expect(replaced.appId).toBe(first.appId)

    expect(await acceptDraft(PANEL, first.token, deps())).toBeNull()
    expect(draftPageUrl(first.appId)).toBeNull()
    expect((await acceptDraft(PANEL, replaced.token, deps()))?.kind).toBe('open')
  })

  it('takes one Open per question', async () => {
    const { token } = await askedAbout(LINK)

    expect((await acceptDraft(PANEL, token, deps()))?.kind).toBe('open')
    expect(await acceptDraft(PANEL, token, deps())).toBeNull()
  })

  it.each([
    ['another account is now signed in', { cloudIdentity: () => OTHER_ACCOUNT }],
    ['the account moved to another workspace', { cloudIdentity: () => '["staff-subject","ws-2"]' }],
    ['the person signed out', { cloudIdentity: () => null, signedInAccount: async () => null }],
    ['the account is no longer staff', { signedInAccount: async () => OUTSIDER_ACCOUNT }]
  ] as [string, Partial<DraftLinkDeps>][])(
    'does not open a draft staff asked for when %s',
    async (_why, overrides) => {
      const { appId, token } = await askedAbout(LINK)

      expect(await acceptDraft(PANEL, token, deps(overrides))).toBeNull()
      expect(draftPageUrl(appId)).toBeNull()
      expect(draftCards()).toEqual([])
      expect(mocks.capture).not.toHaveBeenCalledWith(DRAFT_OPENED_EVENT, expect.anything())
    }
  )

  it('does not open the draft when the account changes while Desktop checks it is staff', async () => {
    const { appId, token } = await askedAbout(LINK)
    let identity: string = STAFF
    const d = deps({
      cloudIdentity: () => identity,
      signedInAccount: async () => {
        identity = OTHER_ACCOUNT
        return STAFF_ACCOUNT
      }
    })

    expect(await acceptDraft(PANEL, token, d)).toBeNull()
    expect(draftPageUrl(appId)).toBeNull()
  })
})

describe('cloudIdentity', () => {
  function signedIn(subject: string | null, workspaceId: string | null): void {
    vi.mocked(getCloudSession).mockReturnValue({
      currentSubject: () => subject,
      currentWorkspaceId: () => workspaceId
    } as unknown as ReturnType<typeof getCloudSession>)
  }

  it('names the signed-in account and its workspace together', () => {
    signedIn('staff-subject', 'ws-1')
    const first = cloudIdentity()
    signedIn('staff-subject', 'ws-2')
    const otherWorkspace = cloudIdentity()
    signedIn('other-subject', 'ws-1')

    expect(first).not.toBeNull()
    expect(otherWorkspace).not.toBe(first)
    expect(cloudIdentity()).not.toBe(first)
    signedIn('staff-subject', 'ws-1')
    expect(cloudIdentity()).toBe(first)
  })

  it('is null when no one is signed in', () => {
    signedIn(null, 'ws-1')
    expect(cloudIdentity()).toBeNull()
  })
})

describe('an account change while a draft is loading', () => {
  function changeAccountDuringLoad(): DraftLinkDeps {
    let identity: string | null = STAFF
    mocks.fetch.mockImplementation(async () => {
      identity = OTHER_ACCOUNT
      return new Response('<title>Depth Swap</title>')
    })
    return deps({ cloudIdentity: () => identity })
  }

  it('drops a link that finishes loading after the account changed, and asks nothing', async () => {
    const d = changeAccountDuringLoad()

    await expect(openDraftLink(LINK, d)).resolves.toBe('account_changed')

    expect(d.sendToPanel).not.toHaveBeenCalled()
    expect(hasDrafts()).toBe(false)
    expect(mocks.capture).toHaveBeenCalledWith(DRAFT_REFUSED_EVENT, { reason: 'account_changed' })
  })

  it('tells settings to try again when a pasted address finishes loading after the account changed', async () => {
    const homeWindow = vi.fn(() => ({ id: 1 }) as unknown as BrowserWindow)
    const d = { ...changeAccountDuringLoad(), homeWindow }

    await expect(
      openPastedDraft('https://pr-683.drafts.comfy.org/apps/depth-swap/', d)
    ).resolves.toEqual({
      kind: 'refused',
      title: "Couldn't open this draft app",
      message: 'The Comfy Cloud account changed while the draft app was loading. Try again.'
    })
    expect(homeWindow).not.toHaveBeenCalled()
    expect(d.sendToPanel).not.toHaveBeenCalled()
    expect(hasDrafts()).toBe(false)
  })

  it('leaves a later account nothing to accept', async () => {
    const d = changeAccountDuringLoad()
    await openDraftLink(LINK, d)

    expect(d.sendToPanel).not.toHaveBeenCalled()
    expect(hasDrafts()).toBe(false)
    expect(draftCards()).toEqual([])
  })
})

describe('a draft page asking Desktop for its Cloud account', () => {
  async function acceptedDraft(): Promise<string> {
    const { appId, token } = await askedAbout(LINK)
    await acceptDraft(PANEL, token, deps())
    return appId
  }

  it('is allowed while the account that said Open is signed in and still staff', async () => {
    const appId = await acceptedDraft()

    await expect(isDraftStillAllowed(appId, deps())).resolves.toBe(true)
  })

  it('is refused before the person says Open', async () => {
    const { appId } = await askedAbout(LINK)

    await expect(isDraftStillAllowed(appId, deps())).resolves.toBe(false)
  })

  it('is refused once the draft is dropped, as when the person goes back to all apps', async () => {
    const appId = await acceptedDraft()

    revokeDraft(appId)

    await expect(isDraftStillAllowed(appId, deps())).resolves.toBe(false)
  })

  it.each([
    ['another account is now signed in', { cloudIdentity: () => OTHER_ACCOUNT }],
    ['the account moved to another workspace', { cloudIdentity: () => '["staff-subject","ws-2"]' }],
    ['the person signed out', { cloudIdentity: () => null, signedInAccount: async () => null }],
    [
      'the same account signed in again with a password',
      { signedInAccount: async () => ({ email: 'purz@comfy.org', signInProvider: 'password' }) }
    ],
    ['the account is no longer staff', { signedInAccount: async () => OUTSIDER_ACCOUNT }]
  ] as [string, Partial<DraftLinkDeps>][])('is refused when %s', async (_why, overrides) => {
    const appId = await acceptedDraft()

    await expect(isDraftStillAllowed(appId, deps(overrides))).resolves.toBe(false)
  })

  it('is refused when the account changes while Desktop checks it is staff', async () => {
    const appId = await acceptedDraft()
    let identity: string = STAFF
    const d = deps({
      cloudIdentity: () => identity,
      signedInAccount: async () => {
        identity = OTHER_ACCOUNT
        return STAFF_ACCOUNT
      }
    })

    await expect(isDraftStillAllowed(appId, d)).resolves.toBe(false)
  })
})

describe('draftsStillAllowed', () => {
  it('keeps no drafts without asking who is signed in', async () => {
    const signedInAccount = vi.fn(async () => null)

    await expect(draftsStillAllowed(deps({ signedInAccount }))).resolves.toBe(true)
    expect(signedInAccount).not.toHaveBeenCalled()
  })

  it('keeps the drafts when the account and workspace stayed the same, as after a failed workspace switch', async () => {
    await askedAbout(LINK)

    await expect(draftsStillAllowed(deps())).resolves.toBe(true)
  })

  it.each([
    ['another account is now signed in', { cloudIdentity: () => OTHER_ACCOUNT }],
    ['the account moved to another workspace', { cloudIdentity: () => '["staff-subject","ws-2"]' }],
    ['the person signed out', { cloudIdentity: () => null, signedInAccount: async () => null }],
    [
      'the same account signed in again with a password',
      { signedInAccount: async () => ({ email: 'purz@comfy.org', signInProvider: 'password' }) }
    ]
  ] as [string, Partial<DraftLinkDeps>][])('drops the drafts when %s', async (_why, overrides) => {
    await askedAbout(LINK)

    await expect(draftsStillAllowed(deps(overrides))).resolves.toBe(false)
  })
})
