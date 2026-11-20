<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { PopoverAnchor, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { ArrowRightLeft, Check, CreditCard, Ellipsis, LogOut, Settings } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import PopoverContent from '@comfyorg/design-system/popover/PopoverContent'
import SearchInput from '@comfyorg/design-system/search-input/SearchInput'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import WorkspaceAvatar from '../components/WorkspaceAvatar.vue'
import { useAuthStore } from '../stores/authStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useSelectedWorkspace } from '../composables/useSelectedWorkspace'
import {
  isPersonalWorkspace,
  PERSONAL_WORKSPACE_ID,
  workspaceScopeId
} from '../../../shared/workspaces'
import type { PlatformSettingsPage, Workspace } from '../../../types/ipc'

const { collapsed } = defineProps<{
  collapsed: boolean
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

function planLabel(tier: string | null | undefined): string {
  if (!tier) return ''
  return (Object.hasOwn(PLAN_LABELS, tier) && PLAN_LABELS[tier]) || tier
}

function roleLabel(role: string): string {
  return (Object.hasOwn(roleLabels.value, role) && roleLabels.value[role]) || role
}

const {
  workspace: currentWorkspace,
  statusIsCurrent,
  name: selectedWorkspaceName
} = useSelectedWorkspace()
const personalLabel = computed(() => t('devPlatform.workspace.personalLabel'))
const currentWorkspaceName = computed(
  () => selectedWorkspaceName.value ?? t('devPlatform.workspace.switchLabel')
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

const personalWorkspace = computed<Workspace>(() => ({
  id: PERSONAL_WORKSPACE_ID,
  type: 'personal',
  role: 'owner',
  ...store.workspaces.find(isPersonalWorkspace),
  name: personalLabel.value
}))
const listedWorkspaces = computed(() => [
  personalWorkspace.value,
  ...store.workspaces.filter((workspace) => !isPersonalWorkspace(workspace))
])

const loadingWorkspaces = computed(() => store.loadingWorkspaces && store.workspaces.length === 0)
const searchable = computed(() => listedWorkspaces.value.length > SEARCH_THRESHOLD)
const filteredWorkspaces = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return listedWorkspaces.value
  return listedWorkspaces.value.filter((workspace) => workspace.name.toLowerCase().includes(needle))
})
const emptyMessage = computed(() =>
  loadingWorkspaces.value || filteredWorkspaces.value.length
    ? null
    : t('devPlatform.workspaceMenu.noMatch')
)

function isCurrent(workspace: Workspace): boolean {
  return workspaceScopeId(workspace) === dashboardScope.selectedWorkspaceId
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
  if (open) {
    if (!store.loadingWorkspaces && (store.workspacesError || !store.workspacesLoaded)) {
      void store.fetchWorkspaces()
    }
    return
  }
  workspacesOpen.value = false
})

watch(workspacesOpen, (open) => {
  if (!open) query.value = ''
})

const OPTION_STEPS: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowDown: (index, last) => Math.min(index + 1, last),
  ArrowUp: (index) => Math.max(index - 1, 0),
  Home: () => 0,
  End: (_index, last) => last
}

function moveBetweenOptions(event: KeyboardEvent): void {
  const step = Object.hasOwn(OPTION_STEPS, event.key) ? OPTION_STEPS[event.key] : undefined
  if (!step) return
  const listbox = event.currentTarget as HTMLElement
  const options = [...listbox.querySelectorAll<HTMLElement>('[role="option"]')]
  if (!options.length) return
  event.preventDefault()
  const index = options.indexOf(document.activeElement as HTMLElement)
  options[step(index, options.length - 1)]?.focus()
}

function focusCurrentWorkspace(event: Event): void {
  event.preventDefault()
  void nextTick(() => {
    const flyout = workspaceFlyout.value
    ;(flyout?.querySelector<HTMLElement>('[aria-selected="true"]') ?? flyout)?.focus()
  })
}

function selectWorkspace(workspace: Workspace): void {
  if (!isCurrent(workspace)) dashboardScope.selectWorkspace(workspaceScopeId(workspace))
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
        class="h-12 w-full justify-start gap-3 rounded-lg px-2 text-ui font-medium hover:bg-secondary data-[state=open]:bg-secondary"
        data-testid="workspace-switcher-trigger"
        :aria-label="currentWorkspaceName"
        :title="collapsed ? currentWorkspaceName : undefined"
      >
        <WorkspaceAvatar
          size="sm"
          :workspace-name="currentWorkspaceName"
          :subscription-tier="currentWorkspaceTier"
        />
        <Transition
          enter-active-class="transition-opacity duration-180 delay-30 ease-out"
          enter-from-class="opacity-0"
          leave-active-class="transition-opacity duration-150 ease-out"
          leave-to-class="opacity-0"
        >
          <span v-if="!collapsed" class="flex min-w-0 flex-1 items-center gap-3 text-nowrap">
            <span class="min-w-0 flex-1 truncate text-left" data-testid="workspace-switcher-name">{{
              currentWorkspaceName
            }}</span>
            <Ellipsis class="shrink-0 text-muted-foreground" :size="16" aria-hidden="true" />
          </span>
        </Transition>
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
            <div
              class="flex min-h-0 flex-col gap-2 overflow-y-auto px-1"
              role="listbox"
              :aria-label="t('devPlatform.workspace.switchLabel')"
              @keydown="moveBetweenOptions"
            >
              <Button
                v-for="workspace in filteredWorkspaces"
                :key="workspaceScopeId(workspace)"
                type="button"
                variant="textonly"
                size="unset"
                role="option"
                class="h-10 w-full shrink-0 justify-start gap-2 rounded-md px-2 py-1 text-left"
                :aria-selected="isCurrent(workspace)"
                :data-testid="`workspace-option-${workspaceScopeId(workspace)}`"
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
