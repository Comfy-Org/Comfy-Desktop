import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  DASHBOARD_WORKSPACE_SETTING,
  PERSONAL_WORKSPACE_ID,
  isPersonalWorkspace,
  workspaceContextId
} from '../../../shared/workspaces'
import { useAuthStore } from './authStore'

/** Dashboard browsing scope is independent of the workspace used for remote operations.
 * All New Instance entry points read this live state; settings only persist it across launches. */
export const useDashboardScopeStore = defineStore('dashboardScope', () => {
  const authStore = useAuthStore()
  const selectedWorkspaceId = ref(PERSONAL_WORKSPACE_ID)
  const initialized = ref(false)
  let initialization: Promise<void> | undefined
  let selectionChanged = false
  let persistedWorkspaceId: unknown

  const membershipKnown = computed(
    () => authStore.workspacesLoaded && !authStore.loadingWorkspaces && !authStore.workspacesError
  )

  function resolveWorkspaceId(preferred?: string): string {
    if (!authStore.isSignedIn) return PERSONAL_WORKSPACE_ID
    const fallback = workspaceContextId(authStore.status)
    const candidate = preferred || fallback
    if (candidate === PERSONAL_WORKSPACE_ID || !membershipKnown.value) return candidate

    // Only a successful catalog response establishes lost membership. The
    // authenticated workspace can itself be stale, so validate the fallback too.
    const workspace =
      authStore.workspaces.find((workspace) => workspace.id === candidate) ??
      authStore.workspaces.find((workspace) => workspace.id === fallback)
    return workspace && !isPersonalWorkspace(workspace) ? workspace.id : PERSONAL_WORKSPACE_ID
  }

  function applySelection(workspaceId: string): void {
    selectedWorkspaceId.value = workspaceId
    if (!initialized.value || persistedWorkspaceId === workspaceId) return
    persistedWorkspaceId = workspaceId
    void window.api.setSetting(DASHBOARD_WORKSPACE_SETTING, workspaceId).catch((error) => {
      if (persistedWorkspaceId === workspaceId) persistedWorkspaceId = undefined
      console.warn('Could not save dashboard workspace', error)
    })
  }

  function selectWorkspace(workspaceId: string): void {
    selectionChanged = true
    applySelection(resolveWorkspaceId(workspaceId))
  }

  function initialize(): Promise<void> {
    initialization ??= (async () => {
      const [saved] = await Promise.all([
        window.api.getSetting(DASHBOARD_WORKSPACE_SETTING).catch(() => undefined),
        authStore.whenReady()
      ])
      persistedWorkspaceId = saved
      const savedWorkspaceId = typeof saved === 'string' && saved.trim() ? saved : undefined
      const preferredWorkspaceId = () =>
        selectionChanged ? selectedWorkspaceId.value : savedWorkspaceId
      // An auth change can invalidate a pending request. Keep waiting for the
      // current session's catalog, but never treat a failed request as empty
      // or block an explicit Personal selection on the network.
      while (
        preferredWorkspaceId() !== PERSONAL_WORKSPACE_ID &&
        authStore.isSignedIn &&
        !authStore.workspacesLoaded &&
        !authStore.workspacesError
      ) {
        await authStore.fetchWorkspaces()
      }
      initialized.value = true
      applySelection(resolveWorkspaceId(preferredWorkspaceId()))
    })()
    return initialization
  }

  watch(
    () => ({ signedIn: authStore.isSignedIn, workspaceId: workspaceContextId(authStore.status) }),
    (next, previous) => {
      if (!initialized.value) return
      if (!next.signedIn) {
        applySelection(PERSONAL_WORKSPACE_ID)
        return
      }
      if (next.signedIn === previous.signedIn && next.workspaceId === previous.workspaceId) return
      // Follow an authenticated switch only when browsing that workspace;
      // an independent Personal/team selection remains local to the dashboard.
      if (selectedWorkspaceId.value === previous.workspaceId) {
        applySelection(resolveWorkspaceId(next.workspaceId))
      }
      void authStore.fetchWorkspaces()
    }
  )

  watch([() => authStore.workspaces, membershipKnown], () => {
    if (initialized.value && membershipKnown.value) {
      applySelection(resolveWorkspaceId(selectedWorkspaceId.value))
    }
  })

  return { selectedWorkspaceId, initialized, initialize, selectWorkspace }
})
