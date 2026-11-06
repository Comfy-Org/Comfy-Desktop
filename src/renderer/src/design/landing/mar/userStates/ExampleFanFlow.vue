<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { ArrowRight } from 'lucide-vue-next'
import { go as goTo } from '../../useProto'
import { can } from '../../milestones'
import { EXAMPLES, playLoop, runExample } from './examples'

/**
 * First-time examples · Fan × Coverflow: the coverflow's covers, each
 * carrying its own name, type and run time at the top. The covers turn
 * into depth like Coverflow; arrow keys, a click on a side cover, a drag
 * or a sideways scroll bring one to the front. Pointing at a cover (or
 * focusing it) shows its Run button at the bottom; Enter on the front cover
 * runs it too. Run never says where: on Desktop it runs on Desktop, on
 * Cloud on Cloud.
 */
const STEP = 176 // px between the front cover and its neighbours
const FAR = 100 // px between covers further out
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
/** The Run button on a cover runs that one, front or side; anywhere else on a
 *  side cover only brings it to the front. */
function runFrom(i: number): void {
  if (!moved) runExample(EXAMPLES[i]!)
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

// A sideways scroll (a trackpad swipe) steps one cover per gesture;
// vertical scroll is left to the page.
let wheelSum = 0
let wheelTimer: ReturnType<typeof setTimeout> | undefined
function wheel(e: WheelEvent): void {
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
  e.preventDefault()
  wheelSum += e.deltaX
  if (Math.abs(wheelSum) > 60) {
    void go(active.value + Math.sign(wheelSum))
    wheelSum = -Infinity * Math.sign(wheelSum) // once per gesture
  }
  clearTimeout(wheelTimer)
  wheelTimer = setTimeout(() => (wheelSum = 0), 160)
}
</script>

<template>
  <div
    class="mar-ff"
    role="region"
    aria-roledescription="carousel"
    aria-label="Examples"
    @keydown="key"
  >
    <div
      class="mar-ff-stage"
      :class="dragging && moved && 'is-dragging'"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
      @wheel="wheel"
    >
      <button
        v-for="(x, i) in EXAMPLES"
        :key="x.label"
        ref="cards"
        type="button"
        class="mar-ff-card"
        :class="i === active && 'is-front'"
        :style="pose(i)"
        :tabindex="i === active ? 0 : -1"
        :aria-current="i === active ? 'true' : undefined"
        :aria-label="
          i === active ? `Run ${x.label}, ${x.kind}, ${x.runs}` : `${x.label}, ${x.kind}, ${x.runs}`
        "
        @mouseenter="i === active && playLoop($event.currentTarget as Element, true)"
        @mouseleave="playLoop($event.currentTarget as Element, false)"
        @click="pick(i)"
      >
        <img :src="x.src" alt="" draggable="false" />
        <video v-if="x.video" :src="x.video" muted loop playsinline preload="none" />
        <span class="mar-ff-shade" />
        <span class="mar-ff-scrim" />
        <span class="mar-ff-meta">
          <span class="mar-ff-title">{{ x.label }}</span>
          <span class="mar-ff-eyebrow">{{ x.kind }} · {{ x.runs }}</span>
        </span>
        <span class="mar-ff-go" aria-hidden="true" @click.stop="runFrom(i)">Run</span>
      </button>
    </div>

    <div class="mar-ff-action">
      <button v-if="can.exploreApps" type="button" class="mar-ff-all" @click="goTo('explore')">
        See all examples<ArrowRight :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.mar-ff {
  --mar-ff-ease: cubic-bezier(0.19, 1, 0.22, 1);
  display: flex;
  flex-direction: column;
  align-items: center;
}
.mar-ff-stage {
  position: relative;
  width: 100%;
  height: 268px;
  margin-top: 12px;
  overflow-x: clip;
  perspective: 1100px;
  touch-action: pan-y;
  user-select: none;
  cursor: grab;
}
.mar-ff-stage.is-dragging {
  cursor: grabbing;
}
.mar-ff-card {
  transition:
    transform 650ms var(--mar-ff-ease),
    opacity 400ms ease;
}
.is-dragging .mar-ff-card {
  transition: none;
}
.mar-ff-card img,
.mar-ff-card video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}
.mar-ff-card video {
  opacity: 0;
  transition: opacity 300ms ease;
}
.mar-ff-card.is-front:hover video,
.mar-ff-card.is-front:focus-visible video {
  opacity: 1;
}
.mar-ff-shade {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / var(--shade, 0));
  pointer-events: none;
  transition: background-color 400ms ease;
}
/* Name and meta at the top of the cover, over a scrim so they read on any
   picture. */
.mar-ff-meta {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 14px 16px 36px;
  background: linear-gradient(180deg, rgb(0 0 0 / 0.62), rgb(0 0 0 / 0.28) 55%, transparent);
  color: #fff;
  text-align: left;
  pointer-events: none;
}
.mar-ff-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.2;
  text-wrap: balance;
  text-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
}
.mar-ff-eyebrow {
  color: rgb(255 255 255 / 0.72);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
/* Run at the bottom: a full-width white button over a soft scrim, shown on
   the cover you point at (or focus). */
.mar-ff-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 55%, rgb(0 0 0 / 0.55));
  opacity: 0;
  pointer-events: none;
  transition: opacity 250ms ease;
}
.mar-ff-go {
  position: absolute;
  right: 12px;
  bottom: 12px;
  left: 12px;
  display: flex;
  height: 38px;
  align-items: center;
  justify-content: center;
  padding: 0 20px;
  border-radius: var(--radius-control);
  background: #fff;
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.06),
    0 8px 20px -6px rgb(0 0 0 / 0.5);
  color: #111;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.005em;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transform: translateY(6px) scale(0.98);
  transition:
    opacity 200ms ease,
    transform 300ms cubic-bezier(0.19, 1, 0.22, 1),
    background-color 160ms ease;
}
.mar-ff-card:hover .mar-ff-go,
.mar-ff-card:focus-visible .mar-ff-go {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}
.mar-ff-card .mar-ff-go:hover {
  background: rgb(255 255 255 / 0.9);
}
.mar-ff-card .mar-ff-go:active {
  transform: translateY(0) scale(0.98);
}
.mar-ff-card:hover .mar-ff-scrim,
.mar-ff-card:focus-visible .mar-ff-scrim {
  opacity: 1;
}
.mar-ff-action {
  display: flex;
  height: 40px;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 4px;
}
@media (prefers-reduced-motion: reduce) {
  .mar-ff-card,
  .mar-ff-card video,
  .mar-ff-shade,
  .mar-ff-go,
  .mar-ff-scrim {
    transition: none;
  }
}
</style>

<style>
/* The covers carry their own names and See all examples sits under them,
   so the section's left-aligned header steps aside. */
:root .proto-ui section:has(> .mar-ff) > :first-child:not(.mar-ff) {
  display: none;
}
/* Global: these are buttons, past the prototype's button reset. */
:root .proto-ui.proto-ui.proto-ui .mar-ff-card {
  position: absolute;
  top: 14px;
  left: 50%;
  width: 196px;
  height: 246px;
  margin-left: -98px;
  overflow: hidden;
  padding: 0;
  border: 1px solid rgb(255 255 255 / 0.1);
  border-radius: 20px;
  background: var(--color-card-background);
  box-shadow: 0 26px 50px -24px rgb(0 0 0 / 0.75);
  outline: none;
  cursor: inherit;
}
:root[data-ds-theme='light'] .proto-ui.proto-ui.proto-ui .mar-ff-card {
  border-color: rgb(0 0 0 / 0.06);
  box-shadow: 0 24px 44px -24px rgb(0 0 0 / 0.4);
}
:root .proto-ui.proto-ui.proto-ui .mar-ff-card.is-front {
  cursor: pointer;
}
:root .proto-ui.proto-ui.proto-ui .mar-ff-card:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-border-focus),
    0 26px 50px -24px rgb(0 0 0 / 0.75);
}
:root .proto-ui.proto-ui.proto-ui .mar-ff-all {
  display: inline-flex;
  width: auto;
  height: 30px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-radius: var(--radius-control);
  font-size: 13px;
  font-weight: 500;
  outline: none;
  transition:
    background-color 160ms ease,
    opacity 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-ff-all {
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-ff-all:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-ff-all:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
</style>
