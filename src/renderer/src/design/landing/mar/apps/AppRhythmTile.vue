<script setup lang="ts">
import { ArrowUpRight } from 'lucide-vue-next'

/**
 * One app in the Apps gallery's Rhythm layout (Firefly's Quick actions):
 * a square picture with the app's name on it, bottom left. On hover the
 * picture grows a little inside its frame and turns into what the app
 * made (a video plays), the name rises and its one line fades in under
 * it, and Home's corner arrow fades in at the top right. Opacity and
 * transform only.
 */
const {
  name,
  blurb,
  thumb,
  preview,
  video,
  big = false
} = defineProps<{
  name: string
  blurb: string
  thumb: string
  /** What the app made: shown on hover over the thumbnail. */
  preview?: string
  video?: string
  big?: boolean
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
    :class="['mar-rt', big && 'is-big']"
    @mouseenter="play($event, true)"
    @mouseleave="play($event, false)"
  >
    <span class="mar-rt-pic">
      <img :src="thumb" alt="" loading="lazy" />
      <img v-if="preview" class="mar-rt-after" :src="preview" alt="" loading="lazy" />
      <video
        v-if="video"
        class="mar-rt-after"
        :src="video"
        muted
        loop
        playsinline
        preload="none"
      />
    </span>
    <span class="mar-rt-go" aria-hidden="true"
      ><ArrowUpRight :size="16" :stroke-width="2.25"
    /></span>
    <span class="mar-rt-text">
      <span class="mar-rt-name">{{ name }}</span>
      <span class="mar-rt-blurb">{{ blurb }}</span>
    </span>
  </div>
</template>

<style scoped>
.mar-rt {
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  display: block;
  overflow: hidden;
  aspect-ratio: 1;
  border-radius: var(--radius-card);
  background: var(--color-secondary-background);
  color: #fff;
  cursor: pointer;
  outline: none;
}
.mar-rt::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgb(0 0 0 / 0.66), transparent 46%);
  content: '';
  pointer-events: none;
}
.mar-rt:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
.mar-rt-pic {
  position: absolute;
  inset: 0;
  transition: transform 600ms var(--ease);
}
.mar-rt-pic > * {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mar-rt-after {
  opacity: 0;
  transition: opacity 450ms var(--ease);
}
.mar-rt:is(:hover, :focus-visible) .mar-rt-pic {
  transform: scale(1.04);
}
.mar-rt:is(:hover, :focus-visible) .mar-rt-after {
  opacity: 1;
}
/* Home's corner arrow (the workflow carousel's front card). */
.mar-rt-go {
  position: absolute;
  z-index: 1;
  top: 12px;
  right: 12px;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 9px;
  background: rgb(255 255 255 / 0.2);
  backdrop-filter: blur(14px) saturate(1.5);
  color: #fff;
  opacity: 0;
  transform: scale(0.9);
  transition:
    opacity 300ms var(--ease),
    transform 300ms var(--ease);
}
.mar-rt:is(:hover, :focus-visible) .mar-rt-go {
  opacity: 1;
  transform: none;
  transition-delay: 100ms;
}
.mar-rt-text {
  position: absolute;
  z-index: 1;
  right: 14px;
  bottom: 12px;
  left: 14px;
  display: grid;
}
.mar-rt.is-big .mar-rt-text {
  right: 16px;
  bottom: 14px;
  left: 16px;
}
.mar-rt-name,
.mar-rt-blurb {
  grid-area: 1 / 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition:
    opacity 300ms var(--ease),
    transform 300ms var(--ease);
}
.mar-rt-name {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
}
.mar-rt.is-big .mar-rt-name {
  font-size: 15px;
}
.mar-rt-blurb {
  align-self: end;
  color: rgb(255 255 255 / 0.78);
  font-size: 11.5px;
  opacity: 0;
  transform: translateY(6px);
}
.mar-rt:is(:hover, :focus-visible) .mar-rt-name {
  transform: translateY(-17px);
}
.mar-rt:is(:hover, :focus-visible) .mar-rt-blurb {
  opacity: 1;
  transform: none;
}
@media (prefers-reduced-motion: reduce) {
  .mar-rt-pic,
  .mar-rt-go,
  .mar-rt-after,
  .mar-rt-name,
  .mar-rt-blurb {
    transition-duration: 0.01ms;
  }
}
</style>
