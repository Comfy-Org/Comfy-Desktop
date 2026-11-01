<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { ChevronLeft, ChevronRight, Play } from 'lucide-vue-next'
import { EXAMPLES, playLoop, runExample } from './examples'

/**
 * First-time examples · Coverflow: the examples on a 3D carousel. The one
 * in front faces you with Run; the rest turn away into depth. Arrows,
 * the arrow keys, a drag or a click on a side card brings one to the
 * front, snapping to it; clicking the front one runs it on Comfy Cloud.
 */
const STEP = 190 // px between the front card and its neighbours
const FAR = 110 // px between cards further out
const active = ref(Math.floor(EXAMPLES.length / 2))
const drag = ref(0)
const dragging = ref(false)
const cards = ref<HTMLElement[]>([])
let startX = 0
let moved = false

function pose(i: number): Record<string, string> {
  const d = i - active.value + drag.value / STEP
  const a = Math.abs(d)
  const s = Math.sign(d)
  const x = s * (Math.min(a, 1) * STEP + Math.max(a - 1, 0) * FAR)
  const z = -Math.min(a, 1) * 150 - Math.max(a - 1, 0) * 70
  const rot = -Math.max(-1, Math.min(1, d)) * 42
  return {
    transform: `translateX(${x}px) translateZ(${z}px) rotateY(${rot}deg)`,
    zIndex: String(100 - Math.round(a * 10)),
    opacity: a > 2.6 ? '0' : '1',
    '--shade': String(Math.min(a * 0.32, 0.64))
  }
}

async function go(i: number, focus = false): Promise<void> {
  active.value = Math.max(0, Math.min(EXAMPLES.length - 1, i))
  if (focus) {
    await nextTick()
    cards.value[active.value]?.focus()
  }
}
function pick(i: number): void {
  if (moved) return
  if (i === active.value) runExample(EXAMPLES[i]!)
  else void go(i)
}
function key(e: KeyboardEvent): void {
  if (e.key === 'ArrowLeft') void go(active.value - 1, true)
  else if (e.key === 'ArrowRight') void go(active.value + 1, true)
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
  if (moved) void go(Math.round(active.value - drag.value / STEP))
  drag.value = 0
  // Let the click that ends a drag pass without picking.
  setTimeout(() => (moved = false))
}
</script>

<template>
  <div
    class="mar-flow"
    role="region"
    aria-roledescription="carousel"
    aria-label="Examples"
    @keydown="key"
  >
    <div
      class="mar-flow-stage"
      :class="dragging && moved && 'is-dragging'"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
    >
      <button
        v-for="(x, i) in EXAMPLES"
        :key="x.label"
        ref="cards"
        type="button"
        class="mar-flow-card"
        :class="i === active && 'is-front'"
        :style="pose(i)"
        :tabindex="i === active ? 0 : -1"
        :aria-current="i === active ? 'true' : undefined"
        :aria-label="i === active ? `Run ${x.label}, ${x.kind}, ${x.runs}` : x.label"
        @mouseenter="i === active && playLoop($event.currentTarget as Element, true)"
        @mouseleave="playLoop($event.currentTarget as Element, false)"
        @click="pick(i)"
      >
        <img :src="x.src" alt="" draggable="false" />
        <video v-if="x.video" :src="x.video" muted loop playsinline preload="none" />
        <span class="mar-flow-fade" />
        <span class="mar-flow-text">
          <span class="text-[15px] leading-snug font-medium text-white">{{ x.label }}</span>
          <span class="text-[12px] text-white/65">{{ x.kind }} · {{ x.runs }}</span>
        </span>
        <span class="mar-flow-run"><Play :size="11" fill="currentColor" />Run</span>
        <span class="mar-flow-shade" />
      </button>
    </div>

    <div class="mt-3 flex items-center justify-center gap-3">
      <button
        type="button"
        class="mar-flow-arrow"
        aria-label="Previous example"
        :disabled="active === 0"
        @click="go(active - 1)"
      >
        <ChevronLeft :size="16" />
      </button>
      <div class="flex items-center gap-1.5" aria-hidden="true">
        <span
          v-for="(x, i) in EXAMPLES"
          :key="x.label"
          class="mar-flow-dot"
          :class="i === active && 'is-on'"
        />
      </div>
      <button
        type="button"
        class="mar-flow-arrow"
        aria-label="Next example"
        :disabled="active === EXAMPLES.length - 1"
        @click="go(active + 1)"
      >
        <ChevronRight :size="16" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.mar-flow {
  --mar-flow-ease: cubic-bezier(0.19, 1, 0.22, 1);
}
.mar-flow-stage {
  position: relative;
  height: 300px;
  overflow-x: clip;
  perspective: 1100px;
  touch-action: pan-y;
  user-select: none;
  cursor: grab;
}
.mar-flow-stage.is-dragging {
  cursor: grabbing;
}
.mar-flow-card {
  transition:
    transform 650ms var(--mar-flow-ease),
    opacity 400ms ease;
}
.is-dragging .mar-flow-card {
  transition: none;
}
.mar-flow-card img,
.mar-flow-card video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}
.mar-flow-card video {
  opacity: 0;
  transition: opacity 300ms ease;
}
.mar-flow-card.is-front:hover video,
.mar-flow-card.is-front:focus-visible video {
  opacity: 1;
}
.mar-flow-fade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 50%, rgb(0 0 0 / 0.78));
}
.mar-flow-shade {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / var(--shade, 0));
  pointer-events: none;
  transition: background-color 400ms ease;
}
.mar-flow-text {
  position: absolute;
  right: 16px;
  bottom: 16px;
  left: 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}
.mar-flow-run {
  position: absolute;
  top: 12px;
  right: 12px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: var(--radius-control);
  padding: 5px 11px;
  background: #fff;
  color: #111;
  font-size: 12px;
  font-weight: 600;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.2);
  opacity: 0;
  transform: translateY(-4px);
  transition:
    opacity 250ms ease,
    transform 350ms var(--mar-flow-ease);
}
.mar-flow-card.is-front .mar-flow-run {
  opacity: 1;
  transform: none;
}
.mar-flow-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 22%, transparent);
  transition:
    width 300ms var(--mar-flow-ease),
    background-color 200ms ease;
}
.mar-flow-dot.is-on {
  width: 18px;
  background: var(--color-base-foreground);
}
@media (prefers-reduced-motion: reduce) {
  .mar-flow-card,
  .mar-flow-card video,
  .mar-flow-shade,
  .mar-flow-run,
  .mar-flow-dot {
    transition: none;
  }
}
</style>

<style>
/* Global: these are buttons, past the prototype's button reset. */
:root .proto-ui.proto-ui.proto-ui .mar-flow-card {
  position: absolute;
  top: 14px;
  left: 50%;
  width: 216px;
  height: 270px;
  margin-left: -108px;
  overflow: hidden;
  padding: 0;
  border: 1px solid rgb(255 255 255 / 0.1);
  border-radius: 20px;
  background: var(--color-card-background);
  box-shadow: 0 26px 50px -24px rgb(0 0 0 / 0.75);
  outline: none;
  cursor: inherit;
}
:root[data-ds-theme='light'] .proto-ui.proto-ui.proto-ui .mar-flow-card {
  border-color: rgb(0 0 0 / 0.06);
  box-shadow: 0 24px 44px -24px rgb(0 0 0 / 0.4);
}
:root .proto-ui.proto-ui.proto-ui .mar-flow-card.is-front {
  cursor: pointer;
}
:root .proto-ui.proto-ui.proto-ui .mar-flow-card:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-border-focus),
    0 26px 50px -24px rgb(0 0 0 / 0.75);
}
:root .proto-ui.proto-ui.proto-ui .mar-flow-arrow {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
  outline: none;
  transition:
    background-color 160ms ease,
    opacity 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-flow-arrow:hover:not(:disabled) {
  background: color-mix(in oklch, var(--color-base-foreground) 13%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-flow-arrow:disabled {
  opacity: 0.35;
}
:root .proto-ui.proto-ui.proto-ui .mar-flow-arrow:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
</style>
