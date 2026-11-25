<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { ArrowUpRight, CornerDownLeft, Plus, Search, X } from 'lucide-vue-next'
import WorkflowCover from '../brand/WorkflowCover.vue'
import CategoryChip from '../CategoryChip.vue'
import MarSeg from '../pages/MarSeg.vue'
import CreateBackdrop from './CreateBackdrop.vue'
import { allWorkflows, type ProjectWorkflow } from '../../gallery'
import { activeInstance, instanceById } from '../../useProto'
import { thumb } from '../../mock'
import { NODE_TYPES, type NodeKind } from '../graph/canvasData'
import { NODE_ICONS } from '../graph/nodeIcons'
import { recentsCover } from '../cover'
import { closeCreate, openTemplate, openWorkflow, startBlank, startWithNode } from './createScreen'
import { readiness, searchStarters, SHELVES, type Starter } from './createStarters'

type Hit =
  | { id: string; type: 'workflow'; workflow: ProjectWorkflow }
  | { id: string; type: 'template'; starter: Starter }
  | { id: string; type: 'node'; node: NodeKind }
  | { id: string; type: 'blank' }

const KINDS = Object.keys(NODE_TYPES) as NodeKind[]
const BLANK: Hit = { id: 'blank', type: 'blank' }
const SHELF_MAX = 7
const RECENT_MAX = 8

const workflowHit = (workflow: ProjectWorkflow): Hit => ({
  id: `workflow:${workflow.id}`,
  type: 'workflow',
  workflow
})
const templateHit = (starter: Starter): Hit => ({
  id: `template:${starter.id}`,
  type: 'template',
  starter
})

const query = ref('')
const at = ref(-1)
const field = ref<HTMLInputElement>()
const shelf = ref(SHELVES[0]!.id)
const shelfOptions = SHELVES.map((s) => ({ value: s.id, label: s.label }))

const q = computed(() => query.value.trim().toLowerCase())
const workflows = computed(() => [...allWorkflows.value].sort((a, b) => a.age - b.age))
const matches = (text: string): boolean => text.toLowerCase().includes(q.value)

const starters = computed(() =>
  (SHELVES.find((s) => s.id === shelf.value) ?? SHELVES[0]!).starters().slice(0, SHELF_MAX)
)
const recents = computed(() => workflows.value.slice(0, RECENT_MAX))

const sections = computed<{ title: string; hits: Hit[] }[]>(() => {
  if (!q.value) return []
  return [
    {
      title: 'Workflows',
      hits: workflows.value
        .filter((w) => matches(w.name))
        .slice(0, 5)
        .map(workflowHit)
    },
    { title: 'Templates', hits: searchStarters(q.value, 5).map(templateHit) },
    {
      title: 'Nodes',
      hits: KINDS.filter((k) => matches(`${NODE_TYPES[k].title} ${NODE_TYPES[k].description}`))
        .slice(0, 4)
        .map((node): Hit => ({ id: `node:${node}`, type: 'node', node }))
    },
    { title: '', hits: [BLANK] }
  ].filter((s) => s.hits.length)
})

const flat = computed<Hit[]>(() =>
  q.value
    ? sections.value.flatMap((s) => s.hits)
    : [...starters.value.map(templateHit), BLANK, ...recents.value.map(workflowHit)]
)
const found = computed(() => flat.value.some((h) => h.type !== 'blank'))
const indexOf = (hit: Hit): number => flat.value.findIndex((h) => h.id === hit.id)
const current = computed(() => flat.value[at.value])
watch(q, (v) => (at.value = v ? 0 : -1))
watch(shelf, () => (at.value = -1))

function pick(hit: Hit): void {
  if (hit.type === 'workflow') openWorkflow(hit.workflow)
  else if (hit.type === 'template') openTemplate(hit.starter.template)
  else if (hit.type === 'node') startWithNode(hit.node)
  else startBlank()
}

const buildOf = (w: ProjectWorkflow) => (w.envId ? instanceById(w.envId) : undefined)

function title(hit: Hit): string {
  if (hit.type === 'workflow') return hit.workflow.name
  if (hit.type === 'template') return hit.starter.makes
  if (hit.type === 'node') return NODE_TYPES[hit.node].title
  return 'Blank canvas'
}
function meta(hit: Hit): string {
  if (hit.type === 'workflow') return buildOf(hit.workflow)?.name ?? ''
  if (hit.type === 'template') return hit.starter.model
  if (hit.type === 'node') return NODE_TYPES[hit.node].description
  return `Empty canvas on ${activeInstance.value.name}`
}
const icon = (hit: Hit): Component =>
  hit.type === 'node' ? NODE_ICONS[hit.node] : hit.type === 'blank' ? Plus : Search

const workflowPicture = (w: ProjectWorkflow): string | undefined =>
  recentsCover.id === 'image' ? thumb(w.thumbId) : undefined
const hueOf = (w: ProjectWorkflow): string => `--h: ${buildOf(w)?.hue ?? 250}`

function playIn(el: EventTarget | Element | null | undefined): void {
  const video = (el as Element | null)?.querySelector?.('video')
  if (video) void video.play().catch(() => undefined)
}
function stopIn(el: EventTarget | Element | null | undefined): void {
  const video = (el as Element | null)?.querySelector?.('video')
  if (!video) return
  video.pause()
  video.currentTime = 0
}

function key(e: KeyboardEvent): void {
  const last = flat.value.length - 1
  const sideways = !q.value && at.value >= 0
  if (e.key === 'ArrowDown' || (sideways && e.key === 'ArrowRight'))
    at.value = Math.min(last, at.value + 1)
  else if (e.key === 'ArrowUp' || (sideways && e.key === 'ArrowLeft'))
    at.value = Math.max(q.value ? 0 : -1, at.value - 1)
  else if (e.key === 'Enter') {
    const hit = flat.value[Math.max(0, at.value)]
    if (hit && (q.value || at.value >= 0)) pick(hit)
  } else if (e.key === 'Escape') {
    if (query.value) query.value = ''
    else closeCreate()
  } else return
  e.preventDefault()
}

watch(at, (i, was) => {
  nextTick(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-mcs-at]')
    els.forEach((el) => Number(el.dataset.mcsAt) === was && stopIn(el))
    const el = [...els].find((x) => Number(x.dataset.mcsAt) === i)
    if (!el) return
    el.scrollIntoView({ block: 'nearest' })
    playIn(el)
  })
})

function onWindowKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && document.activeElement !== field.value) closeCreate()
}
onMounted(() => {
  field.value?.focus()
  window.addEventListener('keydown', onWindowKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKey))
</script>

<template>
  <section class="mcs relative min-h-full px-8 pb-20" aria-label="Create">
    <CreateBackdrop />
    <button type="button" class="mcs-close" aria-label="Close" title="Close" @click="closeCreate">
      <X :size="16" />
    </button>

    <div class="relative mx-auto flex w-full max-w-280 flex-col">
      <header class="mcs-hero">
        <h1 class="heading-gradient text-center text-display font-bold tracking-[-0.02em]">
          Create a workflow
        </h1>
        <p class="mt-2 text-center text-body text-muted-foreground">
          Start from a template that already works, or pick up one of yours.
        </p>
        <div class="mcs-bar">
          <label class="mcs-field">
            <Search :size="18" class="shrink-0 text-subtle-foreground" />
            <input
              ref="field"
              v-model="query"
              type="text"
              placeholder="Search workflows, templates and nodes"
              aria-label="Search workflows, templates and nodes"
              aria-controls="mcs-list"
              @keydown="key"
            />
            <kbd v-if="!query" class="mcs-kbd">Esc</kbd>
            <button
              v-else
              type="button"
              class="mcs-clear"
              aria-label="Clear search"
              @click="((query = ''), field?.focus())"
            >
              <X :size="14" />
            </button>
          </label>
          <button
            type="button"
            class="mcs-blank"
            :class="!q && indexOf(BLANK) === at && 'is-at'"
            :data-mcs-at="q ? undefined : indexOf(BLANK)"
            :title="`Empty canvas on ${activeInstance.name}`"
            @click="startBlank"
          >
            <Plus :size="16" />Blank canvas
          </button>
        </div>
      </header>

      <div v-if="!q" id="mcs-list" class="mcs-empty">
        <section class="mcs-section">
          <div class="mcs-sec-row">
            <h2 class="mcs-sec">Templates</h2>
            <div class="mcs-shelves">
              <MarSeg v-model="shelf" :options="shelfOptions" label="Templates for" />
            </div>
          </div>
          <div :key="shelf" class="mcs-grid">
            <button
              v-for="(s, i) in starters"
              :key="s.id"
              type="button"
              class="mcs-tpl group"
              :class="[i === 0 && 'is-feature', indexOf(templateHit(s)) === at && 'is-at']"
              :style="{ '--i': i }"
              :data-mcs-at="indexOf(templateHit(s))"
              @pointerenter="playIn($event.currentTarget)"
              @pointerleave="stopIn($event.currentTarget)"
              @focus="playIn($event.currentTarget)"
              @blur="stopIn($event.currentTarget)"
              @click="openTemplate(s.template)"
            >
              <img :src="s.poster" alt="" loading="lazy" class="mcs-tpl-pic" />
              <video
                v-if="s.clip"
                :src="s.clip"
                :poster="s.poster"
                muted
                loop
                playsinline
                preload="none"
                class="mcs-tpl-pic mcs-tpl-video"
              />
              <span class="mcs-tpl-chip"><CategoryChip :category="s.media" /></span>
              <span class="mcs-tpl-go"><ArrowUpRight :size="16" /></span>
              <span class="mcs-tpl-text">
                <span class="mcs-tpl-title">{{ s.makes }}</span>
                <span class="mcs-tpl-model">{{ s.model }}</span>
                <span v-if="i === 0" class="mcs-tpl-line">{{ s.line }}.</span>
              </span>
            </button>
          </div>
        </section>

        <section v-if="recents.length" class="mcs-section">
          <div class="mcs-sec-row">
            <h2 class="mcs-sec">Recent workflows</h2>
          </div>
          <div class="mcs-recents">
            <button
              v-for="(w, i) in recents"
              :key="w.id"
              type="button"
              class="mcs-recent"
              :class="indexOf(workflowHit(w)) === at && 'is-at'"
              :style="[hueOf(w), { '--i': i }]"
              :data-mcs-at="indexOf(workflowHit(w))"
              @click="openWorkflow(w)"
            >
              <span class="mcs-recent-cover">
                <img v-if="workflowPicture(w)" :src="workflowPicture(w)" alt="" loading="lazy" />
                <WorkflowCover v-else :name="w.name" />
                <span class="mcs-recent-tint" />
              </span>
              <span class="mcs-recent-name">{{ w.name }}</span>
              <span class="mcs-recent-meta">
                <i class="mcs-dot" />
                <span class="min-w-0 flex-1 truncate">{{ buildOf(w)?.name }}</span>
                <span class="shrink-0">{{ w.modified }}</span>
              </span>
            </button>
          </div>
        </section>
      </div>

      <div v-else class="mcs-results">
        <div id="mcs-list" class="flex min-w-0 flex-1 flex-col">
          <template v-for="s in sections" :key="s.title || 'blank'">
            <h2 v-if="s.title" class="mcs-sec mcs-sec-list">{{ s.title }}</h2>
            <button
              v-for="hit in s.hits"
              :key="hit.id"
              type="button"
              class="mcs-row"
              :class="indexOf(hit) === at && 'is-at'"
              :data-mcs-at="indexOf(hit)"
              @pointermove="at = indexOf(hit)"
              @click="pick(hit)"
            >
              <span class="mcs-thumb" :class="`is-${hit.type}`">
                <WorkflowCover v-if="hit.type === 'workflow'" :name="hit.workflow.name" />
                <img
                  v-else-if="hit.type === 'template'"
                  :src="hit.starter.poster"
                  alt=""
                  loading="lazy"
                />
                <component :is="icon(hit)" v-else :size="18" />
              </span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-body text-base-foreground">{{ title(hit) }}</span>
                <span class="truncate text-ui text-subtle-foreground">{{ meta(hit) }}</span>
              </span>
              <span v-if="hit.type === 'workflow'" class="shrink-0 text-ui text-subtle-foreground">
                {{ hit.workflow.modified }}
              </span>
              <CornerDownLeft
                v-if="indexOf(hit) === at"
                :size="14"
                class="shrink-0 text-subtle-foreground"
              />
            </button>
          </template>
          <p v-if="!found" class="px-3 pt-2 pb-4 text-ui text-subtle-foreground">
            No workflow, template or node matches “{{ query.trim() }}”.
          </p>
        </div>

        <aside v-if="current" class="mcs-peek" aria-live="polite">
          <div class="mcs-peek-media" :class="`is-${current.type}`">
            <WorkflowCover v-if="current.type === 'workflow'" :name="current.workflow.name" />
            <template v-else-if="current.type === 'template'">
              <img :src="current.starter.poster" alt="" />
              <video
                v-if="current.starter.clip"
                :key="current.starter.clip"
                :src="current.starter.clip"
                muted
                loop
                playsinline
                autoplay
              />
            </template>
            <component :is="icon(current)" v-else :size="28" />
          </div>
          <p class="mt-4 text-heading font-medium text-base-foreground">{{ title(current) }}</p>
          <p class="mt-1 text-ui text-muted-foreground">
            <template v-if="current.type === 'template'">{{ current.starter.line }}.</template>
            <template v-else-if="current.type === 'workflow'"
              >On {{ meta(current) }}, edited
              {{ current.workflow.modified.toLowerCase() }}.</template
            >
            <template v-else-if="current.type === 'node'"
              >Starts a canvas on {{ activeInstance.name }} with this node on it.</template
            >
            <template v-else>{{ meta(current) }}.</template>
          </p>
          <span
            v-if="current.type === 'template'"
            class="mcs-ready mcs-peek-ready"
            :class="`is-${readiness(current.starter.template).tone}`"
            >{{ readiness(current.starter.template).label }}</span
          >
          <p class="mcs-peek-hint">
            <kbd class="mcs-kbd">↵</kbd>
            {{
              current.type === 'workflow'
                ? 'Open'
                : current.type === 'template'
                  ? 'Use template'
                  : 'Start'
            }}
          </p>
        </aside>
      </div>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mcs {
  --mcs-glass: rgb(14 14 16 / 0.28);
  isolation: isolate;
}
:root .proto-ui.proto-ui.proto-ui .mcs-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: var(--mar-tab-item-radius, 8px);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mcs-close:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mcs-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: clamp(56px, 11vh, 112px);
  animation: mcs-rise 520ms var(--mar-ease, ease-out) both;
}
:root .proto-ui.proto-ui.proto-ui .mcs-bar {
  display: flex;
  width: 100%;
  max-width: 760px;
  gap: 10px;
  margin-top: 28px;
}
:root .proto-ui.proto-ui.proto-ui .mcs-field {
  display: flex;
  height: 56px;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 12px;
  padding: 0 16px 0 22px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-secondary-background) 82%, transparent);
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 10%, transparent),
    0 18px 48px -24px oklch(0 0 0 / 0.8);
  backdrop-filter: blur(14px);
  transition: box-shadow 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mcs-field:focus-within {
  box-shadow:
    inset 0 0 0 1px var(--color-border-focus),
    0 0 0 4px color-mix(in oklch, var(--color-base-foreground) 6%, transparent),
    0 18px 48px -24px oklch(0 0 0 / 0.8);
}
:root .proto-ui.proto-ui.proto-ui .mcs-field input {
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
  font-size: 16px;
}
:root .proto-ui.proto-ui.proto-ui .mcs-field input::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mcs-kbd {
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--color-secondary-background-hover);
  color: var(--color-subtle-foreground);
  font: inherit;
  font-size: 11px;
}
:root .proto-ui.proto-ui.proto-ui .mcs-clear {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 999px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mcs-clear:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mcs-blank {
  display: inline-flex;
  height: 56px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 20px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-secondary-background) 82%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
  transition:
    background-color 140ms ease,
    color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mcs-blank:hover,
:root .proto-ui.proto-ui.proto-ui .mcs-blank.is-at {
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mcs-section {
  margin-top: 48px;
}
:root .proto-ui.proto-ui.proto-ui .mcs-sec-row {
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
:root .proto-ui.proto-ui.proto-ui .mcs-sec {
  flex: none;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
:root .proto-ui.proto-ui.proto-ui .mcs-shelves {
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
:root .proto-ui.proto-ui.proto-ui .mcs-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  grid-auto-rows: 168px;
  gap: 12px;
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl {
  position: relative;
  overflow: hidden;
  border-radius: 14px;
  background: var(--color-card-background);
  text-align: left;
  outline: none;
  animation: mcs-rise 520ms var(--mar-ease, ease-out) both;
  animation-delay: calc(80ms + var(--i, 0) * 45ms);
  transition:
    transform 260ms var(--mar-ease, ease-out),
    box-shadow 260ms var(--mar-ease, ease-out);
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl.is-feature {
  grid-row: span 2;
  grid-column: span 2;
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl:hover,
:root .proto-ui.proto-ui.proto-ui .mcs-tpl.is-at {
  transform: translateY(-3px);
  box-shadow: 0 22px 40px -24px oklch(0 0 0 / 0.9);
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl:focus-visible,
:root .proto-ui.proto-ui.proto-ui .mcs-tpl.is-at,
:root .proto-ui.proto-ui.proto-ui .mcs-recent:focus-visible .mcs-recent-cover,
:root .proto-ui.proto-ui.proto-ui .mcs-recent.is-at .mcs-recent-cover {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl-pic {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition:
    transform 600ms var(--mar-ease, ease-out),
    opacity 300ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl-video {
  opacity: 0;
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl:hover .mcs-tpl-pic,
:root .proto-ui.proto-ui.proto-ui .mcs-tpl.is-at .mcs-tpl-pic {
  transform: scale(1.04);
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl:hover .mcs-tpl-video,
:root .proto-ui.proto-ui.proto-ui .mcs-tpl.is-at .mcs-tpl-video,
:root .proto-ui.proto-ui.proto-ui .mcs-tpl:focus-visible .mcs-tpl-video {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl::after {
  content: '';
  position: absolute;
  inset: 30% 0 0;
  background: linear-gradient(
    to top,
    var(--color-media-overlay),
    var(--color-media-overlay) 30%,
    color-mix(in oklch, var(--color-media-overlay) 45%, transparent) 65%,
    transparent
  );
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl-chip {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1;
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl-go {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 9px;
  background: var(--mcs-glass);
  color: white;
  opacity: 0;
  backdrop-filter: blur(14px) saturate(1.5);
  transition: opacity 200ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl:hover .mcs-tpl-go,
:root .proto-ui.proto-ui.proto-ui .mcs-tpl.is-at .mcs-tpl-go {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl-text {
  position: absolute;
  inset: auto 0 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 12px 14px 14px;
  color: white;
  text-shadow: 0 1px 2px oklch(0 0 0 / 0.35);
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl-title {
  max-width: 100%;
  overflow: hidden;
  font-size: var(--text-ui);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl-model {
  max-width: 100%;
  overflow: hidden;
  font-size: 12px;
  opacity: 0.72;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl.is-feature .mcs-tpl-text {
  padding: 20px 22px 22px;
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl.is-feature .mcs-tpl-title {
  font-size: var(--text-title);
  line-height: var(--text-title--line-height);
  letter-spacing: -0.01em;
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl.is-feature .mcs-tpl-model {
  margin-top: 2px;
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .mcs-tpl-line {
  display: -webkit-box;
  max-width: 44ch;
  margin-top: 8px;
  overflow: hidden;
  font-size: var(--text-ui);
  line-height: 19px;
  opacity: 0.86;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
:root .proto-ui.proto-ui.proto-ui .mcs-ready {
  display: inline-flex;
  height: 22px;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--mcs-glass);
  color: white;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  backdrop-filter: blur(14px) saturate(1.5);
}
:root .proto-ui.proto-ui.proto-ui .mcs-ready.is-off {
  opacity: 0.8;
}
:root .proto-ui.proto-ui.proto-ui .mcs-recents {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px 12px;
}
:root .proto-ui.proto-ui.proto-ui .mcs-recent {
  display: flex;
  min-width: 0;
  flex-direction: column;
  text-align: left;
  outline: none;
  animation: mcs-rise 520ms var(--mar-ease, ease-out) both;
  animation-delay: calc(260ms + var(--i, 0) * 35ms);
}
:root .proto-ui.proto-ui.proto-ui .mcs-recent-cover {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: 12px;
  background: var(--color-card-background);
  transition: box-shadow 200ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mcs-recent-cover > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .mcs-recent-tint {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 80% 90% at 100% 0%,
    oklch(0.74 0.16 var(--h, 250) / 0.4),
    transparent 70%
  );
  mix-blend-mode: screen;
  opacity: 0.7;
  transition: opacity 240ms ease;
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .mcs-recent:hover .mcs-recent-tint,
:root .proto-ui.proto-ui.proto-ui .mcs-recent.is-at .mcs-recent-tint {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .mcs-recent:hover .mcs-recent-cover {
  background: var(--color-card-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .mcs-recent-name {
  margin-top: 10px;
  overflow: hidden;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .mcs-recent-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .mcs-dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 999px;
  background: oklch(0.74 0.16 var(--h, 250));
}
:root .proto-ui.proto-ui.proto-ui .mcs-results {
  display: flex;
  align-items: flex-start;
  gap: 32px;
  margin: 28px auto 0;
  width: 100%;
  max-width: 1000px;
  animation: mcs-fade 200ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .mcs-sec-list {
  margin: 22px 12px 8px;
}
:root .proto-ui.proto-ui.proto-ui .mcs-sec-list:first-child {
  margin-top: 4px;
}
:root .proto-ui.proto-ui.proto-ui .mcs-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 14px;
  padding: 8px 12px 8px 8px;
  border-radius: 12px;
  text-align: left;
  transition: background-color 120ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mcs-row.is-at {
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .mcs-thumb {
  position: relative;
  display: grid;
  width: 80px;
  height: 52px;
  flex: none;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mcs-thumb.is-blank {
  background: transparent;
  outline: 1px dashed color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
  outline-offset: -1px;
}
:root .proto-ui.proto-ui.proto-ui .mcs-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .mcs-peek {
  position: sticky;
  top: 24px;
  display: flex;
  width: 320px;
  flex: none;
  flex-direction: column;
  align-items: flex-start;
  padding: 12px 12px 16px;
  border-radius: 14px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, var(--color-content-background));
}
:root .proto-ui.proto-ui.proto-ui .mcs-peek > p {
  padding: 0 6px;
}
:root .proto-ui.proto-ui.proto-ui .mcs-peek-media {
  position: relative;
  display: grid;
  width: 100%;
  aspect-ratio: 4 / 3;
  place-items: center;
  overflow: hidden;
  border-radius: 10px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mcs-peek-media img,
:root .proto-ui.proto-ui.proto-ui .mcs-peek-media video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .mcs-peek-ready {
  margin: 12px 6px 0;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
  backdrop-filter: none;
}
:root .proto-ui.proto-ui.proto-ui .mcs-peek-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
@keyframes mcs-rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}
@keyframes mcs-fade {
  from {
    opacity: 0;
  }
}
@media (max-width: 1180px) {
  :root .proto-ui.proto-ui.proto-ui .mcs-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  :root .proto-ui.proto-ui.proto-ui .mcs-tpl:nth-child(n + 6) {
    display: none;
  }
}
@media (max-width: 1000px) {
  :root .proto-ui.proto-ui.proto-ui .mcs-peek {
    display: none;
  }
}
@media (max-width: 860px) {
  :root .proto-ui.proto-ui.proto-ui .mcs-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  :root .proto-ui.proto-ui.proto-ui .mcs-tpl:nth-child(n + 6) {
    display: block;
  }
  :root .proto-ui.proto-ui.proto-ui .mcs-recents {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  :root .proto-ui.proto-ui.proto-ui .mcs-sec-row {
    flex-direction: column;
    align-items: flex-start;
  }
  :root .proto-ui.proto-ui.proto-ui .mcs-shelves {
    max-width: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .mcs-hero,
  :root .proto-ui.proto-ui.proto-ui .mcs-tpl,
  :root .proto-ui.proto-ui.proto-ui .mcs-recent,
  :root .proto-ui.proto-ui.proto-ui .mcs-results {
    animation: none;
  }
  :root .proto-ui.proto-ui.proto-ui .mcs-tpl,
  :root .proto-ui.proto-ui.proto-ui .mcs-tpl-pic {
    transition: none;
  }
  :root .proto-ui.proto-ui.proto-ui .mcs-tpl:hover,
  :root .proto-ui.proto-ui.proto-ui .mcs-tpl.is-at,
  :root .proto-ui.proto-ui.proto-ui .mcs-tpl:hover .mcs-tpl-pic,
  :root .proto-ui.proto-ui.proto-ui .mcs-tpl.is-at .mcs-tpl-pic {
    transform: none;
  }
}
</style>
