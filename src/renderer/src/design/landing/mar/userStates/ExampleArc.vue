<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { go } from '../../useProto'
import { can } from '../../milestones'
import { EXAMPLES, playLoop, reducedMotion, runExample } from './examples'

/**
 * First-time examples · Arc carousel: the examples stand on a wide 3D
 * cylinder, tall cards curving away to both sides and fading into the
 * page. The one in front faces you, flat, with a thin ring; each card
 * carries its own name and run time at the top, so nothing below it moves
 * when you flip. The arc wraps around and turns on a spring: ← →, a click
 * on a side card, a drag or a sideways scroll. Pointing at a card (or
 * focusing it) shows its Run button at the bottom; Enter runs the front one.
 * Run never says where: on Desktop it runs on Desktop, on Cloud on Cloud.
 */
const N = EXAMPLES.length
const ANGLE = 24 // degrees between neighbours on the cylinder
const RADIUS = 600 // px, the cylinder's radius
const DRAG = 240 // px of drag that turns the arc by one card

// `pos` is where the arc is (in cards, unbounded); `target` where it's going.
const pos = ref(Math.floor(N / 2))
const target = ref(pos.value)
const dragging = ref(false)
const cards = ref<HTMLElement[]>([])
const active = computed(() => mod(Math.round(target.value), N))

function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}
/** Signed distance of card i from the front, wrapped to [-N/2, N/2). */
function offset(i: number): number {
  const d = mod(i - pos.value, N)
  return d >= N / 2 ? d - N : d
}

function pose(i: number): Record<string, string> {
  const d = offset(i)
  const a = Math.abs(d)
  const rad = (d * ANGLE * Math.PI) / 180
  const x = RADIUS * Math.sin(rad)
  const z = RADIUS * (Math.cos(rad) - 1)
  // Fully there up to one card out, gone by the seam at the back.
  const fade = Math.max(0, Math.min(1, (N / 2 - a) / (N / 2 - 1)))
  return {
    transform: `translateX(${x}px) translateZ(${z}px) rotateY(${d * ANGLE}deg)`,
    zIndex: String(100 - Math.round(a * 10)),
    opacity: String(fade),
    visibility: fade < 0.01 ? 'hidden' : 'visible',
    '--dim': String(Math.min(a * 0.36, 0.72))
  }
}

// A light spring: settles quickly with a hint of overshoot, and picks up
// from wherever the arc is, so flipping fast stays smooth.
let vel = 0
let raf = 0
let last = 0
function tick(t: number): void {
  const dt = Math.min(0.032, (t - last) / 1000 || 0.016)
  last = t
  vel += (170 * (target.value - pos.value) - 22 * vel) * dt
  pos.value += vel * dt
  if (Math.abs(target.value - pos.value) < 0.0005 && Math.abs(vel) < 0.002) {
    pos.value = target.value
    raf = 0
    return
  }
  raf = requestAnimationFrame(tick)
}
function settle(): void {
  if (reducedMotion()) {
    pos.value = target.value
    vel = 0
    return
  }
  if (!raf) {
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }
}
onBeforeUnmount(() => cancelAnimationFrame(raf))

async function turn(by: number, focus = false): Promise<void> {
  target.value = Math.round(target.value) + by
  settle()
  if (focus) {
    await nextTick()
    cards.value[active.value]?.focus()
  }
}
function pick(i: number): void {
  if (moved) return
  if (i === active.value) runExample(EXAMPLES[i]!)
  else void turn(Math.round(offset(i) + pos.value - target.value))
}
/** The Run button on a cover runs that one, front or side; anywhere else on a
 *  side cover only brings it to the front. */
function runFrom(i: number): void {
  if (!moved) runExample(EXAMPLES[i]!)
}
function key(e: KeyboardEvent): void {
  if (e.key === 'ArrowLeft') void turn(-1, true)
  else if (e.key === 'ArrowRight') void turn(1, true)
  else return
  e.preventDefault()
}

// Drag: the arc follows the pointer, then springs to the nearest card,
// carrying the throw's speed.
let startX = 0
let startPos = 0
let lastX = 0
let lastT = 0
let moved = false
function down(e: PointerEvent): void {
  if (e.button !== 0) return
  startX = lastX = e.clientX
  lastT = performance.now()
  startPos = pos.value
  moved = false
  dragging.value = true
}
function move(e: PointerEvent): void {
  if (!dragging.value) return
  const dx = e.clientX - startX
  if (!moved && Math.abs(dx) > 6) {
    moved = true
    cancelAnimationFrame(raf)
    raf = 0
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  if (!moved) return
  const now = performance.now()
  vel = (-(e.clientX - lastX) / DRAG / Math.max(1, now - lastT)) * 1000
  lastX = e.clientX
  lastT = now
  pos.value = startPos - dx / DRAG
  target.value = pos.value
}
function up(): void {
  if (!dragging.value) return
  dragging.value = false
  if (moved) {
    target.value = Math.round(pos.value + Math.max(-1.5, Math.min(1.5, vel * 0.12)))
    settle()
  }
  // Let the click that ends a drag pass without picking.
  setTimeout(() => (moved = false))
}

// Sideways scroll (a trackpad swipe) turns the arc; vertical scroll is left
// to the page.
let wheelTimer: ReturnType<typeof setTimeout> | undefined
function wheel(e: WheelEvent): void {
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
  e.preventDefault()
  target.value += e.deltaX / DRAG
  settle()
  clearTimeout(wheelTimer)
  wheelTimer = setTimeout(() => {
    target.value = Math.round(target.value)
    settle()
  }, 120)
}
</script>

<template>
  <div
    class="mar-arc"
    role="region"
    aria-roledescription="carousel"
    aria-label="Examples"
    @keydown="key"
  >
    <div
      class="mar-arc-stage"
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
        class="mar-arc-card"
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
        <span class="mar-arc-fade" />
        <span class="mar-arc-scrim" />
        <span class="mar-arc-text">
          <span class="mar-arc-title">{{ x.label }}</span>
          <span class="mar-arc-meta">{{ x.kind }} · {{ x.runs }}</span>
        </span>
        <span class="mar-arc-dim" />
        <span class="mar-arc-go" aria-hidden="true" @click.stop="runFrom(i)">Run</span>
      </button>
    </div>

    <!-- For a mouse wheel, which can't swipe sideways: shown on hover. -->
    <button
      type="button"
      class="mar-arc-nav is-prev"
      aria-label="Previous example"
      @click="turn(-1)"
    >
      <ChevronLeft :size="18" />
    </button>
    <button type="button" class="mar-arc-nav is-next" aria-label="Next example" @click="turn(1)">
      <ChevronRight :size="18" />
    </button>

    <div class="mar-arc-actions">
      <button v-if="can.exploreApps" type="button" class="mar-arc-all" @click="go('explore')">
        See all examples<ArrowRight :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.mar-arc {
  position: relative;
}
/* In the gap between the second card and the one fading out. */
:root .proto-ui.proto-ui.proto-ui .mar-arc-nav {
  position: absolute;
  top: 170px;
  z-index: 10;
  display: flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  color: var(--color-base-foreground);
  opacity: 0;
  backdrop-filter: blur(12px);
  transform: translateY(-50%);
  transition:
    opacity 160ms ease,
    background-color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-arc-nav.is-prev {
  left: max(0px, calc(50% - 372px));
}
:root .proto-ui.proto-ui.proto-ui .mar-arc-nav.is-next {
  right: max(0px, calc(50% - 372px));
}
:root .proto-ui.proto-ui.proto-ui .mar-arc:hover .mar-arc-nav,
:root .proto-ui.proto-ui.proto-ui .mar-arc-nav:focus-visible {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .mar-arc-nav:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 22%, transparent);
}
@media (hover: none) {
  :root .proto-ui.proto-ui.proto-ui .mar-arc-nav {
    opacity: 1;
  }
}
.mar-arc-stage {
  position: relative;
  height: 340px;
  overflow-x: clip;
  perspective: 1400px;
  perspective-origin: 50% 45%;
  touch-action: pan-y;
  user-select: none;
  cursor: grab;
}
.mar-arc-stage.is-dragging {
  cursor: grabbing;
}
.mar-arc-card img,
.mar-arc-card video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}
.mar-arc-card video {
  opacity: 0;
  transition: opacity 300ms ease;
}
.mar-arc-card.is-front:hover video,
.mar-arc-card.is-front:focus-visible video {
  opacity: 1;
}
.mar-arc-fade {
  position: absolute;
  inset: 0 0 auto;
  height: 45%;
  background: linear-gradient(180deg, rgb(0 0 0 / 0.62), rgb(0 0 0 / 0.28) 55%, transparent);
  pointer-events: none;
}
/* Side cards sink into the page: dark on dark, pale on light. */
.mar-arc-dim {
  position: absolute;
  inset: 0;
  background: var(--color-content-background);
  opacity: var(--dim, 0);
  pointer-events: none;
}
.mar-arc-text {
  position: absolute;
  top: 16px;
  right: 16px;
  left: 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}
.mar-arc-title {
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.2;
  text-wrap: balance;
  text-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
}
.mar-arc-meta {
  color: rgb(255 255 255 / 0.72);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
/* Run at the bottom: a white button over a soft scrim, shown on the card
   you point at (or focus). */
.mar-arc-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 55%, rgb(0 0 0 / 0.55));
  opacity: 0;
  pointer-events: none;
  transition: opacity 250ms ease;
}
.mar-arc-go {
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
.mar-arc-card:hover .mar-arc-go,
.mar-arc-card:focus-visible .mar-arc-go {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}
.mar-arc-card .mar-arc-go:hover {
  background: rgb(255 255 255 / 0.9);
}
.mar-arc-card .mar-arc-go:active {
  transform: translateY(0) scale(0.98);
}
.mar-arc-card:hover .mar-arc-scrim,
.mar-arc-card:focus-visible .mar-arc-scrim {
  opacity: 1;
}
.mar-arc-actions {
  display: flex;
  height: 40px;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 8px;
}
@media (prefers-reduced-motion: reduce) {
  .mar-arc-card video,
  .mar-arc-go,
  .mar-arc-scrim {
    transition: none;
  }
}
</style>

<style>
/* The arc carries its own title on each card, so the section's
   left-aligned header steps aside. */
:root .proto-ui section:has(> .mar-arc) > :first-child:not(.mar-arc) {
  display: none;
}
/* Global: these are buttons, past the prototype's button reset. */
:root .proto-ui.proto-ui.proto-ui .mar-arc-card {
  position: absolute;
  top: 12px;
  left: 50%;
  width: 216px;
  height: 312px;
  margin-left: -108px;
  overflow: hidden;
  padding: 0;
  border-radius: 18px;
  background: var(--color-card-background);
  box-shadow: 0 28px 56px -26px rgb(0 0 0 / 0.8);
  outline: none;
  cursor: inherit;
  backface-visibility: hidden;
  will-change: transform;
}
:root .proto-ui.proto-ui.proto-ui .mar-arc-card.is-front {
  box-shadow:
    0 0 0 1.5px rgb(255 255 255 / 0.9),
    0 28px 56px -26px rgb(0 0 0 / 0.8);
  cursor: pointer;
}
:root[data-ds-theme='light'] .proto-ui.proto-ui.proto-ui .mar-arc-card {
  box-shadow: 0 24px 44px -24px rgb(0 0 0 / 0.4);
}
:root[data-ds-theme='light'] .proto-ui.proto-ui.proto-ui .mar-arc-card.is-front {
  box-shadow:
    0 0 0 1.5px rgb(0 0 0 / 0.85),
    0 24px 44px -24px rgb(0 0 0 / 0.4);
}
:root .proto-ui.proto-ui.proto-ui .mar-arc-card.is-front:focus-visible {
  box-shadow:
    0 0 0 1.5px rgb(255 255 255 / 0.9),
    0 0 0 4px var(--color-border-focus),
    0 28px 56px -26px rgb(0 0 0 / 0.8);
}
:root .proto-ui.proto-ui.proto-ui .mar-arc-all {
  display: inline-flex;
  width: auto;
  height: 34px;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  border-radius: var(--radius-control);
  font-size: 13px;
  font-weight: 500;
  outline: none;
  transition:
    background-color 160ms ease,
    opacity 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-arc-all {
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-arc-all:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-arc-all:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
</style>
