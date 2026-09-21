import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { AuthStatus, Workspace } from '../../../types/ipc'
import { useAuthStore } from './authStore'
import { useDashboardScopeStore } from './dashboardScopeStore'

const workspaces: Workspace[] = [
  { id: 'w1', name: 'One', type: 'team', role: 'owner' },
  { id: 'w2', name: 'Two', type: 'team', role: 'owner' }
]
const signedIn: AuthStatus = { signedIn: true, workspaceId: 'w1', workspaceType: 'team' }
const api = {
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  comfybuilder: {
    getAuthStatus: vi.fn(),
    onAuthChanged: vi.fn(),
    listWorkspaces: vi.fn()
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useDashboardScopeStore', () => {
  let pinia: ReturnType<typeof createPinia>
  let authChanged: (status: AuthStatus) => void

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.resetAllMocks()
    api.getSetting.mockResolvedValue(undefined)
    api.setSetting.mockResolvedValue(undefined)
    api.comfybuilder.getAuthStatus.mockResolvedValue(signedIn)
    api.comfybuilder.listWorkspaces.mockResolvedValue(workspaces)
    api.comfybuilder.onAuthChanged.mockImplementation((cb: typeof authChanged) => {
      authChanged = cb
      return () => {}
    })
    vi.stubGlobal('window', { api })
  })

  afterEach(() => {
    disposePinia(pinia)
    vi.unstubAllGlobals()
  })

  it.each([undefined, '', 'removed'])(
    'resolves and persists the authenticated fallback for saved scope %s',
    async (saved) => {
      api.getSetting.mockResolvedValue(saved)
      const scope = useDashboardScopeStore()
      await scope.initialize()
      expect(scope.selectedWorkspaceId).toBe('w1')
      expect(api.setSetting).toHaveBeenCalledExactlyOnceWith('dashboardWorkspaceId', 'w1')
    }
  )

  it.each(['personal', 'w2'])(
    'restores %s without rewriting it or switching authentication',
    async (saved) => {
      api.getSetting.mockResolvedValue(saved)
      const scope = useDashboardScopeStore()
      await scope.initialize()
      expect(scope.selectedWorkspaceId).toBe(saved)
      expect(useAuthStore().status.workspaceId).toBe('w1')
      expect(api.setSetting).not.toHaveBeenCalled()
    }
  )

  it('does not choose an authenticated workspace absent from a successful catalog', async () => {
    api.getSetting.mockResolvedValue('removed')
    api.comfybuilder.listWorkspaces.mockResolvedValue([])
    const scope = useDashboardScopeStore()
    await scope.initialize()
    expect(scope.selectedWorkspaceId).toBe('personal')
    expect(api.setSetting).toHaveBeenCalledWith('dashboardWorkspaceId', 'personal')
  })

  it('restores an explicit Personal selection without waiting for membership', async () => {
    api.getSetting.mockResolvedValue('personal')
    const scope = useDashboardScopeStore()
    await scope.initialize()
    expect(scope.selectedWorkspaceId).toBe('personal')
    expect(api.comfybuilder.listWorkspaces).not.toHaveBeenCalled()
  })

  it('normalizes a saved server Personal workspace to the local Personal scope', async () => {
    api.getSetting.mockResolvedValue('server-personal')
    api.comfybuilder.listWorkspaces.mockResolvedValue([
      ...workspaces,
      { id: 'server-personal', name: 'Personal workspace', type: 'team', role: 'owner' }
    ])
    const scope = useDashboardScopeStore()
    await scope.initialize()
    expect(scope.selectedWorkspaceId).toBe('personal')
  })

  it('preserves an unavailable saved workspace offline, then reconciles on successful retry', async () => {
    api.getSetting.mockResolvedValue('removed')
    api.comfybuilder.listWorkspaces.mockRejectedValueOnce(new Error('offline'))
    const scope = useDashboardScopeStore()
    await scope.initialize()
    expect(scope.selectedWorkspaceId).toBe('removed')
    expect(api.setSetting).not.toHaveBeenCalled()

    await useAuthStore().fetchWorkspaces()
    await flushPromises()
    expect(scope.selectedWorkspaceId).toBe('w1')
    expect(api.setSetting).toHaveBeenCalledWith('dashboardWorkspaceId', 'w1')
  })

  it('ignores a failed refresh and reconciles a later successful membership removal', async () => {
    api.getSetting.mockResolvedValue('w2')
    const scope = useDashboardScopeStore()
    await scope.initialize()
    const auth = useAuthStore()
    api.comfybuilder.listWorkspaces.mockRejectedValueOnce(new Error('offline'))
    await auth.fetchWorkspaces()
    expect(scope.selectedWorkspaceId).toBe('w2')
    expect(api.setSetting).not.toHaveBeenCalled()

    api.comfybuilder.listWorkspaces.mockResolvedValue([workspaces[0]])
    await auth.fetchWorkspaces()
    await flushPromises()
    expect(scope.selectedWorkspaceId).toBe('w1')
  })

  it('initializes once for concurrent callers, including when no dashboard is mounted', async () => {
    const saved = deferred<string>()
    api.getSetting.mockReturnValue(saved.promise)
    const scope = useDashboardScopeStore()
    const first = scope.initialize()
    const second = scope.initialize()
    await flushPromises()
    expect(scope.initialized).toBe(false)
    expect(api.setSetting).not.toHaveBeenCalled()
    saved.resolve('w2')
    await Promise.all([first, second])
    expect(scope.selectedWorkspaceId).toBe('w2')
    expect(api.getSetting).toHaveBeenCalledOnce()
    expect(api.comfybuilder.getAuthStatus).toHaveBeenCalledOnce()
    expect(api.comfybuilder.listWorkspaces).toHaveBeenCalledOnce()
  })

  it('does not overwrite a user selection made while settings load', async () => {
    const saved = deferred<string>()
    api.getSetting.mockReturnValue(saved.promise)
    const scope = useDashboardScopeStore()
    const initializing = scope.initialize()
    await flushPromises()
    scope.selectWorkspace('personal')
    saved.resolve('w2')
    await initializing
    expect(scope.selectedWorkspaceId).toBe('personal')
    expect(api.setSetting).toHaveBeenCalledExactlyOnceWith('dashboardWorkspaceId', 'personal')
  })

  it('resolves Personal when signed out, without validating the saved team', async () => {
    api.getSetting.mockResolvedValue('w2')
    api.comfybuilder.getAuthStatus.mockResolvedValue({ signedIn: false })
    const scope = useDashboardScopeStore()
    await scope.initialize()
    expect(scope.selectedWorkspaceId).toBe('personal')
    expect(api.comfybuilder.listWorkspaces).not.toHaveBeenCalled()
  })

  it('does not restore a team if sign-out arrives while membership is loading', async () => {
    api.getSetting.mockResolvedValue('w2')
    const catalog = deferred<Workspace[]>()
    api.comfybuilder.listWorkspaces.mockReturnValueOnce(catalog.promise)
    const scope = useDashboardScopeStore()
    const initializing = scope.initialize()
    await flushPromises()
    authChanged({ signedIn: false })
    catalog.resolve(workspaces)
    await initializing
    expect(scope.selectedWorkspaceId).toBe('personal')
  })

  it('waits for the current session if authentication changes during initialization', async () => {
    api.getSetting.mockResolvedValue('w2')
    const stale = deferred<Workspace[]>()
    api.comfybuilder.listWorkspaces.mockReturnValueOnce(stale.promise)
    const scope = useDashboardScopeStore()
    const initializing = scope.initialize()
    await flushPromises()
    authChanged({ ...signedIn, workspaceId: 'w3' })
    api.comfybuilder.listWorkspaces.mockResolvedValue([
      { id: 'w3', name: 'Three', type: 'team', role: 'owner' }
    ])
    stale.resolve(workspaces)
    await initializing
    expect(scope.selectedWorkspaceId).toBe('w3')
  })

  it('follows authenticated switches only while viewing the old active scope', async () => {
    const scope = useDashboardScopeStore()
    await scope.initialize()
    authChanged({ ...signedIn, workspaceId: 'w2' })
    await flushPromises()
    expect(scope.selectedWorkspaceId).toBe('w2')

    scope.selectWorkspace('personal')
    authChanged(signedIn)
    await flushPromises()
    expect(scope.selectedWorkspaceId).toBe('personal')
    scope.selectWorkspace('w2')
    authChanged({ signedIn: false })
    await flushPromises()
    expect(scope.selectedWorkspaceId).toBe('personal')
    authChanged(signedIn)
    await flushPromises()
    expect(scope.selectedWorkspaceId).toBe('w1')
  })
})
