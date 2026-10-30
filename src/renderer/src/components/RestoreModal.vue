<script setup lang="ts">
// TODO(stale-old-modal): delete after Settings drawer (v2,
// ComfyUISettingsPanel) reaches functional parity and ships everywhere.
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { useModalOverlay } from '../composables/useModalOverlay'
import SnapshotDiffView from './SnapshotDiffView.vue'
import type { SnapshotDiffData } from '../types/ipc'

interface Props {
  diffData: SnapshotDiffData | null
  loading: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()

const { t } = useI18n()

const { handleOverlayMouseDown, handleOverlayClick } = useModalOverlay(
  () => true,
  () => emit('cancel')
)
</script>

<template>
  <Teleport to="body">
    <div
      class="restore-modal-overlay fixed inset-0 z-[75] flex items-center justify-center [-webkit-backdrop-filter:blur(2px)]"
      @mousedown="handleOverlayMouseDown"
      @click="handleOverlayClick"
    >
      <div
        class="restore-modal-box flex max-h-[70vh] min-w-[400px] max-w-[560px] flex-col rounded-[var(--radius-panel)] border border-solid border-[var(--border)] bg-[var(--neutral-800)] px-6 py-4"
      >
        <div
          class="restore-modal-title -mx-6 mb-3 border-b border-solid border-[var(--border)] px-6 pb-3 text-[16px] font-semibold"
        >
          {{ t('snapshots.restorePreviewTitle') }}
        </div>

        <div
          v-if="loading"
          class="restore-modal-loading justify-center py-4 text-[13px] text-text-muted flex items-center gap-2.5 before:inline-block before:size-4 before:shrink-0 before:animate-spin before:rounded-[50%] before:border-2 before:border-solid before:border-[var(--border)] before:border-t-[var(--accent)] before:[animation-duration:0.6s] before:content-['']"
        >
          {{ t('common.loading') }}
        </div>

        <template v-else-if="diffData">
          <div
            v-if="diffData.empty"
            class="restore-modal-empty mb-4 py-2 text-[14px] text-text-muted"
          >
            {{ t('snapshots.restoreNoChanges') }}
          </div>
          <template v-else>
            <div class="restore-modal-summary mb-3 flex flex-wrap gap-1">
              <span
                v-if="diffData.diff.comfyuiChanged"
                class="restore-badge restore-badge-changed rounded-[3px] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] px-1.5 py-px text-[11px] font-semibold text-[var(--warning)]"
                >{{ t('snapshots.comfyuiUpdated') }}</span
              >
              <span
                v-if="diffData.diff.updateChannelChanged && diffData.diff.updateChannel"
                class="restore-badge restore-badge-changed rounded-[3px] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] px-1.5 py-px text-[11px] font-semibold text-[var(--warning)]"
                >{{ diffData.diff.updateChannel.from }} → {{ diffData.diff.updateChannel.to }}</span
              >
              <span
                v-if="diffData.diff.nodesAdded.length > 0"
                class="restore-badge restore-badge-added rounded-[3px] bg-[color-mix(in_srgb,var(--success)_12%,transparent)] px-1.5 py-px text-[11px] font-semibold text-[var(--success)]"
                >+{{ diffData.diff.nodesAdded.length }} {{ t('snapshots.nodesLabel') }}</span
              >
              <span
                v-if="diffData.diff.nodesRemoved.length > 0"
                class="restore-badge restore-badge-removed rounded-[3px] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-1.5 py-px text-[11px] font-semibold text-[var(--danger)]"
                >−{{ diffData.diff.nodesRemoved.length }} {{ t('snapshots.nodesLabel') }}</span
              >
              <span
                v-if="diffData.diff.nodesChanged.length > 0"
                class="restore-badge restore-badge-changed rounded-[3px] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] px-1.5 py-px text-[11px] font-semibold text-[var(--warning)]"
                >~{{ diffData.diff.nodesChanged.length }} {{ t('snapshots.nodesLabel') }}</span
              >
              <span
                v-if="diffData.diff.pipsAdded.length > 0"
                class="restore-badge restore-badge-added rounded-[3px] bg-[color-mix(in_srgb,var(--success)_12%,transparent)] px-1.5 py-px text-[11px] font-semibold text-[var(--success)]"
                >+{{ diffData.diff.pipsAdded.length }} {{ t('snapshots.pkgsLabel') }}</span
              >
              <span
                v-if="diffData.diff.pipsRemoved.length > 0"
                class="restore-badge restore-badge-removed rounded-[3px] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-1.5 py-px text-[11px] font-semibold text-[var(--danger)]"
                >−{{ diffData.diff.pipsRemoved.length }} {{ t('snapshots.pkgsLabel') }}</span
              >
              <span
                v-if="diffData.diff.pipsChanged.length > 0"
                class="restore-badge restore-badge-changed rounded-[3px] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] px-1.5 py-px text-[11px] font-semibold text-[var(--warning)]"
                >~{{ diffData.diff.pipsChanged.length }} {{ t('snapshots.pkgsLabel') }}</span
              >
            </div>

            <div
              class="restore-modal-diff mb-4 min-h-0 overflow-y-auto rounded-md bg-[var(--bg)] px-3 py-2.5"
            >
              <SnapshotDiffView :diff="diffData.diff" />
            </div>
          </template>
        </template>

        <div
          class="restore-modal-actions -mx-6 flex justify-end gap-2 border-t border-solid border-[var(--border)] px-6 pt-3"
        >
          <Button
            variant="secondary"
            size="unset"
            class="static inline-block rounded-lg border border-solid px-4 py-2 text-[14px] leading-[1.5] appearance-auto whitespace-normal transition-none disabled:pointer-events-auto disabled:cursor-default disabled:opacity-40 focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color] border-[var(--border)] bg-[var(--surface)] font-normal text-text hover:bg-[var(--border)]"
            @click="emit('cancel')"
            >{{ t('snapshots.restoreCancel') }}</Button
          >
          <Button
            v-if="diffData && !diffData.empty"
            variant="inverted"
            size="unset"
            class="static inline-block rounded-lg border border-solid px-4 py-2 text-[14px] leading-[1.5] appearance-auto whitespace-normal transition-none disabled:pointer-events-auto disabled:cursor-default disabled:opacity-40 focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color] border-[var(--accent-primary)] bg-[var(--accent-primary)] font-medium text-[var(--color-background)] hover:border-[color-mix(in_srgb,var(--accent-primary)_85%,#000)] hover:bg-[color-mix(in_srgb,var(--accent-primary)_85%,#000)] enabled:hover:border-[var(--accent-hover)] enabled:hover:bg-[var(--accent-hover)] hover:[transition:background_120ms_ease,border-color_120ms_ease]"
            @click="emit('confirm')"
          >
            {{ t('snapshots.restoreConfirm') }}
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
