<script setup lang="ts">
import { computed } from 'vue'
import { Play } from 'lucide-vue-next'
import { EXAMPLES, playLoop, runExample } from './examples'

/**
 * First-time examples · Bento: one example big (the one with a loop, so
 * the page moves when you point at it) and the rest in a two-by-two
 * beside it. Hover plays the loop or drifts the picture inside its tile;
 * no tile changes size. Picking one runs it on Comfy Cloud.
 */
const heroIndex = Math.max(
  0,
  EXAMPLES.findIndex((x) => x.video)
)
const hero = EXAMPLES[heroIndex]!
const rest = computed(() => EXAMPLES.filter((_, i) => i !== heroIndex).slice(0, 4))
</script>

<template>
  <div class="mar-bento" role="list" aria-label="Examples">
    <button
      type="button"
      role="listitem"
      class="mar-bento-tile is-hero"
      @mouseenter="playLoop($event.currentTarget as Element, true)"
      @mouseleave="playLoop($event.currentTarget as Element, false)"
      @focus="playLoop($event.currentTarget as Element, true)"
      @blur="playLoop($event.currentTarget as Element, false)"
      @click="runExample(hero)"
    >
      <img :src="hero.src" alt="" />
      <video v-if="hero.video" :src="hero.video" muted loop playsinline preload="none" />
      <span class="mar-bento-fade" />
      <span class="mar-bento-chip">{{ hero.kind }} · {{ hero.runs }}</span>
      <span class="mar-bento-text">
        <span class="text-[22px] leading-tight font-semibold tracking-[-0.01em] text-white">{{
          hero.label
        }}</span>
        <span class="mar-bento-cta"><Play :size="12" fill="currentColor" />Run it now</span>
      </span>
    </button>
    <button
      v-for="x in rest"
      :key="x.label"
      type="button"
      role="listitem"
      class="mar-bento-tile"
      @mouseenter="playLoop($event.currentTarget as Element, true)"
      @mouseleave="playLoop($event.currentTarget as Element, false)"
      @click="runExample(x)"
    >
      <img :src="x.src" alt="" loading="lazy" />
      <video v-if="x.video" :src="x.video" muted loop playsinline preload="none" />
      <span class="mar-bento-fade" />
      <span class="mar-bento-text">
        <span class="text-ui leading-snug font-medium text-white">{{ x.label }}</span>
        <span class="text-[11px] text-white/65">{{ x.kind }} · {{ x.runs }}</span>
      </span>
      <span class="mar-bento-run" aria-hidden="true"><Play :size="11" fill="currentColor" /></span>
    </button>
  </div>
</template>

<style scoped>
.mar-bento {
  --mar-bento-ease: cubic-bezier(0.16, 1, 0.3, 1);
  display: grid;
  width: 100%;
  height: 340px;
  grid-template-columns: 1.7fr 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 10px;
}
.mar-bento-tile img,
.mar-bento-tile video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition:
    transform 1200ms var(--mar-bento-ease),
    opacity 400ms ease;
}
.mar-bento-tile video {
  opacity: 0;
}
.mar-bento-fade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 45%, rgb(0 0 0 / 0.75));
}
.is-hero .mar-bento-fade {
  background:
    linear-gradient(180deg, transparent 40%, rgb(0 0 0 / 0.8)),
    radial-gradient(120% 60% at 0% 100%, rgb(0 0 0 / 0.35), transparent);
}
.mar-bento-text {
  position: absolute;
  right: 14px;
  bottom: 13px;
  left: 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
}
.is-hero .mar-bento-text {
  right: 22px;
  bottom: 22px;
  left: 22px;
  gap: 12px;
}
.mar-bento-chip {
  position: absolute;
  top: 16px;
  left: 16px;
  border-radius: 999px;
  padding: 4px 10px;
  background: var(--color-media-overlay);
  backdrop-filter: blur(12px);
  color: rgb(255 255 255 / 0.92);
  font-size: 12px;
}
.mar-bento-cta {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 0 14px;
  background: #fff;
  color: #111;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.25);
}
.mar-bento-run {
  position: absolute;
  top: 10px;
  right: 10px;
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #fff;
  color: #111;
  opacity: 0;
  transform: scale(0.85);
  transition:
    opacity 200ms ease,
    transform 300ms var(--mar-bento-ease);
}
/* Hover: the picture drifts inside its tile and a loop takes over;
   the tile itself never changes size. */
.mar-bento-tile:hover img,
.mar-bento-tile:focus-visible img {
  transform: scale(1.06);
}
.mar-bento-tile:hover video,
.mar-bento-tile:focus-visible video {
  opacity: 1;
}
.mar-bento-tile:hover .mar-bento-run,
.mar-bento-tile:focus-visible .mar-bento-run {
  opacity: 1;
  transform: none;
}
@media (prefers-reduced-motion: reduce) {
  .mar-bento-tile img,
  .mar-bento-tile video,
  .mar-bento-run {
    transition: none;
  }
  .mar-bento-tile:hover img,
  .mar-bento-tile:focus-visible img {
    transform: none;
  }
}
</style>

<style>
/* Global: these are buttons, past the prototype's button reset. */
:root .proto-ui.proto-ui.proto-ui .mar-bento-tile {
  position: relative;
  width: auto;
  height: auto;
  min-height: 0;
  overflow: hidden;
  padding: 0;
  border-radius: 18px;
  background: var(--color-card-background);
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .mar-bento-tile.is-hero {
  grid-row: span 2;
  border-radius: 22px;
}
:root .proto-ui.proto-ui.proto-ui .mar-bento-tile:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
</style>
