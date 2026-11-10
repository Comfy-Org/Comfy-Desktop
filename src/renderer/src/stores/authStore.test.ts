import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

import { stubWindowApi } from '../lib/stubWindowApi'
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
    stubWindowApi({ comfybuilder: api })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
    expect(store.builds).toEqual([])

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
    expect(store.workspacesLoaded).toBe(false)
  })

  it('shares a pending workspace request and distinguishes a loaded empty catalog', async () => {
    api.getAuthStatus.mockResolvedValue({ signedIn: true, workspaceId: 'w1' })
    const store = useAuthStore()
    await store.whenReady()
    const catalog = deferred<unknown[]>()
    api.listWorkspaces.mockReturnValueOnce(catalog.promise)
    const first = store.fetchWorkspaces()
    const second = store.fetchWorkspaces()
    expect(api.listWorkspaces).toHaveBeenCalledOnce()
    expect(store.workspacesLoaded).toBe(false)
    catalog.resolve([])
    await Promise.all([first, second])
    expect(store.workspacesLoaded).toBe(true)
    expect(store.workspaces).toEqual([])
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

  it('keeps a switch failure out of status until the next switch or status change', async () => {
    api.getAuthStatus.mockResolvedValue({ signedIn: true, workspaceId: 'w1' })
    const store = useAuthStore()
    await store.whenReady()
    api.switchWorkspace.mockResolvedValueOnce({
      signedIn: true,
      workspaceId: 'w1',
      workspaceSwitchFailure: 'unavailable'
    })

    await store.switchWorkspace('w2')

    expect(store.workspaceSwitchFailure).toBe('unavailable')
    expect(store.status).toEqual({ signedIn: true, workspaceId: 'w1' })

    const nextSwitch = deferred<{ signedIn: boolean; workspaceId: string }>()
    api.switchWorkspace.mockReturnValueOnce(nextSwitch.promise)
    const switching = store.switchWorkspace('w3')
    expect(store.workspaceSwitchFailure).toBeUndefined()
    nextSwitch.resolve({ signedIn: true, workspaceId: 'w3' })
    await switching

    api.switchWorkspace.mockResolvedValueOnce({
      signedIn: true,
      workspaceId: 'w3',
      workspaceSwitchFailure: 'retryable'
    })
    await store.switchWorkspace('w2')
    expect(store.workspaceSwitchFailure).toBe('retryable')

    authChangedCb?.({ signedIn: true, workspaceId: 'w4' })
    expect(store.workspaceSwitchFailure).toBeUndefined()
  })

  it('does not let an older switch failure overwrite a newer switch', async () => {
    api.getAuthStatus.mockResolvedValue({ signedIn: true, workspaceId: 'w1' })
    const store = useAuthStore()
    await store.whenReady()
    const older = deferred<Record<string, unknown>>()
    api.switchWorkspace.mockReturnValueOnce(older.promise)
    api.switchWorkspace.mockResolvedValueOnce({ signedIn: true, workspaceId: 'w3' })

    const first = store.switchWorkspace('w2')
    await store.switchWorkspace('w3')
    older.resolve({ signedIn: true, workspaceId: 'w3', workspaceSwitchFailure: 'retryable' })
    await first

    expect(store.workspaceSwitchFailure).toBeUndefined()
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

    const invoke = deferred<unknown>()
    api.switchWorkspace.mockReturnValueOnce(invoke.promise)
    const switching = store.switchWorkspace('w2')
    authChangedCb?.({ signedIn: true, workspaceId: 'w2' })

    const rows = deferred<unknown[]>()
    api.listBuilds.mockReturnValueOnce(rows.promise)
    const fetching = store.fetchBuilds()
    expect(store.loadingBuilds).toBe(true)

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

    authChangedCb?.({ signedIn: false })
    expect(store.loadingWorkspaces).toBe(false)
    expect(store.buildsError).toBe(false)

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
    expect(store.workspacesLoaded).toBe(false)
    expect(store.builds).toEqual([])
    expect(store.buildsLoaded).toBe(false)
  })
})
