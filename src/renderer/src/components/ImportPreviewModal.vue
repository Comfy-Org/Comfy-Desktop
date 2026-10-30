<script setup lang="ts">
// TODO(stale-old-modal): delete after Settings drawer (v2,
// ComfyUISettingsPanel) reaches functional parity and ships everywhere.
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import ModalShell from './ModalShell.vue'
import type { SnapshotFilePreview } from '../types/ipc'
import SnapshotFilePreviewContent from './SnapshotFilePreviewContent.vue'

interface Props {
  preview: SnapshotFilePreview | null
  loading: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()

const { t } = useI18n()
</script>

<template>
  <ModalShell width="regular" :title="t('snapshots.importPreviewTitle')" @close="emit('cancel')">
    <div
      v-if="loading"
      class="ip-loading justify-center py-8 text-[14px] text-text-muted flex items-center gap-2.5 before:inline-block before:size-4 before:shrink-0 before:animate-spin before:rounded-[50%] before:border-2 before:border-solid before:border-[var(--border)] before:border-t-[var(--accent)] before:[animation-duration:0.6s] before:content-['']"
    >
      {{ t('common.loading') }}
    </div>
    <template v-else-if="preview">
      <SnapshotFilePreviewContent :preview="preview" />
    </template>

    <template #footer>
      <div class="flex shrink-0 justify-end gap-2.5">
        <Button
          variant="secondary"
          size="unset"
          class="static inline-block rounded-lg border border-solid px-4 py-2 text-[14px] leading-[1.5] appearance-auto whitespace-normal transition-none disabled:pointer-events-auto disabled:cursor-default disabled:opacity-40 focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color] border-[var(--border)] bg-[var(--surface)] font-normal text-text hover:bg-[var(--border)]"
          @click="emit('cancel')"
          >{{ t('common.cancel') }}</Button
        >
        <Button
          v-if="preview"
          variant="inverted"
          size="unset"
          class="static inline-block rounded-lg border border-solid px-4 py-2 text-[14px] leading-[1.5] appearance-auto whitespace-normal transition-none disabled:pointer-events-auto disabled:cursor-default disabled:opacity-40 focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color] border-[var(--accent-primary)] bg-[var(--accent-primary)] font-medium text-[var(--color-background)] hover:border-[color-mix(in_srgb,var(--accent-primary)_85%,#000)] hover:bg-[color-mix(in_srgb,var(--accent-primary)_85%,#000)] enabled:hover:border-[var(--accent-hover)] enabled:hover:bg-[var(--accent-hover)] hover:[transition:background_120ms_ease,border-color_120ms_ease]"
          :disabled="loading"
          @click="emit('confirm')"
        >
          {{ t('snapshots.importConfirm') }}
        </Button>
      </div>
    </template>
  </ModalShell>
</template>
