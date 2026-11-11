<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventListener, usePreferredReducedMotion } from '@vueuse/core'
import { DropdownMenuRadioGroup } from 'reka-ui'
import { AudioLines, Box, Check, ChevronDown, Download, File, Workflow, X } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Tag from '@comfyorg/design-system/chip/Tag'
import AudioPreview from '@comfyorg/design-system/media/AudioPreview'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuRadioItem from '@comfyorg/design-system/menu/MenuRadioItem'
import DesktopDialogSurface from '../components/ui/DesktopDialogSurface.vue'
import InfoTooltip from '../components/InfoTooltip.vue'
import { formatBytes } from '../lib/downloadFormatters'
import type { AssetKind } from '../types/ipc'

export interface OutputDetailItem {
  key: string
  name: string
  kind: AssetKind | null
  sizeBytes: number | null
  createdAt: string | null
  tags: string[]
  previewUrl: string | null
  workflow: boolean | null
}

type Zoom = 'fit' | 0.5 | 1 | 2

const ZOOM_STEPS: Zoom[] = ['fit', 0.5, 1, 2]

const { items } = defineProps<{
  items: OutputDetailItem[]
}>()

const index = defineModel<number>('index', { required: true })

const emit = defineEmits<{
  close: []
  download: [index: number]
  'open-workflow': [index: number]
}>()

const { t, locale } = useI18n()
const preferredMotion = usePreferredReducedMotion()
const filmstrip = useTemplateRef<HTMLOListElement>('filmstrip')
const natural = ref<{ width: number; height: number } | null>(null)
const zoom = ref<Zoom>('fit')

const item = computed(() => items[index.value]!)
const reducedMotion = computed(() => preferredMotion.value === 'reduce')
const extension = computed(() => {
  const dot = item.value.name.lastIndexOf('.')
  return dot >= 0 ? item.value.name.slice(dot + 1).toUpperCase() : ''
})
const subtitle = computed(() =>
  [
    item.value.kind ? t(`assets.kindSingular.${item.value.kind}`) : t('assets.kindSingular.file'),
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
const percent = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent' }))
const zoomLabel = computed(() =>
  zoom.value === 'fit' ? t('assets.detail.fit') : percent.value.format(zoom.value)
)
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
}

function onVideoLoad(event: Event): void {
  const video = event.target as HTMLVideoElement
  natural.value = { width: video.videoWidth, height: video.videoHeight }
}

function step(delta: number): void {
  index.value = (index.value + delta + items.length) % items.length
}

function zoomOptionLabel(option: Zoom): string {
  return option === 'fit' ? t('assets.detail.fit') : percent.value.format(option)
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
    overlay-class="fixed inset-0 z-60 grid place-items-center bg-media-overlay px-20 py-12 backdrop-blur-md"
    content-class="flex flex-row h-[min(820px,calc(100vh-96px))] w-[min(1280px,calc(100vw-160px))] gap-3 rounded-panel border border-solid border-border bg-window-background p-3"
    data-testid="output-detail"
    @close="emit('close')"
  >
    <Button
      type="button"
      variant="secondary"
      size="icon"
      class="absolute top-0 -right-14 rounded-full"
      :aria-label="t('common.close')"
      data-testid="output-detail-close"
      data-initial-focus
      @click="emit('close')"
    >
      <X :size="16" aria-hidden="true" />
    </Button>

    <section class="flex min-w-0 flex-1 flex-col gap-3 p-3">
      <div
        class="flex min-h-0 flex-1 overflow-auto"
        :class="zoom === 'fit' && 'items-center justify-center'"
      >
        <img
          v-if="item.previewUrl && item.kind === 'image'"
          :key="item.key"
          :src="item.previewUrl"
          :alt="item.name"
          class="m-auto rounded-lg"
          :class="zoom === 'fit' && 'max-h-full max-w-full object-contain'"
          :style="zoomedWidth ? { width: zoomedWidth, maxWidth: 'none' } : undefined"
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
          @loadedmetadata="onVideoLoad"
        />
        <div v-else-if="item.previewUrl && item.kind === 'audio'" class="m-auto w-full max-w-xl">
          <AudioPreview :key="item.key" :audio-urls="[item.previewUrl]" />
        </div>
        <div v-else class="m-auto flex flex-col items-center gap-2 text-subtle-foreground">
          <AudioLines v-if="item.kind === 'audio'" :size="40" aria-hidden="true" />
          <Box v-else-if="item.kind === '3d'" :size="40" aria-hidden="true" />
          <File v-else :size="40" aria-hidden="true" />
          <span class="text-ui">{{ extension }}</span>
        </div>
      </div>

      <footer class="flex shrink-0 items-end gap-3">
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
              <img
                v-if="entry.previewUrl && entry.kind === 'image'"
                :src="entry.previewUrl"
                alt=""
                loading="lazy"
                class="size-full object-cover"
              />
              <video
                v-else-if="entry.previewUrl && entry.kind === 'video'"
                :src="entry.previewUrl"
                preload="metadata"
                muted
                class="size-full object-cover"
              />
              <AudioLines v-else-if="entry.kind === 'audio'" :size="16" aria-hidden="true" />
              <Box v-else-if="entry.kind === '3d'" :size="16" aria-hidden="true" />
              <File v-else :size="16" aria-hidden="true" />
            </button>
          </li>
        </ol>
        <Menu
          v-if="item.kind === 'image'"
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
              class="min-w-20 justify-between gap-1.5 px-3 text-ui tabular-nums"
              :aria-label="t('assets.detail.zoomLevel', { level: zoomLabel })"
              data-testid="output-detail-zoom"
            >
              {{ zoomLabel }}
              <ChevronDown :size="14" aria-hidden="true" />
            </Button>
          </template>
          <DropdownMenuRadioGroup :model-value="String(zoom)">
            <MenuRadioItem
              v-for="option in ZOOM_STEPS"
              :key="option"
              as="button"
              type="button"
              :value="String(option)"
              class="w-full"
              @select="zoom = option"
            >
              <span class="flex-1 text-left">{{ zoomOptionLabel(option) }}</span>
              <Check v-if="zoom === option" :size="15" aria-hidden="true" />
            </MenuRadioItem>
          </DropdownMenuRadioGroup>
        </Menu>
      </footer>
    </section>

    <aside
      class="flex w-[clamp(280px,30%,360px)] shrink-0 flex-col gap-6 overflow-y-auto rounded-xl bg-card p-5"
      data-testid="output-detail-panel"
    >
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <h2 class="m-0 truncate text-heading font-semibold text-foreground">{{ item.name }}</h2>
          <p class="m-0 text-ui text-subtle-foreground">{{ subtitle }}</p>
        </div>
        <div v-if="facts.length > 0" class="flex flex-wrap gap-1.5">
          <Tag v-for="fact in facts" :key="fact" :label="fact" />
        </div>
      </div>

      <div v-if="item.tags.length > 0" class="flex flex-col gap-2.5">
        <div
          class="flex items-center text-xs font-medium tracking-wide text-subtle-foreground uppercase"
        >
          {{ t('assets.detail.tags') }}
          <InfoTooltip
            v-if="item.workflow === null"
            :text="t('assets.detail.tagsHint')"
            icon="info"
          />
        </div>
        <div class="flex flex-wrap gap-1.5">
          <Tag v-for="tag in item.tags" :key="tag" :label="tag" />
        </div>
      </div>

      <div v-if="item.workflow !== null" class="flex flex-col gap-2.5">
        <div class="text-xs font-medium tracking-wide text-subtle-foreground uppercase">
          {{ t('assets.detail.generationInfo') }}
        </div>
        <div class="flex items-center justify-between gap-4 text-ui">
          <span class="text-foreground">
            {{ t('assets.detail.workflow') }}
          </span>
          <span class="text-subtle-foreground">
            {{ item.workflow ? t('assets.detail.available') : t('assets.detail.notSaved') }}
          </span>
        </div>
      </div>

      <div class="mt-auto flex flex-col gap-2">
        <Button
          type="button"
          variant="inverted"
          size="md"
          class="gap-1.5 text-ui"
          data-testid="output-detail-download"
          @click="emit('download', index)"
        >
          <Download :size="15" aria-hidden="true" />
          {{ t('assets.download') }}
        </Button>
        <Button
          v-if="item.workflow"
          type="button"
          variant="secondary"
          size="md"
          class="gap-1.5 text-ui"
          data-testid="output-detail-workflow"
          @click="emit('open-workflow', index)"
        >
          <Workflow :size="15" aria-hidden="true" />
          {{ t('assets.detail.openWorkflow') }}
        </Button>
      </div>
    </aside>
  </DesktopDialogSurface>
</template>
