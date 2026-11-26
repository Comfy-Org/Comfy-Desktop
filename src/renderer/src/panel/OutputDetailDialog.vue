<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventListener, usePreferredReducedMotion, useResizeObserver } from '@vueuse/core'
import {
  Box,
  ChevronDown,
  Download,
  File,
  Images,
  LoaderCircle,
  Music,
  ScanSearch,
  Workflow,
  X
} from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Tag from '@comfyorg/design-system/chip/Tag'
import AudioPreview from '@comfyorg/design-system/media/AudioPreview'
import Menu from '@comfyorg/design-system/menu/Menu'
import DesktopDialogSurface from '../components/ui/DesktopDialogSurface.vue'
import OutputDetailThumb from './OutputDetailThumb.vue'
import AssetZoomControl from './AssetZoomControl.vue'
import type { AssetZoom } from './AssetZoomControl.vue'
import { formatBytes } from '../lib/downloadFormatters'
import { revealInFolderKey } from '../composables/usePlatform'
import type { MenuItem } from '@comfyorg/design-system/lib/menu/types'
import type { AssetKind } from '../types/ipc'

const ModelViewer = defineAsyncComponent(() => import('./ModelViewer.vue'))

export interface OutputDetailItem {
  key: string
  name: string
  kind: AssetKind | null
  sizeBytes: number | null
  createdAt: string | null
  previewUrl: string | null
  thumbnailUrl: string | null
  savedIn?: string | null
  models?: string[]
  prompts?: string[]
  inCloud?: boolean
  workflow?: boolean
  workflowBuilds?: { id: string; name: string }[]
  workflowSlot?: boolean
  workflowBusy?: boolean
  workflowStatus?: string
  mainAction: 'download' | null
  loadModel?: () => Promise<Uint8Array | null>
}

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
}>()

const { t, locale } = useI18n()
const revealKey = revealInFolderKey(window.api.platform)
const preferredMotion = usePreferredReducedMotion()
const filmstrip = useTemplateRef<HTMLOListElement>('filmstrip')
const panel = useTemplateRef<HTMLElement>('panel')
const natural = ref<{ width: number; height: number } | null>(null)
const zoom = ref<AssetZoom>('fit')
const image = useTemplateRef<HTMLImageElement>('image')
const fitScale = ref(1)

const item = computed(() => items[index.value] ?? items[0]!)
const workflowChoices = computed<MenuItem[]>(() => {
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
const subtitle = computed(() =>
  [
    t(`assets.kindSingular.${item.value.kind ?? 'file'}`),
    item.value.createdAt
      ? t('assets.detail.createdAt', {
          date: new Date(item.value.createdAt).toLocaleString(locale.value)
        })
      : null
  ]
    .filter(Boolean)
    .join(' · ')
)
const facts = computed(() =>
  [
    extension.value,
    natural.value ? `${natural.value.width} × ${natural.value.height}` : null,
    item.value.sizeBytes === null ? null : formatBytes(item.value.sizeBytes)
  ].filter((fact): fact is string => !!fact)
)
const savedFolder = computed(() => {
  const folder = item.value.savedIn
  if (!folder) return null
  const cut = Math.max(folder.lastIndexOf('/'), folder.lastIndexOf('\\'))
  return { name: folder.slice(cut + 1) || folder, parent: cut > 0 ? folder.slice(0, cut) : '' }
})
const zoomedWidth = computed(() =>
  zoom.value === 'fit' || !natural.value ? null : `${natural.value.width * zoom.value}px`
)

watch(
  () => item.value.key,
  async () => {
    natural.value = null
    zoom.value = 'fit'
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
  measureFit()
}

function measureFit(): void {
  const img = image.value
  if (zoom.value !== 'fit' || !img || !natural.value?.width) return
  fitScale.value = img.clientWidth / natural.value.width
}

useResizeObserver(image, measureFit)

function onVideoLoad(event: Event): void {
  const video = event.target as HTMLVideoElement
  natural.value = { width: video.videoWidth, height: video.videoHeight }
}

function step(delta: number): void {
  if (items.length === 0) return
  index.value = (index.value + delta + items.length) % items.length
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
    <section class="flex min-w-0 flex-1 flex-col gap-3 p-3">
      <div
        class="flex min-h-0 flex-1 overflow-auto"
        :class="zoom === 'fit' && 'items-center justify-center'"
      >
        <img
          v-if="item.previewUrl && item.kind === 'image'"
          :key="item.key"
          ref="image"
          :src="item.previewUrl"
          :alt="item.name"
          class="m-auto rounded-lg"
          :class="zoom === 'fit' ? 'max-h-full max-w-full object-contain' : 'shrink-0'"
          :style="zoomedWidth ? { width: zoomedWidth, maxWidth: 'none' } : undefined"
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
        <AssetZoomControl v-if="item.kind === 'image'" v-model="zoom" :fit-scale="fitScale" />
      </footer>
    </section>

    <aside
      ref="panel"
      class="flex w-[clamp(280px,30%,360px)] shrink-0 flex-col gap-6 overflow-y-auto rounded-xl bg-card p-5"
      data-testid="output-detail-panel"
    >
      <div class="flex flex-col gap-3">
        <div class="flex items-start gap-2">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <h2 class="m-0 line-clamp-2 text-heading font-semibold break-words text-foreground">
              {{ item.name }}
            </h2>
            <p class="m-0 text-ui text-subtle-foreground">{{ subtitle }}</p>
          </div>
          <Button
            type="button"
            variant="muted-textonly"
            size="icon"
            class="-mt-1 -mr-1 shrink-0 rounded-full"
            :aria-label="t('common.close')"
            data-testid="output-detail-close"
            @click="emit('close')"
          >
            <X :size="16" aria-hidden="true" />
          </Button>
        </div>
        <div v-if="facts.length > 0" class="flex flex-wrap gap-1.5">
          <Tag v-for="fact in facts" :key="fact" :label="fact" />
        </div>
      </div>

      <div
        v-if="item.prompts?.length"
        class="flex flex-col gap-2.5"
        data-testid="output-detail-prompts"
      >
        <div class="text-xs font-medium tracking-wide text-subtle-foreground uppercase">
          {{ t('assets.detail.prompts') }}
        </div>
        <p
          v-for="(prompt, at) in item.prompts"
          :key="at"
          class="m-0 max-h-40 overflow-y-auto rounded-lg bg-secondary p-3 text-ui break-words text-foreground select-text"
        >
          {{ prompt }}
        </p>
      </div>

      <div
        v-if="item.models?.length"
        class="flex flex-col gap-2.5"
        data-testid="output-detail-models"
      >
        <div class="text-xs font-medium tracking-wide text-subtle-foreground uppercase">
          {{ t('assets.detail.models') }}
        </div>
        <div class="flex flex-wrap gap-1.5">
          <Tag v-for="model in item.models" :key="model" :label="model" />
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
        <div
          v-if="savedFolder"
          class="flex min-w-0 flex-col gap-0.5 text-ui"
          :title="item.savedIn ?? undefined"
        >
          <span class="truncate text-foreground">{{ savedFolder.name }}</span>
          <span v-if="savedFolder.parent" class="truncate text-subtle-foreground">{{
            savedFolder.parent
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
          <ScanSearch :size="15" aria-hidden="true" />
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
