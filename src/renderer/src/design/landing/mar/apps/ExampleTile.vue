<script setup lang="ts">
import { Play, Video } from 'lucide-vue-next'
import type { AppExample } from './appExamples'
import ImageGlyph from './ImageGlyph.vue'

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
  go = 'Run',
  picked = false,
  badge = true,
  titled = false
} = defineProps<{
  x: AppExample
  ratio?: string
  /** The app that made it, over its name (left out on the app's own page). */
  app?: string
  go?: string
  picked?: boolean
  /** What it is (Image, or a video's length) in the corner; off where
   *  every one is the same kind. */
  badge?: boolean
  /** Its name always shown, the action only on hover (the app's page). */
  titled?: boolean
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
    :class="['mar-ex-tile group', picked && 'is-picked', titled && 'is-titled']"
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
      <span v-if="badge && x.kind === 'Video'" class="mar-ex-tile-kind" aria-label="Video"
        ><Video :size="12" />{{ x.duration }}</span
      >
      <!-- A landscape photo: an outlined frame, wider than tall, with a
           filled sun and hills inside. -->
      <span v-else-if="badge" class="mar-ex-tile-kind is-icon" aria-label="Image"
        ><ImageGlyph :size="11"
      /></span>
      <!-- What it is (and which app made it), over a fade, on hover. -->
      <span class="mar-ex-tile-text">
        <span class="min-w-0 flex-1">
          <span v-if="app" class="block truncate text-ui text-white/70">{{ app }}</span>
          <span class="block truncate text-ui font-medium text-white">{{ x.title }}</span>
        </span>
        <!-- The same white action as Home's examples. -->
        <span class="mar-ex-tile-go" aria-hidden="true"
          ><Play v-if="!titled" :size="13" />{{ go }}</span
        >
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
  top: 8px;
  left: 8px;
  display: inline-flex;
  height: 22px;
  align-items: center;
  gap: 5px;
  padding: 0 8px 0 7px;
  border-radius: 999px;
  /* Dark glass, so it reads on any picture, bright or dark. */
  background: rgb(14 14 16 / 0.5);
  backdrop-filter: blur(16px) saturate(1.6);
  color: #fff;
  font-size: 11.5px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
/* Slim, like a caption: the picture leads. */
.mar-ex-tile-kind.is-icon {
  width: 22px;
  justify-content: center;
  padding: 0;
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
/* Titled: the name always over the fade, the action only on hover. */
.mar-ex-tile.is-titled .mar-ex-tile-text {
  align-items: center;
  padding-top: 40px;
  opacity: 1;
}
.mar-ex-tile.is-titled .mar-ex-tile-go {
  padding: 0 14px;
  opacity: 0;
  transition: opacity 160ms ease;
}
.mar-ex-tile.is-titled:is(:hover, :focus-visible) .mar-ex-tile-go {
  opacity: 1;
}
</style>
