import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as WorkspaceTokenModule from '../cloud/workspaceToken'

const mocks = vi.hoisted(() => ({
  enabled: true,
  generation: 0,
  flagRead: null as Promise<boolean> | null,
  getGrantAccessToken: vi.fn<() => Promise<string | null>>(),
  mint: vi.fn(),
  partnerMint: vi.fn(),
  current: 'ws-1',
  entries: [] as unknown[]
}))

vi.mock('./telemetry', () => ({ emit: vi.fn() }))
vi.mock('./embeddedSessionFlag', () => ({
  isEmbeddedSessionEnabled: async () => (mocks.flagRead ? mocks.flagRead : mocks.enabled)
}))
vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({
    getGrantAccessToken: mocks.getGrantAccessToken,
    heldWorkspaceToken: () => null,
    currentWorkspaceId: () => mocks.current,
    currentSubject: () => (mocks.current ? 'user-1' : null),
    currentGrantFamily: () => null,
    currentAuthGeneration: () => mocks.generation,
    isWorkspaceMintAllowed: async () => true,
    endGrantFamily: () => {}
  }),
  rejectAccessToken: vi.fn()
}))
vi.mock('../cloud/workspaceToken', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceTokenModule>()),
  mintWorkspaceToken: mocks.mint,
  mintPartnerNodeToken: mocks.partnerMint,
  renewPartnerNodeToken: vi.fn()
}))
vi.mock('../host/registry', () => ({
  get comfyWindows() {
    return new Map(mocks.entries.map((entry, index) => [index, entry]))
  },
  findEntryByComfySender: (wc: unknown) =>
    (mocks.entries as Array<{ comfyView: { webContents: unknown } }>).find(
      (entry) => entry.comfyView.webContents === wc
    ) ?? null
}))

import {
  billingHandoffForSender,
  EMBEDDED_SESSION_CHANNELS,
  EMBEDDED_SESSION_DISABLED_EVENT,
  _resetForTest as resetEmbeddedSession,
  partnerNodeTokenForSender,
  workspaceTokenForSender,
  broadcastEmbeddedSessionChanged,
  stateForSender,
  switchWorkspaceForSender
} from './embeddedSession'
import type { EmbeddedSessionSender } from './embeddedSession'
import { CLOUD_CONFIG } from '../cloud/config'
import * as mainTelemetry from './telemetry'
import { _resetForTest as resetViewGrants } from './viewWorkspaceGrants'

function jwt(claims: Record<string, unknown>): string {
  const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${b64({ alg: 'ES256' })}.${b64({ scope: CLOUD_CONFIG.scope, ...claims })}.sig`
}

const ACCESS = jwt({ sub: 'user-1', email: 'a@example.com', workspace_id: 'ws-1' })
function mintedFor(workspaceId: string): string {
  return jwt({ sub: 'user-1', workspace_id: workspaceId, auth_method: 'cloud', scope: undefined })
}

const MINTED = mintedFor('ws-1')

function partnerNodeFor(workspaceId: string): string {
  return jwt({ sub: 'user-1', workspace_id: workspaceId, aud: 'comfy-partner-node', sid: 's-1' })
}

interface ViewOptions {
  frameUrl?: string
  installationId?: string | null
  subframe?: boolean
}

function view(comfyUrl: string, options: ViewOptions = {}) {
  const frameUrl = options.frameUrl ?? comfyUrl
  const mainFrame = { processId: 1, routingId: 1, url: frameUrl }
  const webContents = {
    mainFrame,
    isDestroyed: () => false,
    getURL: () => frameUrl,
    send: vi.fn()
  }
  mocks.entries.push({
    installationId: options.installationId === undefined ? 'inst-1' : options.installationId,
    comfyUrl,
    comfyView: { webContents }
  })
  const senderFrame = options.subframe ? { processId: 1, routingId: 2, url: frameUrl } : mainFrame
  const event = { sender: webContents, senderFrame } as unknown as EmbeddedSessionSender
  return { event, webContents }
}

beforeEach(() => {
  mocks.enabled = true
  mocks.generation = 0
  mocks.flagRead = null
  mocks.entries = []
  mocks.getGrantAccessToken.mockReset().mockResolvedValue(ACCESS)
  mocks.mint.mockReset().mockImplementation(async (_grant: string, workspaceId: string) => ({
    kind: 'minted',
    token: mintedFor(workspaceId),
    expiresAt: Date.now() + 900_000
  }))
  mocks.partnerMint.mockReset().mockImplementation(async (_grant: string, workspaceId: string) => ({
    kind: 'minted',
    token: partnerNodeFor(workspaceId),
    expiresAt: Date.now() + 90 * 60_000
  }))
  mocks.current = 'ws-1'
  resetViewGrants()
  resetEmbeddedSession()
  vi.mocked(mainTelemetry.emit).mockClear()
})

function disabledEvents(): unknown[] {
  return vi
    .mocked(mainTelemetry.emit)
    .mock.calls.filter(([event]) => event === EMBEDDED_SESSION_DISABLED_EVENT)
}

describe('embeddedSession', () => {
  it.each([
    ['local ComfyUI on 127.0.0.1', 'http://127.0.0.1:8000', {}],
    ['local ComfyUI on localhost', 'http://localhost:8188', {}],
    ['local ComfyUI on [::1]', 'http://[::1]:8188', {}]
  ])('shares the session with %s', async (_name, comfyUrl, options) => {
    const { event } = view(comfyUrl, options)

    await expect(stateForSender(event)).resolves.toEqual({
      status: 'signed_in',
      userId: 'user-1',
      email: 'a@example.com',
      workspaceId: 'ws-1'
    })
    await expect(workspaceTokenForSender(event, 'ws-1')).resolves.toBe(MINTED)
    await expect(partnerNodeTokenForSender(event, 'ws-1')).resolves.toBe(partnerNodeFor('ws-1'))
  })

  it.each([
    ['a remote ComfyUI', 'http://192.168.1.20:8188', {}],
    ['an https host', 'https://cloud.comfy.org', {}],
    ['a view that navigated away', 'http://127.0.0.1:8000', { frameUrl: 'https://evil.example' }],
    ['a subframe', 'http://127.0.0.1:8000', { subframe: true }],
    ['a view with no installation', 'http://127.0.0.1:8000', { installationId: null }]
  ])('refuses %s', async (_name, comfyUrl, options: ViewOptions) => {
    const { event } = view(comfyUrl, options)

    await expect(stateForSender(event)).resolves.toEqual({ status: 'disabled' })
    await expect(workspaceTokenForSender(event, 'ws-1')).resolves.toBeNull()
    await expect(partnerNodeTokenForSender(event, 'ws-1')).resolves.toBeNull()
    expect(mocks.getGrantAccessToken).not.toHaveBeenCalled()
  })

  it.each([
    ['its own workspace', 'ws-1', partnerNodeFor('ws-1')],
    ['no workspace', undefined, null],
    ['an empty workspace', '', null],
    ['another workspace', 'ws-2', null],
    ['a non-string workspace', 42, null]
  ])(
    'releases the partner-node token for %s only on an exact match',
    async (_name, workspaceId, expected) => {
      const { event } = view('http://127.0.0.1:8000')

      await expect(partnerNodeTokenForSender(event, workspaceId)).resolves.toBe(expected)
    }
  )

  it.each([
    ['workspace', workspaceTokenForSender],
    ['partner-node', partnerNodeTokenForSender]
  ])('drops a %s token request whose flag read spans a sign-in', async (_name, tokenForSender) => {
    let release: (enabled: boolean) => void = () => {}
    mocks.flagRead = new Promise((resolve) => {
      release = resolve
    })
    const { event } = view('http://127.0.0.1:8000')
    const pending = tokenForSender(event, 'ws-1')
    mocks.generation += 1
    release(true)

    await expect(pending).resolves.toBeNull()
    expect(mocks.getGrantAccessToken).not.toHaveBeenCalled()
  })

  it('T-V6: hands a view switched to B a partner-node token for B, and a bystander none', async () => {
    const switcher = view('http://127.0.0.1:8000')
    const bystander = view('http://127.0.0.1:8001')
    await switchWorkspaceForSender(switcher.event, 'ws-2', async () => {
      mocks.current = 'ws-2'
      return { status: { signedIn: true, workspaceId: 'ws-2' }, reached: true }
    })

    await expect(partnerNodeTokenForSender(switcher.event, 'ws-2')).resolves.toBe(
      partnerNodeFor('ws-2')
    )
    await expect(partnerNodeTokenForSender(bystander.event, 'ws-2')).resolves.toBeNull()
    expect(mocks.partnerMint).toHaveBeenCalledExactlyOnceWith(ACCESS, 'ws-2')
  })

  it.each([
    ['its own workspace', 'ws-1', MINTED],
    ['no workspace', undefined, null],
    ['an empty workspace', '', null],
    ['another workspace', 'ws-2', null],
    ['a non-string workspace', 42, null]
  ])(
    'releases the workspace token for %s only on an exact match',
    async (_name, workspaceId, expected) => {
      const { event } = view('http://127.0.0.1:8000')

      await expect(workspaceTokenForSender(event, workspaceId)).resolves.toBe(expected)
    }
  )

  it('switches a signed-in view to the workspace it names and returns the new state', async () => {
    const { event } = view('http://127.0.0.1:8000')
    const switchWorkspace = vi.fn(async (workspaceId: string) => {
      mocks.current = workspaceId
      return { status: { signedIn: true, workspaceId }, reached: true }
    })

    await expect(switchWorkspaceForSender(event, 'ws-2', switchWorkspace)).resolves.toEqual({
      status: 'signed_in',
      userId: 'user-1',
      email: 'a@example.com',
      workspaceId: 'ws-2'
    })
    expect(switchWorkspace).toHaveBeenCalledWith('ws-2')
  })

  it('releases the workspace a view switched to only to that view', async () => {
    const switcher = view('http://127.0.0.1:8000')
    const bystander = view('http://127.0.0.1:8001')
    const switchWorkspace = vi.fn(async (workspaceId: string) => {
      mocks.current = workspaceId
      return { status: { signedIn: true, workspaceId }, reached: true }
    })

    await switchWorkspaceForSender(switcher.event, 'ws-2', switchWorkspace)

    await expect(workspaceTokenForSender(switcher.event, 'ws-2')).resolves.toBe(mintedFor('ws-2'))
    await expect(workspaceTokenForSender(bystander.event, 'ws-2')).resolves.toBeNull()
  })

  it.each([
    ['failed', 'ws-1'],
    ['did not reach although the session already names', 'ws-2']
  ])('does not let a view hold a workspace its switch %s it', async (_name, reportedWorkspace) => {
    const switcher = view('http://127.0.0.1:8000')
    const unreachedSwitch = vi.fn(async () => ({
      status: { signedIn: true, workspaceId: reportedWorkspace },
      reached: false
    }))

    await switchWorkspaceForSender(switcher.event, 'ws-2', unreachedSwitch)
    mocks.current = 'ws-2'

    await expect(workspaceTokenForSender(switcher.event, 'ws-2')).resolves.toBeNull()
  })

  it.each([
    ['a remote view', 'http://192.168.1.20:8188', 'ws-2', ACCESS, { status: 'disabled' }],
    ['a signed-out session', 'http://127.0.0.1:8000', 'ws-2', null, { status: 'signed_out' }],
    ['an empty workspace', 'http://127.0.0.1:8000', '', ACCESS, undefined],
    ['a non-string workspace', 'http://127.0.0.1:8000', 42, ACCESS, undefined]
  ])('does not switch for %s', async (_name, comfyUrl, workspaceId, token, expected) => {
    mocks.getGrantAccessToken.mockResolvedValue(token)
    const { event } = view(comfyUrl)
    const switchWorkspace = vi.fn(async () => ({ status: { signedIn: true }, reached: true }))

    const state = await switchWorkspaceForSender(event, workspaceId, switchWorkspace)

    expect(switchWorkspace).not.toHaveBeenCalled()
    if (expected) expect(state).toEqual(expected)
    else expect(state).toMatchObject({ status: 'signed_in', workspaceId: 'ws-1' })
  })

  it('does not switch while the ops flag is off', async () => {
    mocks.enabled = false
    const { event } = view('http://127.0.0.1:8000')
    const switchWorkspace = vi.fn(async () => ({ status: { signedIn: true }, reached: true }))

    await expect(switchWorkspaceForSender(event, 'ws-2', switchWorkspace)).resolves.toEqual({
      status: 'disabled'
    })
    expect(switchWorkspace).not.toHaveBeenCalled()
  })

  it('refuses an unregistered sender', async () => {
    const event = {
      sender: { mainFrame: { processId: 1, routingId: 1 } },
      senderFrame: { processId: 1, routingId: 1, url: 'http://127.0.0.1:8000' }
    } as unknown as EmbeddedSessionSender

    await expect(stateForSender(event)).resolves.toEqual({ status: 'disabled' })
    await expect(workspaceTokenForSender(event, 'ws-1')).resolves.toBeNull()
  })

  it('stays disabled while the ops flag is off', async () => {
    mocks.enabled = false
    const { event } = view('http://127.0.0.1:8000')

    await expect(stateForSender(event)).resolves.toEqual({ status: 'disabled' })
    await expect(workspaceTokenForSender(event, 'ws-1')).resolves.toBeNull()
    await expect(partnerNodeTokenForSender(event, 'ws-1')).resolves.toBeNull()
    expect(mocks.getGrantAccessToken).not.toHaveBeenCalled()
  })

  it('reports once per process that the ops flag left a local view without the session', async () => {
    mocks.enabled = false
    const first = view('http://127.0.0.1:8000')
    const second = view('http://localhost:8188')

    await stateForSender(first.event)
    await stateForSender(second.event)
    await workspaceTokenForSender(second.event, 'ws-1')

    expect(disabledEvents()).toEqual([[EMBEDDED_SESSION_DISABLED_EVENT]])
  })

  it.each<[string, (event: EmbeddedSessionSender) => Promise<unknown>]>([
    ['a workspace token', (event) => workspaceTokenForSender(event, 'ws-1')],
    ['a partner-node token', (event) => partnerNodeTokenForSender(event, 'ws-1')]
  ])('reports a local view that only asks for %s while the ops flag is off', async (_name, ask) => {
    mocks.enabled = false
    const { event } = view('http://127.0.0.1:8000')

    await expect(ask(event)).resolves.toBeNull()

    expect(disabledEvents()).toEqual([[EMBEDDED_SESSION_DISABLED_EVENT]])
  })

  it('reports nothing for a change announced while the ops flag is off and no view asked', async () => {
    mocks.enabled = false
    view('http://127.0.0.1:8000')

    await broadcastEmbeddedSessionChanged()

    expect(disabledEvents()).toEqual([])
  })

  it('reports nothing while the ops flag is on, or for a view it does not trust', async () => {
    const local = view('http://127.0.0.1:8000')
    const remote = view('http://192.168.1.20:8188')

    await stateForSender(local.event)
    await expect(stateForSender(remote.event)).resolves.toEqual({ status: 'disabled' })

    expect(disabledEvents()).toEqual([])
  })

  it('keeps a view signed in on the grant itself when Cloud did not grant the mint scope', async () => {
    const grant = jwt({ sub: 'user-1', workspace_id: 'ws-1', scope: 'comfy-cloud:user:read' })
    mocks.getGrantAccessToken.mockResolvedValue(grant)
    const { event } = view('http://127.0.0.1:8000')

    await expect(stateForSender(event)).resolves.toMatchObject({ status: 'signed_in' })
    await expect(workspaceTokenForSender(event, 'ws-1')).resolves.toBe(grant)
    expect(mocks.mint).not.toHaveBeenCalled()
  })

  it('reports the active workspace, not the workspace the grant is anchored on', async () => {
    mocks.current = 'ws-2'
    const { event } = view('http://127.0.0.1:8000')

    await expect(stateForSender(event)).resolves.toEqual({
      status: 'signed_in',
      userId: 'user-1',
      email: 'a@example.com',
      workspaceId: 'ws-2'
    })
  })

  it('reads signed_out when Desktop has no session', async () => {
    mocks.getGrantAccessToken.mockResolvedValue(null)
    const { event } = view('http://127.0.0.1:8000')

    await expect(stateForSender(event)).resolves.toEqual({ status: 'signed_out' })
  })

  it('broadcasts only to views it would serve', async () => {
    const local = view('http://127.0.0.1:8000')
    const remote = view('http://192.168.1.20:8188')

    await broadcastEmbeddedSessionChanged()

    expect(local.webContents.send).toHaveBeenCalledWith(EMBEDDED_SESSION_CHANNELS.changed, {
      status: 'signed_in',
      userId: 'user-1',
      email: 'a@example.com',
      workspaceId: 'ws-1'
    })
    expect(remote.webContents.send).not.toHaveBeenCalled()
  })

  it('broadcasts nothing while the ops flag is off', async () => {
    mocks.enabled = false
    const local = view('http://127.0.0.1:8000')

    await broadcastEmbeddedSessionChanged()

    expect(local.webContents.send).not.toHaveBeenCalled()
  })

  it('drops an older broadcast that finishes after a newer one', async () => {
    const local = view('http://127.0.0.1:8000')
    let finishOlder: (token: string | null) => void = () => {}
    mocks.getGrantAccessToken.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOlder = resolve
      })
    )
    const newer = jwt({ sub: 'user-1', workspace_id: 'ws-1' })
    mocks.getGrantAccessToken.mockResolvedValueOnce(newer)
    mocks.current = 'ws-2'

    const older = broadcastEmbeddedSessionChanged()
    await broadcastEmbeddedSessionChanged()
    finishOlder(null)
    await older

    expect(local.webContents.send).toHaveBeenCalledOnce()
    expect(local.webContents.send).toHaveBeenCalledWith(EMBEDDED_SESSION_CHANNELS.changed, {
      status: 'signed_in',
      userId: 'user-1',
      workspaceId: 'ws-2'
    })
  })
})

describe('billingHandoffForSender', () => {
  const ENTRY_URL = 'https://billing.comfy.org/handoff?code=abc'

  function respond(status: number, body: unknown): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status }))
    )
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function issue(workspaceId: unknown = 'ws-2', receiver: unknown = 'billing_web') {
    const { event } = view('http://127.0.0.1:8000')
    return billingHandoffForSender(event, workspaceId, receiver, '1.2.3')
  }

  it('posts the handoff request with the grant access token as Bearer', async () => {
    respond(201, { entry_url: ENTRY_URL, expires_at: '2026-11-12T12:00:00Z', request_id: 'r-1' })

    await expect(issue('ws-2', 'platform')).resolves.toEqual({
      status: 'issued',
      entryUrl: ENTRY_URL
    })
    expect(fetch).toHaveBeenCalledWith(`${CLOUD_CONFIG.apiBase}/auth/handoffs`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ACCESS}`
      },
      body: JSON.stringify({
        workspace_id: 'ws-2',
        receiver: 'platform',
        surface: 'desktop',
        client_version: '1.2.3'
      }),
      signal: expect.any(AbortSignal)
    })
  })

  it.each([
    ['a 401', 401, { code: 'unauthorized', message: 'expired' }, { status: 'sign_in_again' }],
    [
      'a disabled handoff',
      403,
      { code: 'HANDOFF_DISABLED', message: 'Handoff is disabled' },
      { status: 'refused', code: 'HANDOFF_DISABLED', message: 'Handoff is disabled' }
    ],
    ['an error without a body', 500, null, { status: 'refused' }],
    ['a 201 without an entry url', 201, { request_id: 'r-1' }, { status: 'refused' }],
    ['a 201 with an unparseable entry url', 201, { entry_url: 'not a url' }, { status: 'refused' }],
    [
      'a 201 with an http entry url',
      201,
      { entry_url: 'http://billing.comfy.org/handoff' },
      { status: 'refused' }
    ],
    [
      'a 201 with a javascript entry url',
      201,
      { entry_url: 'javascript:alert(1)' },
      { status: 'refused' }
    ]
  ])('resolves %s', async (_name, status, body, expected) => {
    respond(status, body)

    const result = await issue()

    expect(result).toEqual(expected)
    expect(JSON.stringify(result)).not.toContain(ACCESS)
    expect(fetch).toHaveBeenCalledWith(
      `${CLOUD_CONFIG.apiBase}/auth/handoffs`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: `Bearer ${ACCESS}` }),
        body: expect.stringContaining('"surface":"desktop"')
      })
    )
  })

  it('refuses without a code when the request never reaches Cloud', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )

    await expect(issue()).resolves.toEqual({ status: 'refused' })
  })

  it('asks to sign in again without calling Cloud when Desktop is signed out', async () => {
    respond(201, { entry_url: ENTRY_URL })
    mocks.getGrantAccessToken.mockResolvedValue(null)

    await expect(issue()).resolves.toEqual({ status: 'sign_in_again' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['an empty workspace', '', 'billing_web'],
    ['a non-string workspace', 42, 'billing_web'],
    ['an unknown receiver', 'ws-2', 'checkout'],
    ['a null receiver', 'ws-2', null]
  ])('is disabled for %s', async (_name, workspaceId, receiver) => {
    respond(201, { entry_url: ENTRY_URL })

    await expect(issue(workspaceId, receiver)).resolves.toEqual({ status: 'disabled' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['a remote ComfyUI', 'http://192.168.1.20:8188', {}],
    ['a view that navigated away', 'http://127.0.0.1:8000', { frameUrl: 'https://evil.example' }],
    ['a subframe', 'http://127.0.0.1:8000', { subframe: true }]
  ])('is disabled for %s', async (_name, comfyUrl, options: ViewOptions) => {
    respond(201, { entry_url: ENTRY_URL })
    const { event } = view(comfyUrl, options)

    await expect(billingHandoffForSender(event, 'ws-2', 'billing_web', '1.2.3')).resolves.toEqual({
      status: 'disabled'
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.getGrantAccessToken).not.toHaveBeenCalled()
  })

  it('is disabled while the embedded session is off', async () => {
    respond(201, { entry_url: ENTRY_URL })
    mocks.enabled = false

    await expect(issue()).resolves.toEqual({ status: 'disabled' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
