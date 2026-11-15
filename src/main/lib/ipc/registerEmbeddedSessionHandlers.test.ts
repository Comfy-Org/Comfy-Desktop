import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComfyDesktop2AuthState } from '../../../types/comfyDesktopBridge'
import { SignInFailure } from '../../cloud/signInFailure'

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  handle: vi.fn(),
  signInToCloud: vi.fn(),
  stateForSender: vi.fn(),
  switchWorkspaceForSender: vi.fn(),
  switchCloudWorkspace: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))

vi.mock('../telemetry', () => ({ emit: mocks.emit }))

vi.mock('../../host/registry', () => ({ findEntryByComfySender: vi.fn() }))

vi.mock('../embeddedSession', () => ({
  EMBEDDED_SESSION_CHANNELS: {
    getState: 'desktop2-auth:get-state',
    getWorkspaceToken: 'desktop2-auth:get-workspace-token',
    getPartnerNodeToken: 'desktop2-auth:get-partner-node-token',
    requestSignIn: 'desktop2-auth:request-sign-in',
    signOut: 'desktop2-auth:sign-out',
    switchWorkspace: 'desktop2-auth:switch-workspace'
  },
  partnerNodeTokenForSender: vi.fn(),
  stateForSender: mocks.stateForSender,
  switchWorkspaceForSender: mocks.switchWorkspaceForSender,
  workspaceTokenForSender: vi.fn()
}))

vi.mock('./registerDevPlatformHandlers', () => ({
  signInToCloud: mocks.signInToCloud,
  signOutOfCloud: vi.fn(),
  switchCloudWorkspace: mocks.switchCloudWorkspace
}))

import { registerEmbeddedSessionHandlers } from './registerEmbeddedSessionHandlers'

const SIGNED_IN: ComfyDesktop2AuthState = {
  status: 'signed_in',
  userId: 'user-1',
  email: 'person@example.com',
  workspaceId: 'ws-1'
}
const SIGNED_OUT: ComfyDesktop2AuthState = { status: 'signed_out' }

type RequestSignIn = (event: unknown) => Promise<ComfyDesktop2AuthState>

function requestSignIn(): RequestSignIn {
  const call = mocks.handle.mock.calls.find(
    ([channel]) => channel === 'desktop2-auth:request-sign-in'
  )
  expect(call).toBeDefined()
  return call![1] as RequestSignIn
}

function reported(): unknown[] {
  return mocks.emit.mock.calls.map(([name, properties]) => {
    expect(name).toBe('comfy.desktop.auth.host_sign_in')
    return properties
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handle.mockReset()
  registerEmbeddedSessionHandlers()
})

describe('desktop2-auth:request-sign-in telemetry', () => {
  it.for<{
    name: string
    signIn: () => Promise<unknown>
    after: ComfyDesktop2AuthState
    outcome: Record<string, unknown>
  }>([
    {
      name: 'a completed sign-in',
      signIn: async () => undefined,
      after: SIGNED_IN,
      outcome: { stage: 'completed', host: 'desktop' }
    },
    {
      name: 'a sign-in replaced by a sign-out',
      signIn: async () => undefined,
      after: SIGNED_OUT,
      outcome: { stage: 'failed', host: 'desktop', reason: 'superseded' }
    },
    {
      name: 'a declined consent',
      signIn: async () => {
        throw new SignInFailure('access_denied', 'cancelled')
      },
      after: SIGNED_OUT,
      outcome: { stage: 'failed', host: 'desktop', reason: 'cancelled' }
    },
    {
      name: 'a token exchange the server refused',
      signIn: async () => {
        throw new SignInFailure('OAuth token request failed: 503 down', 'server_error', {
          httpStatus: 503
        })
      },
      after: SIGNED_OUT,
      outcome: { stage: 'failed', host: 'desktop', reason: 'server_error', http_status: 503 }
    },
    {
      name: 'an unclassified error',
      signIn: async () => {
        throw new Error('person@example.com broke it')
      },
      after: SIGNED_OUT,
      outcome: { stage: 'failed', host: 'desktop', reason: 'unknown' }
    }
  ])(
    'reports the request and $name, and nothing that identifies the person',
    async ({ signIn, after, outcome }) => {
      mocks.stateForSender.mockResolvedValueOnce(SIGNED_OUT).mockResolvedValue(after)
      mocks.signInToCloud.mockImplementation(signIn)

      await requestSignIn()({}).catch(() => undefined)

      expect(reported()).toEqual([{ stage: 'requested', host: 'desktop' }, outcome])
    }
  )

  it('passes the sign-in failure back to the view', async () => {
    mocks.stateForSender.mockResolvedValue(SIGNED_OUT)
    const failure = new SignInFailure('Loopback OAuth callback timed out', 'timeout')
    mocks.signInToCloud.mockRejectedValue(failure)

    await expect(requestSignIn()({})).rejects.toBe(failure)
  })

  it('reports nothing while the embedded session is disabled', async () => {
    mocks.stateForSender.mockResolvedValue({ status: 'disabled' })

    await expect(requestSignIn()({})).resolves.toEqual({ status: 'disabled' })

    expect(mocks.signInToCloud).not.toHaveBeenCalled()
    expect(mocks.emit).not.toHaveBeenCalled()
  })

  it('counts a repeat request during a pending sign-in as the same attempt', async () => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => (finish = resolve))
    mocks.signInToCloud.mockReturnValue(pending)
    mocks.stateForSender
      .mockResolvedValueOnce(SIGNED_OUT)
      .mockResolvedValueOnce(SIGNED_OUT)
      .mockResolvedValue(SIGNED_IN)

    const first = requestSignIn()({})
    await vi.waitFor(() => expect(mocks.signInToCloud).toHaveBeenCalledTimes(1))
    const repeat = requestSignIn()({})
    await vi.waitFor(() => expect(mocks.signInToCloud).toHaveBeenCalledTimes(2))
    finish()
    await Promise.all([first, repeat])

    expect(reported()).toEqual([
      { stage: 'requested', host: 'desktop' },
      { stage: 'completed', host: 'desktop' }
    ])
  })
})

describe('desktop2-auth:switch-workspace', () => {
  it('switches as a view request, which never mints a new workspace silently', async () => {
    const call = mocks.handle.mock.calls.find(
      ([channel]) => channel === 'desktop2-auth:switch-workspace'
    )
    const event = {}
    await (call![1] as (event: unknown, id: unknown) => Promise<unknown>)(event, 'ws-2')
    const [sender, workspaceId, switchWorkspace] = mocks.switchWorkspaceForSender.mock.calls[0]!

    await switchWorkspace('ws-2')

    expect([sender, workspaceId]).toEqual([event, 'ws-2'])
    expect(mocks.switchCloudWorkspace).toHaveBeenCalledExactlyOnceWith('ws-2', 'requested')
  })
})
