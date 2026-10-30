<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { ExternalLink, Folder, FolderOpen, RotateCcw } from 'lucide-vue-next'
import StorageItemIcon from '../../components/StorageItemIcon.vue'

/** Readonly directory row: an icon, a clickable path that opens the folder, an
 *  optional tag, and Browse / Reset actions. Shared by the per-instance and
 *  shared input/output sections so both states look identical. */

interface Props {
  /** Field label shown above the row. Omit when a section header already names it. */
  label?: string
  path: string
  /** Small pill shown after the path (e.g. "default"). */
  tag?: string
  /** Show a reset-to-default action. */
  resettable?: boolean
  /** Show the Browse action. Off for rows edited elsewhere (shared dirs). */
  browsable?: boolean
  /** Show a "manage in Desktop Settings" action instead of local editing. */
  manageable?: boolean
  /** Globally-shared dir → shows the shared badge on its icon. */
  shared?: boolean
}

withDefaults(defineProps<Props>(), {
  label: '',
  tag: '',
  resettable: false,
  browsable: true,
  manageable: false,
  shared: false
})

const emit = defineEmits<{
  open: []
  browse: []
  reset: []
  manage: []
}>()

const { t } = useI18n()
const actionClass =
  'storage-dir-action static inline-flex size-7 items-center justify-center gap-0 rounded-md border border-solid border-transparent bg-transparent p-0 font-normal leading-[1.5] text-text-muted appearance-auto transition-[background-color,color] duration-100 ease-[ease] hover:bg-[var(--brand-surface-bg-hover)] hover:text-neutral-100 focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:text-neutral-100 focus-visible:outline-none focus-visible:ring-0'
</script>

<template>
  <div class="storage-dir-field flex flex-col gap-1.5">
    <label v-if="label" class="storage-dir-label text-[12px] text-text-muted">{{ label }}</label>
    <div
      class="storage-dir-row flex min-w-0 items-center gap-2 rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--brand-surface-bg)] px-2.5 py-2"
    >
      <StorageItemIcon :icon="Folder" :shared="shared" />
      <div class="storage-dir-main flex min-w-0 flex-auto items-center">
        <Button
          type="button"
          variant="textonly"
          size="unset"
          class="storage-dir-name static inline-block overflow-hidden text-ellipsis whitespace-nowrap min-w-0 max-w-full gap-0 rounded-lg border-none bg-transparent p-0 text-left font-normal text-[13px] leading-[18px] text-neutral-100 appearance-auto hover:bg-transparent hover:text-[var(--accent)] hover:underline focus-visible:bg-transparent focus-visible:text-[var(--accent)] focus-visible:underline focus-visible:outline-none focus-visible:ring-0"
          :title="t('models.openDir', 'Open folder')"
          @click="emit('open')"
        >
          {{ path }}
        </Button>
      </div>
      <span
        v-if="tag"
        class="storage-dir-tag shrink-0 rounded-[999px] border border-solid border-[var(--chooser-surface-border)] px-1.5 py-px text-[10px] leading-[14px] font-medium tracking-[0.02em] text-text-muted uppercase"
        >{{ tag }}</span
      >
      <div class="storage-dir-actions inline-flex shrink-0 items-center gap-0.5">
        <Button
          v-if="browsable"
          type="button"
          variant="textonly"
          size="unset"
          :class="actionClass"
          :aria-label="t('common.browse', 'Browse')"
          :title="t('common.browse', 'Browse')"
          @click="emit('browse')"
        >
          <FolderOpen :size="14" aria-hidden="true" />
        </Button>
        <Button
          v-if="manageable"
          type="button"
          variant="textonly"
          size="unset"
          :class="actionClass"
          :aria-label="
            t('comfyUISettings.manageSharedDirs', 'Manage Shared Directories in Desktop Settings')
          "
          :title="
            t('comfyUISettings.manageSharedDirs', 'Manage Shared Directories in Desktop Settings')
          "
          @click="emit('manage')"
        >
          <ExternalLink :size="14" aria-hidden="true" />
        </Button>
        <Button
          v-if="resettable"
          type="button"
          variant="textonly"
          size="unset"
          :class="actionClass"
          :aria-label="t('common.resetDefault', 'Reset to default')"
          :title="t('common.resetDefault', 'Reset to default')"
          @click="emit('reset')"
        >
          <RotateCcw :size="14" aria-hidden="true" />
        </Button>
      </div>
    </div>
  </div>
</template>
