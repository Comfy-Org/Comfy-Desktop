<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { reducedMotion } from '../userStates/examples'

const {
  src,
  clip,
  playing = false
} = defineProps<{
  src?: string
  clip?: string
  playing?: boolean
}>()

const video = ref<HTMLVideoElement>()

function sync(): void {
  const v = video.value
  if (!v) return
  if (playing && !reducedMotion()) void v.play().catch(() => {})
  else if (src) {
    v.pause()
    v.currentTime = 0
  } else v.pause()
}
watch(() => playing, sync)
onMounted(sync)
</script>

<template>
  <span class="hv-media">
    <img v-if="src" :src="src" alt="" draggable="false" loading="lazy" />
    <video
      v-if="clip"
      ref="video"
      :src="clip"
      :class="src && !playing && 'is-hidden'"
      muted
      loop
      playsinline
      :preload="src ? 'none' : 'auto'"
      draggable="false"
    />
  </span>
</template>
