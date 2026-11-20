import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/authStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import {
  PERSONAL_WORKSPACE_ID,
  workspaceContextId,
  workspaceScopeId
} from '../../../shared/workspaces'

export function useSelectedWorkspace() {
  const { t } = useI18n()
  const store = useAuthStore()
  const dashboardScope = useDashboardScopeStore()

  const workspace = computed(() =>
    store.workspaces.find(
      (candidate) => workspaceScopeId(candidate) === dashboardScope.selectedWorkspaceId
    )
  )
  const statusIsCurrent = computed(
    () => workspaceContextId(store.status) === dashboardScope.selectedWorkspaceId
  )
  const name = computed<string | undefined>(() =>
    dashboardScope.selectedWorkspaceId === PERSONAL_WORKSPACE_ID
      ? t('devPlatform.workspace.personalLabel')
      : (workspace.value?.name ?? (statusIsCurrent.value ? store.status.workspaceName : undefined))
  )

  return { workspace, statusIsCurrent, name }
}
