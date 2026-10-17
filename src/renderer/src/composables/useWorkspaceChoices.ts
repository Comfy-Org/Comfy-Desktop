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

  /** A plan or role as Cloud names it, translated when known. Cloud's reply is
   *  not validated, so anything but a string reads as unknown. */
  function knownLabel(value: unknown, known: ReadonlySet<string>, keyPrefix: string): string {
    if (typeof value !== 'string') return ''
    const key = value.toLowerCase()
    return known.has(key) ? t(`${keyPrefix}.${key}`) : key
  }

  function tierLabel(workspace: Workspace | null): string {
    return knownLabel(workspace?.subscriptionTier, KNOWN_TIERS, 'buildsDashboard.account.tier')
  }

  function roleLabel(workspace: Workspace | null): string {
    return knownLabel(workspace?.role, KNOWN_ROLES, 'buildsDashboard.account.role')
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

  const canManagePlan = computed(() => {
    const role: unknown = currentWorkspace.value?.role
    return typeof role === 'string' && role.toLowerCase() === 'owner'
  })

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

  /** Re-read the list, e.g. after a workspace was added on Comfy Cloud. */
  function refreshWorkspaces(): void {
    if (store.isSignedIn && !store.loadingWorkspaces) void store.fetchWorkspaces().catch(() => {})
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
    fetchWorkspacesIfNeeded,
    refreshWorkspaces
  }
}
