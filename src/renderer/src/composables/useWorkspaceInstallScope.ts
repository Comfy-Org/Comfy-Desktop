import { computed, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '../stores/authStore'
import type { Installation } from '../types/ipc'

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

      authStore.initializeWorkspaceContext(next.workspaceId)

      if (
        selectedWorkspaceId.value !== null &&
        selectedWorkspaceId.value === previous?.workspaceId
      ) {
        selectedWorkspaceId.value = next.workspaceId ?? null
      }
    },
    { immediate: true }
  )

  function installationIsInSelectedScope(installation: Installation): boolean {
    if (!authStore.isSignedIn) return installation.workspaceId === undefined
    return selectedWorkspaceId.value === null
      ? installation.workspaceId === undefined
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
