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
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
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
    // Tests override the resolved status and clearAllMocks keeps
    // implementations — reset so boot hydration sees signed-out again.
    vi.mocked(api.comfybuilder.getAuthStatus).mockResolvedValue(signedOut)
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
    expect(store.status).toEqual(signedIn)
    await expect(store.signOut()).resolves.toEqual(signedOut)
    expect(store.isSignedIn).toBe(false)
  })

  it('signIn rethrows failures with the status untouched', async () => {
    vi.mocked(api.comfybuilder.signIn).mockRejectedValue(new Error('access_denied'))

    await expect(store.signIn()).rejects.toThrow('access_denied')
    expect(store.isSignedIn).toBe(false)
  })

  it('unsubscribes on store disposal', () => {
    store.$dispose()

    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('a delayed status pull cannot overwrite a newer pushed status', async () => {
    let resolvePull!: (s: AuthStatus) => void
    vi.mocked(api.comfybuilder.getAuthStatus).mockReturnValue(
      new Promise((res) => {
        resolvePull = res
      }),
    )

    const pending = store.fetchStatus()
    // A push lands while the pull is still in flight…
    authListener?.(signedIn)
    // …so the stale pull result must not win.
    resolvePull(signedOut)
    await pending

    expect(store.isSignedIn).toBe(true)
  })
})
