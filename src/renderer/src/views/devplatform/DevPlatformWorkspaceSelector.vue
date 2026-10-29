<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import DevPlatformAvatar from './DevPlatformAvatar.vue'
import { usePopoverDismiss } from '../../composables/usePopoverDismiss'
import { useAuthStore } from '../../stores/authStore'
import { isPersonalWorkspace, PERSONAL_WORKSPACE_ID } from '../../../../shared/workspaces'

const props = defineProps<{
  modelValue: string
}>()

const itemClass =
  'workspace-selector__item flex min-h-8 w-full items-center justify-start gap-2.5 rounded-lg border-0 bg-transparent px-2.5 py-1.5 text-left font-normal text-neutral-100 text-[length:var(--text-ui)] leading-[inherit] [--dp-avatar-size:calc(var(--takeover-fs-caption)*2.5)] appearance-auto hover:enabled:bg-secondary focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus-ring)] focus-visible:[outline-style:solid]'

const emit = defineEmits<{
  'update:modelValue': [workspaceId: string]
}>()

const { t } = useI18n()
const store = useAuthStore()

const rootRef = ref<HTMLElement | null>(null)
const faceRef = ref<HTMLElement | null>(null)
const currentWorkspaceId = computed(() => props.modelValue)

const {
  menuOpen,
  closeMenu,
  toggleMenu: togglePopover,
  onKeydown
} = usePopoverDismiss({ rootRef, faceRef })

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

function toggleMenu(): void {
  togglePopover()
  if (menuOpen.value) fetchWorkspacesIfNeeded()
}

function onSelectWorkspace(workspaceId: string): void {
  if (workspaceId === currentWorkspaceId.value) {
    closeMenu()
    return
  }
  emit('update:modelValue', workspaceId)
  closeMenu()
}
</script>

<template>
  <div ref="rootRef" class="workspace-selector relative w-fit" @keydown="onKeydown">
    <button
      ref="faceRef"
      type="button"
      class="workspace-selector__face cursor-pointer inline-flex h-7 min-w-0 max-w-80 items-center gap-2 rounded-lg border border-solid border-transparent bg-transparent px-2 py-0 text-neutral-100 text-[length:var(--text-ui)] [--dp-avatar-size:20px] hover:border-transparent hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] focus-visible:[outline-style:solid]"
      data-testid="devplatform-workspace-selector"
      aria-haspopup="true"
      :aria-expanded="menuOpen"
      :aria-label="$t('devPlatform.workspace.switchLabel')"
      @click="toggleMenu"
    >
      <DevPlatformAvatar :name="currentWorkspaceName" />
      <span
        class="workspace-selector__name flex-auto truncate text-left font-semibold text-neutral-100 text-[length:var(--text-ui)]"
        >{{ currentWorkspaceName }}</span
      >
      <ChevronDown
        :size="14"
        class="workspace-selector__caret flex-none text-neutral-200 transition-transform duration-[140ms] ease-[ease]"
        :class="{ 'workspace-selector__caret--open rotate-180': menuOpen }"
        aria-hidden="true"
      />
    </button>

    <div
      v-if="menuOpen"
      class="workspace-selector__menu absolute top-[calc(100%+6px)] left-0 z-20 max-h-[min(70vh,480px)] min-w-[260px] max-w-[340px] overflow-y-auto rounded-card border border-solid border-border bg-popover p-1 shadow-popover"
      role="group"
      :aria-label="$t('devPlatform.workspace.switchLabel')"
      data-testid="devplatform-workspace-menu"
    >
      <div
        v-if="store.loadingWorkspaces && store.workspaces.length === 0"
        class="workspace-selector__hint px-2.5 py-2 text-neutral-200 text-[length:var(--takeover-fs-caption)]"
      >
        {{ $t('common.loading') }}
      </div>
      <Button
        v-else-if="store.workspacesError && store.workspaces.length === 0"
        type="button"
        variant="textonly"
        size="unset"
        :class="[itemClass, 'workspace-selector__retry text-neutral-200']"
        data-testid="devplatform-workspace-retry"
        @click="store.fetchWorkspaces()"
      >
        {{ $t('devPlatform.workspace.loadError') }}
      </Button>

      <Button
        type="button"
        variant="textonly"
        size="unset"
        :class="itemClass"
        :aria-pressed="currentWorkspaceId === PERSONAL_WORKSPACE_ID"
        data-testid="devplatform-workspace-personal"
        @click="onSelectWorkspace(PERSONAL_WORKSPACE_ID)"
      >
        <DevPlatformAvatar :name="$t('devPlatform.workspace.personalLabel')" />
        <span class="workspace-selector__identity flex min-w-0 flex-auto flex-col leading-[1.2]">
          <span class="workspace-selector__item-name truncate font-semibold text-neutral-100">{{
            $t('devPlatform.workspace.personalLabel')
          }}</span>
        </span>
        <Check
          v-if="currentWorkspaceId === PERSONAL_WORKSPACE_ID"
          :size="15"
          class="workspace-selector__check flex-none text-comfy-yellow"
          aria-hidden="true"
        />
      </Button>

      <Button
        v-for="workspace in teamWorkspaces"
        :key="workspace.id"
        type="button"
        variant="textonly"
        size="unset"
        :class="itemClass"
        :aria-pressed="workspace.id === currentWorkspaceId"
        :data-testid="`devplatform-workspace-${workspace.id}`"
        @click="onSelectWorkspace(workspace.id)"
      >
        <DevPlatformAvatar :name="workspaceLabel(workspace)" />
        <span class="workspace-selector__identity flex min-w-0 flex-auto flex-col leading-[1.2]">
          <span class="workspace-selector__item-name truncate font-semibold text-neutral-100">{{
            workspaceLabel(workspace)
          }}</span>
          <span
            v-if="workspace.type !== 'personal'"
            class="workspace-selector__item-sub truncate text-neutral-200 capitalize"
            >{{ workspace.type }}</span
          >
        </span>
        <Check
          v-if="workspace.id === currentWorkspaceId"
          :size="15"
          class="workspace-selector__check flex-none text-comfy-yellow"
          aria-hidden="true"
        />
      </Button>
    </div>
  </div>
</template>
