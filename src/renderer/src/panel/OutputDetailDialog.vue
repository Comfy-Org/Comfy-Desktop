<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventListener, usePreferredReducedMotion } from '@vueuse/core'
import { DropdownMenuRadioGroup } from 'reka-ui'
import {
  Box,
  Check,
  ChevronDown,
  Download,
  Ellipsis,
  File,
  FolderSearch,
  Images,
  LoaderCircle,
  Music,
  Workflow,
  X
} from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Tag from '@comfyorg/design-system/chip/Tag'
import AudioPreview from '@comfyorg/design-system/media/AudioPreview'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuRadioItem from '@comfyorg/design-system/menu/MenuRadioItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import DesktopDialogSurface from '../components/ui/DesktopDialogSurface.vue'
import InfoTooltip from '../components/InfoTooltip.vue'
import OutputDetailThumb from './OutputDetailThumb.vue'
import { useImageZoom } from './useImageZoom'
import { formatBytes } from '../lib/downloadFormatters'
import { revealInFolderKey } from '../composables/usePlatform'
import type { MenuItem as MenuEntry } from '@comfyorg/design-system/lib/menu/types'
import type { AssetKind } from '../types/ipc'
import type { ContextMenuItem } from '../types/context-menu'

const ModelViewer = defineAsyncComponent(() => import('./ModelViewer.vue'))

export interface OutputDetailItem {
  key: string
  name: string
  kind: AssetKind | null
  sizeBytes: number | null
  createdAt: string | null
  tags: string[]
  previewUrl: string | null
  thumbnailUrl: string | null
  width?: number | null
  height?: number | null
  imported?: boolean
  savedIn?: string | null
  savedBy?: string | null
  inCloud?: boolean
  workflow?: boolean
  workflowBuilds?: { id: string; name: string }[]
  workflowSlot?: boolean
  workflowBusy?: boolean
  workflowStatus?: string
  mainAction: 'download' | null
  moreActions?: ContextMenuItem[]
  loadModel?: () => Promise<Uint8Array | null>
}

type Zoom = 'fit' | 0.5 | 1 | 2

const ZOOM_STEPS: Zoom[] = ['fit', 0.5, 1, 2]
const IMAGE_RADIUS_PX = 8

const { items } = defineProps<{
  items: OutputDetailItem[]
}>()

const index = defineModel<number>('index', { required: true })

const emit = defineEmits<{
  close: []
  download: [index: number]
  'show-in-folder': [index: number]
  'open-workflow': [index: number, build?: string]
  'view-in-assets': [index: number]
  action: [index: number, action: string]
}>()

const { t, locale } = useI18n()
const revealKey = revealInFolderKey(window.api.platform)
const preferredMotion = usePreferredReducedMotion()
const filmstrip = useTemplateRef<HTMLOListElement>('filmstrip')
const panel = useTemplateRef<HTMLElement>('panel')
const natural = ref<{ width: number; height: number } | null>(null)
const viewport = useTemplateRef<HTMLElement>('viewport')

const item = computed(() => items[index.value] ?? items[0]!)
const moreActions = computed(() => item.value.moreActions ?? [])
const workflowChoices = computed<MenuEntry[]>(() => {
  const builds = item.value.workflowBuilds ?? []
  if (builds.length < 2) return []
  return builds.map((build) => ({
    key: build.id,
    label: build.name,
    command: () => emit('open-workflow', index.value, build.id)
  }))
})
function openWorkflowHere(): void {
  if (item.value.workflowBusy) return
  emit('open-workflow', index.value, item.value.workflowBuilds?.[0]?.id)
}

function workflowButton(): HTMLElement | null {
  return panel.value?.querySelector<HTMLElement>('[data-testid="output-detail-workflow"]') ?? null
}

watch(
  () => item.value.workflowBusy === true,
  async (opening) => {
    if (!opening) return
    await nextTick()
    if (panel.value?.contains(document.activeElement)) return
    workflowButton()?.focus()
  }
)

const reducedMotion = computed(() => preferredMotion.value === 'reduce')
const extension = computed(() => {
  const dot = item.value.name.lastIndexOf('.')
  return dot >= 0 ? item.value.name.slice(dot + 1).toUpperCase() : ''
})
const whenMade = computed(() => {
  const { createdAt, imported } = item.value
  if (!createdAt) return imported ? t('assets.detail.imported') : null
  const date = new Date(createdAt).toLocaleString(locale.value)
  return t(imported ? 'assets.detail.importedAt' : 'assets.detail.createdAt', { date })
})
const subtitle = computed(() =>
  [t(`assets.kindSingular.${item.value.kind ?? 'file'}`), whenMade.value]
    .filter(Boolean)
    .join(' · ')
)
const dimensions = computed(() => {
  if (item.value.kind !== 'image' && item.value.kind !== 'video') return null
  if (natural.value) return natural.value
  const { width, height } = item.value
  return width && height ? { width, height } : null
})
const facts = computed(() =>
  [
    extension.value,
    dimensions.value ? `${dimensions.value.width} × ${dimensions.value.height}` : null,
    item.value.sizeBytes === null ? null : formatBytes(item.value.sizeBytes)
  ].filter((fact): fact is string => !!fact)
)
const savedFolder = computed(() => {
  const folder = item.value.savedIn
  if (!folder) return null
  const trimmed = folder.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return trimmed.slice(cut + 1) || trimmed
})
const zoomable = computed(() => item.value.kind === 'image' && !!item.value.previewUrl)
const zoomer = useImageZoom(viewport, natural, zoomable)
const percent = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent' }))
const zoomLabel = computed(() =>
  zoomer.scale.value === null ? t('assets.detail.fit') : percent.value.format(zoomer.scale.value)
)
const imageStyle = computed(() => {
  const view = zoomer.view.value
  const size = natural.value
  if (!view || !size) return undefined
  return {
    width: `${size.width}px`,
    height: `${size.height}px`,
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    borderRadius: `${IMAGE_RADIUS_PX / view.scale}px`
  }
})
const viewportCursor = computed(() => {
  if (!zoomer.canPan.value) return undefined
  return zoomer.dragging.value ? 'cursor-grabbing' : 'cursor-grab'
})

watch(
  () => item.value.key,
  async () => {
    natural.value = null
    zoomer.reset()
    await nextTick()
    filmstrip.value
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' })
  },
  { immediate: true }
)

function onImageLoad(event: Event): void {
  const img = event.target as HTMLImageElement
  natural.value = { width: img.naturalWidth, height: img.naturalHeight }
}

function onVideoLoad(event: Event): void {
  const video = event.target as HTMLVideoElement
  natural.value = { width: video.videoWidth, height: video.videoHeight }
}

function step(delta: number): void {
  if (items.length === 0) return
  index.value = (index.value + delta + items.length) % items.length
}

function zoomOptionLabel(option: Zoom): string {
  return option === 'fit' ? t('assets.detail.fit') : percent.value.format(option)
}

function isZoom(option: Zoom): boolean {
  return option === 'fit' ? zoomer.fitted.value : zoomer.scale.value === option
}

function chooseZoom(option: Zoom): void {
  if (option === 'fit') zoomer.fit(true)
  else zoomer.zoomTo(option, undefined, true)
}

function hasModifier(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  const target = event.target
  if (event.defaultPrevented) return
  if (
    target instanceof Element &&
    target.closest('input, textarea, video, audio, [role="menu"], [role="alertdialog"]')
  )
    return
  if (event.key === 'ArrowLeft') step(-1)
  else if (event.key === 'ArrowRight') step(1)
  else if (!hasModifier(event) && zoomer.onKey(event.key)) event.preventDefault()
})
</script>

<template>
  <DesktopDialogSurface
    open
    :aria-label="item.name"
    overlay-class="fixed inset-0 z-60 flex bg-media-overlay p-2 backdrop-blur-md"
    content-class="flex size-full max-h-none max-w-none flex-row gap-3 rounded-shell border border-solid border-border bg-window-background p-3"
    data-testid="output-detail"
    @close="emit('close')"
  >
    <section class="flex min-w-0 flex-1 flex-col gap-3 p-3" data-testid="output-detail-stage">
      <div
        ref="viewport"
        class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        :class="[viewportCursor, zoomable && 'touch-none']"
        data-testid="output-detail-viewport"
        @wheel="zoomer.onWheel"
        @pointerdown="zoomer.onPointerDown"
        @pointermove="zoomer.onPointerMove"
        @pointerup="zoomer.onPointerUp"
        @pointercancel="zoomer.onPointerUp"
        @dblclick="zoomer.onDoubleClick"
      >
        <img
          v-if="item.previewUrl && item.kind === 'image'"
          :key="item.key"
          :src="item.previewUrl"
          :alt="item.name"
          draggable="false"
          :class="
            imageStyle
              ? [
                  'absolute top-0 left-0 max-w-none origin-top-left select-none',
                  zoomer.animate.value &&
                    'transition-transform duration-200 ease-out motion-reduce:transition-none'
                ]
              : 'm-auto max-h-full max-w-full rounded-lg object-contain'
          "
          :style="imageStyle"
          data-testid="output-detail-image"
          @load="onImageLoad"
        />
        <video
          v-else-if="item.previewUrl && item.kind === 'video'"
          :key="item.key"
          :src="item.previewUrl"
          controls
          muted
          :autoplay="!reducedMotion"
          class="m-auto max-h-full max-w-full rounded-lg"
          data-testid="output-detail-video"
          @loadedmetadata="onVideoLoad"
        />
        <div v-else-if="item.previewUrl && item.kind === 'audio'" class="m-auto w-full max-w-xl">
          <AudioPreview :key="item.key" :audio-urls="[item.previewUrl]" />
        </div>
        <ModelViewer
          v-else-if="item.kind === '3d' && item.loadModel"
          :key="item.key"
          :name="item.name"
          :load="item.loadModel"
        />
        <div v-else class="m-auto flex flex-col items-center gap-2 text-subtle-foreground">
          <Music v-if="item.kind === 'audio'" :size="40" aria-hidden="true" />
          <Box v-else-if="item.kind === '3d'" :size="40" aria-hidden="true" />
          <File v-else :size="40" aria-hidden="true" />
          <span class="text-ui">{{ extension }}</span>
        </div>
      </div>

      <footer class="flex shrink-0 items-end justify-end gap-3">
        <ol
          v-if="items.length > 1"
          ref="filmstrip"
          class="m-0 flex min-w-0 flex-1 list-none gap-1.5 overflow-x-auto scrollbar-hide p-1"
        >
          <li v-for="(entry, i) in items" :key="entry.key" class="shrink-0">
            <button
              type="button"
              class="flex size-12 items-center justify-center overflow-hidden rounded-md bg-secondary text-subtle-foreground outline-offset-2"
              :class="i === index ? 'outline-2 outline-foreground' : 'opacity-60 hover:opacity-100'"
              :aria-label="entry.name"
              :aria-current="i === index ? 'true' : undefined"
              :data-testid="`output-detail-thumb-${i}`"
              @click="index = i"
            >
              <OutputDetailThumb :entry="entry" />
            </button>
          </li>
        </ol>
        <Menu
          v-if="zoomable"
          :modal="false"
          align="end"
          class="z-70 min-w-[120px]"
          :aria-label="t('assets.detail.zoom')"
        >
          <template #trigger>
            <Button
              type="button"
              variant="secondary"
              size="md"
              class="min-w-20 justify-between gap-1.5 px-3 text-[13px]/5 tabular-nums"
              :aria-label="t('assets.detail.zoomLevel', { level: zoomLabel })"
              data-testid="output-detail-zoom"
            >
              {{ zoomLabel }}
              <ChevronDown :size="14" aria-hidden="true" />
            </Button>
          </template>
          <DropdownMenuRadioGroup
            :model-value="zoomer.fitted.value ? 'fit' : String(zoomer.scale.value)"
          >
            <MenuRadioItem
              v-for="option in ZOOM_STEPS"
              :key="option"
              as="button"
              type="button"
              :value="String(option)"
              class="w-full"
              @select="chooseZoom(option)"
            >
              <span class="flex-1 text-left">{{ zoomOptionLabel(option) }}</span>
              <Check v-if="isZoom(option)" :size="15" aria-hidden="true" />
            </MenuRadioItem>
          </DropdownMenuRadioGroup>
        </Menu>
      </footer>
    </section>

    <aside
      ref="panel"
      class="flex w-[clamp(280px,30%,360px)] shrink-0 flex-col gap-6 overflow-y-auto rounded-xl bg-card p-5"
      data-testid="output-detail-panel"
    >
      <div
        class="-mx-5 -mt-5 flex shrink-0 items-center gap-1 border-b border-solid border-border py-3 pr-3 pl-5"
        data-testid="output-detail-header"
      >
        <span class="min-w-0 flex-1 truncate text-ui font-semibold text-foreground">
          {{ t('assets.detail.title') }}
        </span>
        <Menu
          v-if="moreActions.length > 0"
          :modal="false"
          align="end"
          class="z-70 min-w-44"
          :aria-label="t('assets.moreActions')"
        >
          <template #trigger>
            <Button
              type="button"
              variant="muted-textonly"
              size="icon"
              class="shrink-0 rounded-full"
              :aria-label="t('assets.moreActions')"
              :title="t('assets.moreActions')"
              data-testid="output-detail-more"
            >
              <Ellipsis :size="16" aria-hidden="true" />
            </Button>
          </template>
          <template v-for="action in moreActions" :key="action.id">
            <MenuSeparator v-if="action.separator" />
            <MenuItem
              as="button"
              type="button"
              class="w-full gap-2.5"
              :class="action.style === 'danger' && 'text-destructive'"
              :data-testid="`output-detail-action-${action.id}`"
              @select="emit('action', index, action.id)"
            >
              <component :is="action.icon" v-if="action.icon" :size="15" aria-hidden="true" />
              <span class="flex-1 text-left">{{ action.label }}</span>
            </MenuItem>
          </template>
        </Menu>
        <button
          type="button"
          class="-ml-0.5 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:bg-foreground/12 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
          :aria-label="t('common.close')"
          :title="t('common.close')"
          data-testid="output-detail-close"
          @click="emit('close')"
        >
          <X :size="16" aria-hidden="true" />
        </button>
      </div>

      <div class="flex flex-col gap-3">
        <div class="flex min-w-0 flex-col gap-1">
          <h2 class="m-0 line-clamp-2 text-heading font-semibold break-words text-foreground">
            {{ item.name }}
          </h2>
          <p class="m-0 text-ui text-subtle-foreground" data-testid="output-detail-subtitle">
            {{ subtitle }}
          </p>
        </div>
        <div
          v-if="facts.length > 0"
          class="flex flex-wrap gap-1.5"
          data-testid="output-detail-facts"
        >
          <Tag v-for="fact in facts" :key="fact" :label="fact" />
        </div>
      </div>

      <div v-if="item.tags.length > 0" class="flex flex-col gap-2.5">
        <div
          class="flex items-center text-xs font-medium tracking-wide text-subtle-foreground uppercase"
        >
          {{ t('assets.detail.tags') }}
          <InfoTooltip :text="t('assets.detail.tagsHint')" icon="info" />
        </div>
        <div class="flex flex-wrap gap-1.5">
          <Tag v-for="tag in item.tags" :key="tag" :label="tag" />
        </div>
      </div>

      <div
        v-if="savedFolder || item.inCloud"
        class="flex flex-col gap-2.5"
        data-testid="output-detail-saved-in"
      >
        <div class="text-xs font-medium tracking-wide text-subtle-foreground uppercase">
          {{ t('assets.detail.savedIn') }}
        </div>
        <span v-if="item.inCloud" class="text-ui text-foreground">
          {{ t('assets.detail.cloudAssets') }}
        </span>
        <div v-if="savedFolder" class="flex min-w-0 flex-col gap-0.5 text-ui">
          <span class="truncate text-foreground">{{ savedFolder }}</span>
          <span v-if="item.savedBy" class="truncate text-subtle-foreground">{{
            item.savedBy
          }}</span>
        </div>
      </div>

      <div class="mt-auto flex flex-col gap-2">
        <Button
          v-if="item.mainAction === 'download'"
          type="button"
          variant="inverted"
          size="md"
          class="gap-1.5 text-[13px]/5"
          data-testid="output-detail-download"
          @click="emit('download', index)"
        >
          <Download :size="15" aria-hidden="true" />
          {{ t('assets.download') }}
        </Button>
        <Button
          v-if="item.mainAction === null"
          type="button"
          variant="inverted"
          size="md"
          class="gap-1.5 text-[13px]/5"
          data-testid="output-detail-show-in-folder"
          @click="emit('show-in-folder', index)"
        >
          <FolderSearch :size="15" aria-hidden="true" />
          {{ t(revealKey) }}
        </Button>
        <span class="sr-only" aria-live="polite" data-testid="output-detail-workflow-status">{{
          item.workflowStatus ?? ''
        }}</span>
        <Menu
          v-if="item.workflow && !item.workflowBusy && workflowChoices.length > 0"
          :items="workflowChoices"
          :modal="false"
          align="start"
          class="z-70"
          :label="t('assets.detail.openWorkflowIn')"
        >
          <template #trigger>
            <Button
              type="button"
              variant="secondary"
              size="md"
              class="w-full gap-1.5 text-[13px]/5"
              data-testid="output-detail-workflow"
            >
              <Workflow :size="15" aria-hidden="true" />
              {{ t('assets.detail.openWorkflow') }}
              <ChevronDown :size="15" aria-hidden="true" />
            </Button>
          </template>
        </Menu>
        <Button
          v-else-if="item.workflow || item.workflowSlot"
          type="button"
          variant="secondary"
          size="md"
          class="gap-1.5 text-[13px]/5 aria-disabled:cursor-default aria-disabled:opacity-50"
          :class="{ invisible: !item.workflow }"
          :aria-hidden="item.workflow ? undefined : 'true'"
          :tabindex="item.workflow ? undefined : -1"
          :disabled="!item.workflow"
          :aria-disabled="item.workflowBusy ? 'true' : undefined"
          :aria-busy="item.workflowStatus ? 'true' : undefined"
          data-testid="output-detail-workflow"
          @click="openWorkflowHere"
        >
          <template v-if="item.workflowStatus">
            <LoaderCircle
              :size="15"
              class="animate-spin [animation-duration:900ms] motion-reduce:animate-none"
              aria-hidden="true"
            />
            {{ item.workflowStatus }}
          </template>
          <template v-else>
            <Workflow :size="15" aria-hidden="true" />
            {{ t('assets.detail.openWorkflow') }}
          </template>
        </Button>
        <Button
          v-if="item.inCloud"
          type="button"
          variant="secondary"
          size="md"
          class="gap-1.5 text-[13px]/5"
          data-testid="output-detail-view-in-assets"
          @click="emit('view-in-assets', index)"
        >
          <Images :size="15" aria-hidden="true" />
          {{ t('assets.viewInAssets') }}
        </Button>
      </div>
    </aside>
  </DesktopDialogSurface>
</template>
