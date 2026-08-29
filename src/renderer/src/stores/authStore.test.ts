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
  listBuilds: vi.fn(),
  installBuild: vi.fn()
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

  it('stays signed in when main cancels sign-out', async () => {
    api.getAuthStatus.mockResolvedValue({ signedIn: true, workspaceId: 'w1' })
    api.signOut.mockResolvedValue({ signedIn: true, workspaceId: 'w1' })
    const store = useAuthStore()
    await flushPromises()

    await store.signOut()

    expect(store.isSignedIn).toBe(true)
  })

  it('fetchBuilds pulls rows only when signed in', async () => {
    const store = useAuthStore()
    // Signed out: no call, empty list.
    expect(await store.fetchBuilds()).toEqual([])
    expect(api.listBuilds).not.toHaveBeenCalled()

    api.signIn.mockResolvedValue({ signedIn: true })
    await store.signIn()
    api.listBuilds.mockResolvedValue([{ id: 'd1', name: 'Image', state: 'installable' }])
    const rows = await store.fetchBuilds()
    expect(rows).toEqual([{ id: 'd1', name: 'Image', state: 'installable' }])
    expect(store.builds).toHaveLength(1)
    expect(store.buildsLoaded).toBe(true)
  })

  it('flags a failed build fetch, and a successful retry clears it', async () => {
    api.signIn.mockResolvedValue({ signedIn: true })
    const store = useAuthStore()
    await store.signIn()

    api.listBuilds.mockRejectedValueOnce(new Error('network'))
    await store.fetchBuilds()
    expect(store.buildsError).toBe(true)
    expect(store.buildsLoaded).toBe(false)
    expect(store.builds).toEqual([]) // stays empty, but flagged as an error not an empty workspace

    api.listBuilds.mockResolvedValue([{ id: 'd1', name: 'Image', state: 'installable' }])
    await store.fetchBuilds()
    expect(store.buildsError).toBe(false)
    expect(store.buildsLoaded).toBe(true)
    expect(store.builds).toHaveLength(1)
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

  it('reconciles the cached active workspace name after loading the workspace list', async () => {
    api.getAuthStatus.mockResolvedValue({
      signedIn: true,
      workspaceId: 'w1',
      workspaceName: 'Old name'
    })
    api.listWorkspaces.mockResolvedValue([
      { id: 'w1', name: 'Current name', type: 'team', role: 'owner' }
    ])
    const store = useAuthStore()
    await flushPromises()

    await store.fetchWorkspaces()
    expect(store.status.workspaceName).toBe('Current name')

    api.listWorkspaces.mockResolvedValue([])
    await store.fetchWorkspaces()
    expect(store.status.workspaceName).toBeUndefined()
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

  it('keeps builds loading until the current revision fetch settles', async () => {
    api.signIn.mockResolvedValue({ signedIn: true, workspaceId: 'w1' })
    api.switchWorkspace.mockResolvedValue({ signedIn: true, workspaceId: 'w2' })
    const store = useAuthStore()
    await store.signIn()
    const stale = deferred<unknown[]>()
    const current = deferred<unknown[]>()
    api.listBuilds.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise)

    const staleFetch = store.fetchBuilds()
    await store.switchWorkspace('w2')
    const currentFetch = store.fetchBuilds()
    stale.resolve([])
    await staleFetch
    expect(store.loadingBuilds).toBe(true)

    current.resolve([])
    await currentFetch
    expect(store.loadingBuilds).toBe(false)
  })

  it('switchWorkspace adopts the new status and drops the stale build cache', async () => {
    api.signIn.mockResolvedValue({ signedIn: true, workspaceId: 'w1' })
    const store = useAuthStore()
    await store.signIn()
    store.builds = [{ id: 'd1', name: 'Old', state: 'installable' }]
    store.buildsLoaded = true

    api.switchWorkspace.mockResolvedValue({
      signedIn: true,
      workspaceId: 'w2',
      workspaceType: 'team'
    })
    await store.switchWorkspace('w2')
    expect(store.status).toMatchObject({ workspaceId: 'w2' })
    expect(store.builds).toEqual([])
    expect(store.buildsLoaded).toBe(false)
  })

  it('the duplicate switch status (push, then invoke result) keeps the sole build fetch alive', async () => {
    api.signIn.mockResolvedValue({ signedIn: true, workspaceId: 'w1' })
    const store = useAuthStore()
    await store.signIn()

    // Main broadcasts the switched status BEFORE the switchWorkspace invoke
    // resolves; the watcher keyed on workspace identity fires exactly once,
    // off this push.
    const invoke = deferred<unknown>()
    api.switchWorkspace.mockReturnValueOnce(invoke.promise)
    const switching = store.switchWorkspace('w2')
    authChangedCb?.({ signedIn: true, workspaceId: 'w2' })

    const rows = deferred<unknown[]>()
    api.listBuilds.mockReturnValueOnce(rows.promise)
    const fetching = store.fetchBuilds()
    expect(store.loadingBuilds).toBe(true)

    // The invoke result carries the identical identity; it must not advance
    // the revision - that would discard the only fetch for w2 and leave the
    // UI reporting a false empty workspace with no re-fire.
    invoke.resolve({ signedIn: true, workspaceId: 'w2' })
    await switching
    expect(store.loadingBuilds).toBe(true)

    rows.resolve([{ id: 'd2', name: 'New', state: 'installable' }])
    await fetching
    expect(store.loadingBuilds).toBe(false)
    expect(store.builds).toEqual([{ id: 'd2', name: 'New', state: 'installable' }])
  })

  it('a pushed sign-out with no follow-up fetch clears stuck loading and error flags', async () => {
    api.signIn.mockResolvedValue({ signedIn: true, workspaceId: 'w1' })
    const store = useAuthStore()
    await store.signIn()

    const stale = deferred<unknown[]>()
    api.listWorkspaces.mockReturnValueOnce(stale.promise)
    api.listBuilds.mockRejectedValueOnce(new Error('network'))
    const staleFetch = store.fetchWorkspaces()
    await store.fetchBuilds()
    expect(store.loadingWorkspaces).toBe(true)
    expect(store.buildsError).toBe(true)

    // Sign-out arrives while the workspace fetch is still in flight; nothing
    // refetches for the signed-out state, so the transition itself must
    // settle the flags.
    authChangedCb?.({ signedIn: false })
    expect(store.loadingWorkspaces).toBe(false)
    expect(store.buildsError).toBe(false)

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
    store.builds = [{ id: 'd1', name: 'D', state: 'installable' }]
    store.buildsLoaded = true

    authChangedCb?.({ signedIn: false })
    expect(store.isSignedIn).toBe(false)
    expect(store.workspaces).toEqual([])
    expect(store.builds).toEqual([])
    expect(store.buildsLoaded).toBe(false)
  })
})
