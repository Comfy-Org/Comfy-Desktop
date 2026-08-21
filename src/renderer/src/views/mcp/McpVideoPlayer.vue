<script setup lang="ts">
import { onMounted, ref, useTemplateRef, watch } from 'vue'

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
    el.play().then(() => (playing.value = true), () => {})
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
        <svg v-if="playing" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>

      <button
        type="button"
        class="mcp-player__icon-btn"
        :aria-label="muted ? 'Unmute' : 'Mute'"
        @click="toggleMute"
      >
        <svg
          v-if="muted"
          viewBox="0 0 24 24"
          fill="currentColor"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <path d="M11 5L6 9H2v6h4l5 4V5z" stroke-linecap="round" stroke-linejoin="round" />
          <line x1="23" y1="9" x2="17" y2="15" stroke-width="2.5" />
          <line x1="17" y1="9" x2="23" y2="15" stroke-width="2.5" />
        </svg>
        <svg
          v-else
          viewBox="0 0 24 24"
          fill="currentColor"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <path d="M11 5L6 9H2v6h4l5 4V5z" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" fill="none" stroke-width="2" stroke-linecap="round" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" fill="none" stroke-width="2" stroke-linecap="round" />
        </svg>
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
  opacity: 1;
  transition: opacity 200ms ease;
}
.mcp-player:hover .mcp-player__controls {
  opacity: 1;
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
  width: 18px;
  height: 18px;
  display: block;
  color: #fff;
}
</style>
