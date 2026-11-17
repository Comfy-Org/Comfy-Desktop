<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import { Folder, FolderOpen, MoreHorizontal, Plus } from '@lucide/vue'
import InfoTooltip from '../../components/InfoTooltip.vue'
import StorageItemIcon from '../../components/StorageItemIcon.vue'
import StorageTag from '../../components/StorageTag.vue'

export type SharedFolderKind = 'models' | 'input' | 'output'

export interface SharedFolderRow {
  key: string
  kind: SharedFolderKind
  path: string
  isDownloads?: boolean
  removable?: boolean
}

defineProps<{
  rows: SharedFolderRow[]
}>()

const emit = defineEmits<{
  open: [row: SharedFolderRow]
  browse: [row: SharedFolderRow]
  'use-for-downloads': [row: SharedFolderRow]
  remove: [row: SharedFolderRow]
  add: []
}>()

const { t } = useI18n()

const kindLabelKey: Record<SharedFolderKind, string> = {
  models: 'settings.folderKindModels',
  input: 'settings.folderKindInput',
  output: 'settings.folderKindOutput'
}

const iconButtonClass = 'shared-folder-action shrink-0'
const openMenuKey = ref<string | null>(null)

function closeMenu(): void {
  openMenuKey.value = null
}
function onMenuKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  closeMenu()
}
onMounted(() => window.addEventListener('blur', closeMenu))
onBeforeUnmount(() => window.removeEventListener('blur', closeMenu))

function handleRemove(row: SharedFolderRow): void {
  closeMenu()
  emit('remove', row)
}
</script>

<template>
  <div class="shared-folders flex flex-col rounded-[14px] bg-white/5 p-1.5" @click="closeMenu()">
    <div
      v-for="row in rows"
      :key="row.key"
      class="shared-folder-row grid min-h-11 min-w-0 grid-cols-[14px_minmax(0,1fr)_64px_128px_66px] items-center gap-2.5 rounded-[10px] py-1.5 pr-1.5 pl-3 transition-[background-color] duration-100 ease-[ease] hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]"
      :data-kind="row.kind"
    >
      <StorageItemIcon :icon="Folder" shared />
      <Button
        type="button"
        variant="textonly"
        size="unset"
        class="shared-folder-path static block min-w-0 max-w-full truncate [direction:rtl] gap-0 rounded-none border-none bg-transparent p-0 text-left font-mono text-[12.5px] leading-[18px] font-normal text-neutral-100 appearance-auto hover:bg-transparent hover:underline focus-visible:bg-transparent focus-visible:underline focus-visible:outline-none focus-visible:ring-0"
        :title="row.path"
        @click.stop="emit('open', row)"
      >
        <bdi dir="ltr">{{ row.path }}</bdi>
      </Button>
      <span class="shared-folder-kind truncate text-[12px] text-text-muted">
        {{ t(kindLabelKey[row.kind]) }}
      </span>
      <div class="shared-folder-downloads flex min-w-0 justify-start">
        <StorageTag v-if="row.isDownloads" class="shared-folder-downloads-tag">
          {{ t('models.primary') }}
          <InfoTooltip :text="t('tooltips.modelsPrimary')" />
        </StorageTag>
        <Button
          v-else-if="row.kind === 'models'"
          type="button"
          variant="muted-textonly"
          size="unset"
          class="shared-folder-use-downloads h-5 rounded-full px-2 text-[11px] leading-[14px] font-medium"
          @click.stop="emit('use-for-downloads', row)"
        >
          {{ t('settings.useForDownloads') }}
        </Button>
      </div>
      <div class="shared-folder-actions inline-flex items-center justify-start gap-0.5">
        <Button
          type="button"
          variant="textonly"
          size="icon"
          :class="iconButtonClass"
          :aria-label="t('common.browse')"
          :title="t('common.browse')"
          @click.stop="emit('browse', row)"
        >
          <FolderOpen :size="14" aria-hidden="true" />
        </Button>
        <Menu
          v-if="row.removable"
          :open="openMenuKey === row.key"
          :modal="false"
          align="end"
          class="shared-folder-menu"
          @update:open="(isOpen) => (openMenuKey = isOpen ? row.key : null)"
          @keydown.capture="onMenuKeydown"
        >
          <template #trigger>
            <Button
              type="button"
              variant="textonly"
              size="icon"
              :class="[iconButtonClass, 'shared-folder-more']"
              :aria-label="t('models.moreActions')"
              @click.stop
            >
              <MoreHorizontal :size="14" aria-hidden="true" />
            </Button>
          </template>
          <MenuItem class="text-destructive" @select="handleRemove(row)">
            {{ t('models.removeDir') }}
          </MenuItem>
        </Menu>
      </div>
    </div>

    <div class="shared-folders-foot flex min-w-0 items-center px-1 pt-1">
      <Button
        type="button"
        variant="muted-textonly"
        size="md"
        class="shared-folders-add rounded-[10px] px-2"
        @click="emit('add')"
      >
        <Plus :size="14" aria-hidden="true" />
        <span>{{ t('settings.addModelsFolder') }}</span>
      </Button>
    </div>
  </div>
</template>
