import { computed, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '../stores/authStore'
import type { Installation } from '../types/ipc'
import { PERSONAL_WORKSPACE_ID, workspaceContextId } from '../../../shared/workspaces'

/** Keeps install lists scoped to the workspace selected in the shared dashboard control. */
export function useWorkspaceInstallScope(installations: Ref<Installation[]>) {
  const authStore = useAuthStore()
  const { selectedWorkspaceId } = storeToRefs(authStore)

  watch(
    () => ({ signedIn: authStore.isSignedIn, workspaceId: authStore.status.workspaceId }),
    (next, previous) => {
      if (!next.signedIn) {
        authStore.resetWorkspaceContext()
        return
      }

      if (next.workspaceId && next.workspaceId !== previous?.workspaceId) {
        void authStore.fetchBuilds()
      }

      authStore.initializeWorkspaceContext(workspaceContextId(authStore.status))

      if (
        previous &&
        selectedWorkspaceId.value === workspaceContextId(previous) &&
        workspaceContextId(authStore.status) !== selectedWorkspaceId.value
      ) {
        selectedWorkspaceId.value = workspaceContextId(authStore.status)
      }
    },
    { immediate: true }
  )

  function installationIsInSelectedScope(installation: Installation): boolean {
    return selectedWorkspaceId.value === PERSONAL_WORKSPACE_ID
      ? installation.workspaceId === undefined || installation.workspaceId === PERSONAL_WORKSPACE_ID
      : installation.workspaceId === selectedWorkspaceId.value
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
