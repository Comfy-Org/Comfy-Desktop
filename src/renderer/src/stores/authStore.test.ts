import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

import { useAuthStore } from './authStore'

const api = {
  signIn: vi.fn(),
  signOut: vi.fn(),
  getAuthStatus: vi.fn(),
  onAuthChanged: vi.fn(() => () => {}),
  listWorkspaces: vi.fn(),
  switchWorkspace: vi.fn(),
  listDistributions: vi.fn(),
  installDistribution: vi.fn()
}

/** Capture the renderer-side auth-change listener the store registers. */
let authChangedCb: ((status: unknown) => void) | undefined

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    authChangedCb = undefined
    api.onAuthChanged.mockImplementation((cb: (status: unknown) => void) => {
      authChangedCb = cb
      return () => {}
    })
    api.getAuthStatus.mockResolvedValue({ signedIn: false })
    ;(globalThis as unknown as { window: unknown }).window = { api: { comfybuilder: api } }
  })

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window
  })

  it('hydrates status from the persisted session on creation', async () => {
    api.getAuthStatus.mockResolvedValue({ signedIn: true, email: 'a@b.c' })
    const store = useAuthStore()
    await flushPromises()
    expect(store.status.email).toBe('a@b.c')
    expect(store.isSignedIn).toBe(true)
  })

  it('signIn updates the status', async () => {
    api.signIn.mockResolvedValue({ signedIn: true, email: 'x@y.z', workspaceId: 'w1' })
    const store = useAuthStore()
    await store.signIn()
    expect(store.status).toMatchObject({ signedIn: true, workspaceId: 'w1' })
  })

  it('fetchDistributions pulls rows only when signed in', async () => {
    const store = useAuthStore()
    // Signed out: no call, empty list.
    expect(await store.fetchDistributions()).toEqual([])
    expect(api.listDistributions).not.toHaveBeenCalled()

    api.signIn.mockResolvedValue({ signedIn: true })
    await store.signIn()
    api.listDistributions.mockResolvedValue([{ id: 'd1', name: 'Image', state: 'installable' }])
    const rows = await store.fetchDistributions()
    expect(rows).toEqual([{ id: 'd1', name: 'Image', state: 'installable' }])
    expect(store.distributions).toHaveLength(1)
  })

  it('flags a failed distribution fetch, and a successful retry clears it', async () => {
    api.signIn.mockResolvedValue({ signedIn: true })
    const store = useAuthStore()
    await store.signIn()

    api.listDistributions.mockRejectedValueOnce(new Error('network'))
    await store.fetchDistributions()
    expect(store.distributionsError).toBe(true)
    expect(store.distributions).toEqual([]) // stays empty, but flagged as an error not an empty workspace

    api.listDistributions.mockResolvedValue([{ id: 'd1', name: 'Image', state: 'installable' }])
    await store.fetchDistributions()
    expect(store.distributionsError).toBe(false)
    expect(store.distributions).toHaveLength(1)
  })

  it('flags a failed workspace fetch without throwing', async () => {
    api.signIn.mockResolvedValue({ signedIn: true })
    const store = useAuthStore()
    await store.signIn()

    api.listWorkspaces.mockRejectedValueOnce(new Error('network'))
    await expect(store.fetchWorkspaces()).resolves.toEqual([])
    expect(store.workspacesError).toBe(true)
    expect(store.loadingWorkspaces).toBe(false)
  })

  it('keeps workspaces loading until the current revision fetch settles', async () => {
    api.signIn.mockResolvedValue({ signedIn: true, workspaceId: 'w1' })
    api.switchWorkspace.mockResolvedValue({ signedIn: true, workspaceId: 'w2' })
    const store = useAuthStore()
    await store.signIn()
    const stale = deferred<unknown[]>()
    const current = deferred<unknown[]>()
    api.listWorkspaces.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise)

    const staleFetch = store.fetchWorkspaces()
    await store.switchWorkspace('w2')
    const currentFetch = store.fetchWorkspaces()
    stale.resolve([])
    await staleFetch
    expect(store.loadingWorkspaces).toBe(true)

    current.resolve([])
    await currentFetch
    expect(store.loadingWorkspaces).toBe(false)
  })

  it('keeps distributions loading until the current revision fetch settles', async () => {
    api.signIn.mockResolvedValue({ signedIn: true, workspaceId: 'w1' })
    api.switchWorkspace.mockResolvedValue({ signedIn: true, workspaceId: 'w2' })
    const store = useAuthStore()
    await store.signIn()
    const stale = deferred<unknown[]>()
    const current = deferred<unknown[]>()
    api.listDistributions.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise)

    const staleFetch = store.fetchDistributions()
    await store.switchWorkspace('w2')
    const currentFetch = store.fetchDistributions()
    stale.resolve([])
    await staleFetch
    expect(store.loadingDistributions).toBe(true)

    current.resolve([])
    await currentFetch
    expect(store.loadingDistributions).toBe(false)
  })

  it('switchWorkspace adopts the new status and drops the stale distribution cache', async () => {
    api.signIn.mockResolvedValue({ signedIn: true, workspaceId: 'w1' })
    const store = useAuthStore()
    await store.signIn()
    store.distributions = [{ id: 'd1', name: 'Old', state: 'installable' }]

    api.switchWorkspace.mockResolvedValue({
      signedIn: true,
      workspaceId: 'w2',
      workspaceType: 'team'
    })
    await store.switchWorkspace('w2')
    expect(store.status).toMatchObject({ workspaceId: 'w2' })
    expect(store.distributions).toEqual([])
  })

  it('a pushed sign-out with no follow-up fetch clears stuck loading and error flags', async () => {
    api.signIn.mockResolvedValue({ signedIn: true, workspaceId: 'w1' })
    const store = useAuthStore()
    await store.signIn()

    const stale = deferred<unknown[]>()
    api.listWorkspaces.mockReturnValueOnce(stale.promise)
    api.listDistributions.mockRejectedValueOnce(new Error('network'))
    const staleFetch = store.fetchWorkspaces()
    await store.fetchDistributions()
    expect(store.loadingWorkspaces).toBe(true)
    expect(store.distributionsError).toBe(true)

    // Sign-out arrives while the workspace fetch is still in flight; nothing
    // refetches for the signed-out state, so the transition itself must
    // settle the flags.
    authChangedCb?.({ signedIn: false })
    expect(store.loadingWorkspaces).toBe(false)
    expect(store.distributionsError).toBe(false)

    // The stale fetch settling later must not resurrect anything.
    stale.resolve([{ id: 'w1', name: 'W1', type: 'team', role: 'owner' }])
    await staleFetch
    expect(store.loadingWorkspaces).toBe(false)
    expect(store.workspaces).toEqual([])
  })

  it('a pushed sign-out clears scoped state', async () => {
    api.signIn.mockResolvedValue({ signedIn: true, workspaceId: 'w1' })
    const store = useAuthStore()
    await store.signIn()
    store.workspaces = [{ id: 'w1', name: 'W1', type: 'team', role: 'owner' }]
    store.distributions = [{ id: 'd1', name: 'D', state: 'installable' }]

    authChangedCb?.({ signedIn: false })
    expect(store.isSignedIn).toBe(false)
    expect(store.workspaces).toEqual([])
    expect(store.distributions).toEqual([])
  })
})
