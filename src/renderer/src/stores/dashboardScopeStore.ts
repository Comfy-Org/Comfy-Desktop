import { computed, onScopeDispose, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  DASHBOARD_WORKSPACE_SETTING,
  PERSONAL_WORKSPACE_ID,
  isPersonalWorkspace,
  workspaceContextId
} from '../../../shared/workspaces'
import { useAuthStore } from './authStore'

/** Dashboard browsing scope is independent of the workspace used for remote operations.
 * All New Instance entry points read this live state; settings synchronize windows and launches. */
export const useDashboardScopeStore = defineStore('dashboardScope', () => {
  const authStore = useAuthStore()
  const selectedWorkspaceId = ref(PERSONAL_WORKSPACE_ID)
  const initialized = ref(false)
  let initialization: Promise<void> | undefined
  let selectionChanged = false
  let persistedWorkspaceId: unknown
  let preferenceRead = Promise.resolve()
  let preferenceRevision = 0
  let pendingWrite: { workspaceId: string } | undefined
  let disposed = false

  const membershipKnown = computed(
    () => authStore.workspacesLoaded && !authStore.loadingWorkspaces && !authStore.workspacesError
  )

  function resolveWorkspaceId(preferred?: string): string {
    if (!authStore.statusLoaded) return preferred || PERSONAL_WORKSPACE_ID
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
    if (
      !initialized.value ||
      (!authStore.statusLoaded && !selectionChanged) ||
      (!pendingWrite && persistedWorkspaceId === workspaceId) ||
      pendingWrite?.workspaceId === workspaceId
    )
      return

    const write = { workspaceId }
    const seen = preferenceRevision
    pendingWrite = write
    void window.api
      .setSetting(DASHBOARD_WORKSPACE_SETTING, workspaceId)
      .then(() => {
        // Keep the last confirmed value on failure, so a delayed settings echo
        // cannot roll back a newer live selection whose write failed.
        if (pendingWrite === write && preferenceRevision === seen)
          persistedWorkspaceId = workspaceId
      })
      .catch((error) => console.warn('Could not save dashboard workspace', error))
      .finally(() => {
        if (pendingWrite === write) pendingWrite = undefined
      })
  }

  function selectWorkspace(workspaceId: string): void {
    selectionChanged = true
    preferenceRevision += 1
    applySelection(resolveWorkspaceId(workspaceId))
  }

  function savedWorkspaceId(): string | undefined {
    return typeof persistedWorkspaceId === 'string' && persistedWorkspaceId.trim()
      ? persistedWorkspaceId
      : undefined
  }

  function readPreference(): Promise<void> {
    const seen = ++preferenceRevision
    preferenceRead = window.api
      .getSetting(DASHBOARD_WORKSPACE_SETTING)
      .then((saved) => {
        if (disposed || preferenceRevision !== seen || saved === persistedWorkspaceId) return
        persistedWorkspaceId = saved
        selectionChanged = false
        if (initialized.value) {
          applySelection(resolveWorkspaceId(savedWorkspaceId()))
        }
      })
      .catch(() => {}) // A failed read supplies no replacement preference.
    return preferenceRead
  }

  const unsubscribe = window.api.onSettingsChanged(({ key }) => {
    if (key === DASHBOARD_WORKSPACE_SETTING) void readPreference()
  })
  onScopeDispose(() => {
    disposed = true
    unsubscribe()
  })

  function initialize(): Promise<void> {
    initialization ??= (async () => {
      let reading = readPreference()
      await Promise.all([reading, authStore.whenReady()])
      // A broadcast can supersede the initial read while IPC is in flight.
      while (reading !== preferenceRead) {
        reading = preferenceRead
        await reading
      }
      if (disposed) return
      initialized.value = true
      applySelection(
        resolveWorkspaceId(selectionChanged ? selectedWorkspaceId.value : savedWorkspaceId())
      )
      // Membership validates the restored selection in the background. Local
      // browsing and opening a wizard never wait on a Cloud request.
      if (
        authStore.isSignedIn &&
        selectedWorkspaceId.value !== PERSONAL_WORKSPACE_ID &&
        !authStore.workspacesLoaded &&
        !authStore.workspacesError
      ) {
        void authStore.fetchWorkspaces()
      }
    })()
    return initialization
  }

  watch(
    () => ({
      loaded: authStore.statusLoaded,
      signedIn: authStore.isSignedIn,
      workspaceId: workspaceContextId(authStore.status)
    }),
    (next, previous) => {
      if (!initialized.value || !next.loaded) return
      if (!next.signedIn) {
        applySelection(PERSONAL_WORKSPACE_ID)
        return
      }
      if (
        previous.loaded &&
        next.signedIn === previous.signedIn &&
        next.workspaceId === previous.workspaceId
      )
        return

      if (!previous.loaded) {
        applySelection(resolveWorkspaceId(selectedWorkspaceId.value))
      } else if (selectedWorkspaceId.value === previous.workspaceId) {
        // Follow an authenticated switch only when browsing that workspace;
        // an independent Personal/team selection remains local to the dashboard.
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
