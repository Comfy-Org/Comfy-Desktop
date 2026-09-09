<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCw } from 'lucide-vue-next'
import { emitTelemetryAction } from '../../lib/telemetry'
import { useAuthStore } from '../../stores/authStore'
import DevPlatformWorkspaceSelector from './DevPlatformWorkspaceSelector.vue'

defineProps<{
  modelValue: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [workspaceId: string | null]
}>()

const { t } = useI18n()
const authStore = useAuthStore()
const refreshing = computed(() => authStore.loadingWorkspaces || authStore.loadingBuilds)

async function refreshWorkspace(): Promise<void> {
  emitTelemetryAction('comfy.desktop.workspace.refresh', {})
  await Promise.all([authStore.fetchWorkspaces(), authStore.fetchBuilds()])
}
</script>

<template>
  <div class="workspace-selector-bar">
    <div class="workspace-selector-bar__controls">
      <DevPlatformWorkspaceSelector
        :model-value="modelValue"
        @update:model-value="emit('update:modelValue', $event)"
      />
      <button
        type="button"
        class="workspace-selector-bar__refresh"
        :disabled="refreshing"
        :aria-label="t('devPlatform.workspace.refresh')"
        :title="t('devPlatform.workspace.refresh')"
        data-testid="workspace-selector-refresh"
        @click="refreshWorkspace"
      >
        <RefreshCw
          :size="13"
          :class="{ 'workspace-selector-bar__refresh-icon--busy': refreshing }"
        />
      </button>
    </div>
    <div class="workspace-selector-bar__divider" aria-hidden="true" />
    <div v-if="$slots.default" class="workspace-selector-bar__trailing">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.workspace-selector-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 1168px;
}

.workspace-selector-bar__divider {
  flex: 1 1 auto;
  min-width: 16px;
  height: 1px;
  background: var(--chooser-surface-border);
}

.workspace-selector-bar__controls {
  display: flex;
  flex: 0 1 290px;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.workspace-selector-bar__trailing {
  display: flex;
  flex: 0 0 auto;
  align-items: baseline;
  gap: 4px;
  margin-left: auto;
  color: var(--text-muted);
  font-size: 12px;
}

.workspace-selector-bar__trailing :deep(strong) {
  color: var(--neutral-100);
  font-weight: 600;
}

.workspace-selector-bar__controls :deep(.workspace-selector) {
  flex: 1 1 auto;
  min-width: 0;
}

.workspace-selector-bar__controls :deep(.workspace-selector__face) {
  --dp-avatar-size: 20px;
  box-sizing: border-box;
  width: 100%;
  min-width: 180px;
  padding: 4px 8px;
}

.workspace-selector-bar__refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.workspace-selector-bar__refresh:hover:not(:disabled) {
  border-color: var(--chooser-surface-border-hover);
  background: var(--chooser-surface-bg-hover);
  color: var(--neutral-100);
}

.workspace-selector-bar__refresh:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.workspace-selector-bar__refresh:disabled {
  cursor: default;
  opacity: 0.6;
}

.workspace-selector-bar__refresh-icon--busy {
  animation: workspace-selector-refresh-spin 900ms linear infinite;
}

@keyframes workspace-selector-refresh-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .workspace-selector-bar {
    flex-wrap: wrap;
  }

  .workspace-selector-bar__divider {
    display: none;
  }

  .workspace-selector-bar__controls {
    flex-basis: 100%;
  }

  .workspace-selector-bar__trailing {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
