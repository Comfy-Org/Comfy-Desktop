<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { PopoverAnchor, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { ArrowRightLeft, Check, CreditCard, Ellipsis, LogOut, Settings } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import PopoverContent from '@comfyorg/design-system/popover/PopoverContent'
import SearchInput from '@comfyorg/design-system/search-input/SearchInput'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
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

const emit = defineEmits<{
  'menu-open': [open: boolean]
}>()

const SEARCH_THRESHOLD = 6

const PLAN_LABELS: Readonly<Record<string, string>> = {
  FREE: 'Free',
  STANDARD: 'Standard',
  CREATOR: 'Creator',
  PRO: 'Pro',
  FOUNDERS_EDITION: 'Founders',
  TEAM: 'Team',
  ENTERPRISE: 'Enterprise'
}

const { t } = useI18n()
const store = useAuthStore()
const dashboardScope = useDashboardScopeStore()

const roleLabels = computed<Readonly<Record<string, string>>>(() => ({
  owner: t('devPlatform.workspaceMenu.role.owner'),
  member: t('devPlatform.workspaceMenu.role.member')
}))

const menuOpen = ref(false)
const workspacesOpen = ref(false)
const query = ref('')
const workspaceFlyout = useTemplateRef<HTMLElement>('workspaceFlyout')

useEventListener(window, 'blur', () => {
  menuOpen.value = false
})

function scopeId(workspace: Workspace): string {
  return isPersonalWorkspace(workspace) ? PERSONAL_WORKSPACE_ID : workspace.id
}

function planLabel(tier: string | null | undefined): string {
  if (!tier) return ''
  return (Object.hasOwn(PLAN_LABELS, tier) && PLAN_LABELS[tier]) || tier
}

function roleLabel(role: string): string {
  return (Object.hasOwn(roleLabels.value, role) && roleLabels.value[role]) || role
}

const currentWorkspace = computed(() =>
  store.workspaces.find((workspace) => scopeId(workspace) === dashboardScope.selectedWorkspaceId)
)
const statusIsCurrent = computed(
  () => workspaceContextId(store.status) === dashboardScope.selectedWorkspaceId
)
const currentWorkspaceName = computed(
  () =>
    currentWorkspace.value?.name ??
    (statusIsCurrent.value ? store.status.workspaceName : undefined) ??
    t('devPlatform.workspaceMenu.workspace')
)
const currentWorkspaceTier = computed(() => currentWorkspace.value?.subscriptionTier)
const currentWorkspaceMeta = computed(() => {
  const current = currentWorkspace.value
  if (!current) return []
  return [planLabel(current.subscriptionTier), roleLabel(current.role)].filter(Boolean)
})
const currentCloudWorkspaceId = computed(
  () => currentWorkspace.value?.id ?? (statusIsCurrent.value ? store.status.workspaceId : undefined)
)
const settingsPage = computed<PlatformSettingsPage>(() => {
  const type =
    currentWorkspace.value?.type ?? (statusIsCurrent.value ? store.status.workspaceType : undefined)
  return type === 'team' ? 'general' : 'people'
})

const loadingWorkspaces = computed(() => store.loadingWorkspaces && store.workspaces.length === 0)
const searchable = computed(() => store.workspaces.length > SEARCH_THRESHOLD)
const filteredWorkspaces = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return store.workspaces
  return store.workspaces.filter((workspace) => workspace.name.toLowerCase().includes(needle))
})
const emptyMessage = computed(() => {
  if (loadingWorkspaces.value || filteredWorkspaces.value.length) return null
  return t(
    store.workspaces.length
      ? 'devPlatform.workspaceMenu.noMatch'
      : 'devPlatform.workspaceMenu.empty'
  )
})

function isCurrent(workspace: Workspace): boolean {
  return scopeId(workspace) === dashboardScope.selectedWorkspaceId
}

watch(
  () => store.isSignedIn,
  (signedIn) => {
    if (signedIn && !store.workspacesLoaded && !store.loadingWorkspaces) {
      void store.fetchWorkspaces()
    }
  },
  { immediate: true }
)

watch(menuOpen, (open) => {
  emit('menu-open', open)
  if (open) {
    if (store.workspacesError && !store.loadingWorkspaces) void store.fetchWorkspaces()
    return
  }
  workspacesOpen.value = false
})

onBeforeUnmount(() => {
  if (menuOpen.value) emit('menu-open', false)
})

watch(workspacesOpen, (open) => {
  if (!open) query.value = ''
})

function focusCurrentWorkspace(event: Event): void {
  event.preventDefault()
  void nextTick(() => {
    const flyout = workspaceFlyout.value
    ;(flyout?.querySelector<HTMLElement>('[aria-selected="true"]') ?? flyout)?.focus()
  })
}

function selectWorkspace(workspace: Workspace): void {
  if (isCurrent(workspace)) return
  dashboardScope.selectWorkspace(scopeId(workspace))
  menuOpen.value = false
}

function openSettingsPage(page: PlatformSettingsPage): void {
  const workspaceId = currentCloudWorkspaceId.value
  if (!workspaceId) return
  menuOpen.value = false
  void window.api.comfybuilder
    .openSettingsPage(page, workspaceId)
    .catch((error) => console.warn('Could not open Developer Platform settings', error))
}

async function signOut(): Promise<void> {
  menuOpen.value = false
  try {
    await store.signOut()
  } catch {
    return
  }
}
</script>

<template>
  <PopoverRoot v-model:open="menuOpen">
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="textonly"
        size="unset"
        class="h-12 w-full rounded-lg text-[13px]/5 font-medium hover:bg-secondary data-[state=open]:bg-secondary"
        :class="collapsed ? 'justify-center p-1' : 'justify-start gap-3 px-3'"
        data-testid="workspace-switcher-trigger"
        :aria-label="currentWorkspaceName"
        :title="collapsed ? currentWorkspaceName : undefined"
      >
        <WorkspaceAvatar
          size="sm"
          :workspace-name="currentWorkspaceName"
          :subscription-tier="currentWorkspaceTier"
        />
        <template v-if="!collapsed">
          <span class="min-w-0 flex-1 truncate text-left">{{ currentWorkspaceName }}</span>
          <Ellipsis class="text-muted-foreground" :size="16" aria-hidden="true" />
        </template>
      </Button>
    </PopoverTrigger>

    <PopoverContent
      side="top"
      align="start"
      :side-offset="8"
      class="w-75 max-w-[calc(100vw-2rem)] rounded-lg bg-popover p-0 shadow-lg"
      data-testid="workspace-menu"
    >
      <PopoverRoot v-model:open="workspacesOpen">
        <PopoverAnchor as-child>
          <div class="flex flex-col">
            <section class="flex flex-col border-b pb-2">
              <PopoverTrigger as-child>
                <Button
                  type="button"
                  variant="textonly"
                  size="unset"
                  class="group mx-2 mt-2 mb-1 justify-start gap-3 rounded-md p-2 text-left data-[state=open]:bg-accent"
                  :aria-label="t('devPlatform.workspaceMenu.switchWorkspace')"
                  data-testid="workspace-switch-action"
                >
                  <WorkspaceAvatar
                    :workspace-name="currentWorkspaceName"
                    :subscription-tier="currentWorkspaceTier"
                  />
                  <span class="flex min-w-0 flex-1 flex-col gap-1">
                    <span class="truncate text-sm/tight font-medium">{{
                      currentWorkspaceName
                    }}</span>
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
                  <span
                    class="flex size-8 shrink-0 items-center justify-center text-muted-foreground transition-colors group-hover:text-foreground group-data-[state=open]:text-foreground"
                    aria-hidden="true"
                  >
                    <ArrowRightLeft :size="16" />
                  </span>
                </Button>
              </PopoverTrigger>
              <Button
                type="button"
                variant="textonly"
                size="unset"
                class="mx-2 h-10 justify-start gap-2 rounded-md px-2 font-normal"
                data-testid="workspace-settings"
                :disabled="!currentCloudWorkspaceId"
                @click="openSettingsPage(settingsPage)"
              >
                <Settings class="text-muted-foreground" :size="16" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-left">{{
                  t('devPlatform.workspaceMenu.workspaceSettings')
                }}</span>
              </Button>
              <Button
                type="button"
                variant="textonly"
                size="unset"
                class="mx-2 h-10 justify-start gap-2 rounded-md px-2 font-normal"
                data-testid="workspace-manage-credits"
                :disabled="!currentCloudWorkspaceId"
                @click="openSettingsPage('billing')"
              >
                <CreditCard class="text-muted-foreground" :size="16" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-left">{{
                  t('devPlatform.workspaceMenu.managePlanAndCredits')
                }}</span>
              </Button>
            </section>

            <div class="flex flex-col py-2">
              <span
                class="truncate px-4 pt-3 pb-2 text-sm/tight text-muted-foreground"
                data-testid="workspace-menu-user"
                >{{ store.status.email || t('devPlatform.workspaceMenu.account') }}</span
              >
              <Button
                type="button"
                variant="textonly"
                size="unset"
                class="mx-2 h-10 justify-start gap-2 rounded-md px-2 font-normal"
                data-testid="workspace-logout"
                @click="signOut"
              >
                <LogOut class="text-muted-foreground" :size="16" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-left">{{
                  t('devPlatform.workspaceMenu.logOut')
                }}</span>
              </Button>
            </div>
          </div>
        </PopoverAnchor>

        <PopoverContent
          side="right"
          align="start"
          :side-offset="8"
          class="w-62 rounded-lg bg-popover p-0 shadow-lg"
          :aria-label="t('devPlatform.workspaceMenu.switchWorkspace')"
          :aria-busy="loadingWorkspaces || undefined"
          data-testid="workspace-switcher-panel"
          @open-auto-focus="focusCurrentWorkspace"
        >
          <div
            ref="workspaceFlyout"
            class="flex max-h-(--reka-popover-content-available-height) flex-col gap-1.5 pt-3 pb-2 outline-none"
            tabindex="-1"
          >
            <div v-if="searchable" class="px-1">
              <SearchInput
                v-model="query"
                :placeholder="t('devPlatform.workspaceMenu.search')"
                :accessible-label="t('devPlatform.workspaceMenu.search')"
                :clear-label="t('devPlatform.workspaceMenu.clearSearch')"
              />
            </div>
            <div v-if="loadingWorkspaces" class="flex flex-col gap-2 px-1">
              <div
                v-for="index in 2"
                :key="index"
                class="flex h-10 items-center gap-2 px-2 py-1"
                data-testid="workspace-skeleton"
              >
                <Skeleton class="size-8 rounded-md" />
                <Skeleton class="h-4 w-24 rounded-sm" />
              </div>
            </div>
            <div
              v-else
              class="flex min-h-0 flex-col gap-2 overflow-y-auto px-1"
              role="listbox"
              :aria-label="t('devPlatform.workspace.switchLabel')"
            >
              <Button
                v-for="workspace in filteredWorkspaces"
                :key="workspace.id"
                type="button"
                variant="textonly"
                size="unset"
                role="option"
                class="h-10 w-full shrink-0 justify-start gap-2 rounded-md px-2 py-1 text-left"
                :aria-selected="isCurrent(workspace)"
                :data-testid="`workspace-option-${workspace.id}`"
                @click="selectWorkspace(workspace)"
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
                <Check v-if="isCurrent(workspace)" :size="16" aria-hidden="true" />
              </Button>
            </div>
            <small
              v-if="store.workspacesError"
              class="block px-3 py-1 text-xs text-destructive"
              data-testid="workspace-load-error"
              >{{ t('devPlatform.workspaceMenu.loadFailed') }}</small
            >
            <small
              v-else-if="emptyMessage"
              class="block px-3 py-1 text-xs text-muted-foreground"
              data-testid="workspace-switcher-empty"
              >{{ emptyMessage }}</small
            >
          </div>
        </PopoverContent>
      </PopoverRoot>
    </PopoverContent>
  </PopoverRoot>
</template>
