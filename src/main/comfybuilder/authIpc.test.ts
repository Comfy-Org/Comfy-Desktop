// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthStatus, AuthTokens } from './types'

// Hoisted so the vi.mock('electron') factory (which runs before top-level
// consts initialise) can close over the capture structures.
const captured = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  sends: [] as Array<{ channel: string; payload: unknown }>,
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown): void => {
      captured.handlers.set(channel, fn)
    },
  },
  BrowserWindow: {
    getAllWindows: (): Array<{ webContents: { send: (c: string, p: unknown) => void } }> => {
      const makeWindow = () => ({
        webContents: {
          send: (channel: string, payload: unknown): void => {
            captured.sends.push({ channel, payload })
          },
        },
      })
      // Two windows prove the broadcast fans out to every renderer.
      return [makeWindow(), makeWindow()]
    },
  },
}))

vi.mock('./oauth', () => ({ signIn: vi.fn() }))
vi.mock('./tokenStore', () => ({
  saveTokens: vi.fn(),
  clearTokens: vi.fn(),
  getAuthStatus: vi.fn(),
}))

import { signIn } from './oauth'
import { clearTokens, getAuthStatus, saveTokens } from './tokenStore'
import { COMFYBUILDER_AUTH_CHANNELS, registerComfybuilderAuthIpc } from './authIpc'

const ACCESS_TOKEN = 'mock-access-token-DO-NOT-LEAK-aaa111'
const REFRESH_TOKEN = 'mock-refresh-token-DO-NOT-LEAK-bbb222'

const STATUS: AuthStatus = {
  signedIn: true,
  email: 'builder@example.com',
  workspaceId: 'ws_abc123',
  workspaceType: 'team',
  role: 'admin',
}

const TOKENS: AuthTokens = {
  accessToken: ACCESS_TOKEN,
  refreshToken: REFRESH_TOKEN,
  expiresAt: 9_999_999_999_000,
}

function invoke(channel: string): Promise<unknown> {
  const handler = captured.handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  return Promise.resolve(handler({}))
}

describe('comfybuilder auth IPC', () => {
  beforeEach(() => {
    captured.handlers.clear()
    captured.sends.length = 0
    vi.mocked(signIn).mockReset()
    vi.mocked(saveTokens).mockReset()
    vi.mocked(clearTokens).mockReset()
    vi.mocked(getAuthStatus).mockReset()
    vi.mocked(signIn).mockResolvedValue({ tokens: TOKENS, status: STATUS })
    vi.mocked(getAuthStatus).mockReturnValue(STATUS)
    registerComfybuilderAuthIpc()
  })

  it('signIn persists tokens main-side and returns only AuthStatus (no tokens across IPC)', async () => {
    const result = (await invoke(COMFYBUILDER_AUTH_CHANNELS.signIn)) as AuthStatus

    expect(vi.mocked(saveTokens)).toHaveBeenCalledWith(TOKENS)

    expect(result).toEqual(STATUS)
    expect(result.signedIn).toBe(true)
    expect(result.email).toBe('builder@example.com')
    expect(result.workspaceId).toBe('ws_abc123')

    const serialized = JSON.stringify(result)
    const parsed = JSON.parse(serialized) as Record<string, unknown>
    expect(parsed).not.toHaveProperty('tokens')
    expect(parsed).not.toHaveProperty('accessToken')
    expect(parsed).not.toHaveProperty('refreshToken')
    expect(serialized).not.toContain(ACCESS_TOKEN)
    expect(serialized).not.toContain(REFRESH_TOKEN)

    expect(captured.sends).toHaveLength(2)
    for (const sent of captured.sends) {
      expect(sent.channel).toBe(COMFYBUILDER_AUTH_CHANNELS.authChanged)
      const wire = JSON.stringify(sent.payload)
      expect(wire).not.toContain(ACCESS_TOKEN)
      expect(wire).not.toContain(REFRESH_TOKEN)
      expect(JSON.parse(wire)).toEqual(STATUS)
    }
  })

  it('signOut clears tokens, broadcasts signed-out, and returns {signedIn:false}', async () => {
    const result = (await invoke(COMFYBUILDER_AUTH_CHANNELS.signOut)) as AuthStatus

    expect(vi.mocked(clearTokens)).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ signedIn: false })
    expect(JSON.parse(JSON.stringify(result))).toEqual({ signedIn: false })

    expect(captured.sends).toHaveLength(2)
    for (const sent of captured.sends) {
      expect(sent.channel).toBe(COMFYBUILDER_AUTH_CHANNELS.authChanged)
      expect(sent.payload).toEqual({ signedIn: false })
    }
  })

  it('getAuthStatus returns the stored status without exposing tokens or broadcasting', async () => {
    const result = (await invoke(COMFYBUILDER_AUTH_CHANNELS.getAuthStatus)) as AuthStatus

    expect(vi.mocked(getAuthStatus)).toHaveBeenCalledTimes(1)
    expect(result).toEqual(STATUS)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(ACCESS_TOKEN)
    expect(serialized).not.toContain(REFRESH_TOKEN)
    expect(captured.sends).toHaveLength(0)
  })
})
