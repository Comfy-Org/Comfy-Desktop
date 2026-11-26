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
const loaded = ref(false)

watch(
  () => media?.url,
  () => {
    natural.value =
      media?.width && media.height ? { width: media.width, height: media.height } : null
    broken.value = false
    loaded.value = false
  },
  { immediate: true }
)

const fitScale = computed(() => {
  if (!natural.value || frameWidth.value === 0 || frameHeight.value === 0) return 1
  return Math.min(frameWidth.value / natural.value.width, frameHeight.value / natural.value.height)
})
const scale = computed(() => (zoom === 'fit' ? fitScale.value : zoom / 100))
const placeholderSide = computed(() => Math.min(frameWidth.value, frameHeight.value))
const boxSize = computed(() => {
  if (natural.value) {
    return {
      width: `${natural.value.width * scale.value}px`,
      height: `${natural.value.height * scale.value}px`
    }
  }
  if (poster && placeholderSide.value > 0) {
    return { width: `${placeholderSide.value}px`, height: `${placeholderSide.value}px` }
  }
  return { maxWidth: '100%', maxHeight: '100%' }
})

const showing = computed(() => Boolean(media && !broken.value && natural.value))

watch(
  [scale, showing],
  ([value, shown]) => {
    emit('scale', shown ? Math.round(value * 100) : null)
  },
  { immediate: true }
)

function arrive(event: Event): void {
  measure(event)
  loaded.value = true
}

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
    <div class="flex min-h-full min-w-full">
      <div
        v-if="media && !broken"
        class="relative m-auto shrink-0 overflow-hidden rounded-[10px]"
        :style="boxSize"
      >
        <img
          v-if="poster && !loaded"
          :src="poster"
          alt=""
          class="absolute inset-0 size-full object-cover"
          data-testid="workflow-result-placeholder"
        />
        <video
          v-if="media.kind === 'video'"
          :src="media.url"
          :poster="poster ?? undefined"
          class="relative block size-full object-contain transition-opacity duration-300 motion-reduce:transition-none"
          :class="loaded ? 'opacity-100' : 'opacity-0'"
          autoplay
          muted
          loop
          playsinline
          @loadedmetadata="measure"
          @loadeddata="arrive"
          @error="broken = true"
        />
        <img
          v-else
          :src="media.url"
          alt=""
          class="relative block size-full object-contain transition-opacity duration-300 motion-reduce:transition-none"
          :class="loaded ? 'opacity-100' : 'opacity-0'"
          data-testid="workflow-result-media"
          @load="arrive"
          @error="broken = true"
        />
      </div>
      <img
        v-else-if="poster"
        :src="poster"
        alt=""
        class="m-auto block max-w-full rounded-[10px] object-contain"
        :style="{ maxHeight: `${frameHeight}px` }"
        data-testid="workflow-result-placeholder"
      />
      <div v-else class="m-auto"><slot /></div>
    </div>
  </div>
</template>
