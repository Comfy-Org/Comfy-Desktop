import { computed, watch, type Ref } from 'vue'
import { useAuthStore } from '../stores/authStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import type { Installation } from '../types/ipc'
import { isInstallationInWorkspace } from '../../../shared/workspaces'

export function useWorkspaceInstallScope(installations: Ref<Installation[]>) {
  const authStore = useAuthStore()
  const dashboardScope = useDashboardScopeStore()
  const selectedWorkspaceId = computed({
    get: () => dashboardScope.selectedWorkspaceId,
    set: dashboardScope.selectWorkspace
  })
  void dashboardScope.initialize()

  watch(
    [() => authStore.isSignedIn, () => authStore.status.workspaceId],
    ([signedIn, workspaceId]) => {
      if (signedIn && workspaceId) void authStore.fetchBuilds()
    },
    { immediate: true }
  )

  function installationIsInSelectedScope(installation: Installation): boolean {
    return isInstallationInWorkspace(installation, selectedWorkspaceId.value)
  }

  const scopedInstallations = computed(() =>
    installations.value.filter(installationIsInSelectedScope)
  )

  return {
    selectedWorkspaceId,
    installationIsInSelectedScope,
    scopedInstallations
  }
}
