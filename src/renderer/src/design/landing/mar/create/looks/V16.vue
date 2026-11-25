<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue'
import {
  Check,
  CornerDownLeft,
  Cpu,
  Download,
  HardDrive,
  Play,
  Plus,
  Search,
  X
} from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import CategoryChip from '../../CategoryChip.vue'
import TplGraph from '../../templateModal/TplGraph.vue'
import '../../templateModal/templateModal.css'
import { graphFor } from '../../templateModal/graphSpec'
import { fmtGb, mediaFor, needsFor, totalGb } from '../../templateModal/templateData'
import { allWorkflows, type ProjectWorkflow } from '../../../gallery'
import { activeInstance, instanceById } from '../../../useProto'
import { NODE_TYPES, type NodeKind } from '../../graph/canvasData'
import { NODE_ICONS } from '../../graph/nodeIcons'
import { closeCreate, openTemplate, openWorkflow, startBlank, startWithNode } from '../createScreen'
import { readiness, searchStarters, SHELVES, type Starter } from '../createStarters'
import { costLine, reducedMotion, targetOf, useCloseOnEsc } from './lookD'

type Hit =
  | { id: string; type: 'workflow'; workflow: ProjectWorkflow }
  | { id: string; type: 'template'; starter: Starter }
  | { id: string; type: 'node'; node: NodeKind }
  | { id: string; type: 'blank' }

const KINDS = Object.keys(NODE_TYPES) as NodeKind[]
const BLANK: Hit = { id: 'blank', type: 'blank' }
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
const field = ref<HTMLInputElement>()
const shelf = ref(SHELVES[0]!.id)
const q = computed(() => query.value.trim().toLowerCase())
const matches = (text: string): boolean => text.toLowerCase().includes(q.value)
const workflows = computed(() => [...allWorkflows.value].sort((a, b) => a.age - b.age))

const sections = computed<{ title: string; hits: Hit[] }[]>(() => {
  if (!q.value) {
    const current = SHELVES.find((s) => s.id === shelf.value) ?? SHELVES[0]!
    return [
      { title: '', hits: [BLANK] },
      { title: current.label, hits: current.starters().map(templateHit) },
      { title: 'Your recent workflows', hits: workflows.value.slice(0, 6).map(workflowHit) }
    ].filter((s) => s.hits.length)
  }
  return [
    { title: 'Templates', hits: searchStarters(q.value, 8).map(templateHit) },
    {
      title: 'Your workflows',
      hits: workflows.value
        .filter((w) => matches(w.name))
        .slice(0, 5)
        .map(workflowHit)
    },
    {
      title: 'Start with a node',
      hits: KINDS.filter((k) => matches(`${NODE_TYPES[k].title} ${NODE_TYPES[k].description}`))
        .slice(0, 4)
        .map((node): Hit => ({ id: `node:${node}`, type: 'node', node }))
    },
    { title: '', hits: [BLANK] }
  ].filter((s) => s.hits.length)
})

const flat = computed(() => sections.value.flatMap((s) => s.hits))
const indexOf = (hit: Hit): number => flat.value.findIndex((h) => h.id === hit.id)
const firstTemplate = (): number =>
  Math.max(
    0,
    flat.value.findIndex((h) => h.type === 'template')
  )
const at = ref(firstTemplate())
const current = computed(() => flat.value[at.value] ?? flat.value[0])
watch([q, shelf], () => (at.value = firstTemplate()))

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

const shelfIndex = computed(() => SHELVES.findIndex((s) => s.id === shelf.value))
function stepShelf(d: number): void {
  const n = SHELVES.length
  shelf.value = SHELVES[(shelfIndex.value + d + n) % n]!.id
}

function key(e: KeyboardEvent): void {
  const last = flat.value.length - 1
  if (e.key === 'ArrowDown') at.value = Math.min(last, at.value + 1)
  else if (e.key === 'ArrowUp') at.value = Math.max(0, at.value - 1)
  else if (!q.value && e.key === 'ArrowRight') stepShelf(1)
  else if (!q.value && e.key === 'ArrowLeft') stepShelf(-1)
  else if (e.key === 'Enter') {
    if (current.value) pick(current.value)
  } else if (e.key === 'Escape') {
    if (query.value) query.value = ''
    else closeCreate()
  } else return
  e.preventDefault()
}

watch(at, (i) =>
  nextTick(() =>
    document
      .querySelector<HTMLElement>(`[data-v16-at="${i}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  )
)

const preview = computed(() => {
  const hit = current.value
  if (hit?.type !== 'template') return undefined
  const t = hit.starter.template
  const target = targetOf(t)
  const ready = readiness(t)
  const models = needsFor(t)
  return {
    starter: hit.starter,
    ready,
    target,
    cost: costLine(t),
    models,
    total: totalGb(t),
    graph: graphFor(t, mediaFor(t)),
    action:
      ready.tone === 'ready'
        ? 'Run it'
        : ready.tone === 'fetch'
          ? 'Download and run'
          : target.action || 'Open template'
  }
})

const reduced = reducedMotion()
useCloseOnEsc(field)
</script>

<template>
  <section class="v16" aria-label="Create">
    <button type="button" class="v16-close" aria-label="Close" title="Close" @click="closeCreate">
      <X :size="16" />
    </button>

    <div class="v16-shell">
      <aside class="v16-side">
        <h1 class="v16-title">Create a workflow</h1>
        <label class="v16-field">
          <Search :size="16" class="shrink-0 text-subtle-foreground" />
          <input
            ref="field"
            v-model="query"
            type="text"
            placeholder="Search templates, workflows, nodes"
            aria-label="Search templates, workflows and nodes"
            aria-controls="v16-list"
            @keydown="key"
          />
          <button
            v-if="query"
            type="button"
            class="v16-clear"
            aria-label="Clear search"
            @click="((query = ''), field?.focus())"
          >
            <X :size="13" />
          </button>
        </label>
        <div v-if="!q" class="v16-shelves" role="group" aria-label="Templates for">
          <button
            v-for="s in SHELVES"
            :key="s.id"
            type="button"
            class="v16-shelf"
            :class="shelf === s.id && 'v16-on'"
            :aria-pressed="shelf === s.id"
            @click="((shelf = s.id), field?.focus())"
          >
            {{ s.label }}
          </button>
        </div>

        <div id="v16-list" class="v16-list" aria-label="Starting points">
          <template v-for="s in sections" :key="s.title || 'blank'">
            <h2 v-if="s.title" class="v16-sec">{{ s.title }}</h2>
            <button
              v-for="hit in s.hits"
              :key="hit.id"
              type="button"
              class="v16-row"
              :class="indexOf(hit) === at && 'is-at'"
              :aria-current="indexOf(hit) === at || undefined"
              :data-v16-at="indexOf(hit)"
              @click="at = indexOf(hit)"
              @dblclick="pick(hit)"
            >
              <span class="v16-thumb" :class="`is-${hit.type}`">
                <img
                  v-if="hit.type === 'template'"
                  :src="hit.starter.poster"
                  alt=""
                  loading="lazy"
                />
                <WorkflowCover v-else-if="hit.type === 'workflow'" :name="hit.workflow.name" />
                <component :is="icon(hit)" v-else :size="15" />
              </span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="v16-row-title">{{ title(hit) }}</span>
                <span class="v16-row-meta">{{ meta(hit) }}</span>
              </span>
              <span v-if="hit.type === 'workflow'" class="v16-row-meta shrink-0">{{
                hit.workflow.modified
              }}</span>
            </button>
          </template>
          <p v-if="q && flat.length === 1" class="v16-none">
            Nothing matches “{{ query.trim() }}”. Start blank, or try another word.
          </p>
        </div>

        <footer class="v16-keys" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> Browse</span>
          <span v-if="!q"><kbd>←</kbd><kbd>→</kbd> Category</span>
          <span><kbd>↵</kbd> Open</span>
          <span><kbd>esc</kbd> Close</span>
        </footer>
      </aside>

      <main class="v16-pane" aria-live="polite">
        <template v-if="preview">
          <div :key="preview.starter.id" class="v16-stage">
            <img :src="preview.starter.poster" alt="" class="v16-stage-pic" />
            <video
              v-if="preview.starter.clip"
              :src="preview.starter.clip"
              :poster="preview.starter.poster"
              class="v16-stage-pic"
              muted
              loop
              playsinline
              :autoplay="!reduced"
            />
            <span class="v16-stage-chip"><CategoryChip :category="preview.starter.media" /></span>
            <div class="v16-stage-text">
              <p class="v16-stage-title">{{ preview.starter.makes }}</p>
              <p class="v16-stage-line">{{ preview.starter.line }}.</p>
            </div>
          </div>

          <div class="v16-detail">
            <div class="v16-run">
              <div class="min-w-0 flex-1">
                <p class="v16-status" :class="`is-${preview.ready.tone}`">
                  <Check v-if="preview.ready.tone === 'ready'" :size="14" />
                  <Download v-else-if="preview.ready.tone === 'fetch'" :size="14" />
                  {{ preview.ready.label }}
                </p>
                <p class="v16-cost">{{ preview.cost }}</p>
              </div>
              <button type="button" class="v16-go" @click="openTemplate(preview.starter.template)">
                <Download v-if="preview.ready.tone === 'fetch'" :size="15" />
                <Play v-else :size="15" />
                {{ preview.action }}
                <kbd>↵</kbd>
              </button>
            </div>

            <div class="v16-cols">
              <figure class="v16-graph">
                <TplGraph :spec="preview.graph" />
                <figcaption>
                  {{ preview.graph.nodes.length }} nodes, {{ preview.starter.model }}
                </figcaption>
              </figure>
              <div class="v16-needs">
                <h3 class="v16-h3">What it needs</h3>
                <ul>
                  <li v-for="m in preview.models" :key="m.name">
                    <HardDrive :size="13" class="shrink-0 text-subtle-foreground" />
                    <span class="min-w-0 flex-1 truncate">{{ m.name }}</span>
                    <span class="shrink-0 tabular-nums">{{ m.size }}</span>
                  </li>
                  <li v-if="!preview.models.length">
                    <Check :size="13" class="shrink-0 text-subtle-foreground" />
                    <span class="flex-1">Nothing to download</span>
                  </li>
                  <li v-if="preview.starter.template.vram">
                    <Cpu :size="13" class="shrink-0 text-subtle-foreground" />
                    <span class="flex-1">Graphics memory</span>
                    <span class="shrink-0 tabular-nums">{{ preview.starter.template.vram }}</span>
                  </li>
                </ul>
                <p v-if="preview.total" class="v16-total">
                  <span>Total download</span><b>{{ fmtGb(preview.total) }}</b>
                </p>
                <p class="v16-note">{{ preview.target.note || preview.target.status }}</p>
              </div>
            </div>
          </div>
        </template>

        <div v-else-if="current" class="v16-other">
          <div class="v16-other-media" :class="`is-${current.type}`">
            <WorkflowCover v-if="current.type === 'workflow'" :name="current.workflow.name" />
            <component :is="icon(current)" v-else :size="40" />
          </div>
          <p class="v16-stage-title v16-other-title">{{ title(current) }}</p>
          <p class="v16-cost">
            <template v-if="current.type === 'workflow'"
              >On {{ meta(current) }}, edited
              {{ current.workflow.modified.toLowerCase() }}.</template
            >
            <template v-else-if="current.type === 'node'"
              >A canvas on {{ activeInstance.name }} with this node on it.</template
            >
            <template v-else
              >An empty canvas on {{ activeInstance.name }}. Add nodes yourself.</template
            >
          </p>
          <button type="button" class="v16-go mt-6" @click="pick(current)">
            {{ current.type === 'workflow' ? 'Open workflow' : 'Start' }}
            <kbd><CornerDownLeft :size="11" /></kbd>
          </button>
        </div>
      </main>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v16 {
  position: relative;
  height: 100%;
  min-height: 560px;
  padding: 20px 20px 20px 24px;
  isolation: isolate;
}
:root .proto-ui.proto-ui.proto-ui .v16-close {
  position: absolute;
  top: 32px;
  right: 32px;
  z-index: 3;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 999px;
  background: var(--color-media-overlay);
  color: white;
  backdrop-filter: blur(12px);
}
:root .proto-ui.proto-ui.proto-ui .v16-close:hover {
  background: var(--color-base-foreground);
  color: var(--color-content-background);
}
:root .proto-ui.proto-ui.proto-ui .v16-shell {
  display: grid;
  height: 100%;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 20px;
}
:root .proto-ui.proto-ui.proto-ui .v16-side {
  display: flex;
  min-height: 0;
  flex-direction: column;
  padding-top: 20px;
}
:root .proto-ui.proto-ui.proto-ui .v16-title {
  padding: 0 4px;
  color: var(--color-base-foreground);
  font-size: var(--text-title);
  font-weight: 600;
  letter-spacing: -0.015em;
}
:root .proto-ui.proto-ui.proto-ui .v16-field {
  display: flex;
  height: 40px;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  padding: 0 10px 0 12px;
  border-radius: 10px;
  background: var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px transparent;
  transition: box-shadow 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v16-field:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v16-field input {
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
:root .proto-ui.proto-ui.proto-ui .v16-field input::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v16-clear {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 6px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v16-shelves {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v16-shelf {
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-weight: 500;
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v16-shelf:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v16-shelf.v16-on {
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  box-shadow: none;
}
:root .proto-ui.proto-ui.proto-ui .v16-list {
  min-height: 0;
  flex: 1;
  margin: 10px -6px 0;
  padding: 0 6px 8px;
  overflow-y: auto;
  scrollbar-width: thin;
}
:root .proto-ui.proto-ui.proto-ui .v16-sec {
  margin: 16px 8px 6px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v16-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  padding: 6px 10px 6px 6px;
  border-radius: 10px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v16-row:hover {
  background: color-mix(in oklch, var(--color-secondary-background) 55%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .v16-row.is-at {
  background: var(--color-secondary-background);
  box-shadow: inset 2px 0 0 var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v16-row:focus-visible {
  box-shadow: inset 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v16-thumb {
  position: relative;
  display: grid;
  width: 52px;
  height: 36px;
  flex: none;
  place-items: center;
  overflow: hidden;
  border-radius: 7px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v16-thumb.is-blank {
  background: transparent;
  outline: 1px dashed color-mix(in oklch, var(--color-base-foreground) 22%, transparent);
  outline-offset: -1px;
}
:root .proto-ui.proto-ui.proto-ui .v16-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v16-row-title {
  overflow: hidden;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v16-row-meta {
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v16-none {
  padding: 8px 10px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v16-keys {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  padding: 12px 4px 0;
  border-top: 1px solid var(--color-border-default);
  color: var(--color-subtle-foreground);
  font-size: 11px;
}
:root .proto-ui.proto-ui.proto-ui .v16 kbd {
  display: inline-grid;
  min-width: 18px;
  height: 18px;
  margin-right: 2px;
  padding: 0 4px;
  place-items: center;
  border-radius: 5px;
  background: var(--color-secondary-background-hover);
  color: var(--color-muted-foreground);
  font: inherit;
  font-size: 10px;
}
:root .proto-ui.proto-ui.proto-ui .v16-pane {
  display: flex;
  min-height: 0;
  min-width: 0;
  flex-direction: column;
  overflow-y: auto;
  border-radius: 18px;
  background: color-mix(in oklch, var(--color-base-foreground) 4%, var(--color-content-background));
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  scrollbar-width: thin;
}
:root .proto-ui.proto-ui.proto-ui .v16-stage {
  position: relative;
  flex: none;
  aspect-ratio: 16 / 8;
  max-height: 52vh;
  overflow: hidden;
  border-radius: 18px 18px 0 0;
  background: var(--color-card-background);
  animation: v16-in 260ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .v16-stage-pic {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v16-stage::after {
  content: '';
  position: absolute;
  inset: 45% 0 0;
  background: linear-gradient(to top, var(--color-media-overlay), transparent);
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v16-stage-chip {
  position: absolute;
  top: 14px;
  left: 14px;
  z-index: 1;
}
:root .proto-ui.proto-ui.proto-ui .v16-stage-text {
  position: absolute;
  inset: auto 0 0;
  z-index: 1;
  padding: 0 28px 22px;
  color: white;
}
:root .proto-ui.proto-ui.proto-ui .v16-stage-title {
  font-size: 30px;
  font-weight: 600;
  line-height: 36px;
  letter-spacing: -0.02em;
}
:root .proto-ui.proto-ui.proto-ui .v16-stage-line {
  max-width: 60ch;
  margin-top: 4px;
  font-size: 14px;
  opacity: 0.85;
}
:root .proto-ui.proto-ui.proto-ui .v16-detail {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px 28px 28px;
}
:root .proto-ui.proto-ui.proto-ui .v16-run {
  display: flex;
  align-items: center;
  gap: 16px;
}
:root .proto-ui.proto-ui.proto-ui .v16-status {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-base-foreground);
  font-size: var(--text-heading);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v16-status.is-ready svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v16-cost {
  margin-top: 2px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v16-go {
  display: inline-flex;
  height: 44px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 14px 0 18px;
  border-radius: 12px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: 14px;
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v16-go:hover {
  background: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v16-go kbd {
  margin-left: 4px;
  background: color-mix(in oklch, var(--color-inverted-foreground) 14%, transparent);
  color: inherit;
}
:root .proto-ui.proto-ui.proto-ui .v16-cols {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: 20px;
}
:root .proto-ui.proto-ui.proto-ui .v16-graph {
  --tpl-ink: var(--color-base-foreground);
  --tpl-well-2: color-mix(in oklch, var(--tpl-ink) 7%, transparent);
  --tpl-node: color-mix(in oklch, var(--color-base-foreground) 6%, var(--color-content-background));
  --tpl-node-head: color-mix(
    in oklch,
    var(--color-base-foreground) 9%,
    var(--color-content-background)
  );
  position: relative;
  height: 220px;
  overflow: hidden;
  border-radius: 12px;
  background-color: var(--color-content-background);
  background-image: radial-gradient(
    color-mix(in oklch, var(--color-base-foreground) 10%, transparent) 1px,
    transparent 1px
  );
  background-size: 16px 16px;
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v16-graph .mar-tpl-graph {
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v16-graph figcaption {
  position: absolute;
  bottom: 8px;
  left: 10px;
  color: var(--color-subtle-foreground);
  font-size: 11px;
}
:root .proto-ui.proto-ui.proto-ui .v16-h3 {
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v16-needs ul {
  display: flex;
  flex-direction: column;
  margin-top: 10px;
}
:root .proto-ui.proto-ui.proto-ui .v16-needs li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 0;
  border-bottom: 1px solid var(--color-border-default);
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v16-total {
  display: flex;
  justify-content: space-between;
  padding: 10px 0 0;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v16-total b {
  color: var(--color-base-foreground);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v16-note {
  margin-top: 10px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  line-height: 17px;
}
:root .proto-ui.proto-ui.proto-ui .v16-other {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  text-align: center;
}
:root .proto-ui.proto-ui.proto-ui .v16-other-media {
  position: relative;
  display: grid;
  width: min(420px, 80%);
  aspect-ratio: 16 / 10;
  place-items: center;
  overflow: hidden;
  border-radius: 14px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v16-other-media.is-blank {
  background: transparent;
  outline: 1.5px dashed color-mix(in oklch, var(--color-base-foreground) 20%, transparent);
  outline-offset: -1.5px;
}
:root .proto-ui.proto-ui.proto-ui .v16-other-title {
  margin-top: 20px;
  color: var(--color-base-foreground);
}
@keyframes v16-in {
  from {
    opacity: 0.4;
  }
}
@media (max-width: 960px) {
  :root .proto-ui.proto-ui.proto-ui .v16-shell {
    grid-template-columns: 300px minmax(0, 1fr);
  }
  :root .proto-ui.proto-ui.proto-ui .v16-cols {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v16-stage {
    animation: none;
  }
}
</style>
