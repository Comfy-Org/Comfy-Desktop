<script setup lang="ts">
import { Play, Video } from 'lucide-vue-next'
import type { AppExample } from './appExamples'

/**
 * One example, as Home and the Explore Gallery show them: the picture (a
 * video plays while the pointer is on it), what it is in the corner, and
 * on hover its name over a fade with the white action. The page handles
 * the click.
 */
const {
  x,
  ratio,
  app,
  go = 'Run app',
  picked = false
} = defineProps<{
  x: AppExample
  ratio?: string
  /** The app that made it, over its name (left out on the app's own page). */
  app?: string
  go?: string
  picked?: boolean
}>()

function play(e: MouseEvent, on: boolean): void {
  const v = (e.currentTarget as HTMLElement).querySelector('video')
  if (!v) return
  if (on && !matchMedia('(prefers-reduced-motion: reduce)').matches) void v.play().catch(() => {})
  else {
    v.pause()
    v.currentTime = 0
  }
}
</script>

<template>
  <div
    :class="['mar-ex-tile group', picked && 'is-picked']"
    @mouseenter="play($event, true)"
    @mouseleave="play($event, false)"
  >
    <span class="mar-ex-tile-media" :style="ratio && { aspectRatio: ratio }">
      <img :src="x.after" alt="" loading="lazy" />
      <video
        v-if="x.video"
        :src="x.video"
        muted
        loop
        playsinline
        preload="none"
        class="mar-ex-tile-video"
      />
      <span v-if="x.kind === 'Video'" class="mar-ex-tile-kind" aria-label="Video"
        ><Video :size="13" />{{ x.duration }}</span
      >
      <!-- A landscape photo: an outlined frame, wider than tall, with a
           filled sun and hills inside. -->
      <span v-else class="mar-ex-tile-kind is-icon" aria-label="Image"
        ><svg width="14" height="10" viewBox="0 0 24 17" aria-hidden="true">
          <rect
            x="1"
            y="1"
            width="22"
            height="15"
            rx="2.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
          />
          <circle cx="7" cy="5.75" r="1.75" fill="currentColor" />
          <path d="M1.8 15.2V13L8 7.5l3.25 3 4.25-4.75 6.7 7.4v2.05Z" fill="currentColor" /></svg
      ></span>
      <!-- What it is (and which app made it), over a fade, on hover. -->
      <span class="mar-ex-tile-text">
        <span class="min-w-0 flex-1">
          <span v-if="app" class="block truncate text-ui text-white/70">{{ app }}</span>
          <span class="block truncate text-ui font-medium text-white">{{ x.title }}</span>
        </span>
        <!-- The same white action as Home's examples. -->
        <span class="mar-ex-tile-go" aria-hidden="true"><Play :size="13" />{{ go }}</span>
      </span>
    </span>
  </div>
</template>

<style scoped>
.mar-ex-tile {
  display: block;
  margin-bottom: 14px;
  break-inside: avoid;
  cursor: pointer;
  outline: none;
}
.mar-ex-tile-media {
  position: relative;
  display: block;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--color-secondary-background);
}
.mar-ex-tile-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: scale 500ms cubic-bezier(0.19, 1, 0.22, 1);
}
.mar-ex-tile:hover .mar-ex-tile-media img {
  scale: 1.03;
}
.mar-ex-tile:focus-visible .mar-ex-tile-media {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
/* The one the panel holds, ringed as in the asset modal. */
.mar-ex-tile.is-picked .mar-ex-tile-media {
  box-shadow:
    0 0 0 2px var(--color-card-background),
    0 0 0 4px var(--color-base-foreground);
}
.mar-ex-tile-kind {
  position: absolute;
  z-index: 1;
  top: 10px;
  left: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 6px 11px;
  border-radius: 999px;
  /* Dark glass, so it reads on any picture, bright or dark. */
  background: rgb(14 14 16 / 0.5);
  backdrop-filter: blur(16px) saturate(1.6);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.mar-ex-tile-kind.is-icon {
  padding: 6px 8px;
}
.mar-ex-tile-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 250ms ease;
}
.mar-ex-tile:hover .mar-ex-tile-video {
  opacity: 1;
}
.mar-ex-tile-text {
  position: absolute;
  z-index: 1;
  inset: auto 0 0;
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 48px 14px 14px;
  background: linear-gradient(to top, rgb(0 0 0 / 0.75), rgb(0 0 0 / 0.4) 55%, transparent);
  opacity: 0;
  transition: opacity 200ms ease;
}
.mar-ex-tile:is(:hover, :focus-visible) .mar-ex-tile-text {
  opacity: 1;
}
.mar-ex-tile-go {
  display: inline-flex;
  height: 30px;
  align-items: center;
  flex: none;
  gap: 6px;
  padding: 0 13px 0 11px;
  border-radius: var(--radius-control);
  background: #fff;
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.06),
    0 8px 20px -6px rgb(0 0 0 / 0.5);
  color: #111;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
}
.mar-ex-tile-go:hover {
  background: rgb(255 255 255 / 0.9);
}
</style>
