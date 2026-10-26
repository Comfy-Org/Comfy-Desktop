import { computed, watch } from 'vue'
import { useAuthStore } from '../stores/authStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { emitTelemetryAction } from '../lib/telemetry'
import { PERSONAL_WORKSPACE_ID } from '../../../shared/workspaces'
import type { Installation } from '../types/ipc'

/**
 * The dashboard's workspace: which one is selected, which installs belong to
 * it, and keeping the session's workspace and its Build catalog in step.
 *
 * Every user has a local Personal workspace. Signed-in users additionally see
 * authenticated team workspaces; the server Personal workspace merges into
 * the local Personal scope.
 */
export function useDashboardWorkspace() {
  const authStore = useAuthStore()
  const dashboardScope = useDashboardScopeStore()
  void dashboardScope.initialize()

  const selectedWorkspaceModel = computed({
    get: () => dashboardScope.selectedWorkspaceId,
    set: dashboardScope.selectWorkspace
  })

  /** Server workspace whose Builds belong to the selected dashboard scope. */
  const selectedManagedWorkspaceId = computed(() => {
    if (!authStore.isSignedIn) return null
    if (dashboardScope.selectedWorkspaceId !== PERSONAL_WORKSPACE_ID) {
      return dashboardScope.selectedWorkspaceId
    }
    if (authStore.status.workspaceType === 'personal') return authStore.status.workspaceId ?? null
    return authStore.personalWorkspace?.id ?? null
  })

  // Warm the selected workspace's Build catalog while the user is still on the
  // dashboard. New Instance can then choose its initial tab without waiting for
  // a network request. A generation guard prevents a slower previous selection
  // from fetching after the user has moved to another workspace.
  let buildPrefetchGeneration = 0
  watch(
    [() => authStore.isSignedIn, selectedManagedWorkspaceId],
    async ([signedIn, workspaceId]) => {
      const generation = ++buildPrefetchGeneration
      if (!signedIn || !workspaceId) return
      try {
        if (authStore.status.workspaceId !== workspaceId) {
          await authStore.switchWorkspace(workspaceId)
        }
        if (
          generation !== buildPrefetchGeneration ||
          selectedManagedWorkspaceId.value !== workspaceId
        )
          return
        await authStore.fetchBuilds()
      } catch {
        // The wizard retains its normal authorization and retry UI when a
        // background prefetch cannot complete.
      }
    },
    { immediate: true }
  )

  function installationIsInSelectedScope(inst: Installation): boolean {
    return dashboardScope.selectedWorkspaceId === PERSONAL_WORKSPACE_ID
      ? inst.workspaceId === undefined || inst.workspaceId === PERSONAL_WORKSPACE_ID
      : inst.workspaceId === dashboardScope.selectedWorkspaceId
  }

  const refreshingWorkspace = computed(() => authStore.loadingWorkspaces || authStore.loadingBuilds)

  async function refreshWorkspace(): Promise<void> {
    emitTelemetryAction('comfy.desktop.workspace.refresh', {})
    await Promise.all([authStore.fetchWorkspaces(), authStore.fetchBuilds()])
  }

  /** A signed-in user can turn a local install into a Build of the active workspace. */
  function canPromoteToWorkspace(inst: Installation): boolean {
    return (
      authStore.isSignedIn &&
      Boolean(authStore.status.workspaceId) &&
      inst.status === 'installed' &&
      inst.sourceCategory === 'local' &&
      Boolean(inst.installPath)
    )
  }

  return {
    selectedWorkspaceModel,
    installationIsInSelectedScope,
    refreshingWorkspace,
    refreshWorkspace,
    canPromoteToWorkspace
  }
}
