import { computed, watch } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/authStore'
import { isPersonalWorkspace, PERSONAL_WORKSPACE_ID } from '../../../shared/workspaces'
import type { Workspace } from '../types/ipc'

/** Cloud's subscription tiers with a name; any other is shown as sent. */
const KNOWN_TIERS = new Set([
  'free',
  'standard',
  'creator',
  'pro',
  'founders_edition',
  'team',
  'enterprise'
])
const KNOWN_ROLES = new Set(['owner', 'member'])

/** The workspaces a user can switch the dashboard to, and how each is named:
 *  the local Personal scope first, then the signed-in user's team workspaces. */
export function useWorkspaceChoices(currentWorkspaceId: Readonly<Ref<string>>) {
  const { t } = useI18n()
  const store = useAuthStore()

  function workspaceLabel(workspace: { name: string; type: string }): string {
    return isPersonalWorkspace(workspace) || workspace.type !== 'team'
      ? t('devPlatform.workspace.personalLabel')
      : workspace.name
  }

  function tierLabel(workspace: Workspace | null): string {
    const tier = workspace?.subscriptionTier?.toLowerCase() ?? ''
    return KNOWN_TIERS.has(tier) ? t(`buildsDashboard.account.tier.${tier}`) : tier
  }

  function roleLabel(workspace: Workspace | null): string {
    const role = workspace?.role?.toLowerCase() ?? ''
    return KNOWN_ROLES.has(role) ? t(`buildsDashboard.account.role.${role}`) : role
  }

  /** The selected workspace's record, once the list has loaded. */
  const currentWorkspace = computed(() =>
    currentWorkspaceId.value === PERSONAL_WORKSPACE_ID
      ? store.personalWorkspace
      : (store.workspaces.find((workspace) => workspace.id === currentWorkspaceId.value) ?? null)
  )

  /** Its plan and the user's role in it, e.g. Creator • Owner. */
  const currentMeta = computed(() =>
    [tierLabel(currentWorkspace.value), roleLabel(currentWorkspace.value)].filter(Boolean)
  )

  const canManagePlan = computed(() => currentWorkspace.value?.role?.toLowerCase() === 'owner')

  const teamWorkspaces = computed(() =>
    store.isSignedIn ? store.workspaces.filter((workspace) => !isPersonalWorkspace(workspace)) : []
  )

  /** Every workspace to switch to, Personal first, with its plan. */
  const workspaceChoices = computed(() => [
    {
      id: PERSONAL_WORKSPACE_ID,
      label: t('devPlatform.workspace.personalLabel'),
      tier: tierLabel(store.personalWorkspace)
    },
    ...teamWorkspaces.value.map((workspace) => ({
      id: workspace.id,
      label: workspaceLabel(workspace),
      tier: tierLabel(workspace)
    }))
  ])

  const currentWorkspaceName = computed(() => {
    if (currentWorkspaceId.value === PERSONAL_WORKSPACE_ID) {
      return t('devPlatform.workspace.personalLabel')
    }
    const current = store.workspaces.find((workspace) => workspace.id === currentWorkspaceId.value)
    if (current) return workspaceLabel(current)
    // Cached auth metadata describes only the authenticated workspace, which
    // may differ from the dashboard's selection (especially while offline).
    if (store.status.workspaceId === currentWorkspaceId.value) {
      if (
        isPersonalWorkspace({ name: store.status.workspaceName, type: store.status.workspaceType })
      ) {
        return t('devPlatform.workspace.personalLabel')
      }
      if (store.status.workspaceName) return store.status.workspaceName
    }
    return t('devPlatform.workspace.currentFallback')
  })

  function fetchWorkspacesIfNeeded(): void {
    if (store.isSignedIn && store.workspaces.length === 0 && !store.loadingWorkspaces) {
      void store.fetchWorkspaces().catch(() => {})
    }
  }

  watch(
    () => store.isSignedIn,
    (signedIn) => {
      if (signedIn) fetchWorkspacesIfNeeded()
    },
    { immediate: true }
  )

  return {
    teamWorkspaces,
    workspaceChoices,
    currentWorkspaceName,
    currentMeta,
    canManagePlan,
    workspaceLabel,
    fetchWorkspacesIfNeeded
  }
}
