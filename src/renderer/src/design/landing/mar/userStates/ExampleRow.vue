<script setup lang="ts">
import { Play } from 'lucide-vue-next'
import { EXAMPLES, playLoop, runExample } from './examples'

/**
 * First-time examples · Row: big square pictures side by side, the type
 * on a chip and the name over the picture (First run · Original as it
 * was). Hover zooms the picture inside its card and shows Run.
 */
</script>

<template>
  <div class="mar-xrow" role="list" aria-label="Examples">
    <button
      v-for="x in EXAMPLES"
      :key="x.label"
      type="button"
      role="listitem"
      class="mar-xrow-card"
      @mouseenter="playLoop($event.currentTarget as Element, true)"
      @mouseleave="playLoop($event.currentTarget as Element, false)"
      @focus="playLoop($event.currentTarget as Element, true)"
      @blur="playLoop($event.currentTarget as Element, false)"
      @click="runExample(x)"
    >
      <img :src="x.src" alt="" loading="lazy" />
      <video v-if="x.video" :src="x.video" muted loop playsinline preload="none" />
      <span class="mar-xrow-chip">{{ x.kind }}</span>
      <span class="mar-xrow-label">
        <span>{{ x.label }}</span>
        <span class="mar-xrow-runs">{{ x.runs }}</span>
      </span>
      <span class="mar-xrow-run"><Play :size="12" fill="currentColor" />Run</span>
    </button>
  </div>
</template>

<style scoped>
.mar-xrow {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}
.mar-xrow-card img,
.mar-xrow-card video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition:
    transform 600ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 300ms ease;
}
.mar-xrow-card video {
  opacity: 0;
}
.mar-xrow-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgb(0 0 0 / 0.72), transparent 55%);
}
.mar-xrow-chip {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1;
  border-radius: 999px;
  padding: 3px 8px;
  background: var(--color-media-overlay);
  backdrop-filter: blur(12px);
  color: rgb(255 255 255 / 0.92);
  font-size: 11px;
}
.mar-xrow-label {
  position: absolute;
  right: 14px;
  bottom: 14px;
  left: 14px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.3;
  text-align: left;
  transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-xrow-runs {
  color: rgb(255 255 255 / 0.65);
  font-size: 12px;
  font-weight: 400;
}
.mar-xrow-run {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 999px;
  padding: 5px 10px;
  background: #fff;
  color: #111;
  font-size: 12px;
  font-weight: 600;
  opacity: 0;
  transform: translateY(4px);
  transition:
    opacity 200ms ease,
    transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-xrow-card:hover img,
.mar-xrow-card:focus-visible img {
  transform: scale(1.04);
}
.mar-xrow-card:hover video,
.mar-xrow-card:focus-visible video {
  opacity: 1;
}
.mar-xrow-card:hover .mar-xrow-run,
.mar-xrow-card:focus-visible .mar-xrow-run {
  opacity: 1;
  transform: none;
}
.mar-xrow-card:hover .mar-xrow-label,
.mar-xrow-card:focus-visible .mar-xrow-label {
  transform: translateY(-30px);
}
@media (prefers-reduced-motion: reduce) {
  .mar-xrow-card img,
  .mar-xrow-card video,
  .mar-xrow-label,
  .mar-xrow-run {
    transition: none;
  }
  .mar-xrow-card:hover img,
  .mar-xrow-card:focus-visible img {
    transform: none;
  }
}
</style>

<style>
/* Global: these are buttons, past the prototype's button reset. */
:root .proto-ui.proto-ui.proto-ui .mar-xrow-card {
  position: relative;
  width: auto;
  overflow: hidden;
  padding: 0;
  border-radius: 18px;
  aspect-ratio: 1;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .mar-xrow-card:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
</style>
