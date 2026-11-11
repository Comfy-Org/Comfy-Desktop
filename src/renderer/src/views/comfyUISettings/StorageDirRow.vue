<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { Folder, FolderOpen, RotateCcw } from 'lucide-vue-next'
import StorageItemIcon from '../../components/StorageItemIcon.vue'

interface Props {
  label?: string
  path: string
  tag?: string
  resettable?: boolean
  browsable?: boolean
  manageable?: boolean
  shared?: boolean
  hideSharedTag?: boolean
}

withDefaults(defineProps<Props>(), {
  label: '',
  tag: '',
  resettable: false,
  browsable: true,
  manageable: false,
  shared: false,
  hideSharedTag: false
})

const emit = defineEmits<{
  open: []
  browse: []
  reset: []
  manage: []
}>()

const { t } = useI18n()
const tagClass =
  'inline-flex h-5 shrink-0 items-center rounded-[999px] px-2 text-[11px] leading-[14px] font-medium bg-[color-mix(in_srgb,var(--text)_8%,transparent)] text-text-muted'
const actionClass =
  'storage-dir-action static inline-flex size-7 items-center justify-center gap-0 rounded-md border border-solid border-transparent bg-transparent p-0 font-normal leading-[1.5] text-text-muted appearance-auto transition-[background-color,color] duration-100 ease-[ease] hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] hover:text-neutral-100 focus-visible:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] focus-visible:text-neutral-100 focus-visible:outline-none focus-visible:ring-0'
</script>

<template>
  <div class="storage-dir-field flex flex-col gap-1.5">
    <label v-if="label" class="storage-dir-label text-[12px] text-text-muted">{{ label }}</label>
    <div
      class="storage-dir-row flex min-h-14 min-w-0 items-center gap-2.5 rounded-[14px] bg-card py-1.5 pr-3 pl-[18px]"
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
      <span v-if="shared && !hideSharedTag" :class="[tagClass, 'storage-dir-shared-tag']">{{
        t('models.sharedTag')
      }}</span>
      <span v-if="tag" :class="[tagClass, 'storage-dir-tag']">{{ tag }}</span>
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
  </div>
</template>
