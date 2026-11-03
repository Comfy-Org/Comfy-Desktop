<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { DropdownMenuRadioGroup } from 'reka-ui'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuRadioItem from '@comfyorg/design-system/menu/MenuRadioItem'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import DevPlatformAvatar from './DevPlatformAvatar.vue'
import { useAuthStore } from '../../stores/authStore'
import { isPersonalWorkspace, PERSONAL_WORKSPACE_ID } from '../../../../shared/workspaces'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [workspaceId: string]
}>()

const { t } = useI18n()
const store = useAuthStore()

const currentWorkspaceId = computed(() => props.modelValue)

const menuOpen = ref(false)
useEventListener(window, 'blur', () => {
  menuOpen.value = false
})

function workspaceLabel(workspace: { name: string; type: string }): string {
  return isPersonalWorkspace(workspace) || workspace.type !== 'team'
    ? t('devPlatform.workspace.personalLabel')
    : workspace.name
}

const teamWorkspaces = computed(() =>
  store.isSignedIn ? store.workspaces.filter((workspace) => !isPersonalWorkspace(workspace)) : []
)

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

watch(menuOpen, (open) => {
  if (open) fetchWorkspacesIfNeeded()
})

function onSelectWorkspace(workspaceId: string): void {
  if (workspaceId === currentWorkspaceId.value) {
    menuOpen.value = false
    return
  }
  emit('update:modelValue', workspaceId)
  menuOpen.value = false
}
</script>

<template>
  <div class="workspace-selector relative w-fit">
    <Menu
      v-model:open="menuOpen"
      :modal="false"
      class="workspace-selector__menu z-20 min-w-[260px] max-w-[340px]"
      :aria-label="$t('devPlatform.workspace.switchLabel')"
      data-testid="devplatform-workspace-menu"
    >
      <template #trigger>
        <Button
          type="button"
          variant="textonly"
          size="md"
          class="workspace-selector__face min-w-0 max-w-80 [--dp-avatar-size:20px]"
          data-testid="devplatform-workspace-selector"
          :aria-label="$t('devPlatform.workspace.switchLabel')"
        >
          <DevPlatformAvatar :name="currentWorkspaceName" />
          <span class="workspace-selector__name min-w-0 flex-auto truncate text-left">{{
            currentWorkspaceName
          }}</span>
          <ChevronDown
            :size="14"
            class="workspace-selector__caret shrink-0 transition-transform"
            :class="{ 'workspace-selector__caret--open rotate-180': menuOpen }"
            aria-hidden="true"
          />
        </Button>
      </template>
      <div
        v-if="store.loadingWorkspaces && store.workspaces.length === 0"
        class="workspace-selector__hint px-3 py-2 text-xs text-muted-foreground"
        role="status"
      >
        {{ $t('common.loading') }}
      </div>
      <MenuItem
        v-else-if="store.workspacesError && store.workspaces.length === 0"
        as="button"
        type="button"
        class="workspace-selector__retry w-full"
        data-testid="devplatform-workspace-retry"
        @select.prevent="store.fetchWorkspaces()"
        >{{ $t('devPlatform.workspace.loadError') }}</MenuItem
      >
      <DropdownMenuRadioGroup :model-value="currentWorkspaceId">
        <MenuRadioItem
          as="button"
          type="button"
          :value="PERSONAL_WORKSPACE_ID"
          class="workspace-selector__item w-full [--dp-avatar-size:24px]"
          data-testid="devplatform-workspace-personal"
          @select="onSelectWorkspace(PERSONAL_WORKSPACE_ID)"
        >
          <DevPlatformAvatar :name="$t('devPlatform.workspace.personalLabel')" />
          <span class="workspace-selector__identity min-w-0 flex-auto text-left"
            ><span class="workspace-selector__item-name block truncate">{{
              $t('devPlatform.workspace.personalLabel')
            }}</span></span
          >
          <Check
            v-if="currentWorkspaceId === PERSONAL_WORKSPACE_ID"
            :size="15"
            aria-hidden="true"
          />
        </MenuRadioItem>
        <MenuRadioItem
          v-for="workspace in teamWorkspaces"
          :key="workspace.id"
          as="button"
          type="button"
          :value="workspace.id"
          class="workspace-selector__item w-full [--dp-avatar-size:24px]"
          :data-testid="`devplatform-workspace-${workspace.id}`"
          @select="onSelectWorkspace(workspace.id)"
        >
          <DevPlatformAvatar :name="workspaceLabel(workspace)" />
          <span
            class="workspace-selector__identity flex min-w-0 flex-auto flex-col text-left leading-tight"
          >
            <span class="workspace-selector__item-name truncate">{{
              workspaceLabel(workspace)
            }}</span>
            <span
              v-if="workspace.type !== 'personal'"
              class="workspace-selector__item-sub truncate text-xs text-muted-foreground capitalize"
              >{{ workspace.type }}</span
            >
          </span>
          <Check v-if="workspace.id === currentWorkspaceId" :size="15" aria-hidden="true" />
        </MenuRadioItem>
      </DropdownMenuRadioGroup>
    </Menu>
  </div>
</template>
