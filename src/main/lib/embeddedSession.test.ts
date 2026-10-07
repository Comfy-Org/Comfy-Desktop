// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: true,
  getAccessToken: vi.fn<() => Promise<string | null>>(),
  entries: [] as unknown[]
}))

vi.mock('./embeddedSessionFlag', () => ({
  isEmbeddedSessionEnabled: async () => mocks.enabled
}))
vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({ getAccessToken: mocks.getAccessToken })
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
  EMBEDDED_SESSION_CHANNELS,
  workspaceTokenForSender,
  broadcastEmbeddedSessionChanged,
  stateForSender
} from './embeddedSession'
import type { EmbeddedSessionSender } from './embeddedSession'

function jwt(claims: Record<string, unknown>): string {
  const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${b64({ alg: 'ES256' })}.${b64(claims)}.sig`
}

const ACCESS = jwt({ sub: 'user-1', email: 'a@example.com', workspace_id: 'ws-1' })

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
  mocks.entries = []
  mocks.getAccessToken.mockReset().mockResolvedValue(ACCESS)
})

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
    await expect(workspaceTokenForSender(event, 'ws-1')).resolves.toBe(ACCESS)
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
    expect(mocks.getAccessToken).not.toHaveBeenCalled()
  })

  it.each([
    ['its own workspace', 'ws-1', ACCESS],
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
    expect(mocks.getAccessToken).not.toHaveBeenCalled()
  })

  it('reads signed_out when Desktop has no session', async () => {
    mocks.getAccessToken.mockResolvedValue(null)
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
    mocks.getAccessToken.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOlder = resolve
      })
    )
    const newer = jwt({ sub: 'user-1', workspace_id: 'ws-2' })
    mocks.getAccessToken.mockResolvedValueOnce(newer)

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
