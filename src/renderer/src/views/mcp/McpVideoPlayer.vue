<script setup lang="ts">
import { onMounted, ref, useTemplateRef, watch } from 'vue'
import { Pause, Play, Volume2, VolumeX } from 'lucide-vue-next'

const { src = '', ariaLabel = '' } = defineProps<{
  src?: string
  ariaLabel?: string
}>()

const videoEl = useTemplateRef<HTMLVideoElement>('videoEl')
const playing = ref(false)
const muted = ref(true)

function kickAutoplay(): void {
  const el = videoEl.value
  if (!el) return
  el.muted = true
  muted.value = true
  el.play().then(
    () => {
      playing.value = true
    },
    () => {
      playing.value = false
    }
  )
}

onMounted(kickAutoplay)
watch(() => src, kickAutoplay)

function togglePlay(): void {
  const el = videoEl.value
  if (!el) return
  if (el.paused) {
    el.play().then(
      () => (playing.value = true),
      () => {}
    )
  } else {
    el.pause()
    playing.value = false
  }
}

function toggleMute(): void {
  const el = videoEl.value
  if (!el) return
  el.muted = !el.muted
  muted.value = el.muted
}
</script>

<template>
  <div class="mcp-player" :class="{ 'is-idle': playing }">
    <video
      v-if="src"
      ref="videoEl"
      class="mcp-player__video"
      :aria-label="ariaLabel"
      :src="src"
      preload="auto"
      autoplay
      muted
      loop
      playsinline
      @playing="playing = true"
      @pause="playing = false"
      @volumechange="muted = ($event.target as HTMLVideoElement).muted"
      @click="togglePlay"
    />
    <div v-else class="mcp-player__placeholder">
      <span>How-to video coming soon</span>
    </div>

    <div v-if="src" class="mcp-player__controls">
      <button
        type="button"
        class="mcp-player__icon-btn"
        :aria-label="playing ? 'Pause' : 'Play'"
        @click="togglePlay"
      >
        <Pause v-if="playing" :size="18" fill="currentColor" />
        <Play v-else :size="18" fill="currentColor" />
      </button>

      <button
        type="button"
        class="mcp-player__icon-btn"
        :aria-label="muted ? 'Unmute' : 'Mute'"
        @click="toggleMute"
      >
        <VolumeX v-if="muted" :size="18" />
        <Volume2 v-else :size="18" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.mcp-player {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 3px;
  background: var(--neutral-800);
}
.mcp-player__video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 13px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-sizing: border-box;
  cursor: pointer;
}
.mcp-player__placeholder {
  position: absolute;
  inset: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 13px;
  color: color-mix(in oklab, var(--neutral-100) 55%, transparent);
  font-size: 13px;
  background: linear-gradient(135deg, var(--neutral-900), var(--neutral-800));
}
.mcp-player__controls {
  position: absolute;
  right: 16px;
  bottom: 16px;
  display: flex;
  gap: 8px;
  transition: opacity 200ms ease;
}
.mcp-player.is-idle .mcp-player__controls {
  opacity: 0;
}
.mcp-player.is-idle:hover .mcp-player__controls {
  opacity: 1;
}
.mcp-player__icon-btn {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: 0;
  border-radius: 9999px;
  cursor: pointer;
  background: rgba(10, 8, 12, 0.5);
  backdrop-filter: blur(6px);
  color: #fff;
  transition: background 140ms ease;
}
.mcp-player__icon-btn:hover {
  background: rgba(10, 8, 12, 0.72);
}
.mcp-player__icon-btn svg {
  flex: none;
  display: block;
}
</style>
