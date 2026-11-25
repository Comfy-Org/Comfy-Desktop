<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Check, Download, Flame, Plus, Search, Clock3, TrendingUp, X } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import CategoryChip from '../../CategoryChip.vue'
import MarSeg from '../../pages/MarSeg.vue'
import Sparkline from '../../../ui/Sparkline.vue'
import { allWorkflows, type ProjectWorkflow } from '../../../gallery'
import { activeInstance, instanceById } from '../../../useProto'
import { closeCreate, openTemplate, openWorkflow, startBlank } from '../createScreen'
import { readiness, searchStarters, SHELVES, type Starter } from '../createStarters'
import {
  allStarters,
  communityOf,
  costLine,
  fmtCount,
  playIn,
  stopIn,
  useCloseOnEsc,
  type Community
} from './lookD'

type Sort = 'trending' | 'new' | 'most'
const SORTS: { value: Sort; label: string; icon: typeof Flame }[] = [
  { value: 'trending', label: 'Trending', icon: Flame },
  { value: 'new', label: 'New', icon: Clock3 },
  { value: 'most', label: 'Most run', icon: TrendingUp }
]
const KINDS = [
  { value: 'all', label: 'Everything' },
  ...SHELVES.slice(1).map((s) => ({ value: s.id, label: s.label }))
]
const COLS = 3
const MAX = 9

const query = ref('')
const field = ref<HTMLInputElement>()
const sort = ref<Sort>('trending')
const kind = ref('all')
const at = ref(-1)
const q = computed(() => query.value.trim().toLowerCase())

interface Card {
  starter: Starter
  c: Community
}

const pool = computed<Starter[]>(() => {
  if (q.value) return searchStarters(q.value, 24)
  if (kind.value === 'all') return allStarters()
  return SHELVES.find((s) => s.id === kind.value)?.starters() ?? []
})

const cards = computed<Card[]>(() => {
  const list = pool.value.map((starter) => ({ starter, c: communityOf(starter) }))
  const by: Record<Sort, (a: Card, b: Card) => number> = {
    trending: (a, b) => b.c.trend - a.c.trend,
    new: (a, b) => a.c.days - b.c.days,
    most: (a, b) => b.c.runsWeek - a.c.runsWeek
  }
  return list.sort(by[sort.value]).slice(0, MAX)
})

const workflows = computed(() => [...allWorkflows.value].sort((a, b) => a.age - b.age))
const recents = computed(() =>
  q.value
    ? workflows.value.filter((w) => w.name.toLowerCase().includes(q.value)).slice(0, 4)
    : workflows.value.slice(0, 4)
)
const buildOf = (w: ProjectWorkflow) => (w.envId ? instanceById(w.envId) : undefined)

watch([q, sort, kind], () => (at.value = q.value ? 0 : -1))

function badge(c: Community): string {
  if (sort.value === 'new') return c.days <= 1 ? 'Out today' : `New, ${c.days} days ago`
  return `${fmtCount(c.today)} people made this today`
}

function key(e: KeyboardEvent): void {
  const last = cards.value.length - 1
  const browsing = at.value >= 0
  if (e.key === 'ArrowDown') at.value = Math.min(last, at.value < 0 ? 0 : at.value + COLS)
  else if (e.key === 'ArrowUp') at.value = at.value - COLS < 0 ? -1 : at.value - COLS
  else if (browsing && e.key === 'ArrowRight') at.value = Math.min(last, at.value + 1)
  else if (browsing && e.key === 'ArrowLeft') at.value = Math.max(0, at.value - 1)
  else if (e.key === 'Enter') {
    const card = cards.value[Math.max(0, at.value)]
    if (card && (q.value || browsing)) openTemplate(card.starter.template)
    else if (!card && q.value) startBlank()
  } else if (e.key === 'Escape') {
    if (query.value) query.value = ''
    else closeCreate()
  } else return
  e.preventDefault()
}

watch(at, (i, was) =>
  nextTick(() => {
    const el = (n: number) => document.querySelector<HTMLElement>(`[data-v17-at="${n}"]`)
    stopIn(el(was))
    const now = el(i)
    now?.scrollIntoView({ block: 'nearest' })
    playIn(now)
  })
)

useCloseOnEsc(field)
</script>

<template>
  <section class="v17" aria-label="Create">
    <button type="button" class="v17-close" aria-label="Close" title="Close" @click="closeCreate">
      <X :size="16" />
    </button>

    <div class="v17-wrap">
      <header class="v17-head">
        <div class="min-w-0">
          <h1 class="v17-title">Create a workflow</h1>
          <p class="v17-sub">Start from what people are making with Comfy this week.</p>
        </div>
        <div class="v17-bar">
          <label class="v17-field">
            <Search :size="16" class="shrink-0 text-subtle-foreground" />
            <input
              ref="field"
              v-model="query"
              type="text"
              placeholder="Search templates and your workflows"
              aria-label="Search templates and your workflows"
              @keydown="key"
            />
            <button
              v-if="query"
              type="button"
              class="v17-clear"
              aria-label="Clear search"
              @click="((query = ''), field?.focus())"
            >
              <X :size="13" />
            </button>
          </label>
          <button
            type="button"
            class="v17-blank"
            :title="`Empty canvas on ${activeInstance.name}`"
            @click="startBlank"
          >
            <Plus :size="15" />Blank canvas
          </button>
        </div>
      </header>

      <div class="v17-filters">
        <MarSeg v-model="sort" :options="SORTS" label="Sort templates" />
        <div v-if="!q" class="v17-kinds" role="tablist" aria-label="Show">
          <button
            v-for="k in KINDS"
            :key="k.value"
            type="button"
            role="tab"
            class="v17-kind"
            :aria-selected="kind === k.value"
            @click="kind = k.value"
          >
            {{ k.label }}
          </button>
        </div>
        <p v-else class="v17-count">{{ cards.length }} templates match “{{ query.trim() }}”</p>
      </div>

      <div :key="`${sort}-${kind}-${q}`" class="v17-grid">
        <button
          v-for="({ starter: s, c }, i) in cards"
          :key="s.id"
          type="button"
          class="v17-card group"
          :class="at === i && 'is-at'"
          :style="{ '--i': i }"
          :data-v17-at="i"
          @pointerenter="playIn($event.currentTarget)"
          @pointerleave="stopIn($event.currentTarget)"
          @focus="playIn($event.currentTarget)"
          @blur="stopIn($event.currentTarget)"
          @click="openTemplate(s.template)"
        >
          <span class="v17-media">
            <img :src="s.poster" alt="" loading="lazy" class="v17-pic" />
            <video
              v-if="s.clip"
              :src="s.clip"
              :poster="s.poster"
              muted
              loop
              playsinline
              preload="none"
              class="v17-pic v17-video"
            />
            <span class="v17-chip"><CategoryChip :category="s.media" /></span>
            <span class="v17-hot">
              <Flame v-if="sort !== 'new'" :size="12" />
              <Clock3 v-else :size="12" />
              {{ badge(c) }}
            </span>
            <span class="v17-peek">
              <span
                v-for="r in [readiness(s.template)]"
                :key="r.label"
                class="v17-peek-ready"
                :class="`is-${r.tone}`"
              >
                <Check v-if="r.tone === 'ready'" :size="13" />
                <Download v-else-if="r.tone === 'fetch'" :size="13" />
                {{ r.label }}
              </span>
              <span class="v17-peek-cost">{{ costLine(s.template) }}</span>
              <span class="v17-peek-go">Use template</span>
            </span>
          </span>

          <span class="v17-body">
            <span class="v17-row">
              <span class="min-w-0 flex-1">
                <span class="v17-name">{{ s.makes }}</span>
                <span class="v17-model">{{ s.model }}</span>
              </span>
              <span
                class="v17-runs"
                :title="`${c.runsWeek.toLocaleString('en-US')} runs this week`"
              >
                <Sparkline :values="c.week" :width="48" :height="18" />
                <span
                  ><b>{{ fmtCount(c.runsWeek) }}</b> runs this week</span
                >
              </span>
            </span>

            <span class="v17-others">
              <span class="v17-strip" aria-label="Made by others">
                <img v-for="(o, j) in c.outputs" :key="j" :src="o" alt="" loading="lazy" />
              </span>
              <span class="v17-by">
                <span class="v17-faces">
                  <i
                    v-for="m in [c.creator, ...c.makers.slice(0, 2)]"
                    :key="m.name"
                    class="v17-face"
                    :style="{ '--h': m.hue }"
                    >{{ m.initials }}</i
                  >
                </span>
                <span class="v17-by-text"
                  >by <b>{{ c.creator.name }}</b></span
                >
              </span>
            </span>
          </span>
        </button>
      </div>

      <div v-if="q && !cards.length" class="v17-none">
        <p>No template matches “{{ query.trim() }}”.</p>
        <button type="button" class="v17-blank" @click="startBlank">
          <Plus :size="15" />Start blank instead
        </button>
      </div>

      <section v-if="recents.length" class="v17-recent">
        <h2 class="v17-h2">{{ q ? 'Your workflows' : 'Pick up where you left off' }}</h2>
        <div class="v17-recent-row">
          <button
            v-for="w in recents"
            :key="w.id"
            type="button"
            class="v17-wf"
            @click="openWorkflow(w)"
          >
            <span class="v17-wf-cover"><WorkflowCover :name="w.name" /></span>
            <span class="flex min-w-0 flex-col">
              <span class="v17-name">{{ w.name }}</span>
              <span class="v17-model">{{ buildOf(w)?.name }}, {{ w.modified.toLowerCase() }}</span>
            </span>
          </button>
        </div>
      </section>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v17 {
  position: relative;
  min-height: 100%;
  padding: 0 32px 64px;
}
:root .proto-ui.proto-ui.proto-ui .v17-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 8px;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v17-close:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v17-wrap {
  max-width: 1180px;
  margin: 0 auto;
}
:root .proto-ui.proto-ui.proto-ui .v17-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding-top: 56px;
}
:root .proto-ui.proto-ui.proto-ui .v17-title {
  color: var(--color-base-foreground);
  font-size: var(--text-display);
  font-weight: 700;
  line-height: var(--text-display--line-height);
  letter-spacing: -0.02em;
}
:root .proto-ui.proto-ui.proto-ui .v17-sub {
  margin-top: 6px;
  color: var(--color-muted-foreground);
  font-size: var(--text-body, 15px);
}
:root .proto-ui.proto-ui.proto-ui .v17-bar {
  display: flex;
  width: min(520px, 50%);
  flex: none;
  gap: 8px;
}
:root .proto-ui.proto-ui.proto-ui .v17-field {
  display: flex;
  height: 42px;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 10px;
  padding: 0 10px 0 14px;
  border-radius: 999px;
  background: var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px transparent;
}
:root .proto-ui.proto-ui.proto-ui .v17-field:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v17-field input {
  height: auto;
  min-width: 0;
  flex: 1;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  box-shadow: none;
  color: var(--color-base-foreground);
  font: inherit;
  font-size: 14px;
}
:root .proto-ui.proto-ui.proto-ui .v17-field input::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v17-clear {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 999px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v17-blank {
  display: inline-flex;
  height: 42px;
  flex: none;
  align-items: center;
  gap: 7px;
  padding: 0 16px;
  border-radius: 999px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v17-blank:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v17-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
  margin: 32px 0 16px;
}
:root .proto-ui.proto-ui.proto-ui .v17-kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}
:root .proto-ui.proto-ui.proto-ui .v17-kind {
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v17-kind:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v17-kind[aria-selected='true'] {
  color: var(--color-base-foreground);
  font-weight: 500;
  box-shadow: inset 0 -2px 0 var(--color-base-foreground);
  border-radius: 0;
}
:root .proto-ui.proto-ui.proto-ui .v17-count {
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v17-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 28px 18px;
}
:root .proto-ui.proto-ui.proto-ui .v17-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  text-align: left;
  outline: none;
  animation: v17-rise 420ms var(--mar-ease, ease-out) both;
  animation-delay: calc(var(--i, 0) * 35ms);
}
:root .proto-ui.proto-ui.proto-ui .v17-media {
  position: relative;
  display: block;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: 14px;
  background: var(--color-card-background);
  transition: box-shadow 200ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v17-card:focus-visible .v17-media,
:root .proto-ui.proto-ui.proto-ui .v17-card.is-at .v17-media {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v17-pic {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition:
    transform 600ms var(--mar-ease, ease-out),
    opacity 300ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v17-video {
  opacity: 0;
}
:root .proto-ui.proto-ui.proto-ui .v17-card:hover .v17-pic,
:root .proto-ui.proto-ui.proto-ui .v17-card.is-at .v17-pic {
  transform: scale(1.03);
}
:root .proto-ui.proto-ui.proto-ui .v17-card:hover .v17-video,
:root .proto-ui.proto-ui.proto-ui .v17-card.is-at .v17-video,
:root .proto-ui.proto-ui.proto-ui .v17-card:focus-visible .v17-video {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v17-chip {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1;
}
:root .proto-ui.proto-ui.proto-ui .v17-hot {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1;
  display: inline-flex;
  height: 24px;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  border-radius: 999px;
  background: var(--color-media-overlay);
  color: white;
  font-size: 11px;
  font-weight: 600;
  backdrop-filter: blur(12px);
}
:root .proto-ui.proto-ui.proto-ui .v17-peek {
  position: absolute;
  inset: auto 8px 8px;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 2px 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--color-media-overlay);
  color: white;
  opacity: 0;
  transform: translateY(6px);
  backdrop-filter: blur(16px) saturate(1.4);
  transition:
    opacity 180ms ease,
    transform 220ms var(--mar-ease, ease-out);
}
:root .proto-ui.proto-ui.proto-ui .v17-card:hover .v17-peek,
:root .proto-ui.proto-ui.proto-ui .v17-card:focus-visible .v17-peek,
:root .proto-ui.proto-ui.proto-ui .v17-card.is-at .v17-peek {
  opacity: 1;
  transform: none;
}
:root .proto-ui.proto-ui.proto-ui .v17-peek-ready {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-ui);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v17-peek-ready.is-ready svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v17-peek-cost {
  grid-row: 2;
  font-size: 12px;
  opacity: 0.75;
}
:root .proto-ui.proto-ui.proto-ui .v17-peek-go {
  grid-row: span 2;
  padding: 7px 12px;
  border-radius: 8px;
  background: white;
  color: black;
  font-size: 12px;
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v17-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 2px 0;
}
:root .proto-ui.proto-ui.proto-ui .v17-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v17-name {
  display: block;
  overflow: hidden;
  color: var(--color-base-foreground);
  font-size: var(--text-heading);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v17-model {
  display: block;
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v17-runs {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  color: var(--color-subtle-foreground);
  font-size: 11px;
}
:root .proto-ui.proto-ui.proto-ui .v17-runs b {
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v17-others {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v17-strip {
  display: flex;
  gap: 3px;
}
:root .proto-ui.proto-ui.proto-ui .v17-strip img {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  object-fit: cover;
  opacity: 0.9;
}
:root .proto-ui.proto-ui.proto-ui .v17-by {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
:root .proto-ui.proto-ui.proto-ui .v17-faces {
  display: flex;
}
:root .proto-ui.proto-ui.proto-ui .v17-face {
  display: grid;
  width: 22px;
  height: 22px;
  margin-left: -6px;
  place-items: center;
  border-radius: 999px;
  background: oklch(0.72 0.11 var(--h));
  box-shadow: 0 0 0 2px var(--color-content-background);
  color: oklch(0.22 0.05 var(--h));
  font-size: 9px;
  font-style: normal;
  font-weight: 700;
}
:root .proto-ui.proto-ui.proto-ui .v17-face:first-child {
  margin-left: 0;
}
:root .proto-ui.proto-ui.proto-ui .v17-by-text {
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v17-by-text b {
  color: var(--color-muted-foreground);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v17-none {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 24px 0;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v17-recent {
  margin-top: 48px;
}
:root .proto-ui.proto-ui.proto-ui .v17-h2 {
  margin-bottom: 12px;
  color: var(--color-base-foreground);
  font-size: var(--text-heading);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v17-recent-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v17-wf {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: 12px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .v17-wf:hover {
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v17-wf .v17-name {
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v17-wf-cover {
  position: relative;
  width: 64px;
  height: 44px;
  flex: none;
  overflow: hidden;
  border-radius: 8px;
}
@keyframes v17-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
@media (max-width: 1000px) {
  :root .proto-ui.proto-ui.proto-ui .v17-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  :root .proto-ui.proto-ui.proto-ui .v17-head {
    flex-direction: column;
    align-items: stretch;
  }
  :root .proto-ui.proto-ui.proto-ui .v17-bar {
    width: 100%;
  }
  :root .proto-ui.proto-ui.proto-ui .v17-recent-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v17-card,
  :root .proto-ui.proto-ui.proto-ui .v17-pic,
  :root .proto-ui.proto-ui.proto-ui .v17-peek {
    animation: none;
    transition: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v17-card:hover .v17-pic {
    transform: none;
  }
}
</style>
