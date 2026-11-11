<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import {
  ChevronRight,
  FileText,
  Folder,
  FolderLock,
  FolderOpen,
  MoreHorizontal,
  Plus
} from 'lucide-vue-next'
import InfoTooltip from '../../components/InfoTooltip.vue'
import StorageItemIcon from '../../components/StorageItemIcon.vue'
import StorageTag from '../../components/StorageTag.vue'

interface ModelsDir {
  path: string
  isPrimary: boolean
  locked?: boolean
  readonly?: boolean
  promotable?: boolean
  kind?: 'extra'
  shared?: boolean
}

interface Props {
  dirs: ModelsDir[]
  addLabel?: string
  hideSharedTag?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  change: [index: number]
  remove: [index: number]
  'make-primary': [index: number]
  open: [index: number]
  details: [index: number]
  add: []
}>()

const { t } = useI18n()
const actionClass = 'models-dir-action shrink-0'
const nameClass =
  'models-dir-name static block min-w-0 max-w-full truncate gap-0 rounded-none border-none bg-transparent p-0 text-left font-mono text-[12.5px] leading-[18px] font-normal text-neutral-100 appearance-auto hover:bg-transparent hover:underline focus-visible:bg-transparent focus-visible:underline focus-visible:outline-none focus-visible:ring-0'
const openMenuIndex = ref<number | null>(null)

function canPromote(dir: ModelsDir): boolean {
  return dir.kind !== 'extra' && !dir.isPrimary && dir.promotable !== false
}

function canRemove(dir: ModelsDir): boolean {
  return dir.kind !== 'extra' && !dir.isPrimary && !dir.locked && !dir.readonly
}

function hasMenuActions(dir: ModelsDir): boolean {
  return canPromote(dir) || canRemove(dir)
}

function closeMenu(): void {
  openMenuIndex.value = null
}
function onMenuKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  closeMenu()
}
onMounted(() => window.addEventListener('blur', closeMenu))
onBeforeUnmount(() => window.removeEventListener('blur', closeMenu))

function handleChange(index: number): void {
  closeMenu()
  emit('change', index)
}

function handleRemove(index: number): void {
  closeMenu()
  emit('remove', index)
}

const justPromotedPath = ref<string | null>(null)
const justPromotedTimer = ref<ReturnType<typeof setTimeout> | null>(null)

function handleMakePrimary(index: number): void {
  closeMenu()
  const promoted = props.dirs[index]?.path ?? null
  emit('make-primary', index)
  if (promoted) {
    justPromotedPath.value = promoted
    if (justPromotedTimer.value) clearTimeout(justPromotedTimer.value)
    justPromotedTimer.value = setTimeout(() => {
      justPromotedPath.value = null
      justPromotedTimer.value = null
    }, 1200)
  }
}

onBeforeUnmount(() => {
  if (justPromotedTimer.value) {
    clearTimeout(justPromotedTimer.value)
    justPromotedTimer.value = null
  }
})

const rows = computed(() =>
  props.dirs.map((dir, index) => ({
    ...dir,
    index,
    locked: dir.locked === true,
    isExtra: dir.kind === 'extra',
    showMenu: hasMenuActions(dir),
    canPromote: canPromote(dir),
    canRemove: canRemove(dir)
  }))
)
</script>

<template>
  <div class="models-dir-list flex flex-col rounded-[14px] bg-white/5 p-1.5" @click="closeMenu()">
    <div
      v-for="row in rows"
      :key="row.path"
      class="models-dir-row flex min-h-11 min-w-0 items-center gap-2.5 rounded-[10px] py-1.5 pr-1.5 pl-3 transition-[background-color] duration-100 ease-[ease] hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]"
      :class="{
        'is-just-promoted animate-[models-dir-promote_1200ms_ease-out]':
          row.path === justPromotedPath
      }"
    >
      <StorageItemIcon
        :icon="row.isExtra ? FileText : row.locked ? FolderLock : Folder"
        :shared="row.shared"
        :title="row.locked ? t('models.lockedDir') : undefined"
      />
      <div class="models-dir-main flex min-w-0 flex-auto items-center">
        <Button
          type="button"
          variant="textonly"
          size="unset"
          :class="nameClass"
          :title="row.isExtra ? t('comfyUISettings.viewCustomPathDetails') : t('models.openDir')"
          @click.stop="row.isExtra ? emit('details', row.index) : emit('open', row.index)"
        >
          {{ row.path }}
        </Button>
      </div>
      <StorageTag v-if="row.isPrimary" class="models-dir-tag tag-primary">
        {{ t('models.primary') }}
        <InfoTooltip :text="t('tooltips.modelsPrimary')" />
      </StorageTag>
      <StorageTag v-if="row.shared && !props.hideSharedTag" class="models-dir-tag tag-shared">
        {{ t('models.sharedTag') }}
      </StorageTag>
      <StorageTag v-if="row.locked || row.isExtra" class="models-dir-tag tag-local">
        {{ row.isExtra ? t('comfyUISettings.yamlTag') : t('models.instanceOnly') }}
        <InfoTooltip
          :text="
            row.isExtra ? t('tooltips.extraModelPathsInstance') : t('tooltips.instanceOwnModelsDir')
          "
        />
      </StorageTag>
      <div class="models-dir-actions inline-flex shrink-0 items-center gap-0.5">
        <Button
          v-if="row.isExtra"
          type="button"
          variant="textonly"
          size="icon"
          :class="actionClass"
          :aria-label="t('comfyUISettings.viewCustomPathDetails')"
          :title="t('comfyUISettings.viewCustomPathDetails')"
          @click.stop="emit('details', row.index)"
        >
          <ChevronRight :size="14" aria-hidden="true" />
        </Button>
        <Button
          v-if="!row.locked && !row.isExtra && !row.readonly"
          type="button"
          variant="textonly"
          size="icon"
          :class="actionClass"
          :aria-label="t('common.browse')"
          :title="t('common.browse')"
          @click.stop="handleChange(row.index)"
        >
          <FolderOpen :size="14" aria-hidden="true" />
        </Button>
        <div v-if="row.showMenu" class="models-dir-menu-wrap">
          <Menu
            :open="openMenuIndex === row.index"
            :modal="false"
            align="end"
            class="models-dir-menu"
            @update:open="(isOpen) => (openMenuIndex = isOpen ? row.index : null)"
            @keydown.capture="onMenuKeydown"
          >
            <template #trigger>
              <Button
                type="button"
                variant="textonly"
                size="icon"
                :class="actionClass"
                :aria-label="t('models.moreActions')"
                @click.stop
              >
                <MoreHorizontal :size="14" aria-hidden="true" />
              </Button>
            </template>
            <MenuItem v-if="row.canPromote" @select="handleMakePrimary(row.index)">
              {{ t('models.makePrimary') }}
            </MenuItem>
            <MenuItem
              v-if="row.canRemove"
              class="text-destructive"
              @select="handleRemove(row.index)"
            >
              {{ t('models.removeDir') }}
            </MenuItem>
          </Menu>
        </div>
      </div>
    </div>

    <div class="models-dir-foot flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-1">
      <Button
        type="button"
        variant="muted-textonly"
        size="md"
        class="models-dir-add rounded-[10px] px-2"
        @click="emit('add')"
      >
        <Plus :size="14" aria-hidden="true" />
        <span>{{ props.addLabel ?? t('models.addDir') }}</span>
      </Button>
      <slot name="footer" />
    </div>
  </div>
</template>

<style>
@keyframes models-dir-promote {
  0% {
    background: transparent;
  }
  10% {
    background: color-mix(in srgb, var(--neutral-50) 22%, transparent);
  }
  30% {
    background: color-mix(in srgb, var(--neutral-50) 22%, transparent);
  }
  100% {
    background: transparent;
  }
}
</style>
