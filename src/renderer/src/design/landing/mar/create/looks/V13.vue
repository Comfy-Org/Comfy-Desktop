<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-vue-next'
import CategoryChip from '../../CategoryChip.vue'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { activeInstance } from '../../../useProto'
import { closeCreate, openTemplate, openWorkflow, startBlank } from '../createScreen'
import { readiness, SHELVES, type Starter } from '../createStarters'
import CSearch from './CSearch.vue'
import {
  buildOf,
  fitOf,
  ofCases,
  playIn,
  recentWorkflows,
  startersWhere,
  stopIn,
  useCreateKeys
} from './cLooks'

interface Row {
  id: string
  title: string
  starters: Starter[]
}

const ROW_MAX = 10

const query = ref('')
const field = ref<HTMLInputElement>()
const results = ref<InstanceType<typeof CSearch>>()
const hover = ref<{ row: string; id: string } | null>(null)
useCreateKeys(field)

const recents = computed(() => recentWorkflows(8))
const lastMade = computed(() => recents.value[0])

const rows = computed<Row[]>(() => {
  const quick = startersWhere((w) => w.runs !== 'cloud', 60)
    .filter((s) => fitOf(s.template).band === 'now' || (fitOf(s.template).gb || 99) < 6)
    .slice(0, ROW_MAX)
  const because = lastMade.value
  const list: Row[] = [
    { id: 'popular', title: 'Popular now', starters: SHELVES[0]!.starters() },
    { id: 'quick', title: 'Quick wins, under a minute', starters: quick },
    {
      id: 'video',
      title: 'Make it move',
      starters: startersWhere(ofCases('Video generation', 'Video editing'), ROW_MAX)
    },
    {
      id: 'fix',
      title: 'Edit and fix',
      starters: startersWhere(ofCases('Image editing', 'Upscale'), ROW_MAX)
    }
  ]
  if (because)
    list.splice(2, 0, {
      id: 'because',
      title: `Because you made ${because.name}`,
      starters: startersWhere(
        because.category === 'video'
          ? ofCases('Video editing', 'Characters & fashion', 'Upscale')
          : ofCases('Characters & fashion', 'Brand & design', 'Product & ads'),
        ROW_MAX
      )
    })
  list.push({
    id: '3d',
    title: '3D and sound',
    starters: startersWhere(ofCases('3D', 'Audio'), ROW_MAX)
  })
  return list.filter((r) => r.starters.length)
})

const isHover = (row: string, s: Starter): boolean =>
  hover.value?.row === row && hover.value.id === s.id

function enter(e: Event, row: string, s: Starter): void {
  hover.value = { row, id: s.id }
  playIn(e.currentTarget)
}
function leave(e: Event): void {
  hover.value = null
  stopIn(e.currentTarget)
}

function scrollRow(e: Event, dir: number): void {
  const track = (e.currentTarget as HTMLElement).closest('.v13-row')?.querySelector('.v13-track')
  if (!track) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: reduce ? 'auto' : 'smooth' })
}

function onKey(e: KeyboardEvent): void {
  if (results.value?.onKey(e)) return
  if (e.key === 'Escape') {
    e.preventDefault()
    closeCreate()
  }
}
</script>

<template>
  <section class="v13 relative min-h-full pb-16" aria-label="Create">
    <button type="button" class="v13-close" aria-label="Close" title="Close" @click="closeCreate">
      <X :size="16" />
    </button>

    <header class="v13-head">
      <h1 class="text-title font-semibold text-base-foreground">Create a workflow</h1>
      <label class="v13-field">
        <Search :size="15" class="shrink-0 text-subtle-foreground" />
        <input
          ref="field"
          v-model="query"
          type="text"
          placeholder="Search workflows, templates and nodes"
          aria-label="Search workflows, templates and nodes"
          @keydown="onKey"
        />
        <button
          v-if="query"
          type="button"
          class="text-subtle-foreground"
          aria-label="Clear search"
          @click="((query = ''), field?.focus())"
        >
          <X :size="14" />
        </button>
      </label>
      <button
        type="button"
        class="v13-blank"
        :title="`Empty canvas on ${activeInstance.name}`"
        @click="startBlank"
      >
        <Plus :size="15" />Blank canvas
      </button>
    </header>

    <div v-if="query.trim()" class="v13-pad mt-6">
      <CSearch ref="results" :query @clear="query = ''" />
    </div>

    <template v-else>
      <section v-if="recents.length" class="v13-row" aria-label="Continue">
        <h2 class="v13-row-title">Pick up where you left off</h2>
        <div class="v13-track is-recent">
          <button
            v-for="w in recents"
            :key="w.id"
            type="button"
            class="v13-recent"
            @click="openWorkflow(w)"
          >
            <span class="v13-recent-cover"><WorkflowCover :name="w.name" /></span>
            <span class="mt-2 block truncate text-ui font-medium text-base-foreground">{{
              w.name
            }}</span>
            <span class="block truncate text-ui text-subtle-foreground"
              >{{ buildOf(w)?.name }} · {{ w.modified }}</span
            >
          </button>
        </div>
      </section>

      <section v-for="(row, ri) in rows" :key="row.id" class="v13-row" :aria-label="row.title">
        <div class="v13-row-head">
          <h2 class="v13-row-title">{{ row.title }}</h2>
          <div class="v13-arrows">
            <button type="button" aria-label="Scroll back" @click="scrollRow($event, -1)">
              <ChevronLeft :size="16" />
            </button>
            <button type="button" aria-label="Scroll on" @click="scrollRow($event, 1)">
              <ChevronRight :size="16" />
            </button>
          </div>
        </div>
        <div class="v13-track" :class="ri === 0 && 'is-first'">
          <button
            v-for="(s, i) in row.starters"
            :key="s.id"
            type="button"
            class="v13-poster group"
            :class="[ri === 0 && i === 0 && 'is-big', isHover(row.id, s) && 'is-on']"
            @pointerenter="enter($event, row.id, s)"
            @pointerleave="leave"
            @focus="enter($event, row.id, s)"
            @blur="leave"
            @click="openTemplate(s.template)"
          >
            <span class="v13-poster-media">
              <img :src="s.poster" alt="" loading="lazy" />
              <video
                v-if="s.clip"
                :src="s.clip"
                :poster="s.poster"
                muted
                loop
                playsinline
                preload="none"
              />
            </span>
            <span class="v13-poster-chip"><CategoryChip :category="s.media" /></span>
            <span class="v13-poster-text">
              <span class="v13-poster-title">{{ s.makes }}</span>
              <span class="v13-poster-model">{{ s.model }}</span>
              <span class="v13-poster-more" aria-live="polite">
                <span class="v13-poster-line">{{ s.line }}.</span>
                <span v-if="isHover(row.id, s)" class="v13-poster-ready">{{
                  readiness(s.template).label
                }}</span>
              </span>
            </span>
          </button>
        </div>
      </section>
    </template>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v13 {
  container-type: inline-size;
  isolation: isolate;
}
:root .proto-ui.proto-ui.proto-ui .v13 > * {
  --v13-gutter: max(32px, calc((100cqw - 1280px) / 2));
}
:root .proto-ui.proto-ui.proto-ui .v13-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: var(--radius-control);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v13-close:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v13-head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 48px var(--v13-gutter) 8px;
}
:root .proto-ui.proto-ui.proto-ui .v13-pad {
  padding: 0 var(--v13-gutter);
}
:root .proto-ui.proto-ui.proto-ui .v13-field {
  display: flex;
  height: 36px;
  width: 360px;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  padding: 0 10px 0 12px;
  border-radius: 999px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v13-field:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v13-field input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-base-foreground);
  font: inherit;
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v13-field input::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v13-blank {
  display: inline-flex;
  height: 36px;
  align-items: center;
  gap: 6px;
  margin-right: 32px;
  padding: 0 14px;
  border-radius: 999px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v13-blank:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v13-row {
  margin-top: 28px;
}
:root .proto-ui.proto-ui.proto-ui .v13-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: var(--v13-gutter);
}
:root .proto-ui.proto-ui.proto-ui .v13-row-title {
  padding: 0 var(--v13-gutter);
  margin-bottom: 10px;
  color: var(--color-base-foreground);
  font-size: var(--text-heading);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v13-row-head .v13-row-title {
  padding-right: 0;
}
:root .proto-ui.proto-ui.proto-ui .v13-arrows {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
}
:root .proto-ui.proto-ui.proto-ui .v13-arrows button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 999px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v13-arrows button:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v13-track {
  display: flex;
  gap: 12px;
  padding: 4px var(--v13-gutter) 12px;
  overflow-x: auto;
  scroll-padding: 0 var(--v13-gutter);
  scroll-snap-type: x proximity;
  scrollbar-width: none;
}
:root .proto-ui.proto-ui.proto-ui .v13-track::-webkit-scrollbar {
  display: none;
}
:root .proto-ui.proto-ui.proto-ui .v13-poster {
  position: relative;
  width: 190px;
  height: 250px;
  flex: none;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--color-card-background);
  text-align: left;
  outline: none;
  scroll-snap-align: start;
  transition:
    width 360ms var(--mar-ease, ease-out),
    box-shadow 200ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v13-poster.is-big {
  width: 400px;
}
:root .proto-ui.proto-ui.proto-ui .v13-poster.is-on {
  width: 340px;
}
:root .proto-ui.proto-ui.proto-ui .v13-poster.is-big.is-on {
  width: 460px;
}
:root .proto-ui.proto-ui.proto-ui .v13-poster:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v13-poster-media img,
:root .proto-ui.proto-ui.proto-ui .v13-poster-media video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v13-poster-media video {
  opacity: 0;
  transition: opacity 300ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v13-poster.is-on .v13-poster-media video {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v13-poster::after {
  content: '';
  position: absolute;
  inset: 35% 0 0;
  background: linear-gradient(
    to top,
    var(--color-media-overlay),
    color-mix(in oklch, var(--color-media-overlay) 50%, transparent) 55%,
    transparent
  );
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v13-poster-chip {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1;
}
:root .proto-ui.proto-ui.proto-ui .v13-poster-text {
  position: absolute;
  inset: auto 0 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  padding: 14px;
}
:root .proto-ui.proto-ui.proto-ui .v13-poster-title {
  color: white;
  font-size: var(--text-heading);
  font-weight: 600;
  line-height: 20px;
}
:root .proto-ui.proto-ui.proto-ui .v13-poster.is-big .v13-poster-title {
  font-size: var(--text-title);
  line-height: var(--text-title--line-height);
}
:root .proto-ui.proto-ui.proto-ui .v13-poster-model {
  margin-top: 2px;
  color: rgb(255 255 255 / 0.7);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v13-poster-more {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows 300ms var(--mar-ease, ease-out),
    opacity 200ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v13-poster-more > * {
  min-height: 0;
}
:root .proto-ui.proto-ui.proto-ui .v13-poster.is-on .v13-poster-more {
  grid-template-rows: 1fr;
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v13-poster-line {
  display: -webkit-box;
  margin-top: 8px;
  overflow: hidden;
  color: rgb(255 255 255 / 0.85);
  font-size: var(--text-ui);
  line-height: 18px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
:root .proto-ui.proto-ui.proto-ui .v13-poster-ready {
  margin-top: 8px;
  color: rgb(255 255 255 / 0.7);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v13-poster.is-big .v13-poster-more {
  grid-template-rows: 1fr;
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v13-recent {
  width: 200px;
  flex: none;
  text-align: left;
  scroll-snap-align: start;
}
:root .proto-ui.proto-ui.proto-ui .v13-recent-cover {
  display: block;
  height: 112px;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--color-card-background);
}
:root .proto-ui.proto-ui.proto-ui .v13-recent:hover .v13-recent-cover {
  background: var(--color-card-background-hover);
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v13-poster,
  :root .proto-ui.proto-ui.proto-ui .v13-poster-more {
    transition: none;
  }
}
</style>
