<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTimeoutFn } from '@vueuse/core'
import { Check, ChevronDown, ChevronUp, Copy, FolderOpen, Music, X } from 'lucide-vue-next'
import Button from '../../design-system/components/Button.vue'
import Card from '../../design-system/components/Card.vue'
import { formatBytes } from '../../lib/formatting'
import type { InstallAsset } from '../../types/ipc'

/** One asset beside the gallery: a full preview and what is known about it.
 *  Dimensions and duration are read from the media itself once it loads. */
const { asset, hasPrevious, hasNext } = defineProps<{
  asset: InstallAsset
  hasPrevious: boolean
  hasNext: boolean
}>()
const emit = defineEmits<{ close: []; step: [delta: -1 | 1]; reveal: [asset: InstallAsset] }>()

const { t, locale } = useI18n()

const dimensions = ref<{ width: number; height: number } | null>(null)
const duration = ref<number | null>(null)
const copied = ref(false)
watch(
  () => asset.id,
  () => {
    dimensions.value = null
    duration.value = null
    copied.value = false
  }
)

function onImageLoad(event: Event): void {
  const img = event.target as HTMLImageElement
  dimensions.value = { width: img.naturalWidth, height: img.naturalHeight }
}
function onMediaMetadata(event: Event): void {
  const media = event.target as HTMLMediaElement
  if (Number.isFinite(media.duration)) duration.value = media.duration
  if (media instanceof HTMLVideoElement && media.videoWidth) {
    dimensions.value = { width: media.videoWidth, height: media.videoHeight }
  }
}

const { start: clearCopiedLater } = useTimeoutFn(() => (copied.value = false), 1500, {
  immediate: false
})
async function copyName(): Promise<void> {
  try {
    await navigator.clipboard.writeText(asset.name)
  } catch {
    // Clipboard access was refused: the name stays selectable in the panel.
    return
  }
  copied.value = true
  clearCopiedLater()
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
}
function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  const [h, m, sec] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

const isCloud = computed(() => !asset.revealable)
const fileType = computed(() => {
  const ext = asset.name.includes('.') ? asset.name.split('.').pop()!.toUpperCase() : ''
  return [t(`buildsDashboard.assetDetail.kind.${asset.mediaType}`), asset.mimeType ?? ext]
    .filter(Boolean)
    .join(' · ')
})
const facts = computed(() =>
  [
    { label: t('buildsDashboard.assetDetail.name'), value: asset.name },
    { label: t('buildsDashboard.assetDetail.type'), value: fileType.value },
    {
      label: t('buildsDashboard.assetDetail.category'),
      value: t(`buildsDashboard.assetDetail.${asset.category}`)
    },
    { label: t('buildsDashboard.assetDetail.size'), value: formatBytes(asset.size) },
    dimensions.value && {
      label: t('buildsDashboard.assetDetail.dimensions'),
      value: `${dimensions.value.width} × ${dimensions.value.height}`
    },
    duration.value !== null && {
      label: t('buildsDashboard.assetDetail.duration'),
      value: formatDuration(duration.value)
    },
    { label: t('buildsDashboard.assetDetail.created'), value: formatDate(asset.createdAt) },
    { label: t('buildsDashboard.assetDetail.modified'), value: formatDate(asset.modifiedAt) },
    isCloud.value
      ? { label: t('buildsDashboard.assetDetail.assetId'), value: asset.id, mono: true }
      : { label: t('buildsDashboard.assetDetail.location'), value: asset.id, mono: true },
    isCloud.value &&
      asset.hash && {
        label: t('buildsDashboard.assetDetail.hash'),
        value: asset.hash,
        mono: true
      }
  ].filter((fact): fact is { label: string; value: string; mono?: boolean } => !!fact)
)
</script>

<template>
  <Card
    as="aside"
    padding="sm"
    class="sticky top-4 flex max-h-[calc(100vh-(--spacing(24)))] w-90 shrink-0 flex-col gap-3 overflow-y-auto"
    :aria-label="asset.name"
    data-testid="asset-detail"
  >
    <header class="flex items-center gap-1">
      <p class="min-w-0 flex-1 truncate pl-1 text-ui font-medium" :title="asset.name">
        {{ asset.name }}
      </p>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="
          copied
            ? t('buildsDashboard.assetDetail.copied')
            : t('buildsDashboard.assetDetail.copyName')
        "
        @click="copyName"
      >
        <Check v-if="copied" :size="14" /><Copy v-else :size="14" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :disabled="!hasPrevious"
        :aria-label="t('buildsDashboard.assetDetail.previous')"
        @click="emit('step', -1)"
        ><ChevronUp :size="15"
      /></Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :disabled="!hasNext"
        :aria-label="t('buildsDashboard.assetDetail.next')"
        @click="emit('step', 1)"
        ><ChevronDown :size="15"
      /></Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="t('buildsDashboard.assetDetail.close')"
        data-testid="asset-detail-close"
        @click="emit('close')"
        ><X :size="15"
      /></Button>
    </header>

    <div
      :key="asset.id"
      class="flex aspect-video items-center justify-center overflow-hidden rounded-control bg-content-background"
    >
      <img
        v-if="asset.mediaType === 'image'"
        :src="asset.url"
        alt=""
        class="size-full object-contain"
        @load="onImageLoad"
      />
      <video
        v-else-if="asset.mediaType === 'video'"
        :src="asset.url"
        controls
        preload="metadata"
        class="size-full object-contain"
        @loadedmetadata="onMediaMetadata"
      />
      <div v-else class="flex w-full flex-col items-center gap-4 px-4 text-muted-foreground">
        <Music :size="28" />
        <audio
          :src="asset.url"
          controls
          preload="metadata"
          class="w-full"
          @loadedmetadata="onMediaMetadata"
        />
      </div>
    </div>

    <dl class="px-1">
      <div
        v-for="fact in facts"
        :key="fact.label"
        class="grid grid-cols-[--spacing(24)_minmax(0,1fr)] gap-3 border-b border-border-default py-2.5 text-ui last:border-b-0"
      >
        <dt class="text-subtle-foreground">{{ fact.label }}</dt>
        <dd :class="['break-words text-base-foreground', fact.mono && 'font-mono break-all']">
          {{ fact.value }}
        </dd>
      </div>
    </dl>

    <Button v-if="asset.revealable" class="self-start" @click="emit('reveal', asset)"
      ><FolderOpen :size="14" />{{ t('buildsDashboard.assets.reveal') }}</Button
    >
  </Card>
</template>
