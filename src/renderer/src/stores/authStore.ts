import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'

import type {
  AuthStatus,
  ElectronApi,
  Workspace,
  WorkspaceSwitchFailure,
  WorkspaceSwitchIntent
} from '../../../types/ipc'
import { isPersonalWorkspace, PERSONAL_WORKSPACE_ID } from '../../../shared/workspaces'
import type { Build } from '../devplatform/types'

export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus>({ signedIn: false })
  const statusLoaded = ref(false)
  const workspaces = ref<Workspace[]>([])
  const builds = ref<Build[]>([])
  const selectedWorkspaceId = ref(PERSONAL_WORKSPACE_ID)
  const loadingWorkspaces = ref(false)
  const workspacesLoaded = ref(false)
  let workspacesRequest: Promise<Workspace[]> | undefined
  const loadingBuilds = ref(false)
  const buildsLoaded = ref(false)
  const workspacesError = ref(false)
  const buildsError = ref(false)
  const workspaceSwitchFailure = ref<WorkspaceSwitchFailure>()
  let latestSwitch = 0
  const comfybuilderApi = (window as Window & { api: ElectronApi }).api.comfybuilder

  let revision = 0
  let workspaceContextInitialized = false

  function initializeWorkspaceContext(workspaceId?: string): void {
    if (workspaceContextInitialized) return
    selectedWorkspaceId.value = workspaceId ?? PERSONAL_WORKSPACE_ID
    workspaceContextInitialized = true
  }

  function resetWorkspaceContext(): void {
    selectedWorkspaceId.value = PERSONAL_WORKSPACE_ID
    workspaceContextInitialized = false
  }

  function advanceRevision(): void {
    revision += 1
    loadingWorkspaces.value = false
    workspacesLoaded.value = false
    workspacesRequest = undefined
    loadingBuilds.value = false
    workspacesError.value = false
    buildsError.value = false
    workspaceSwitchFailure.value = undefined
  }

  function sameIdentity(a: AuthStatus, b: AuthStatus): boolean {
    return a.signedIn === b.signedIn && a.workspaceId === b.workspaceId
  }

  function applyAuthoritativeStatus(next: AuthStatus): void {
    statusLoaded.value = true
    if (sameIdentity(status.value, next)) {
      status.value = next
      return
    }
    advanceRevision()
    status.value = next
    if (!next.signedIn) {
      resetScopedState()
      resetWorkspaceContext()
    } else {
      builds.value = []
      buildsLoaded.value = false
    }
  }

  function resetScopedState(): void {
    workspaces.value = []
    builds.value = []
    buildsLoaded.value = false
  }

  async function fetchStatus(): Promise<AuthStatus> {
    const seen = revision
    const next = await comfybuilderApi.getAuthStatus()
    if (revision === seen && next) applyAuthoritativeStatus(next)
    return next
  }

  async function signIn(): Promise<AuthStatus> {
    const next = await comfybuilderApi.signIn()
    applyAuthoritativeStatus(next)
    return next
  }

  async function signOut(): Promise<AuthStatus> {
    const next = await comfybuilderApi.signOut()
    applyAuthoritativeStatus(next)
    return status.value
  }

  function fetchWorkspaces(): Promise<Workspace[]> {
    const seen = revision
    workspacesRequest ??= loadWorkspaces().finally(() => {
      if (revision === seen) workspacesRequest = undefined
    })
    return workspacesRequest
  }

  async function loadWorkspaces(): Promise<Workspace[]> {
    if (!status.value.signedIn) {
      workspaces.value = []
      workspacesLoaded.value = false
      return workspaces.value
    }
    const seen = revision
    loadingWorkspaces.value = true
    if (revision === seen) workspacesError.value = false
    try {
      const next = await comfybuilderApi.listWorkspaces()
      if (revision === seen) {
        workspaces.value = next
        workspacesLoaded.value = true
        const current = next.find((workspace) => workspace.id === status.value.workspaceId)
        status.value = { ...status.value, workspaceName: current?.name }
      }
      return workspaces.value
    } catch {
      if (revision === seen) workspacesError.value = true
      return workspaces.value
    } finally {
      if (revision === seen) loadingWorkspaces.value = false
    }
  }

  async function switchWorkspace(
    workspaceId: string,
    intent: WorkspaceSwitchIntent = 'chosen'
  ): Promise<AuthStatus> {
    const thisSwitch = ++latestSwitch
    workspaceSwitchFailure.value = undefined
    const { workspaceSwitchFailure: failure, ...next } = await comfybuilderApi.switchWorkspace(
      workspaceId,
      intent
    )
    applyAuthoritativeStatus(next)
    if (thisSwitch === latestSwitch) workspaceSwitchFailure.value = failure
    return next
  }

  const unsubscribe = comfybuilderApi.onAuthChanged((nextStatus) => {
    applyAuthoritativeStatus(nextStatus)
  })

  const initialStatus = fetchStatus().catch(() => status.value)

  onScopeDispose(() => {
    unsubscribe?.()
  })

  const isSignedIn = computed(() => status.value.signedIn)
  const personalWorkspace = computed(() => workspaces.value.find(isPersonalWorkspace) ?? null)

  async function fetchBuilds(): Promise<Build[]> {
    if (!isSignedIn.value) {
      builds.value = []
      buildsLoaded.value = false
      return builds.value
    }
    const seen = revision
    loadingBuilds.value = true
    if (revision === seen) buildsError.value = false
    try {
      const next = await comfybuilderApi.listBuilds()
      if (revision === seen) {
        builds.value = next
        buildsLoaded.value = true
      }
      return builds.value
    } catch {
      if (revision === seen) buildsError.value = true
      return builds.value
    } finally {
      if (revision === seen) loadingBuilds.value = false
    }
  }

  return {
    status,
    statusLoaded,
    workspaces,
    builds,
    selectedWorkspaceId,
    loadingWorkspaces,
    workspacesLoaded,
    loadingBuilds,
    buildsLoaded,
    workspacesError,
    buildsError,
    workspaceSwitchFailure,
    isSignedIn,
    personalWorkspace,
    initializeWorkspaceContext,
    resetWorkspaceContext,
    fetchStatus,
    whenReady: () => initialStatus,
    signIn,
    signOut,
    fetchWorkspaces,
    switchWorkspace,
    fetchBuilds
  }
})
