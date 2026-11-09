<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowRight } from 'lucide-vue-next'
import { go } from '../../useProto'
import { can } from '../../milestones'
import { EXAMPLES, reducedMotion, runExample } from './examples'

/**
 * First-time examples · Arc carousel: the examples stand on a wide 3D
 * cylinder, tall cards curving away to both sides and fading into the
 * page. The one in front faces you, flat, with a thin ring; each card
 * carries its own name and run time at the top, so nothing below it moves
 * when you flip. The arc wraps around and turns on a spring: ← →, a click
 * on a side card, a drag or a sideways scroll. Pointing at the front card
 * (or focusing it) shows its Run button at the bottom; Enter runs it.
 * The front card shows what its app does: a soft gradient sweeps it from
 * what goes in to what comes out and back; the rest stay still until they reach the
 * front. Run never says where: on Desktop it runs on Desktop, on Cloud on
 * Cloud.
 */
const N = EXAMPLES.length
const ANGLE = 25 // degrees between neighbours on the cylinder
const RADIUS = 600 // px, the cylinder's radius
const DRAG = 240 // px of drag that turns the arc by one card
const HOLD = 1600 // ms each side of the front card stays up
const LAND = 350 // ms after a card reaches the front before it first sweeps

// `pos` is where the arc is (in cards, unbounded); `target` where it's going.
// It opens on Re-shoot a video, with Cinematic Studio and Openjutsu beside.
const START = Math.max(
  0,
  EXAMPLES.findIndex((x) => x.label === 'Re-shoot a video')
)
const pos = ref(START)
const target = ref(pos.value)
const dragging = ref(false)
const cards = ref<HTMLElement[]>([])
const active = computed(() => mod(Math.round(target.value), N))

// The front card's sweep: each new front card starts from what goes in.
const after = ref(false)
// It sweeps as soon as it lands, so the motion reads right away.
let sweep: ReturnType<typeof setInterval> | undefined
let first: ReturnType<typeof setTimeout> | undefined
function stop(): void {
  clearTimeout(first)
  clearInterval(sweep)
}
function play(): void {
  stop()
  after.value = false
  if (reducedMotion()) return
  first = setTimeout(() => {
    after.value = true
    sweep = setInterval(() => (after.value = !after.value), HOLD)
  }, LAND)
}
onMounted(play)
watch(active, play)
onBeforeUnmount(stop)

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
  // Fully there at the front, see-through to the sides so the arc melts
  // into the page; gone by the seam at the back.
  const fade = Math.max(0, Math.min(1, (N / 2 - a) / (N / 2 - 1))) * (1 - Math.min(a, 2) * 0.24)
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
          i === active
            ? `Run ${x.label}: ${x.does}. ${x.kind} app`
            : `${x.label}: ${x.does}. ${x.kind} app`
        "
        @click="pick(i)"
      >
        <img
          :src="x.src"
          alt=""
          draggable="false"
          :style="x.focus && { objectPosition: `${x.focus[0]} 50%` }"
        />
        <img
          :src="x.after"
          alt=""
          draggable="false"
          class="mar-arc-after"
          :class="i === active && after && 'is-on'"
          :style="x.focus && { objectPosition: `${x.focus[1]} 50%` }"
        />
        <span class="mar-arc-fade" />
        <span class="mar-arc-scrim" />
        <!-- App, up top; its name and what it does, below. -->
        <span class="mar-arc-text">
          <span class="mar-arc-meta"><span class="mar-arc-app">App</span></span>
        </span>
        <span class="mar-arc-dim" />
        <!-- As on the app cards: the name and what it does on the left,
             the white Run on the right on hover, one row over the fade. -->
        <span class="mar-arc-bar">
          <span class="mar-arc-name">
            <span class="mar-arc-title">{{ x.label }}</span>
            <span class="mar-arc-does">{{ x.does }}</span>
          </span>
          <span class="mar-arc-go" aria-hidden="true">Run</span>
        </span>
      </button>
    </div>

    <div class="mar-arc-actions">
      <button
        v-if="can.exploreApps"
        type="button"
        class="mar-arc-all"
        @click="go(can.explore ? 'explore' : 'apps')"
      >
        See all apps<ArrowRight :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.mar-arc {
  position: relative;
}
.mar-arc-stage {
  position: relative;
  height: 300px;
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
.mar-arc-card img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}
/* What comes out sweeps in behind a soft edge: a wide gradient, no line. */
@property --arc-sweep {
  syntax: '<percentage>';
  inherits: false;
  initial-value: -40%;
}
.mar-arc-card .mar-arc-after {
  --arc-sweep: -40%;
  mask-image: linear-gradient(
    100deg,
    #000 calc(var(--arc-sweep) - 18%),
    transparent calc(var(--arc-sweep) + 18%)
  );
  transition: --arc-sweep 800ms cubic-bezier(0.645, 0.045, 0.355, 1);
}
.mar-arc-card .mar-arc-after.is-on {
  --arc-sweep: 140%;
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
  font-size: 14px;
  font-weight: 500;
  letter-spacing: -0.01em;
  line-height: 1.2;
  text-wrap: balance;
  text-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
}
/* Marks the example as an app, ahead of what it makes. */
.mar-arc-app {
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
/* The name and what it does, one row at the bottom of every card, as
   on the app cards; Run joins it on the front card when you point at it
   (or focus it). */
.mar-arc-bar {
  position: absolute;
  right: 14px;
  bottom: 14px;
  left: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.mar-arc-name {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;
  text-align: left;
}
.mar-arc-name > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mar-arc-does {
  color: rgb(255 255 255 / 0.7);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.35;
}
.mar-arc-meta {
  margin-top: 2px;
  color: rgb(255 255 255 / 0.78);
  font-size: 12px;
}
/* Run at the bottom: a white button over a soft scrim, shown on the front
   card when you point at it (or focus it). */
.mar-arc-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgb(0 0 0 / 0.75), rgb(0 0 0 / 0.4) 30%, transparent 55%);
  pointer-events: none;
  transition: opacity 250ms ease;
}
.mar-arc-go {
  display: inline-flex;
  height: 30px;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  border-radius: var(--radius-control);
  background: #fff;
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.06),
    0 8px 20px -6px rgb(0 0 0 / 0.5);
  color: #111;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transform: translateY(4px);
  transition:
    opacity 200ms ease,
    transform 300ms cubic-bezier(0.19, 1, 0.22, 1),
    background-color 160ms ease;
}
.mar-arc-card.is-front:hover .mar-arc-go,
.mar-arc-card.is-front:focus-visible .mar-arc-go {
  opacity: 1;
  pointer-events: auto;
  transform: none;
}
.mar-arc-card .mar-arc-go:hover {
  background: rgb(255 255 255 / 0.9);
}
.mar-arc-card .mar-arc-go:active {
  scale: 0.98;
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
  .mar-arc-card .mar-arc-after,
  .mar-arc-go,
  .mar-arc-scrim {
    transition: none;
  }
  :root .proto-main .mar-arc-card.is-front img {
    animation: none;
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
  width: 256px;
  height: 272px;
  margin-left: -128px;
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
  box-shadow: 0 28px 56px -26px rgb(0 0 0 / 0.8);
  cursor: pointer;
}
:root[data-ds-theme='light'] .proto-ui.proto-ui.proto-ui .mar-arc-card {
  box-shadow: 0 24px 44px -24px rgb(0 0 0 / 0.4);
}
:root[data-ds-theme='light'] .proto-ui.proto-ui.proto-ui .mar-arc-card.is-front {
  box-shadow: 0 24px 44px -24px rgb(0 0 0 / 0.4);
}
:root .proto-ui.proto-ui.proto-ui .mar-arc-card.is-front:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-border-focus),
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
