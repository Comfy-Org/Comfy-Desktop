<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventListener } from '@vueuse/core'
import {
  ArrowLeft,
  AudioLines,
  Box,
  ChevronLeft,
  ChevronRight,
  Download,
  PanelRight
} from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Tag from '@comfyorg/design-system/chip/Tag'
import AudioPreview from '@comfyorg/design-system/media/AudioPreview'
import InfoTooltip from '../components/InfoTooltip.vue'
import { formatBytes } from '../lib/downloadFormatters'
import type { AssetSummary } from '../types/ipc'

export interface GalleryAsset extends AssetSummary {
  installationId: string
  buildName: string
}

const { assets } = defineProps<{
  assets: GalleryAsset[]
}>()

const index = defineModel<number>('index', { required: true })

const emit = defineEmits<{
  close: []
  download: [asset: GalleryAsset]
}>()

const { t, locale } = useI18n()

const filmstrip = useTemplateRef<HTMLOListElement>('filmstrip')
const panelOpen = ref(true)
const dimensions = ref<string | null>(null)
const duration = ref<string | null>(null)

const asset = computed(() => assets[index.value]!)
const extension = computed(() => {
  const dot = asset.value.name.lastIndexOf('.')
  return dot >= 0 ? asset.value.name.slice(dot + 1).toUpperCase() : ''
})
const kindLabel = computed(() =>
  asset.value.kind ? t(`assets.kindSingular.${asset.value.kind}`) : t('assets.kindSingular.file')
)
const subtitle = computed(() =>
  [
    kindLabel.value,
    extension.value,
    asset.value.sizeBytes === null ? null : formatBytes(asset.value.sizeBytes)
  ]
    .filter(Boolean)
    .join(' · ')
)
const properties = computed(() =>
  [
    { label: t('assets.detail.type'), value: asset.value.mimeType },
    { label: t('assets.detail.dimensions'), value: dimensions.value },
    { label: t('assets.detail.duration'), value: duration.value },
    {
      label: t('assets.detail.created'),
      value: asset.value.createdAt
        ? new Date(asset.value.createdAt).toLocaleString(locale.value)
        : null
    }
  ].filter((row) => row.value)
)

watch(
  asset,
  async () => {
    dimensions.value = null
    duration.value = null
    await nextTick()
    filmstrip.value
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' })
  },
  { immediate: true }
)

function formatDuration(seconds: number): string {
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function onImageLoad(event: Event): void {
  const img = event.target as HTMLImageElement
  dimensions.value = `${img.naturalWidth} × ${img.naturalHeight}`
}

function onVideoLoad(event: Event): void {
  const video = event.target as HTMLVideoElement
  dimensions.value = `${video.videoWidth} × ${video.videoHeight}`
  if (Number.isFinite(video.duration)) duration.value = formatDuration(video.duration)
}

function step(delta: number): void {
  index.value = (index.value + delta + assets.length) % assets.length
}

function ownsKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return false
  const target = event.target
  if (!(target instanceof Element)) return true
  return !target.closest(
    'input, textarea, select, video, audio, [role="dialog"], [role="alertdialog"], [role="menu"]'
  )
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (!ownsKey(event)) return
  if (event.key === 'Escape') emit('close')
  else if (event.key === 'ArrowLeft') step(-1)
  else if (event.key === 'ArrowRight') step(1)
})
</script>

<template>
  <div class="flex min-h-0 flex-1" data-testid="asset-detail">
    <section class="flex min-w-0 flex-1 flex-col">
      <header class="flex shrink-0 items-center gap-3 px-4 py-3">
        <Button
          type="button"
          variant="secondary"
          size="md"
          class="gap-1.5 px-3 text-[13px]/5"
          data-testid="asset-detail-back"
          @click="emit('close')"
        >
          <ArrowLeft :size="15" aria-hidden="true" />
          {{ t('sidebar.assets') }}
        </Button>
        <span class="min-w-0 truncate text-ui font-medium text-foreground">{{ asset.name }}</span>
        <span class="ml-auto shrink-0 text-ui text-subtle-foreground tabular-nums">
          {{
            t('assets.detail.position', {
              build: asset.buildName,
              index: index + 1,
              total: assets.length
            })
          }}
        </span>
        <Button
          type="button"
          variant="muted-textonly"
          size="icon"
          :aria-label="t('assets.detail.togglePanel')"
          :title="t('assets.detail.togglePanel')"
          :aria-pressed="panelOpen"
          @click="panelOpen = !panelOpen"
        >
          <PanelRight :size="15" aria-hidden="true" />
        </Button>
      </header>

      <div class="relative flex min-h-0 flex-1 items-center justify-center px-20 py-4">
        <img
          v-if="asset.previewUrl && asset.kind === 'image'"
          :key="asset.id"
          :src="asset.previewUrl"
          :alt="asset.name"
          class="max-h-full max-w-full object-contain"
          @load="onImageLoad"
        />
        <video
          v-else-if="asset.previewUrl && asset.kind === 'video'"
          :key="asset.id"
          :src="asset.previewUrl"
          controls
          autoplay
          class="max-h-full max-w-full"
          @loadedmetadata="onVideoLoad"
        />
        <div v-else-if="asset.previewUrl && asset.kind === 'audio'" class="w-full max-w-xl">
          <AudioPreview :key="asset.id" :audio-urls="[asset.previewUrl]" />
        </div>
        <div v-else class="flex flex-col items-center gap-2 text-muted-foreground">
          <AudioLines v-if="asset.kind === 'audio'" :size="40" aria-hidden="true" />
          <Box v-else :size="40" aria-hidden="true" />
          <span class="text-ui">{{ extension }}</span>
        </div>

        <Button
          v-if="assets.length > 1"
          type="button"
          variant="secondary"
          size="icon"
          class="absolute top-1/2 left-4 -translate-y-1/2 rounded-full"
          :aria-label="t('assets.detail.previous')"
          data-testid="asset-detail-previous"
          @click="step(-1)"
        >
          <ChevronLeft :size="16" aria-hidden="true" />
        </Button>
        <Button
          v-if="assets.length > 1"
          type="button"
          variant="secondary"
          size="icon"
          class="absolute top-1/2 right-4 -translate-y-1/2 rounded-full"
          :aria-label="t('assets.detail.next')"
          data-testid="asset-detail-next"
          @click="step(1)"
        >
          <ChevronRight :size="16" aria-hidden="true" />
        </Button>
      </div>

      <ol
        ref="filmstrip"
        class="m-0 flex shrink-0 list-none gap-1.5 overflow-x-auto scrollbar-hide px-4 py-3"
      >
        <li v-for="(item, i) in assets" :key="item.id" class="shrink-0">
          <button
            type="button"
            class="flex size-14 items-center justify-center overflow-hidden rounded-md bg-secondary text-muted-foreground outline-offset-2"
            :class="i === index ? 'outline-2 outline-foreground' : 'opacity-70 hover:opacity-100'"
            :aria-label="item.name"
            :aria-current="i === index ? 'true' : undefined"
            @click="index = i"
          >
            <img
              v-if="item.previewUrl && item.kind === 'image'"
              :src="item.previewUrl"
              alt=""
              loading="lazy"
              class="size-full object-cover"
            />
            <video
              v-else-if="item.previewUrl && item.kind === 'video'"
              :src="item.previewUrl"
              preload="metadata"
              muted
              class="size-full object-cover"
            />
            <AudioLines v-else-if="item.kind === 'audio'" :size="16" aria-hidden="true" />
            <Box v-else :size="16" aria-hidden="true" />
          </button>
        </li>
      </ol>
    </section>

    <aside
      v-if="panelOpen"
      class="flex w-[340px] shrink-0 flex-col gap-6 overflow-y-auto border-l border-border-strong p-6"
      data-testid="asset-detail-panel"
    >
      <div class="flex flex-col gap-1">
        <h2 class="m-0 truncate text-heading font-semibold text-foreground">{{ asset.name }}</h2>
        <p class="m-0 text-ui text-subtle-foreground">{{ subtitle }}</p>
      </div>
      <Button
        type="button"
        variant="inverted"
        size="md"
        class="gap-1.5 text-[13px]/5"
        data-testid="asset-detail-download"
        @click="emit('download', asset)"
      >
        <Download :size="15" aria-hidden="true" />
        {{ t('assets.download') }}
      </Button>
      <dl class="m-0 flex flex-col gap-2.5">
        <div v-for="row in properties" :key="row.label" class="flex justify-between gap-4 text-ui">
          <dt class="text-subtle-foreground">{{ row.label }}</dt>
          <dd class="m-0 truncate text-right text-foreground">{{ row.value }}</dd>
        </div>
      </dl>
      <div v-if="asset.tags.length > 0" class="flex flex-col gap-2.5">
        <div
          class="flex items-center text-xs font-medium tracking-wide text-subtle-foreground uppercase"
        >
          {{ t('assets.detail.tags') }}
          <InfoTooltip :text="t('assets.detail.tagsHint')" icon="info" />
        </div>
        <div class="flex flex-wrap gap-1.5">
          <Tag v-for="tag in asset.tags" :key="tag" :label="tag" />
        </div>
      </div>
    </aside>
  </div>
</template>
