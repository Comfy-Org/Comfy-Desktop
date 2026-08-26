<script setup lang="ts">
/** Local dashboard scope selector for unmanaged installs and authenticated workspaces. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown } from 'lucide-vue-next'
import DevPlatformAvatar from './DevPlatformAvatar.vue'
import { useAuthStore } from '../../stores/authStore'

const props = defineProps<{
  modelValue: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [workspaceId: string | null]
}>()

const { t } = useI18n()
const store = useAuthStore()

const menuOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const faceRef = ref<HTMLElement | null>(null)
const currentWorkspaceId = computed(() => props.modelValue)

function workspaceLabel(workspace: { name: string; type: string }): string {
  return workspace.type === 'team' ? workspace.name : t('devPlatform.workspace.personalLabel')
}

const currentWorkspaceName = computed(() => {
  if (currentWorkspaceId.value === null) return t('devPlatform.workspace.unmanagedLabel')
  const current = store.workspaces.find((workspace) => workspace.id === currentWorkspaceId.value)
  if (current) return workspaceLabel(current)
  if (store.status.workspaceType !== 'team') return t('devPlatform.workspace.personalLabel')
  if (store.loadingWorkspaces) return t('common.loading')
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

function closeMenu(): void {
  menuOpen.value = false
}

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) fetchWorkspacesIfNeeded()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && menuOpen.value) {
    event.stopPropagation()
    closeMenu()
    faceRef.value?.focus()
  }
}

function onPointerDown(event: MouseEvent): void {
  if (!menuOpen.value) return
  const target = event.target as Node | null
  if (target && rootRef.value?.contains(target)) return
  closeMenu()
}

onMounted(() => {
  document.addEventListener('mousedown', onPointerDown)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onPointerDown)
})

function onSelectWorkspace(workspaceId: string): void {
  if (workspaceId === currentWorkspaceId.value) {
    closeMenu()
    return
  }
  emit('update:modelValue', workspaceId)
  closeMenu()
}

function onSelectUnmanaged(): void {
  emit('update:modelValue', null)
  closeMenu()
}
</script>

<template>
  <div ref="rootRef" class="workspace-selector" @keydown="onKeydown">
    <button
      ref="faceRef"
      type="button"
      class="workspace-selector__face"
      data-testid="devplatform-workspace-selector"
      aria-haspopup="true"
      :aria-expanded="menuOpen"
      :aria-label="$t('devPlatform.workspace.switchLabel')"
      @click="toggleMenu"
    >
      <DevPlatformAvatar :name="currentWorkspaceName" :neutral="currentWorkspaceId === null" />
      <span class="workspace-selector__name">{{ currentWorkspaceName }}</span>
      <ChevronDown
        :size="14"
        class="workspace-selector__caret"
        :class="{ 'workspace-selector__caret--open': menuOpen }"
        aria-hidden="true"
      />
    </button>

    <div
      v-if="menuOpen"
      class="workspace-selector__menu"
      role="group"
      :aria-label="$t('devPlatform.workspace.switchLabel')"
      data-testid="devplatform-workspace-menu"
    >
      <div
        v-if="store.loadingWorkspaces && store.workspaces.length === 0"
        class="workspace-selector__hint"
      >
        {{ $t('common.loading') }}
      </div>
      <button
        v-else-if="store.workspacesError && store.workspaces.length === 0"
        type="button"
        class="workspace-selector__item workspace-selector__retry"
        data-testid="devplatform-workspace-retry"
        @click="store.fetchWorkspaces()"
      >
        {{ $t('devPlatform.workspace.loadError') }}
      </button>

      <button
        type="button"
        class="workspace-selector__item"
        :aria-pressed="currentWorkspaceId === null"
        data-testid="devplatform-workspace-unmanaged"
        @click="onSelectUnmanaged"
      >
        <DevPlatformAvatar :name="$t('devPlatform.workspace.unmanagedLabel')" neutral />
        <span class="workspace-selector__identity">
          <span class="workspace-selector__item-name">{{
            $t('devPlatform.workspace.unmanagedLabel')
          }}</span>
        </span>
        <Check
          v-if="currentWorkspaceId === null"
          :size="15"
          class="workspace-selector__check"
          aria-hidden="true"
        />
      </button>

      <button
        v-for="workspace in store.workspaces"
        :key="workspace.id"
        type="button"
        class="workspace-selector__item"
        :aria-pressed="workspace.id === currentWorkspaceId"
        :data-testid="`devplatform-workspace-${workspace.id}`"
        @click="onSelectWorkspace(workspace.id)"
      >
        <DevPlatformAvatar :name="workspaceLabel(workspace)" />
        <span class="workspace-selector__identity">
          <span class="workspace-selector__item-name">{{ workspaceLabel(workspace) }}</span>
          <span v-if="workspace.type !== 'personal'" class="workspace-selector__item-sub">{{
            workspace.type
          }}</span>
        </span>
        <Check
          v-if="workspace.id === currentWorkspaceId"
          :size="15"
          class="workspace-selector__check"
          aria-hidden="true"
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
.workspace-selector {
  position: relative;
  width: fit-content;
}

.workspace-selector__face {
  --dp-avatar-size: calc(var(--takeover-fs-caption) * 2.5);
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 220px;
  max-width: 320px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid color-mix(in oklab, var(--neutral-100) 10%, transparent);
  background: color-mix(in oklab, var(--neutral-100) 5%, transparent);
  color: var(--neutral-100);
  font: inherit;
  cursor: pointer;
}
.workspace-selector__face:hover {
  background: color-mix(in oklab, var(--neutral-100) 10%, transparent);
  border-color: color-mix(in oklab, var(--neutral-100) 18%, transparent);
}
.workspace-selector__face:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.workspace-selector__name,
.workspace-selector__item-name,
.workspace-selector__item-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-selector__name {
  flex: 1 1 auto;
  color: var(--neutral-100);
  font-size: var(--takeover-fs-caption);
  font-weight: 600;
  text-align: left;
}
.workspace-selector__caret {
  flex: 0 0 auto;
  color: var(--neutral-200);
  transition: transform 140ms ease;
}
.workspace-selector__caret--open {
  transform: rotate(180deg);
}

.workspace-selector__menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  min-width: 260px;
  max-width: 340px;
  max-height: min(70vh, 480px);
  overflow-y: auto;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--brand-surface-border);
  background: var(--neutral-800);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
}

.workspace-selector__hint {
  padding: 8px 10px;
  color: var(--neutral-200);
  font-size: var(--takeover-fs-caption);
}

.workspace-selector__item {
  --dp-avatar-size: calc(var(--takeover-fs-caption) * 2.5);
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--neutral-100);
  font: inherit;
  font-size: var(--takeover-fs-caption);
  text-align: left;
  cursor: pointer;
}
.workspace-selector__item:hover:not(:disabled) {
  background: var(--brand-surface-bg-hover);
}
.workspace-selector__item:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}
.workspace-selector__retry {
  color: var(--neutral-200);
}

.workspace-selector__identity {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-direction: column;
  line-height: 1.2;
}
.workspace-selector__item-name {
  color: var(--neutral-100);
  font-weight: 600;
}
.workspace-selector__item-sub {
  color: var(--neutral-200);
  text-transform: capitalize;
}
.workspace-selector__check {
  flex: 0 0 auto;
  color: var(--comfy-yellow);
}
</style>
