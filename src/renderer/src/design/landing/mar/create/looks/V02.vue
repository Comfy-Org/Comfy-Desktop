<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, ChevronLeft, ChevronRight, Download, Plus, Search, X } from 'lucide-vue-next'
import Button from '../../../ui/Button.vue'
import CategoryChip from '../../CategoryChip.vue'
import { activeInstance } from '../../../useProto'
import { closeCreate, openTemplate, openWorkflow, startBlank } from '../createScreen'
import { readiness, type Starter } from '../createStarters'
import LookAResults from './LookAResults.vue'
import {
  buildOf,
  prefersReducedMotion,
  shelfStarters,
  sortedWorkflows,
  useCreateEscape,
  useCreateSearch
} from './lookA'

const DWELL_MS = 9000

const reel: Starter[] = (() => {
  const seen = new Set<string>()
  return [...shelfStarters('popular'), ...shelfStarters('video', 4), ...shelfStarters('3d', 1)]
    .filter((s) => !seen.has(s.id) && seen.add(s.id))
    .slice(0, 10)
})()

const query = ref('')
const field = ref<HTMLInputElement>()
const searching = ref(false)
const search = useCreateSearch(query)
useCreateEscape(field, false)

const index = ref(0)
const held = ref(false)
const hero = computed(() => reel[index.value]!)
const heroReady = computed(() => readiness(hero.value.template))
const recents = computed(() => sortedWorkflows.value.slice(0, 5))
const still = prefersReducedMotion()

const cycle = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
function restart(): void {
  clearInterval(timer)
  cycle.value++
  if (still) return
  timer = setInterval(() => {
    if (held.value || searching.value) return
    index.value = (index.value + 1) % reel.length
    cycle.value++
  }, DWELL_MS)
}
function go(i: number): void {
  index.value = (i + reel.length) % reel.length
  restart()
}
onMounted(restart)
watch(held, (h) => !h && restart())
onBeforeUnmount(() => clearInterval(timer))

watch(index, (i) =>
  nextTick(() =>
    document
      .querySelector(`[data-v02-frame="${i}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: still ? 'auto' : 'smooth' })
  )
)

function openSearch(): void {
  searching.value = true
  nextTick(() => field.value?.focus())
}
function onFieldKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && !query.value) {
    searching.value = false
    e.preventDefault()
    return
  }
  search.onKey(e)
}
function onHeroKey(e: KeyboardEvent): void {
  if (e.target instanceof HTMLInputElement) return
  if (e.key === 'ArrowRight') go(index.value + 1)
  else if (e.key === 'ArrowLeft') go(index.value - 1)
  else return
  e.preventDefault()
}
</script>

<template>
  <section class="v02 relative min-h-full" aria-label="Create" @keydown="onHeroKey">
    <div
      class="v02-stage"
      @pointerenter="held = true"
      @pointerleave="held = false"
      @focusin="held = true"
      @focusout="held = false"
    >
      <Transition name="v02-x">
        <div :key="hero.id" class="v02-media" aria-hidden="true">
          <img :src="hero.poster" alt="" />
          <video
            v-if="hero.clip && !still"
            :src="hero.clip"
            :poster="hero.poster"
            muted
            loop
            playsinline
            autoplay
          />
        </div>
      </Transition>
      <div class="v02-shade" aria-hidden="true" />

      <div class="v02-top">
        <span class="v02-name">Create a workflow</span>
        <div class="v02-pill-slot">
          <label v-if="searching || query" class="v02-field">
            <Search :size="15" class="shrink-0 opacity-70" />
            <input
              ref="field"
              v-model="query"
              type="text"
              placeholder="Search templates, workflows and nodes"
              aria-label="Search workflows, templates and nodes"
              @keydown="onFieldKey"
              @blur="!query && (searching = false)"
            />
            <button
              type="button"
              class="opacity-70 hover:opacity-100"
              aria-label="Close search"
              @mousedown.prevent
              @click="((query = ''), (searching = false))"
            >
              <X :size="14" />
            </button>
          </label>
          <button v-else type="button" class="v02-pill" @click="openSearch">
            <Search :size="14" />Search
          </button>
        </div>
        <button
          type="button"
          class="v02-close"
          aria-label="Close"
          title="Close"
          @click="closeCreate"
        >
          <X :size="16" />
        </button>
      </div>

      <div v-if="search.q.value" class="v02-results">
        <LookAResults :search :query />
      </div>

      <Transition v-else name="v02-copy" mode="out-in">
        <div :key="hero.id" class="v02-copy">
          <CategoryChip :category="hero.media" />
          <h1 class="v02-title">{{ hero.makes }}</h1>
          <p class="v02-line">{{ hero.line }}. Built on {{ hero.model }}.</p>
          <div class="v02-act">
            <Button variant="primary" class="v02-use" @click="openTemplate(hero.template)">
              Use template
            </Button>
            <span class="v02-ready" :class="`is-${heroReady.tone}`">
              <Check v-if="heroReady.tone === 'ready'" :size="14" />
              <Download v-else-if="heroReady.tone === 'fetch'" :size="14" />
              {{
                heroReady.tone === 'ready'
                  ? `Ready to run on ${activeInstance.name}`
                  : heroReady.tone === 'fetch'
                    ? `${heroReady.label.replace(' · ', ' download · ')}, then it runs`
                    : heroReady.label
              }}
            </span>
          </div>
        </div>
      </Transition>

      <div v-if="!search.q.value" class="v02-nav">
        <button
          type="button"
          class="v02-arrow"
          aria-label="Previous template"
          @click="go(index - 1)"
        >
          <ChevronLeft :size="18" />
        </button>
        <span class="v02-count">{{ index + 1 }} / {{ reel.length }}</span>
        <button type="button" class="v02-arrow" aria-label="Next template" @click="go(index + 1)">
          <ChevronRight :size="18" />
        </button>
      </div>
    </div>

    <div class="v02-strip" role="tablist" data-no-pill aria-label="Templates">
      <button
        v-for="(s, i) in reel"
        :key="s.id"
        type="button"
        role="tab"
        class="v02-frame"
        :class="[i === index && 'is-on', held && 'is-held']"
        :aria-selected="i === index"
        :data-v02-frame="i"
        @click="go(i)"
        @dblclick="openTemplate(s.template)"
      >
        <img :src="s.poster" alt="" loading="lazy" />
        <span class="v02-frame-name">{{ s.makes }}</span>
        <span v-if="i === index && !still" :key="cycle" class="v02-progress" />
      </button>
    </div>

    <footer class="v02-foot">
      <button
        type="button"
        class="v02-chip"
        :title="`Empty canvas on ${activeInstance.name}`"
        @click="startBlank"
      >
        <Plus :size="14" />Blank canvas
      </button>
      <span v-if="recents.length" class="v02-sep" aria-hidden="true" />
      <span v-if="recents.length" class="shrink-0 text-ui text-subtle-foreground">Recent</span>
      <div class="v02-recents">
        <button
          v-for="w in recents"
          :key="w.id"
          type="button"
          class="v02-chip"
          :title="`${buildOf(w)?.name ?? ''} · ${w.modified}`"
          @click="openWorkflow(w)"
        >
          <span class="truncate">{{ w.name }}</span>
          <span class="text-subtle-foreground">{{ w.modified }}</span>
        </button>
      </div>
    </footer>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v02 {
  display: flex;
  flex-direction: column;
  isolation: isolate;
}
:root .proto-ui.proto-ui.proto-ui .v02-stage {
  position: relative;
  height: clamp(440px, 70vh, 740px);
  overflow: hidden;
  background: var(--color-card-background);
  color: white;
}
:root .proto-ui.proto-ui.proto-ui .v02-media {
  position: absolute;
  inset: 0;
}
:root .proto-ui.proto-ui.proto-ui .v02-media img,
:root .proto-ui.proto-ui.proto-ui .v02-media video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v02-media img {
  animation: v02-push 12s ease-out both;
}
:root .proto-ui.proto-ui.proto-ui .v02-shade {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(to top, var(--color-media-overlay) 0%, transparent 55%),
    linear-gradient(to right, var(--color-media-overlay) 0%, transparent 60%),
    linear-gradient(to bottom, var(--color-media-overlay) 0%, transparent 22%);
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v02-x-enter-active,
:root .proto-ui.proto-ui.proto-ui .v02-x-leave-active {
  transition: opacity 900ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v02-x-enter-from,
:root .proto-ui.proto-ui.proto-ui .v02-x-leave-to {
  opacity: 0;
}
:root .proto-ui.proto-ui.proto-ui .v02-top {
  position: absolute;
  inset: 0 0 auto;
  z-index: 3;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 16px 16px 0 40px;
}
:root .proto-ui.proto-ui.proto-ui .v02-name {
  font-size: var(--text-body);
  font-weight: 500;
  opacity: 0.8;
}
:root .proto-ui.proto-ui.proto-ui .v02-pill-slot {
  display: flex;
  justify-content: center;
}
:root .proto-ui.proto-ui.proto-ui .v02-pill,
:root .proto-ui.proto-ui.proto-ui .v02-field {
  display: inline-flex;
  height: 36px;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  border-radius: 999px;
  background: var(--color-media-overlay);
  color: white;
  font-size: var(--text-ui);
  backdrop-filter: blur(18px) saturate(1.4);
  box-shadow: inset 0 0 0 1px oklch(1 0 0 / 0.12);
}
:root .proto-ui.proto-ui.proto-ui .v02-pill:hover {
  box-shadow: inset 0 0 0 1px oklch(1 0 0 / 0.3);
}
:root .proto-ui.proto-ui.proto-ui .v02-field {
  width: min(520px, 50vw);
  animation: v02-widen 220ms var(--mar-ease, ease-out) both;
}
:root .proto-ui.proto-ui.proto-ui .v02-field:focus-within {
  box-shadow: inset 0 0 0 1px oklch(1 0 0 / 0.45);
}
:root .proto-ui.proto-ui.proto-ui .v02-field input {
  height: auto;
  min-width: 0;
  flex: 1;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  box-shadow: none;
  color: white;
  font: inherit;
  font-size: var(--text-body);
}
:root .proto-ui.proto-ui.proto-ui .v02-field input::placeholder {
  color: oklch(1 0 0 / 0.6);
}
:root .proto-ui.proto-ui.proto-ui .v02-close {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  justify-self: end;
  border-radius: 8px;
  background: var(--color-media-overlay);
  color: white;
  backdrop-filter: blur(18px);
}
:root .proto-ui.proto-ui.proto-ui .v02-results {
  position: absolute;
  inset: 68px 0 0;
  z-index: 2;
  overflow-y: auto;
  padding: 16px max(40px, calc((100% - 1000px) / 2)) 32px;
  background: color-mix(in oklch, var(--color-content-background) 92%, transparent);
  color: var(--color-base-foreground);
  backdrop-filter: blur(24px);
}
:root .proto-ui.proto-ui.proto-ui .v02-copy {
  position: absolute;
  bottom: 48px;
  left: 40px;
  z-index: 2;
  display: flex;
  max-width: min(640px, 60%);
  flex-direction: column;
  align-items: flex-start;
}
:root .proto-ui.proto-ui.proto-ui .v02-title {
  margin-top: 14px;
  font-size: clamp(40px, 5.4vw, 72px);
  font-weight: 650;
  line-height: 0.98;
  letter-spacing: -0.035em;
  text-shadow: 0 2px 24px oklch(0 0 0 / 0.35);
}
:root .proto-ui.proto-ui.proto-ui .v02-line {
  max-width: 52ch;
  margin-top: 14px;
  font-size: var(--text-heading);
  line-height: 1.45;
  opacity: 0.86;
}
:root .proto-ui.proto-ui.proto-ui .v02-act {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
  margin-top: 24px;
}
:root .proto-ui.proto-ui.proto-ui .v02-use {
  height: 44px;
  padding: 0 22px;
  border-radius: 999px;
  font-size: var(--text-body);
}
:root .proto-ui.proto-ui.proto-ui .v02-ready {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-ui);
  opacity: 0.9;
}
:root .proto-ui.proto-ui.proto-ui .v02-ready.is-ready svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v02-copy-enter-active {
  transition:
    opacity 480ms ease,
    transform 480ms var(--mar-ease, ease-out);
}
:root .proto-ui.proto-ui.proto-ui .v02-copy-leave-active {
  transition: opacity 200ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v02-copy-enter-from {
  opacity: 0;
  transform: translateY(14px);
}
:root .proto-ui.proto-ui.proto-ui .v02-copy-leave-to {
  opacity: 0;
}
:root .proto-ui.proto-ui.proto-ui .v02-nav {
  position: absolute;
  right: 32px;
  bottom: 48px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--text-ui);
  font-variant-numeric: tabular-nums;
}
:root .proto-ui.proto-ui.proto-ui .v02-arrow {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 999px;
  background: var(--color-media-overlay);
  color: white;
  backdrop-filter: blur(18px);
  box-shadow: inset 0 0 0 1px oklch(1 0 0 / 0.12);
}
:root .proto-ui.proto-ui.proto-ui .v02-arrow:hover {
  box-shadow: inset 0 0 0 1px oklch(1 0 0 / 0.35);
}
:root .proto-ui.proto-ui.proto-ui .v02-count {
  opacity: 0.75;
}
:root .proto-ui.proto-ui.proto-ui .v02-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 16px 40px 4px;
  scroll-padding: 0 40px;
  scrollbar-width: none;
}
:root .proto-ui.proto-ui.proto-ui .v02-frame {
  position: relative;
  width: 188px;
  flex: none;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: 10px;
  background: var(--color-card-background);
  opacity: 0.6;
  text-align: left;
  outline: none;
  transition:
    opacity 200ms ease,
    box-shadow 200ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v02-frame:hover,
:root .proto-ui.proto-ui.proto-ui .v02-frame.is-on {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v02-frame.is-on,
:root .proto-ui.proto-ui.proto-ui .v02-frame:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v02-frame img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v02-frame::after {
  content: '';
  position: absolute;
  inset: 40% 0 0;
  background: linear-gradient(to top, var(--color-media-overlay), transparent);
}
:root .proto-ui.proto-ui.proto-ui .v02-frame-name {
  position: absolute;
  right: 10px;
  bottom: 8px;
  left: 10px;
  z-index: 1;
  overflow: hidden;
  color: white;
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v02-progress {
  position: absolute;
  inset: auto 0 0;
  z-index: 2;
  height: 2px;
  background: white;
  transform-origin: left;
  animation: v02-fill 9000ms linear both;
}
:root .proto-ui.proto-ui.proto-ui .v02-frame.is-held .v02-progress {
  animation-play-state: paused;
}
:root .proto-ui.proto-ui.proto-ui .v02-foot {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 16px 40px 24px;
}
:root .proto-ui.proto-ui.proto-ui .v02-recents {
  display: flex;
  min-width: 0;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}
:root .proto-ui.proto-ui.proto-ui .v02-chip {
  display: inline-flex;
  height: 30px;
  max-width: 260px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v02-chip:hover {
  background: var(--color-secondary-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v02-sep {
  width: 1px;
  height: 18px;
  margin: 0 6px;
  background: var(--color-border-default);
}
@keyframes v02-push {
  from {
    transform: scale(1.06);
  }
}
@keyframes v02-fill {
  from {
    transform: scaleX(0);
  }
}
@keyframes v02-widen {
  from {
    opacity: 0;
    width: 120px;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v02-media img,
  :root .proto-ui.proto-ui.proto-ui .v02-field {
    animation: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v02-x-enter-active,
  :root .proto-ui.proto-ui.proto-ui .v02-x-leave-active,
  :root .proto-ui.proto-ui.proto-ui .v02-copy-enter-active,
  :root .proto-ui.proto-ui.proto-ui .v02-copy-leave-active {
    transition: none;
  }
}
</style>
