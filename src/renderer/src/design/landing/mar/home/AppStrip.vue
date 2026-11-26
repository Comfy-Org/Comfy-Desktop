<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { useResizeObserver } from '@vueuse/core'
import MarSeg from '../pages/MarSeg.vue'
import { reducedMotion } from '../userStates/examples'
import type { ArcItem } from '../userStates/arcItems'

const {
  items,
  allLabel = 'See all apps',
  title = 'Apps',
  tabs = [],
  leaving = false
} = defineProps<{
  items: ArcItem[]
  allLabel?: string
  title?: string
  tabs?: { value: string; label: string }[]
  leaving?: boolean
}>()
const emit = defineEmits<{ all: [] }>()
const tab = defineModel<string>('tab', { default: '' })

const DRAG_THRESHOLD = 6
const isClip = (src: string): boolean => /^data:video|\.(mp4|webm|mov)(\?|#|$)/i.test(src)

const track = ref<HTMLElement>()
const slides = ref<HTMLElement[]>([])
const atStart = ref(true)
const atEnd = ref(false)
const hovered = ref<string>()

function measure(): void {
  const el = track.value
  if (!el) return
  atStart.value = el.scrollLeft <= 2
  atEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2
}
useResizeObserver(track, measure)
onMounted(measure)

const behavior = (): ScrollBehavior => (reducedMotion() ? 'auto' : 'smooth')

function slideStarts(): number[] {
  const el = track.value
  if (!el) return []
  const origin = el.getBoundingClientRect().left - el.scrollLeft
  return slides.value.map((s) => s.getBoundingClientRect().left - origin)
}

function page(dir: 1 | -1): void {
  const el = track.value
  if (!el) return
  const starts = slideStarts()
  const left = el.scrollLeft
  const right = left + el.clientWidth
  const to =
    dir === 1
      ? (starts.find((x, i) => x > left + 2 && x + (slides.value[i]?.offsetWidth ?? 0) > right) ??
        el.scrollWidth)
      : (starts.find((x) => x >= left - el.clientWidth - 2) ?? 0)
  el.scrollTo({ left: to, behavior: behavior() })
}

function step(from: number, dir: 1 | -1): void {
  const i = Math.max(0, Math.min(items.length - 1, from + dir))
  const target = slides.value[i]
  if (!target) return
  target.focus({ preventScroll: true })
  target.scrollIntoView({ behavior: behavior(), block: 'nearest', inline: 'nearest' })
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  const dir = e.key === 'ArrowRight' ? 1 : -1
  const at = slides.value.indexOf(e.target as HTMLElement)
  if (at >= 0) step(at, dir)
  else page(dir)
}

const dragging = ref(false)
let pointerStart = 0
let scrollStart = 0
let moved = false

function down(e: PointerEvent): void {
  if (e.pointerType !== 'mouse' || e.button !== 0 || !track.value) return
  pointerStart = e.clientX
  scrollStart = track.value.scrollLeft
  moved = false
  dragging.value = true
}
function move(e: PointerEvent): void {
  const el = track.value
  if (!dragging.value || !el) return
  const dx = e.clientX - pointerStart
  if (!moved && Math.abs(dx) > DRAG_THRESHOLD) {
    moved = true
    el.setPointerCapture(e.pointerId)
  }
  if (moved) el.scrollLeft = scrollStart - dx
}
function up(): void {
  const el = track.value
  if (!dragging.value || !el) return
  dragging.value = false
  if (!moved) return
  const starts = slideStarts()
  const nearest = starts.reduce(
    (best, x) => (Math.abs(x - el.scrollLeft) < Math.abs(best - el.scrollLeft) ? x : best),
    0
  )
  el.scrollTo({ left: nearest, behavior: behavior() })
  setTimeout(() => (moved = false))
}

function open(x: ArcItem): void {
  if (moved) return
  x.open()
}

function setPlaying(slide: HTMLElement, on: boolean): void {
  const video = slide.querySelector('video')
  if (!video) return
  if (on && !reducedMotion()) void video.play().catch(() => {})
  else {
    video.pause()
    video.currentTime = 0
  }
}
function enter(x: ArcItem, e: Event): void {
  hovered.value = x.id
  setPlaying(e.currentTarget as HTMLElement, true)
}
function leave(x: ArcItem, e: Event): void {
  if (hovered.value === x.id) hovered.value = undefined
  setPlaying(e.currentTarget as HTMLElement, false)
}

const ids = computed(() => items.map((x) => x.id).join('|'))
watch(ids, async () => {
  await nextTick()
  if (track.value) track.value.scrollLeft = 0
  measure()
})
</script>

<template>
  <div class="mar-strip" role="region" aria-roledescription="carousel" :aria-label="title">
    <div class="mar-strip-head">
      <MarSeg v-if="tabs.length" v-model="tab" :options="tabs" :label="title" />
      <h2 v-else class="mar-strip-title-head">
        <button type="button" class="mar-strip-heading" @click="emit('all')">
          {{ title }}<ChevronRight :size="13" aria-hidden="true" />
        </button>
      </h2>
      <div class="mar-strip-tools">
        <button v-if="allLabel" type="button" class="mar-strip-all" @click="emit('all')">
          {{ allLabel }}<ChevronRight :size="13" aria-hidden="true" />
        </button>
      </div>
    </div>
    <div
      ref="track"
      class="mar-strip-track"
      :class="[dragging && 'is-dragging', leaving && 'is-leaving']"
      tabindex="-1"
      @scroll.passive="measure"
      @keydown="onKey"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
    >
      <button
        v-for="x in items"
        :key="x.id"
        ref="slides"
        type="button"
        class="mar-strip-slide"
        :aria-label="`Open ${x.label}: ${x.does}`"
        @click="open(x)"
        @pointerenter="enter(x, $event)"
        @pointerleave="leave(x, $event)"
        @focus="enter(x, $event)"
        @blur="leave(x, $event)"
      >
        <video
          v-if="isClip(x.src)"
          :src="x.src"
          muted
          loop
          playsinline
          preload="metadata"
          draggable="false"
        />
        <img
          v-else
          :src="x.src"
          alt=""
          draggable="false"
          loading="lazy"
          :style="x.focus && { objectPosition: `${x.focus[0]} 50%` }"
        />
        <img
          v-if="x.after && !isClip(x.src)"
          :src="x.after"
          alt=""
          draggable="false"
          loading="lazy"
          class="mar-strip-after"
          :class="hovered === x.id && 'is-on'"
          :style="x.focus && { objectPosition: `${x.focus[1]} 50%` }"
        />
        <span class="mar-strip-scrim" />
        <span class="mar-strip-text">
          <span class="mar-strip-title">{{ x.label }}</span>
          <span v-if="x.does" class="mar-strip-does">{{ x.does }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.mar-strip {
  --strip-h: clamp(220px, 28vh, 260px);
  --strip-gap: 10px;
  position: relative;
}
.mar-strip-track {
  display: flex;
  transition:
    opacity 260ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 360ms cubic-bezier(0.22, 1, 0.36, 1);
  gap: var(--strip-gap);
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  outline: none;
  cursor: grab;
  user-select: none;
}
.mar-strip-track::-webkit-scrollbar {
  display: none;
}
.mar-strip-track.is-leaving {
  opacity: 0;
  transform: translateY(6px);
  transition-duration: 150ms;
  transition-timing-function: ease-in;
}
.mar-strip-track.is-dragging {
  scroll-snap-type: none;
  cursor: grabbing;
}
.mar-strip-slide img,
.mar-strip-slide video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  transition: scale 500ms cubic-bezier(0.22, 1, 0.36, 1);
}
.mar-strip-slide:is(:hover, :focus-visible) :is(img, video) {
  scale: 1.03;
}
@property --strip-sweep {
  syntax: '<percentage>';
  inherits: false;
  initial-value: -40%;
}
.mar-strip-slide .mar-strip-after {
  --strip-sweep: -40%;
  mask-image: linear-gradient(
    100deg,
    #000 calc(var(--strip-sweep) - 18%),
    transparent calc(var(--strip-sweep) + 18%)
  );
  transition:
    --strip-sweep 900ms cubic-bezier(0.645, 0.045, 0.355, 1),
    scale 500ms cubic-bezier(0.22, 1, 0.36, 1);
}
.mar-strip-slide .mar-strip-after.is-on {
  --strip-sweep: 140%;
}
.mar-strip-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgb(0 0 0 / 0.72), rgb(0 0 0 / 0.32) 28%, transparent 50%);
  pointer-events: none;
}
.mar-strip-text {
  position: absolute;
  right: 16px;
  bottom: 14px;
  left: 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: #fff;
  text-align: left;
  pointer-events: none;
}
.mar-strip-title {
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.25;
  text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
  white-space: nowrap;
}
.mar-strip-does {
  overflow: hidden;
  color: rgb(255 255 255 / 0.78);
  font-size: 12px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mar-strip-head {
  display: flex;
  min-height: 24px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.mar-strip-title-head {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
.mar-strip-tools {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
}
@media (prefers-reduced-motion: reduce) {
  .mar-strip-slide img,
  .mar-strip-slide video,
  .mar-strip-slide .mar-strip-after {
    transition: none;
  }
  .mar-strip-slide:is(:hover, :focus-visible) :is(img, video) {
    scale: 1;
  }
  .mar-strip-track {
    transition: none;
  }
}
</style>

<style>
:root .proto-ui.proto-ui.proto-ui .mar-strip-slide {
  position: relative;
  flex: 0 0 auto;
  width: calc(var(--strip-h) * 0.8);
  height: var(--strip-h);
  overflow: hidden;
  padding: 0;
  border-radius: var(--radius-card);
  background: var(--color-card-background);
  outline: none;
  cursor: pointer;
  scroll-snap-align: start;
}
:root .proto-ui.proto-ui.proto-ui .mar-strip-track.is-dragging .mar-strip-slide {
  cursor: grabbing;
}
:root .proto-ui.proto-ui.proto-ui .mar-strip-slide:focus-visible::after {
  position: absolute;
  inset: 0;
  box-shadow: inset 0 0 0 2px var(--color-border-focus);
  content: '';
}
:root .proto-ui.proto-ui.proto-ui .mar-strip-heading {
  display: inline-flex;
  width: auto;
  height: 32px;
  align-items: center;
  gap: 4px;
  margin: -4px 0 -4px -8px;
  padding: 0 8px;
  border-radius: 8px;
  color: var(--color-muted-foreground);
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  outline: none;
  transition:
    background-color 160ms ease,
    color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-strip-heading:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-strip-heading:focus-visible,
:root .proto-ui.proto-ui.proto-ui .mar-strip-all:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .mar-strip-all {
  display: inline-flex;
  width: auto;
  height: 32px;
  align-items: center;
  gap: 4px;
  margin-right: 4px;
  padding: 0 8px 0 10px;
  border-radius: 8px;
  color: var(--color-muted-foreground);
  font-size: 13px;
  font-weight: 500;
  outline: none;
  transition:
    background-color 160ms ease,
    color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-strip-all:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
</style>
