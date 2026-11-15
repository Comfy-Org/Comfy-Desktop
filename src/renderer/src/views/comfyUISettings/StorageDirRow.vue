<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { Folder, FolderOpen, RotateCcw } from 'lucide-vue-next'
import StorageItemIcon from '../../components/StorageItemIcon.vue'
import StorageTag from '../../components/StorageTag.vue'

type StorageDirRowVariant = 'panel' | 'grouped' | 'field'

interface Props {
  path: string
  tag?: string
  resettable?: boolean
  browsable?: boolean
  manageable?: boolean
  shared?: boolean
  hideSharedTag?: boolean
  variant?: StorageDirRowVariant
}

withDefaults(defineProps<Props>(), {
  tag: '',
  resettable: false,
  browsable: true,
  manageable: false,
  shared: false,
  hideSharedTag: false,
  variant: 'panel'
})

const emit = defineEmits<{
  open: []
  browse: []
  reset: []
  manage: []
}>()

const { t } = useI18n()
const variantClass: Record<StorageDirRowVariant, string> = {
  panel: 'min-h-14 rounded-[14px] bg-white/5 py-1.5 pr-3 pl-[18px]',
  grouped:
    'min-h-12 rounded-[10px] py-1.5 pr-3 pl-3 transition-[background-color] duration-100 ease-[ease] hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]',
  field:
    'rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--brand-surface-bg)] px-2.5 py-2'
}
const actionClass =
  'storage-dir-action static inline-flex size-7 items-center justify-center gap-0 rounded-md border border-solid border-transparent bg-transparent p-0 font-normal leading-[1.5] text-text-muted appearance-auto transition-[background-color,color] duration-100 ease-[ease] hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] hover:text-neutral-100 focus-visible:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] focus-visible:text-neutral-100 focus-visible:outline-none focus-visible:ring-0'
</script>

<template>
  <div
    class="storage-dir-field storage-dir-row flex min-w-0 items-center gap-2.5"
    :class="variantClass[variant]"
  >
    <StorageItemIcon :icon="Folder" :shared="shared" />
    <div class="storage-dir-main flex min-w-0 flex-auto items-center">
      <Button
        type="button"
        variant="textonly"
        size="unset"
        class="storage-dir-name static inline-block overflow-hidden text-ellipsis whitespace-nowrap min-w-0 max-w-full gap-0 rounded-none border-none bg-transparent p-0 text-left font-mono font-normal text-[12.5px] leading-[18px] text-neutral-100 appearance-auto hover:bg-transparent hover:underline focus-visible:bg-transparent focus-visible:underline focus-visible:outline-none focus-visible:ring-0"
        :title="t('models.openDir')"
        @click="emit('open')"
      >
        {{ path }}
      </Button>
    </div>
    <StorageTag v-if="shared && !hideSharedTag" class="storage-dir-shared-tag">
      {{ t('models.sharedTag') }}
    </StorageTag>
    <StorageTag v-if="tag" class="storage-dir-tag">{{ tag }}</StorageTag>
    <div class="storage-dir-actions inline-flex shrink-0 items-center gap-0.5">
      <Button
        v-if="browsable"
        type="button"
        variant="textonly"
        size="unset"
        :class="actionClass"
        :aria-label="t('common.browse')"
        :title="t('common.browse')"
        @click="emit('browse')"
      >
        <FolderOpen :size="14" aria-hidden="true" />
      </Button>
      <Button
        v-if="manageable"
        type="button"
        variant="textonly"
        size="unset"
        :class="[actionClass, 'w-auto px-2.5 text-[13px]']"
        :aria-label="t('comfyUISettings.manageSharedDirs')"
        :title="t('comfyUISettings.manageSharedDirs')"
        @click="emit('manage')"
      >
        {{ t('comfyUISettings.manageShort') }}
      </Button>
      <Button
        v-if="resettable"
        type="button"
        variant="textonly"
        size="unset"
        :class="actionClass"
        :aria-label="t('common.resetDefault')"
        :title="t('common.resetDefault')"
        @click="emit('reset')"
      >
        <RotateCcw :size="14" aria-hidden="true" />
      </Button>
    </div>
  </div>
</template>
