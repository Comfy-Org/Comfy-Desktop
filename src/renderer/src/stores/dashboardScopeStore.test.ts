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
  onSettingsChanged: vi.fn(),
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
    api.onSettingsChanged.mockReturnValue(() => {})
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

  it.each<{
    name: string
    saved?: string
    expected: string
    status?: AuthStatus
    catalog?: Workspace[]
  }>([
    { name: 'missing preference', expected: 'w1' },
    { name: 'empty preference', saved: '', expected: 'w1' },
    { name: 'removed team', saved: 'removed', expected: 'w1' },
    { name: 'explicit Personal', saved: 'personal', expected: 'personal' },
    { name: 'valid team', saved: 'w2', expected: 'w2' },
    { name: 'stale authenticated fallback', saved: 'removed', catalog: [], expected: 'personal' },
    {
      name: 'server Personal workspace',
      saved: 'server-personal',
      expected: 'personal',
      catalog: [
        ...workspaces,
        { id: 'server-personal', name: 'Personal workspace', type: 'team', role: 'owner' }
      ]
    },
    { name: 'signed out', saved: 'w2', status: { signedIn: false }, expected: 'personal' }
  ])(
    'restores and persists scope: $name',
    async ({ saved, expected, status = signedIn, catalog = workspaces }) => {
      api.getSetting.mockResolvedValue(saved)
      api.comfybuilder.getAuthStatus.mockResolvedValue(status)
      api.comfybuilder.listWorkspaces.mockResolvedValue(catalog)
      const scope = useDashboardScopeStore()
      await scope.initialize()
      await flushPromises()

      expect(scope.selectedWorkspaceId).toBe(expected)
      expect(useAuthStore().status.workspaceId).toBe(status.workspaceId)
      if (saved === expected) expect(api.setSetting).not.toHaveBeenCalled()
      else expect(api.setSetting).toHaveBeenCalledExactlyOnceWith('dashboardWorkspaceId', expected)
      if (saved === 'personal' || !status.signedIn) {
        expect(api.comfybuilder.listWorkspaces).not.toHaveBeenCalled()
      }
    }
  )

  it('preserves an unavailable saved workspace offline, then reconciles on successful retry', async () => {
    api.getSetting.mockResolvedValue('removed')
    api.comfybuilder.listWorkspaces.mockRejectedValueOnce(new Error('offline'))
    const scope = useDashboardScopeStore()
    await scope.initialize()
    await flushPromises()
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
    await flushPromises()
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

  it('reconciles the current session when auth changes during a membership request', async () => {
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
    await flushPromises()
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
