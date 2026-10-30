<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
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

interface ModelsDir {
  path: string
  isPrimary: boolean
  /** Locked rows (e.g. the install's own models dir) can't be removed or
   *  browsed/replaced; they show a lock icon. */
  locked?: boolean
  /** Read-only rows (e.g. global shared dirs shown in a per-instance list)
   *  can't be removed or browsed/replaced here, but keep the normal folder
   *  icon (no lock) and stay promotable unless `promotable` is false. */
  readonly?: boolean
  /** Set false to also forbid promoting the row to primary (e.g. the
   *  install's own models dir while shared models is on — the primary is a
   *  global shared dir there). Defaults to true. */
  promotable?: boolean
  /** Read-only row for the install's `extra_model_paths.yaml` file: opens a
   *  detail modal (via `details`), no browse/promote/remove. */
  kind?: 'extra'
  /** Globally-shared dir → shows the shared badge on its icon. */
  shared?: boolean
}

interface Props {
  dirs: ModelsDir[]
  /** Add-button label; defaults to the shared-directory wording used by
   *  Desktop Settings. The per-instance pane passes plain "Add Directory". */
  addLabel?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  change: [index: number]
  remove: [index: number]
  'make-primary': [index: number]
  open: [index: number]
  /** Open the detail modal for a read-only `kind: 'extra'` row. */
  details: [index: number]
  add: []
}>()

const { t } = useI18n()
const actionClass =
  'models-dir-action static inline-flex size-7 items-center justify-center gap-0 rounded-md border border-solid border-transparent bg-transparent p-0 font-normal leading-[1.5] text-text-muted appearance-auto transition-[background-color,color] duration-100 ease-[ease] hover:bg-[var(--brand-surface-bg-hover)] hover:text-neutral-100 focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:text-neutral-100 focus-visible:outline-none focus-visible:ring-0'
const menuItemClass =
  'static block w-full rounded-md border-none bg-transparent px-2.5 py-1.5 text-left text-[12px] leading-[1.5] font-normal whitespace-normal appearance-auto hover:bg-[var(--brand-surface-bg-hover)] focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:outline-none focus-visible:ring-0'

const openMenuIndex = ref<number | null>(null)
const menuToggleRefs = new Map<number, HTMLButtonElement>()
const menuRefs = new Map<number, HTMLDivElement>()

function setMenuToggleRef(index: number, el: Element | null): void {
  if (el instanceof HTMLButtonElement) menuToggleRefs.set(index, el)
  else menuToggleRefs.delete(index)
}

function setMenuRef(index: number, el: Element | null): void {
  if (el instanceof HTMLDivElement) menuRefs.set(index, el)
  else menuRefs.delete(index)
}

function canPromote(dir: ModelsDir): boolean {
  return dir.kind !== 'extra' && !dir.isPrimary && dir.promotable !== false
}

function canRemove(dir: ModelsDir): boolean {
  return dir.kind !== 'extra' && !dir.isPrimary && !dir.locked && !dir.readonly
}

function hasMenuActions(dir: ModelsDir): boolean {
  return canPromote(dir) || canRemove(dir)
}

async function toggleMenu(index: number): Promise<void> {
  const willOpen = openMenuIndex.value !== index
  openMenuIndex.value = willOpen ? index : null
  if (willOpen) {
    await nextTick()
    focusFirstMenuItem(index)
  }
}

function closeMenu(restoreFocus = false): void {
  const prev = openMenuIndex.value
  openMenuIndex.value = null
  if (restoreFocus && prev != null) menuToggleRefs.get(prev)?.focus()
}

function focusFirstMenuItem(index: number): void {
  menuItemsFor(index)[0]?.focus()
}

function menuItemsFor(index: number): HTMLButtonElement[] {
  const menu = menuRefs.get(index)
  if (!menu) return []
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'))
}

function handleMenuArrow(index: number, direction: 1 | -1, event: KeyboardEvent): void {
  event.preventDefault()
  const items = menuItemsFor(index)
  if (items.length === 0) return
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  const next = (current + direction + items.length) % items.length
  items[next]?.focus()
}

function handleChange(index: number): void {
  closeMenu()
  emit('change', index)
}

function handleRemove(index: number): void {
  closeMenu()
  emit('remove', index)
}

/** Path most recently promoted to primary, driving a brief highlight pulse.
 *  Keyed by `path` so the class rides the row as Vue reorders the list. */
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
  <div
    class="models-dir-list flex flex-col rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--brand-surface-bg)]"
    @click="closeMenu()"
  >
    <div
      v-for="row in rows"
      :key="row.path"
      class="models-dir-row flex min-w-0 items-center gap-2 border-t border-solid border-border-hover px-2.5 py-2 first:border-t-0"
      :class="{
        'is-just-promoted animate-[models-dir-promote_1200ms_ease-out]':
          row.path === justPromotedPath
      }"
    >
      <StorageItemIcon
        :icon="row.isExtra ? FileText : row.locked ? FolderLock : Folder"
        :shared="row.shared"
        :title="
          row.locked
            ? t('models.lockedDir', 'This directory is always used and cannot be removed.')
            : undefined
        "
      />
      <div class="models-dir-main flex min-w-0 flex-auto items-center">
        <Button
          type="button"
          variant="textonly"
          size="unset"
          class="models-dir-name static inline-block overflow-hidden text-ellipsis whitespace-nowrap min-w-0 max-w-full gap-0 rounded-lg border-none bg-transparent p-0 text-left text-[13px] leading-[18px] font-normal text-neutral-100 appearance-auto hover:bg-transparent hover:text-[var(--accent)] hover:underline focus-visible:bg-transparent focus-visible:text-[var(--accent)] focus-visible:underline focus-visible:outline-none focus-visible:ring-0"
          :title="
            row.isExtra
              ? t('comfyUISettings.viewCustomPathDetails', 'View custom path details')
              : t('models.openDir', 'Open folder')
          "
          @click.stop="row.isExtra ? emit('details', row.index) : emit('open', row.index)"
        >
          {{ row.path }}
        </Button>
      </div>
      <span
        v-if="row.isPrimary"
        class="models-dir-tag tag-primary inline-flex shrink-0 items-center gap-0.5 rounded-[999px] px-1.5 py-px text-[10px] leading-[14px] font-medium uppercase tracking-[0.02em] border border-solid border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]"
      >
        {{ t('models.primary', 'Downloads') }}
        <InfoTooltip :text="t('tooltips.modelsPrimary')" />
      </span>
      <span
        v-if="row.locked || row.isExtra"
        class="models-dir-tag tag-local inline-flex shrink-0 items-center gap-0.5 rounded-[999px] px-1.5 py-px text-[10px] leading-[14px] font-medium uppercase tracking-[0.02em] border border-solid border-[var(--chooser-surface-border)] bg-[color-mix(in_srgb,var(--text)_6%,transparent)] text-text-muted"
      >
        {{
          row.isExtra ? t('comfyUISettings.yamlTag', 'YAML') : t('models.instanceOnly', 'Instance')
        }}
        <InfoTooltip
          :text="
            row.isExtra ? t('tooltips.extraModelPathsInstance') : t('tooltips.instanceOwnModelsDir')
          "
        />
      </span>
      <div class="models-dir-actions inline-flex shrink-0 items-center gap-0.5">
        <Button
          v-if="row.isExtra"
          type="button"
          variant="textonly"
          size="unset"
          :class="actionClass"
          :aria-label="t('comfyUISettings.viewCustomPathDetails', 'View custom path details')"
          :title="t('comfyUISettings.viewCustomPathDetails', 'View custom path details')"
          @click.stop="emit('details', row.index)"
        >
          <ChevronRight :size="14" aria-hidden="true" />
        </Button>
        <Button
          v-if="!row.locked && !row.isExtra && !row.readonly"
          type="button"
          variant="textonly"
          size="unset"
          :class="actionClass"
          :aria-label="t('common.browse', 'Browse')"
          :title="t('common.browse', 'Browse')"
          @click.stop="handleChange(row.index)"
        >
          <FolderOpen :size="14" aria-hidden="true" />
        </Button>
        <div v-if="row.showMenu" class="models-dir-menu-wrap relative">
          <!-- Keep a native ref: closing the menu restores focus to this element. -->
          <button
            :ref="(el) => setMenuToggleRef(row.index, el as Element | null)"
            type="button"
            :class="actionClass"
            :aria-label="t('models.moreActions', 'More actions')"
            :aria-expanded="openMenuIndex === row.index"
            aria-haspopup="menu"
            @click.stop="toggleMenu(row.index)"
            @keydown.esc.stop.prevent="closeMenu(true)"
          >
            <MoreHorizontal :size="14" aria-hidden="true" />
          </button>
          <div
            v-if="openMenuIndex === row.index"
            :ref="(el) => setMenuRef(row.index, el as Element | null)"
            class="models-dir-menu absolute top-[calc(100%+4px)] right-0 z-10 min-w-[140px] rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-neutral-800 p-1 shadow-[0_8px_24px_color-mix(in_oklab,var(--neutral-950)_40%,transparent)]"
            role="menu"
            @click.stop
            @keydown.esc.stop.prevent="closeMenu(true)"
            @keydown.down.stop.prevent="handleMenuArrow(row.index, 1, $event)"
            @keydown.up.stop.prevent="handleMenuArrow(row.index, -1, $event)"
          >
            <Button
              v-if="row.canPromote"
              type="button"
              role="menuitem"
              variant="textonly"
              size="unset"
              :class="[menuItemClass, 'text-neutral-100']"
              @click="handleMakePrimary(row.index)"
            >
              {{ t('models.makePrimary', 'Use for Model Downloads') }}
            </Button>
            <Button
              v-if="row.canRemove"
              type="button"
              role="menuitem"
              variant="destructive-textonly"
              size="unset"
              :class="[menuItemClass, 'text-danger']"
              @click="handleRemove(row.index)"
            >
              {{ t('models.removeDir', 'Remove') }}
            </Button>
          </div>
        </div>
      </div>
    </div>

    <Button
      type="button"
      variant="textonly"
      size="unset"
      class="models-dir-add static inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border-0 border-t border-solid border-border-hover bg-transparent px-2.5 py-2 text-[13px] leading-[1.5] font-medium text-text-muted appearance-auto transition-[background-color,color] duration-100 ease-[ease] hover:bg-[var(--brand-surface-bg-hover)] hover:text-neutral-100 focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:text-neutral-100 focus-visible:outline-none focus-visible:ring-0"
      @click="emit('add')"
    >
      <Plus :size="14" aria-hidden="true" />
      <span>{{ props.addLabel ?? t('models.addDir', 'Add Shared Directory') }}</span>
    </Button>
  </div>
</template>

<style>
/* The promotion pulse has multiple stops; layout and state styling use utilities. */
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
