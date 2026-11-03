<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeft, ArrowRight, Cloud, Play } from 'lucide-vue-next'
import { EXAMPLES, playLoop, reducedMotion, runExample } from './examples'

/**
 * First-time examples · Deck: the examples as a stack, one on top and the
 * next ones peeking behind, with what the top one does beside it. Flick
 * the top card away (drag), use the arrows or the arrow keys to see the
 * next; Run, or a click on the top card, runs it on Comfy Cloud.
 */
const N = EXAMPLES.length
const active = ref(0)
const drag = ref(0)
const dragging = ref(false)
const leaving = ref<{ i: number; dir: number } | null>(null)
const top = computed(() => EXAMPLES[active.value]!)
let startX = 0
let moved = false
let timer: ReturnType<typeof setTimeout> | undefined

function pose(i: number): Record<string, string> {
  if (leaving.value?.i === i) {
    const dir = leaving.value.dir
    return {
      transform: `translate(${dir * 360}px, 24px) rotate(${dir * 16}deg)`,
      opacity: '0',
      zIndex: String(N + 1)
    }
  }
  const k = (i - active.value + N) % N
  if (k === 0 && drag.value) {
    return {
      transform: `translateX(${drag.value}px) rotate(${drag.value / 18}deg)`,
      zIndex: String(N)
    }
  }
  return {
    transform: `translateX(${k * 30}px) scale(${1 - k * 0.06}) rotate(${k * 4}deg)`,
    opacity: k > 2 ? '0' : '1',
    zIndex: String(N - k)
  }
}

/** Show the next (+1) or previous (-1) example; the top card is flicked
 *  out toward `dir` when moving on. */
function step(by: number, dir = -1): void {
  clearTimeout(timer)
  if (by > 0 && !reducedMotion()) {
    leaving.value = { i: active.value, dir }
    timer = setTimeout(() => (leaving.value = null), 380)
  } else leaving.value = null
  active.value = (active.value + by + N) % N
}
function key(e: KeyboardEvent): void {
  if (e.key === 'ArrowRight') step(1)
  else if (e.key === 'ArrowLeft') step(-1)
  else return
  e.preventDefault()
}

function down(e: PointerEvent): void {
  if (e.button !== 0) return
  startX = e.clientX
  moved = false
  dragging.value = true
}
function move(e: PointerEvent): void {
  if (!dragging.value) return
  const dx = e.clientX - startX
  if (!moved && Math.abs(dx) > 6) {
    moved = true
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  if (moved) drag.value = dx
}
function up(): void {
  if (!dragging.value) return
  dragging.value = false
  const dx = drag.value
  drag.value = 0
  if (Math.abs(dx) > 90) step(1, Math.sign(dx))
  setTimeout(() => (moved = false))
}
function pick(i: number): void {
  if (moved || i !== active.value) return
  runExample(EXAMPLES[i]!)
}
</script>

<template>
  <div
    class="mar-deck"
    role="region"
    aria-roledescription="carousel"
    aria-label="Examples"
    @keydown="key"
  >
    <div
      class="mar-deck-stack"
      :class="dragging && moved && 'is-dragging'"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
    >
      <button
        v-for="(x, i) in EXAMPLES"
        :key="x.label"
        type="button"
        class="mar-deck-card"
        :class="i === active && 'is-top'"
        :style="pose(i)"
        :tabindex="i === active ? 0 : -1"
        :aria-hidden="i === active ? undefined : 'true'"
        :aria-label="`Run ${x.label}, ${x.kind}, ${x.runs}`"
        @mouseenter="i === active && playLoop($event.currentTarget as Element, true)"
        @mouseleave="playLoop($event.currentTarget as Element, false)"
        @click="pick(i)"
      >
        <img :src="x.src" alt="" draggable="false" />
        <video v-if="x.video" :src="x.video" muted loop playsinline preload="none" />
        <span class="mar-deck-chip">{{ x.kind }}</span>
      </button>
    </div>

    <div class="flex w-68 flex-col items-start" aria-live="polite">
      <span class="text-ui text-subtle-foreground tabular-nums"
        >{{ active + 1 }} of {{ EXAMPLES.length }}</span
      >
      <Transition name="mar-deck-swap" mode="out-in">
        <div :key="top.label" class="mt-2 flex flex-col gap-1.5">
          <span
            class="text-[24px] leading-tight font-semibold tracking-[-0.01em] text-base-foreground"
            >{{ top.label }}</span
          >
          <span class="flex items-center gap-1.5 text-ui text-muted-foreground">
            {{ top.kind }} · {{ top.runs }} · <Cloud :size="13" /> Comfy Cloud
          </span>
        </div>
      </Transition>
      <div class="mt-5 flex items-center gap-2">
        <button type="button" class="mar-deck-runbtn" @click="runExample(top)">
          <Play :size="12" fill="currentColor" />Run it
        </button>
        <button
          type="button"
          class="mar-deck-arrow"
          aria-label="Previous example"
          @click="step(-1)"
        >
          <ArrowLeft :size="15" />
        </button>
        <button type="button" class="mar-deck-arrow" aria-label="Next example" @click="step(1)">
          <ArrowRight :size="15" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mar-deck {
  --mar-deck-ease: cubic-bezier(0.19, 1, 0.22, 1);
  display: flex;
  height: 320px;
  align-items: center;
  justify-content: center;
  gap: 56px;
}
.mar-deck-stack {
  position: relative;
  width: 280px;
  height: 300px;
  touch-action: pan-y;
  user-select: none;
}
.mar-deck-card {
  transition:
    transform 550ms var(--mar-deck-ease),
    opacity 350ms ease;
}
.is-dragging .mar-deck-card.is-top {
  transition: none;
}
.mar-deck-card img,
.mar-deck-card video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}
.mar-deck-card video {
  opacity: 0;
  transition: opacity 300ms ease;
}
.mar-deck-card.is-top:hover video,
.mar-deck-card.is-top:focus-visible video {
  opacity: 1;
}
.mar-deck-chip {
  position: absolute;
  top: 12px;
  left: 12px;
  border-radius: 999px;
  padding: 3px 9px;
  background: var(--color-media-overlay);
  backdrop-filter: blur(12px);
  color: rgb(255 255 255 / 0.92);
  font-size: 11px;
}
.mar-deck-swap-enter-active,
.mar-deck-swap-leave-active {
  transition:
    opacity 180ms ease,
    transform 260ms var(--mar-deck-ease);
}
.mar-deck-swap-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.mar-deck-swap-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
@media (prefers-reduced-motion: reduce) {
  .mar-deck-card,
  .mar-deck-card video,
  .mar-deck-swap-enter-active,
  .mar-deck-swap-leave-active {
    transition: none;
  }
}
</style>

<style>
/* Global: these are buttons, past the prototype's button reset. */
:root .proto-ui.proto-ui.proto-ui .mar-deck-card {
  position: absolute;
  top: 10px;
  left: 0;
  width: 220px;
  height: 280px;
  overflow: hidden;
  padding: 0;
  border: 1px solid rgb(255 255 255 / 0.1);
  border-radius: 22px;
  background: var(--color-card-background);
  box-shadow: 0 24px 48px -22px rgb(0 0 0 / 0.75);
  transform-origin: 50% 100%;
  outline: none;
  cursor: grab;
}
:root[data-ds-theme='light'] .proto-ui.proto-ui.proto-ui .mar-deck-card {
  border-color: rgb(0 0 0 / 0.06);
  box-shadow: 0 22px 40px -22px rgb(0 0 0 / 0.4);
}
:root .proto-ui.proto-ui.proto-ui .mar-deck-card:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-border-focus),
    0 24px 48px -22px rgb(0 0 0 / 0.75);
}
:root .proto-ui.proto-ui.proto-ui .mar-deck-runbtn {
  display: inline-flex;
  width: auto;
  height: 34px;
  align-items: center;
  gap: 6px;
  padding: 0 16px;
  border-radius: var(--radius-control);
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: 13px;
  font-weight: 600;
  outline: none;
  transition: opacity 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-deck-runbtn:hover {
  opacity: 0.88;
}
:root .proto-ui.proto-ui.proto-ui .mar-deck-arrow {
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
  outline: none;
  transition: background-color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-deck-arrow:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 13%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-deck-runbtn:focus-visible,
:root .proto-ui.proto-ui.proto-ui .mar-deck-arrow:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
</style>
