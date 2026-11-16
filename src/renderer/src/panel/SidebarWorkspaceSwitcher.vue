<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { DropdownMenuLabel, DropdownMenuRadioGroup } from 'reka-ui'
import { ArrowRightLeft, CreditCard, Ellipsis, LogOut, Settings } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import MenuSub from '@comfyorg/design-system/menu/MenuSub'
import MenuSubContent from '@comfyorg/design-system/menu/MenuSubContent'
import MenuSubTrigger from '@comfyorg/design-system/menu/MenuSubTrigger'
import BaseMenuRadioItem from '../components/ui/BaseMenuRadioItem.vue'
import WorkspaceAvatar from '../components/WorkspaceAvatar.vue'
import { useAuthStore } from '../stores/authStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import {
  isPersonalWorkspace,
  PERSONAL_WORKSPACE_ID,
  workspaceContextId
} from '../../../shared/workspaces'
import type { PlatformSettingsPage, Workspace } from '../../../types/ipc'

const { collapsed } = defineProps<{
  collapsed: boolean
}>()

const { t, te } = useI18n()
const store = useAuthStore()
const dashboardScope = useDashboardScopeStore()

const menuOpen = ref(false)
useEventListener(window, 'blur', () => {
  menuOpen.value = false
})

function scopeId(workspace: Workspace): string {
  return isPersonalWorkspace(workspace) ? PERSONAL_WORKSPACE_ID : workspace.id
}

function translatedOr(key: string, fallback: string): string {
  return te(key) ? t(key) : fallback
}

function planLabel(tier: string | null | undefined): string {
  return tier ? translatedOr(`devPlatform.workspaceMenu.plan.${tier}`, tier) : ''
}

function roleLabel(role: string): string {
  return translatedOr(`devPlatform.workspaceMenu.role.${role}`, role)
}

const workspaceRows = computed<Workspace[]>(() => [
  store.workspaces.find(isPersonalWorkspace) ?? {
    id: PERSONAL_WORKSPACE_ID,
    name: t('devPlatform.workspace.personalLabel'),
    type: 'personal',
    role: 'owner'
  },
  ...store.workspaces.filter((workspace) => !isPersonalWorkspace(workspace))
])
const currentWorkspace = computed(() =>
  store.workspaces.find((workspace) => scopeId(workspace) === dashboardScope.selectedWorkspaceId)
)
const currentStatus = computed(() =>
  workspaceContextId(store.status) === dashboardScope.selectedWorkspaceId ? store.status : undefined
)
const currentWorkspaceName = computed(
  () =>
    currentWorkspace.value?.name ??
    currentStatus.value?.workspaceName ??
    t('devPlatform.workspace.switchLabel')
)
const currentWorkspaceMeta = computed(() => {
  const current = currentWorkspace.value
  return current
    ? [planLabel(current.subscriptionTier), roleLabel(current.role)].filter(Boolean)
    : []
})
const currentCloudWorkspaceId = computed(
  () => currentWorkspace.value?.id ?? currentStatus.value?.workspaceId
)
const settingsPage = computed<PlatformSettingsPage>(() =>
  dashboardScope.selectedWorkspaceId === PERSONAL_WORKSPACE_ID ? 'people' : 'general'
)

function fetchWorkspacesIfMissing(): void {
  if (store.isSignedIn && !store.workspacesLoaded && !store.loadingWorkspaces) {
    void store.fetchWorkspaces()
  }
}

watch(() => store.isSignedIn, fetchWorkspacesIfMissing, { immediate: true })
watch(menuOpen, (open) => {
  if (open) fetchWorkspacesIfMissing()
})

function selectWorkspace(workspaceId: unknown): void {
  if (typeof workspaceId === 'string' && workspaceId !== dashboardScope.selectedWorkspaceId) {
    dashboardScope.selectWorkspace(workspaceId)
  }
}

function openSettingsPage(page: PlatformSettingsPage): void {
  const workspaceId = currentCloudWorkspaceId.value
  if (!workspaceId) return
  void window.api.comfybuilder.openSettingsPage(page, workspaceId).catch(() => {})
}

function signOut(): void {
  void store.signOut().catch(() => {})
}
</script>

<template>
  <Menu
    v-model:open="menuOpen"
    :modal="false"
    side="top"
    :side-offset="8"
    class="w-75 max-w-[calc(100vw-2rem)]"
    :aria-label="t('devPlatform.workspace.switchLabel')"
    data-testid="workspace-menu"
  >
    <template #trigger>
      <Button
        type="button"
        variant="textonly"
        size="unset"
        class="h-12 w-full rounded-lg text-ui font-medium hover:bg-secondary data-[state=open]:bg-secondary"
        :class="collapsed ? 'justify-center p-1' : 'justify-start gap-3 px-3'"
        data-testid="workspace-switcher-trigger"
        :aria-label="currentWorkspaceName"
        :title="collapsed ? currentWorkspaceName : undefined"
      >
        <WorkspaceAvatar
          size="sm"
          :workspace-name="currentWorkspaceName"
          :subscription-tier="currentWorkspace?.subscriptionTier"
        />
        <template v-if="!collapsed">
          <span class="min-w-0 flex-1 truncate text-left">{{ currentWorkspaceName }}</span>
          <Ellipsis class="text-muted-foreground" :size="16" aria-hidden="true" />
        </template>
      </Button>
    </template>

    <MenuSub>
      <MenuSubTrigger
        class="gap-3 p-2"
        :aria-label="t('devPlatform.workspaceMenu.switchWorkspace')"
        data-testid="workspace-switch-action"
      >
        <WorkspaceAvatar
          :workspace-name="currentWorkspaceName"
          :subscription-tier="currentWorkspace?.subscriptionTier"
        />
        <span class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="truncate text-sm/tight font-medium">{{ currentWorkspaceName }}</span>
          <span
            v-if="currentWorkspaceMeta.length"
            class="flex items-center gap-1 overflow-hidden text-2xs/tight font-medium whitespace-nowrap text-muted-foreground uppercase"
            data-testid="workspace-menu-meta"
          >
            <template v-for="(part, index) in currentWorkspaceMeta" :key="index">
              <span
                v-if="index > 0"
                class="size-0.75 shrink-0 rounded-full bg-current"
                aria-hidden="true"
              />
              <span>{{ part }}</span>
            </template>
          </span>
        </span>
        <ArrowRightLeft class="text-muted-foreground" :size="16" aria-hidden="true" />
      </MenuSubTrigger>
      <MenuSubContent
        :side-offset="8"
        class="w-62"
        :aria-label="t('devPlatform.workspaceMenu.switchWorkspace')"
        data-testid="workspace-switcher-panel"
      >
        <div
          v-if="store.loadingWorkspaces && store.workspaces.length === 0"
          class="px-3 py-1.5 text-xs text-muted-foreground"
          role="status"
        >
          {{ t('common.loading') }}
        </div>
        <MenuItem
          v-else-if="store.workspacesError"
          data-testid="workspace-load-error"
          @select.prevent="store.fetchWorkspaces()"
          >{{ t('devPlatform.workspace.loadError') }}</MenuItem
        >
        <DropdownMenuRadioGroup
          :model-value="dashboardScope.selectedWorkspaceId"
          @update:model-value="selectWorkspace"
        >
          <BaseMenuRadioItem
            v-for="workspace in workspaceRows"
            :key="workspace.id"
            :value="scopeId(workspace)"
            :data-testid="`workspace-option-${workspace.id}`"
          >
            <WorkspaceAvatar
              :workspace-name="workspace.name"
              :subscription-tier="workspace.subscriptionTier"
            />
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="truncate text-sm/tight font-medium">{{ workspace.name }}</span>
              <span
                v-if="workspace.subscriptionTier"
                class="truncate text-2xs/tight font-medium text-muted-foreground uppercase"
                >{{ planLabel(workspace.subscriptionTier) }}</span
              >
            </span>
          </BaseMenuRadioItem>
        </DropdownMenuRadioGroup>
      </MenuSubContent>
    </MenuSub>
    <MenuItem
      :disabled="!currentCloudWorkspaceId"
      data-testid="workspace-settings"
      @select="openSettingsPage(settingsPage)"
    >
      <Settings class="text-muted-foreground" :size="16" aria-hidden="true" />
      {{ t('devPlatform.workspaceMenu.workspaceSettings') }}
    </MenuItem>
    <MenuItem
      :disabled="!currentCloudWorkspaceId"
      data-testid="workspace-manage-credits"
      @select="openSettingsPage('billing')"
    >
      <CreditCard class="text-muted-foreground" :size="16" aria-hidden="true" />
      {{ t('devPlatform.workspaceMenu.managePlanAndCredits') }}
    </MenuItem>

    <MenuSeparator />
    <DropdownMenuLabel
      v-if="store.status.email"
      class="truncate px-3 py-1.5 text-xs text-muted-foreground"
      data-testid="workspace-menu-user"
      >{{ store.status.email }}</DropdownMenuLabel
    >
    <MenuItem data-testid="workspace-logout" @select="signOut">
      <LogOut class="text-muted-foreground" :size="16" aria-hidden="true" />
      {{ t('devPlatform.workspaceMenu.logOut') }}
    </MenuItem>
  </Menu>
</template>
