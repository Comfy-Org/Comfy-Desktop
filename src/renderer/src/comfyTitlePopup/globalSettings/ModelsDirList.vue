<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import { FileText, Folder, FolderLock, MoreHorizontal, Plus } from '@lucide/vue'
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
  hideSharedTag?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  change: [index: number]
  remove: [index: number]
  'make-primary': [index: number]
  open: [index: number]
  details: [index: number]
  manage: []
  add: []
}>()

const { t } = useI18n()
const actionClass = 'models-dir-action size-7 shrink-0 rounded-md'
const nameClass =
  'models-dir-name static block min-w-0 max-w-full whitespace-normal [overflow-wrap:anywhere] gap-0 rounded-none border-none bg-transparent p-0 text-left font-mono text-[12.5px] leading-[18px] font-normal text-neutral-100 appearance-auto hover:bg-transparent hover:underline focus-visible:bg-transparent focus-visible:underline focus-visible:outline-none focus-visible:ring-0'
const openMenuIndex = ref<number | null>(null)

function canPromote(dir: ModelsDir): boolean {
  return dir.kind !== 'extra' && !dir.isPrimary && dir.promotable !== false
}

function canRemove(dir: ModelsDir): boolean {
  return dir.kind !== 'extra' && !dir.isPrimary && !dir.locked && !dir.readonly
}

function canChange(dir: ModelsDir): boolean {
  return dir.kind !== 'extra' && !dir.locked && !dir.readonly
}

function hasMenuActions(dir: ModelsDir): boolean {
  return dir.kind === 'extra' || dir.shared === true || canChange(dir) || canPromote(dir)
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

function handleDetails(index: number): void {
  closeMenu()
  emit('details', index)
}

function handleManage(): void {
  closeMenu()
  emit('manage')
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
    canChange: canChange(dir),
    canPromote: canPromote(dir),
    canRemove: canRemove(dir)
  }))
)
</script>

<template>
  <div class="models-dir-list flex flex-col gap-2.5" @click="closeMenu()">
    <div
      v-for="row in rows"
      :key="row.path"
      class="models-dir-row flex min-w-0 items-start gap-2.5 rounded-[14px] bg-card py-4 pr-[9px] pl-[18px]"
      :class="{
        'is-just-promoted animate-[models-dir-promote_1200ms_ease-out]':
          row.path === justPromotedPath
      }"
    >
      <span class="models-dir-icon-slot flex h-8 shrink-0 items-center">
        <StorageItemIcon
          :icon="row.isExtra ? FileText : row.locked ? FolderLock : Folder"
          :shared="row.shared"
          :title="row.locked ? t('models.lockedDir') : undefined"
        />
      </span>
      <div class="models-dir-main flex min-w-0 flex-auto items-start py-[7px]">
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
      <span
        v-if="row.isPrimary || (row.shared && !props.hideSharedTag) || row.locked || row.isExtra"
        class="models-dir-tags flex h-8 shrink-0 items-center gap-2.5"
      >
        <StorageTag v-if="row.isPrimary" class="models-dir-tag tag-primary">
          {{ t('models.primary') }}
          <InfoTooltip :text="t('tooltips.modelsPrimary')" />
        </StorageTag>
        <StorageTag v-if="row.shared && !props.hideSharedTag" class="models-dir-tag tag-shared">
          {{ t('models.sharedTag') }}
          <InfoTooltip :text="t('tooltips.modelsShared')" />
        </StorageTag>
        <StorageTag v-if="row.locked || row.isExtra" class="models-dir-tag tag-local">
          {{ row.isExtra ? t('comfyUISettings.yamlTag') : t('models.instanceOnly') }}
          <InfoTooltip
            :text="
              row.isExtra
                ? t('tooltips.extraModelPathsInstance')
                : t('tooltips.instanceOwnModelsDir')
            "
          />
        </StorageTag>
      </span>
      <div class="models-dir-actions inline-flex h-8 w-7 shrink-0 items-center justify-end">
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
                size="unset"
                :class="actionClass"
                :aria-label="t('models.moreActions')"
                @click.stop
              >
                <MoreHorizontal :size="14" aria-hidden="true" />
              </Button>
            </template>
            <MenuItem v-if="row.isExtra" @select="handleDetails(row.index)">
              {{ t('comfyUISettings.viewCustomPathDetails') }}
            </MenuItem>
            <MenuItem v-if="row.canPromote" @select="handleMakePrimary(row.index)">
              {{ t('models.makePrimary') }}
            </MenuItem>
            <MenuItem v-if="row.canChange" @select="handleChange(row.index)">
              {{ t('models.changeDir') }}
            </MenuItem>
            <MenuItem v-if="row.shared" @select="handleManage()">
              {{ t('comfyUISettings.manageSharedDirs') }}
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

    <div class="models-dir-foot flex min-w-0 items-center">
      <Button
        type="button"
        variant="textonly"
        class="models-dir-add static inline-flex h-8 items-center justify-center gap-1 self-start rounded-lg border-none bg-[var(--chooser-surface-border-hover)] px-3.5 py-2 text-[12px] leading-4 font-medium text-neutral-100 appearance-auto transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-[var(--brand-surface-border-hover)] hover:text-text focus-visible:bg-[var(--brand-surface-border-hover)] focus-visible:text-text focus-visible:outline-none focus-visible:ring-0"
        @click="emit('add')"
      >
        <Plus :size="16" aria-hidden="true" />
        <span>{{ t('settings.addModelsFolder') }}</span>
      </Button>
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
