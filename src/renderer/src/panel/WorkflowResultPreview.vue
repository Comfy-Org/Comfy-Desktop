<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useElementSize } from '@vueuse/core'
import type { CatalogWorkflowMedia } from '../types/ipc'

const {
  media,
  zoom,
  poster = null
} = defineProps<{
  media: CatalogWorkflowMedia | null
  zoom: 'fit' | number
  poster?: string | null
}>()

const emit = defineEmits<{ scale: [percent: number | null] }>()

const frame = ref<HTMLElement | null>(null)
const { width: frameWidth, height: frameHeight } = useElementSize(frame)
const natural = ref<{ width: number; height: number } | null>(null)
const broken = ref(false)

watch(
  () => media?.url,
  () => {
    natural.value =
      media?.width && media.height ? { width: media.width, height: media.height } : null
    broken.value = false
  },
  { immediate: true }
)

const fitScale = computed(() => {
  if (!natural.value || frameWidth.value === 0 || frameHeight.value === 0) return 1
  return Math.min(frameWidth.value / natural.value.width, frameHeight.value / natural.value.height)
})
const scale = computed(() => (zoom === 'fit' ? fitScale.value : zoom / 100))
const shownSize = computed(() =>
  natural.value
    ? {
        width: `${natural.value.width * scale.value}px`,
        height: `${natural.value.height * scale.value}px`
      }
    : { maxWidth: '100%', maxHeight: '100%' }
)

const showing = computed(() => Boolean(media && !broken.value && natural.value))

watch(
  [scale, showing],
  ([value, shown]) => {
    emit('scale', shown ? Math.round(value * 100) : null)
  },
  { immediate: true }
)

function measure(event: Event): void {
  const element = event.target as HTMLImageElement | HTMLVideoElement
  const width = 'naturalWidth' in element ? element.naturalWidth : element.videoWidth
  const height = 'naturalHeight' in element ? element.naturalHeight : element.videoHeight
  if (width > 0 && height > 0) natural.value = { width, height }
}
</script>

<template>
  <div
    ref="frame"
    class="relative size-full overflow-auto"
    :class="zoom === 'fit' && 'overflow-hidden'"
    data-testid="workflow-result"
  >
    <div class="flex min-h-full min-w-full items-center justify-center">
      <template v-if="media && !broken">
        <video
          v-if="media.kind === 'video'"
          :src="media.url"
          :poster="poster ?? undefined"
          class="block shrink-0 rounded-[10px] object-contain"
          :style="shownSize"
          autoplay
          muted
          loop
          playsinline
          @loadedmetadata="measure"
          @error="broken = true"
        />
        <img
          v-else
          :src="media.url"
          alt=""
          class="block shrink-0 rounded-[10px] object-contain"
          :style="shownSize"
          @load="measure"
          @error="broken = true"
        />
      </template>
      <slot v-else />
    </div>
  </div>
</template>
