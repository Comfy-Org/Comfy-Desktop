<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import { Folder, FolderOpen, MoreHorizontal, RotateCcw } from '@lucide/vue'
import StorageItemIcon from '../../components/StorageItemIcon.vue'
import StorageTag from '../../components/StorageTag.vue'
import { revealInFolderKey } from '../../composables/usePlatform'

type StorageDirRowVariant = 'panel' | 'grouped' | 'field'

interface Props {
  path: string
  tag?: string
  resettable?: boolean
  browsable?: boolean
  manageable?: boolean
  shared?: boolean
  hideSharedTag?: boolean
  listAligned?: boolean
  variant?: StorageDirRowVariant
}

const props = withDefaults(defineProps<Props>(), {
  tag: '',
  resettable: false,
  browsable: true,
  manageable: false,
  shared: false,
  hideSharedTag: false,
  listAligned: false,
  variant: 'panel'
})

const emit = defineEmits<{
  open: []
  browse: []
  reset: []
  manage: []
}>()

const { t } = useI18n()
const revealFolderKey = revealInFolderKey(window.api?.platform)
const variantClass: Record<StorageDirRowVariant, string> = {
  panel: 'min-h-14 rounded-[14px] bg-white/5 py-1.5 pr-3 pl-[18px]',
  grouped:
    'min-h-12 rounded-[10px] py-1.5 pr-3 pl-3 transition-[background-color] duration-100 ease-[ease] hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]',
  field:
    'rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--brand-surface-bg)] px-2.5 py-2'
}
const rowClass = computed(() =>
  props.listAligned && props.variant === 'panel'
    ? 'items-start rounded-[14px] bg-card py-4 pr-[9px] pl-[18px]'
    : ['items-center', variantClass[props.variant]]
)
const slotClass = computed(() =>
  props.listAligned ? 'flex h-8 shrink-0 items-center' : 'contents'
)
const menuOpen = ref(false)
const hasMenuActions = computed(() => props.browsable || props.manageable || props.resettable)

function selectFromMenu(action: 'browse' | 'reset' | 'manage'): void {
  menuOpen.value = false
  if (action === 'browse') emit('browse')
  else if (action === 'reset') emit('reset')
  else emit('manage')
}

const actionClass =
  'storage-dir-action static inline-flex size-7 items-center justify-center gap-0 rounded-md border border-solid border-transparent bg-transparent p-0 font-normal leading-[1.5] text-text-muted appearance-auto transition-[background-color,color] duration-100 ease-[ease] hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] hover:text-neutral-100 focus-visible:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] focus-visible:text-neutral-100 focus-visible:outline-none focus-visible:ring-0'

function onMenuKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  menuOpen.value = false
}
</script>

<template>
  <div
    class="storage-dir-field storage-dir-row flex min-w-0 gap-2.5"
    :class="[rowClass, { 'is-list-aligned': listAligned }]"
  >
    <span class="storage-dir-icon-slot" :class="slotClass">
      <StorageItemIcon :icon="Folder" :shared="shared" />
    </span>
    <div
      class="storage-dir-main flex min-w-0 flex-auto"
      :class="listAligned ? 'items-start py-[7px]' : 'items-center'"
    >
      <Button
        type="button"
        variant="textonly"
        size="unset"
        class="storage-dir-name static inline-block min-w-0 max-w-full gap-0 rounded-none border-none bg-transparent p-0 text-left font-mono font-normal text-[12.5px] leading-[18px] text-neutral-100 appearance-auto hover:bg-transparent hover:underline focus-visible:bg-transparent focus-visible:underline focus-visible:outline-none focus-visible:ring-0"
        :class="
          listAligned
            ? 'whitespace-normal [overflow-wrap:anywhere]'
            : 'overflow-hidden text-ellipsis whitespace-nowrap'
        "
        :title="t(revealFolderKey)"
        @click="emit('open')"
      >
        {{ path }}
      </Button>
    </div>
    <span
      v-if="(shared && !hideSharedTag) || tag"
      class="storage-dir-tags gap-2.5"
      :class="listAligned ? 'flex h-8 shrink-0 items-center' : 'contents'"
    >
      <StorageTag
        v-if="shared && !hideSharedTag"
        class="storage-dir-shared-tag"
        :tooltip="t('tooltips.modelsShared')"
      >
        {{ t('models.sharedTag') }}
      </StorageTag>
      <StorageTag v-if="tag" class="storage-dir-tag">{{ tag }}</StorageTag>
    </span>
    <div
      v-if="listAligned"
      class="storage-dir-actions inline-flex h-8 w-7 shrink-0 items-center justify-end"
    >
      <Menu
        v-if="hasMenuActions"
        :open="menuOpen"
        :modal="false"
        align="end"
        class="storage-dir-menu"
        @update:open="(isOpen) => (menuOpen = isOpen)"
        @keydown.capture="onMenuKeydown"
      >
        <template #trigger>
          <Button
            type="button"
            variant="textonly"
            size="unset"
            :class="actionClass"
            :aria-label="t('models.moreActions')"
          >
            <MoreHorizontal :size="14" aria-hidden="true" />
          </Button>
        </template>
        <MenuItem v-if="browsable" @select="selectFromMenu('browse')">
          {{ t('models.changeDir') }}
        </MenuItem>
        <MenuItem v-if="resettable" @select="selectFromMenu('reset')">
          {{ t('common.resetDefault') }}
        </MenuItem>
        <MenuItem v-if="manageable" @select="selectFromMenu('manage')">
          {{ t('comfyUISettings.manageSharedDirs') }}
        </MenuItem>
      </Menu>
    </div>
    <div v-else class="storage-dir-actions inline-flex shrink-0 items-center gap-0.5">
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
