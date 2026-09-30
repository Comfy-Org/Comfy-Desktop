// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: true,
  getAccessToken: vi.fn<() => Promise<string | null>>(),
  revalidate: vi.fn<(token: string) => Promise<boolean>>(),
  entries: [] as unknown[]
}))

vi.mock('./embeddedAuthFlag', () => ({
  isEmbeddedOAuthSessionEnabled: async () => mocks.enabled
}))
vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({
    getAccessToken: mocks.getAccessToken,
    revalidate: mocks.revalidate
  })
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
  EMBEDDED_AUTH_CHANNELS,
  accessTokenForSender,
  broadcastEmbeddedAuthChanged,
  handleRefusalFromSender,
  isSessionOrigin,
  stateForSender
} from './embeddedAuth'
import type { EmbeddedAuthSender } from './embeddedAuth'

function jwt(claims: Record<string, unknown>): string {
  const b64 = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url')
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`
}

const ACCESS = jwt({ sub: 'comfy-user-1', email: 'a@example.com', workspace_id: 'ws-1' })

function view(comfyUrl: string, frameUrl = comfyUrl) {
  const mainFrame = { processId: 1, routingId: 1, url: frameUrl }
  const webContents = {
    mainFrame,
    isDestroyed: () => false,
    getURL: () => frameUrl,
    send: vi.fn()
  }
  const entry = { installationId: 'inst-1', comfyUrl, comfyView: { webContents } }
  mocks.entries.push(entry)
  const event = {
    sender: webContents,
    senderFrame: mainFrame
  } as unknown as EmbeddedAuthSender
  return { event, webContents, mainFrame }
}

beforeEach(() => {
  mocks.enabled = true
  mocks.entries = []
  mocks.getAccessToken.mockReset().mockResolvedValue(ACCESS)
  mocks.revalidate.mockReset()
})

describe('isSessionOrigin', () => {
  it.each([
    ['http://127.0.0.1:8188/', true],
    ['http://localhost:8000/', true],
    ['http://[::1]:8188/', true],
    ['https://cloud.comfy.org/?utm_source=desktop', true],
    ['http://192.168.1.20:8188/', false],
    ['https://evil.example/', false],
    ['https://127.0.0.1:8188/', false],
    ['not a url', false]
  ])('%s -> %s', (url, expected) => {
    expect(isSessionOrigin(url)).toBe(expected)
  })
})

describe('embedded auth bridge', () => {
  it('hands a trusted view only the access token and identity claims', async () => {
    const { event } = view('http://127.0.0.1:8188/')

    await expect(accessTokenForSender(event)).resolves.toBe(ACCESS)
    const state = await stateForSender(event)
    expect(state).toEqual({
      status: 'signed_in',
      userId: 'comfy-user-1',
      email: 'a@example.com',
      workspaceId: 'ws-1'
    })
  })

  it('reads signed_out when Desktop has no session', async () => {
    const { event } = view('http://127.0.0.1:8188/')
    mocks.getAccessToken.mockResolvedValue(null)

    await expect(stateForSender(event)).resolves.toEqual({ status: 'signed_out' })
    await expect(accessTokenForSender(event)).resolves.toBeNull()
  })

  it('is disabled while the flag is off', async () => {
    const { event } = view('http://127.0.0.1:8188/')
    mocks.enabled = false

    await expect(stateForSender(event)).resolves.toEqual({ status: 'disabled' })
    await expect(accessTokenForSender(event)).resolves.toBeNull()
    expect(mocks.getAccessToken).not.toHaveBeenCalled()
  })

  it.each([
    [
      'a view navigated off its origin',
      () => view('http://127.0.0.1:8188/', 'https://evil.example/').event
    ],
    ['a remote ComfyUI server', () => view('http://192.168.1.20:8188/').event],
    [
      'a subframe',
      () => {
        const { event } = view('http://127.0.0.1:8188/')
        return {
          ...event,
          senderFrame: { processId: 1, routingId: 2, url: 'http://127.0.0.1:8188/' }
        } as unknown as EmbeddedAuthSender
      }
    ],
    [
      'an unregistered webContents',
      () => ({ sender: { mainFrame: {} }, senderFrame: {} }) as unknown as EmbeddedAuthSender
    ]
  ])('refuses %s', async (_label, makeEvent) => {
    const event = makeEvent()

    await expect(accessTokenForSender(event)).resolves.toBeNull()
    await expect(stateForSender(event)).resolves.toEqual({ status: 'disabled' })
  })
})

describe('refusal reports', () => {
  it('signs out everywhere when Desktop cannot re-mint the token', async () => {
    const { event } = view('http://127.0.0.1:8188/')
    const onSignedOut = vi.fn()
    mocks.revalidate.mockResolvedValue(false)
    mocks.getAccessToken.mockResolvedValue(null)

    const state = await handleRefusalFromSender(event, ACCESS, 'sso_required', onSignedOut)

    expect(mocks.revalidate).toHaveBeenCalledWith(ACCESS)
    expect(onSignedOut).toHaveBeenCalledOnce()
    expect(state).toEqual({ status: 'signed_out' })
  })

  it('keeps the session when the token was re-minted', async () => {
    const { event } = view('http://127.0.0.1:8188/')
    const onSignedOut = vi.fn()
    mocks.revalidate.mockResolvedValue(true)

    await handleRefusalFromSender(event, ACCESS, 'unauthorized', onSignedOut)

    expect(onSignedOut).not.toHaveBeenCalled()
  })

  it('ignores unknown reasons and untrusted senders', async () => {
    const trusted = view('http://127.0.0.1:8188/').event
    const untrusted = view('http://192.168.1.20:8188/').event

    await handleRefusalFromSender(trusted, ACCESS, 'logout_everyone', vi.fn())
    await handleRefusalFromSender(untrusted, ACCESS, 'unauthorized', vi.fn())

    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})

describe('broadcastEmbeddedAuthChanged', () => {
  it('pushes sign-out to trusted views only', async () => {
    const local = view('http://127.0.0.1:8188/')
    const remote = view('http://192.168.1.20:8188/')
    mocks.getAccessToken.mockResolvedValue(null)

    await broadcastEmbeddedAuthChanged()

    expect(local.webContents.send).toHaveBeenCalledWith(EMBEDDED_AUTH_CHANNELS.changed, {
      status: 'signed_out'
    })
    expect(remote.webContents.send).not.toHaveBeenCalled()
  })

  it('sends nothing while the flag is off', async () => {
    const local = view('http://127.0.0.1:8188/')
    mocks.enabled = false

    await broadcastEmbeddedAuthChanged()

    expect(local.webContents.send).not.toHaveBeenCalled()
  })
})
