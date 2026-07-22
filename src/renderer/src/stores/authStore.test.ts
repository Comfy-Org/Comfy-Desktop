import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthStatus } from '../../../main/comfybuilder/types'
import type { ElectronApi } from '../../../types/ipc'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore TS6307: the vitest test project excludes source files
import { useAuthStore } from './authStore'

const unsubscribe = vi.hoisted(() => vi.fn())
let authListener: ((status: AuthStatus) => void) | undefined

const signedOut: AuthStatus = { signedIn: false }
const signedIn: AuthStatus = {
  signedIn: true,
  email: 'user@example.com',
  workspaceId: 'workspace-1',
  workspaceType: 'cloud',
  role: 'admin',
}

vi.stubGlobal('window', {
  ...window,
  api: {
    comfybuilder: {
      getAuthStatus: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
      onAuthChanged: vi.fn((cb: (status: AuthStatus) => void) => {
        authListener = cb
        return unsubscribe
      }),
    },
  },
})

describe('useAuthStore', () => {
  let store: ReturnType<typeof useAuthStore>
  const api = (window as unknown as Window & { api: ElectronApi }).api

  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
    unsubscribe.mockClear()
    vi.clearAllMocks()
    authListener = undefined
    store = useAuthStore()
  })

  it('initializes signed out with no token fields', () => {
    expect(store.status).toEqual(signedOut)
    expect(store.isSignedIn).toBe(false)
    expect(store.status).not.toHaveProperty('accessToken')
    expect(store.status).not.toHaveProperty('refreshToken')
    expect(store.status).not.toHaveProperty('expiresAt')
  })

  it('fetchStatus updates reactive status from window.api', async () => {
    vi.mocked(api.comfybuilder.getAuthStatus).mockResolvedValue(signedIn)

    const result = await store.fetchStatus()

    expect(api.comfybuilder.getAuthStatus).toHaveBeenCalledOnce()
    expect(result).toEqual(signedIn)
    expect(store.status).toEqual(signedIn)
    expect(store.isSignedIn).toBe(true)
  })

  it('reacts to auth change events', () => {
    expect(authListener).toBeTypeOf('function')

    authListener?.(signedIn)

    expect(store.status).toEqual(signedIn)
    expect(store.isSignedIn).toBe(true)
  })

  it('passes through signIn and signOut calls', async () => {
    vi.mocked(api.comfybuilder.signIn).mockResolvedValue(signedIn)
    vi.mocked(api.comfybuilder.signOut).mockResolvedValue(signedOut)

    await expect(store.signIn()).resolves.toEqual(signedIn)
    await expect(store.signOut()).resolves.toEqual(signedOut)
  })

  it('unsubscribes on store disposal', () => {
    store.$dispose()

    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('tracks the sign-in phase: waiting while in flight, success on a signed-in result', async () => {
    let resolveSignIn!: (status: AuthStatus) => void
    vi.mocked(api.comfybuilder.signIn).mockReturnValue(
      new Promise((res) => {
        resolveSignIn = res
      }),
    )

    const pending = store.signIn()
    expect(store.signInPhase).toBe('waiting-for-browser')

    resolveSignIn(signedIn)
    await pending
    expect(store.signInPhase).toBe('success')
    expect(store.status).toEqual(signedIn)
  })

  it('maps a loopback timeout rejection to the timeout phase, anything else to error', async () => {
    vi.mocked(api.comfybuilder.signIn).mockRejectedValue(
      new Error('Loopback OAuth callback timed out'),
    )
    await expect(store.signIn()).rejects.toThrow()
    expect(store.signInPhase).toBe('timeout')

    vi.mocked(api.comfybuilder.signIn).mockRejectedValue(new Error('access_denied'))
    await expect(store.signIn()).rejects.toThrow()
    expect(store.signInPhase).toBe('error')
  })

  it('cancelSignIn returns to idle and a late settle of the abandoned attempt cannot move the phase', async () => {
    let resolveSignIn!: (status: AuthStatus) => void
    vi.mocked(api.comfybuilder.signIn).mockReturnValue(
      new Promise((res) => {
        resolveSignIn = res
      }),
    )

    const pending = store.signIn()
    store.cancelSignIn()
    expect(store.signInPhase).toBe('idle')

    resolveSignIn(signedIn)
    await pending
    expect(store.signInPhase).toBe('idle')
  })

  it('derives the single workspace from the token claims', () => {
    expect(store.workspaces).toEqual([])

    authListener?.({
      signedIn: true,
      email: 'user@example.com',
      workspaceId: 'workspace-1',
      workspaceType: 'team',
      role: 'member',
    })

    expect(store.workspaces).toEqual([
      { id: 'workspace-1', name: 'user@example.com', type: 'team', role: 'member' },
    ])
    expect(store.needsWorkspaceChoice).toBe(false)

    store.selectWorkspace('workspace-1')
    expect(store.activeWorkspaceId).toBe('workspace-1')
  })

  it('signOut clears the phase and the active workspace', async () => {
    vi.mocked(api.comfybuilder.signOut).mockResolvedValue(signedOut)
    store.selectWorkspace('workspace-1')

    await store.signOut()

    expect(store.signInPhase).toBe('idle')
    expect(store.activeWorkspaceId).toBeUndefined()
    expect(store.isSignedIn).toBe(false)
  })
})
