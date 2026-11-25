<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { CornerDownLeft, Plus, Search, X } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import MarSeg from '../../pages/MarSeg.vue'
import { allWorkflows, type ProjectWorkflow } from '../../../gallery'
import { activeInstance } from '../../../useProto'
import { mock } from '../../assets/mock'
import { NODE_TYPES, type NodeKind } from '../../graph/canvasData'
import { NODE_ICONS } from '../../graph/nodeIcons'
import { closeCreate, openTemplate, openWorkflow, startBlank, startWithNode } from '../createScreen'
import { readiness, searchStarters, SHELVES, type Starter } from '../createStarters'
import { buildOf, graphFor, readyIcon, useEscapeCloses } from './lookKitB'

type Item =
  | { id: string; type: 'blank' }
  | { id: string; type: 'template'; starter: Starter }
  | { id: string; type: 'workflow'; workflow: ProjectWorkflow }
  | { id: string; type: 'node'; node: NodeKind }

const STAGE_W = 1000
const STAGE_H = 440
const COL_X = [30, 360, 680]
const NODE_W = [230, 230, 300]
const BLANK: Item = { id: 'blank', type: 'blank' }
const YOURS = 'yours'

const query = ref('')
const field = ref<HTMLInputElement>()
const shelf = ref<string>(SHELVES[0]!.id)
const hover = ref(-1)
const pinned = ref(-1)
const at = computed(() => (hover.value >= 0 ? hover.value : pinned.value))
const shelfOptions = [
  ...SHELVES.map((s) => ({ value: s.id, label: s.label })),
  { value: YOURS, label: 'Your workflows' }
]

const q = computed(() => query.value.trim().toLowerCase())
const workflows = computed(() => [...allWorkflows.value].sort((a, b) => a.age - b.age))
const tpl = (starter: Starter): Item => ({ id: `t:${starter.id}`, type: 'template', starter })
const wf = (workflow: ProjectWorkflow): Item => ({
  id: `w:${workflow.id}`,
  type: 'workflow',
  workflow
})

const items = computed<Item[]>(() => {
  if (q.value) {
    const kinds = (Object.keys(NODE_TYPES) as NodeKind[]).filter((k) =>
      `${NODE_TYPES[k].title} ${NODE_TYPES[k].description}`.toLowerCase().includes(q.value)
    )
    return [
      BLANK,
      ...searchStarters(q.value, 8).map(tpl),
      ...workflows.value
        .filter((w) => w.name.toLowerCase().includes(q.value))
        .slice(0, 6)
        .map(wf),
      ...kinds.slice(0, 4).map((node): Item => ({ id: `n:${node}`, type: 'node', node }))
    ]
  }
  if (shelf.value === YOURS) return [BLANK, ...workflows.value.slice(0, 10).map(wf)]
  return [BLANK, ...(SHELVES.find((s) => s.id === shelf.value) ?? SHELVES[0]!).starters().map(tpl)]
})
watch([q, shelf], () => {
  hover.value = -1
  pinned.value = -1
})

const current = computed<Item | undefined>(() => items.value[at.value])

function press(i: number): void {
  if (pinned.value === i) pick(items.value[i]!)
  else pinned.value = i
}

function pick(item: Item): void {
  if (item.type === 'template') openTemplate(item.starter.template)
  else if (item.type === 'workflow') openWorkflow(item.workflow)
  else if (item.type === 'node') startWithNode(item.node)
  else startBlank()
}

interface Placed {
  key: string
  kind: NodeKind
  title: string
  left: number
  top: number
  w: number
  h: number
  col: number
}

const heightOf = (kind: NodeKind, col: number): number =>
  col === 2 ? 250 : kind === 'image' ? 150 : kind === 'prompt' ? 104 : 120

const graph = computed(() => {
  const item = current.value
  if (!item || item.type === 'blank') return { nodes: [] as Placed[], wires: [] as string[] }
  if (item.type === 'node') {
    const h = heightOf(item.node, 1)
    return {
      nodes: [
        {
          key: item.node,
          kind: item.node,
          title: NODE_TYPES[item.node].title,
          left: COL_X[1]!,
          top: STAGE_H / 2 - h / 2,
          w: NODE_W[1]!,
          h,
          col: 1
        }
      ],
      wires: []
    }
  }
  const starter =
    item.type === 'template'
      ? item.starter
      : ({ makes: item.workflow.name, model: 'Your workflow', media: 'image' } as Starter)
  const g = graphFor(starter)
  const nodes: Placed[] = g.nodes.map((n, i) => {
    const col = n.x < 300 ? 0 : n.x < 600 ? 1 : 2
    const h = heightOf(n.kind, col)
    return {
      key: `${i}-${n.kind}`,
      kind: n.kind,
      title: n.title,
      left: COL_X[col]!,
      top: n.y + 20 - h / 2,
      w: NODE_W[col]!,
      h,
      col
    }
  })
  const wires = g.wires.map(([a, b]) => {
    const s = nodes[a]!
    const t = nodes[b]!
    const x1 = s.left + s.w
    const y1 = s.top + s.h / 2
    const x2 = t.left
    const y2 = t.top + t.h / 2
    const mid = (x1 + x2) / 2
    return `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`
  })
  return { nodes, wires }
})

const pct = (n: number, of: number): string => `${(n / of) * 100}%`
const box = (n: Placed) => ({
  left: pct(n.left, STAGE_W),
  top: pct(n.top, STAGE_H),
  width: pct(n.w, STAGE_W),
  height: pct(n.h, STAGE_H)
})

const outputOf = computed(() => {
  const item = current.value
  if (item?.type === 'template') return { src: item.starter.poster, clip: item.starter.clip }
  return undefined
})

const PROMPTS: Record<string, string> = {
  image: 'A ceramic vase on wet marble, morning light, 85mm',
  video: 'Slow push in, wings unfold, soft wind',
  audio: 'Warm lo-fi piano loop, vinyl crackle'
}
const promptOf = computed(() => {
  const item = current.value
  return item?.type === 'template' ? (PROMPTS[item.starter.media] ?? PROMPTS.image) : PROMPTS.image
})

function key(e: KeyboardEvent): void {
  const last = items.value.length - 1
  hover.value = -1
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') pinned.value = Math.min(last, at.value + 1)
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') pinned.value = Math.max(0, at.value - 1)
  else if (e.key === 'Enter' && current.value) pick(current.value)
  else if (e.key === 'Escape') {
    if (query.value) query.value = ''
    else closeCreate()
  } else return
  e.preventDefault()
}

watch(at, (i) =>
  nextTick(() =>
    document
      .querySelector(`[data-v07-at="${i}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  )
)

useEscapeCloses(() => field.value)
</script>

<template>
  <section class="v07 relative flex h-full min-h-[640px] flex-col" aria-label="Create">
    <div class="v07-canvas" aria-hidden="true" />

    <header class="v07-top">
      <div class="min-w-0">
        <h1 class="text-title font-semibold tracking-[-0.01em] text-base-foreground">
          Create a workflow
        </h1>
      </div>
      <label class="v07-field">
        <Search :size="15" class="shrink-0 text-subtle-foreground" />
        <input
          ref="field"
          v-model="query"
          type="text"
          placeholder="Search templates, workflows and nodes"
          aria-label="Search templates, workflows and nodes"
          @keydown="key"
        />
        <button
          v-if="query"
          type="button"
          class="v07-icon-btn"
          aria-label="Clear"
          @click="((query = ''), field?.focus())"
        >
          <X :size="13" />
        </button>
      </label>
      <button type="button" class="v07-icon-btn v07-close" aria-label="Close" @click="closeCreate">
        <X :size="16" />
      </button>
    </header>

    <div class="v07-stage-wrap">
      <div class="v07-stage">
        <svg
          :key="`w-${current?.id}`"
          class="v07-wires"
          :viewBox="`0 0 ${STAGE_W} ${STAGE_H}`"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path v-for="d in graph.wires" :key="d" :d class="v07-wire" />
          <path v-for="d in graph.wires" :key="`p${d}`" :d class="v07-pulse" pathLength="100" />
        </svg>
        <div
          v-for="(n, i) in graph.nodes"
          :key="`${current?.id}-${n.key}`"
          class="v07-node"
          :class="[`is-col${n.col}`, `is-${n.kind}`]"
          :style="[box(n), { '--i': i }]"
        >
          <p class="v07-node-head">
            <component :is="NODE_ICONS[n.kind]" :size="12" />
            <span class="truncate">{{ n.title }}</span>
          </p>
          <div v-if="n.col === 2" class="v07-out">
            <template v-if="outputOf">
              <img :src="outputOf.src" alt="" />
              <video
                v-if="outputOf.clip"
                :key="outputOf.clip"
                :src="outputOf.clip"
                muted
                loop
                playsinline
                autoplay
                class="motion-reduce:hidden"
              />
            </template>
            <WorkflowCover v-else-if="current?.type === 'workflow'" :name="current.workflow.name" />
          </div>
          <img
            v-else-if="n.kind === 'image'"
            :src="mock('asset-actor-ref')"
            alt=""
            class="v07-in-pic"
          />
          <p v-else-if="n.kind === 'prompt'" class="v07-prompt">{{ promptOf }}</p>
          <div v-else class="v07-widgets">
            <span><i>steps</i><b>20</b></span>
            <span><i>cfg</i><b>4.0</b></span>
            <span><i>seed</i><b>randomize</b></span>
          </div>
        </div>
        <p v-if="current?.type === 'blank'" class="v07-empty">
          An empty canvas on {{ activeInstance.name }}. Double-click to add your first node.
        </p>
      </div>

      <p v-if="!current" class="v07-empty is-hint">Point at a template to preview it here</p>
      <aside v-if="current" :key="`d-${current.id}`" class="v07-detail" aria-live="polite">
        <template v-if="current.type === 'template'">
          <p class="v07-detail-title">{{ current.starter.makes }}</p>
          <p class="v07-detail-sub">{{ current.starter.model }}</p>
          <p class="v07-detail-line">{{ current.starter.line }}.</p>
          <p class="v07-ready" :class="`is-${readiness(current.starter.template).tone}`">
            <component
              :is="readyIcon(readiness(current.starter.template))"
              v-if="readiness(current.starter.template).tone !== 'off'"
              :size="13"
            />
            {{ readiness(current.starter.template).label }}
          </p>
        </template>
        <template v-else-if="current.type === 'workflow'">
          <p class="v07-detail-title">{{ current.workflow.name }}</p>
          <p class="v07-detail-sub">
            {{ buildOf(current.workflow)?.name }}, edited
            {{ current.workflow.modified.toLowerCase() }}
          </p>
        </template>
        <template v-else-if="current.type === 'node'">
          <p class="v07-detail-title">{{ NODE_TYPES[current.node].title }}</p>
          <p class="v07-detail-line">{{ NODE_TYPES[current.node].description }}.</p>
        </template>
        <template v-else>
          <p class="v07-detail-title">Blank canvas</p>
          <p class="v07-detail-line">Build it yourself, node by node.</p>
        </template>
        <button type="button" class="v07-go" @click="pick(current)">
          {{
            current.type === 'template'
              ? 'Use template'
              : current.type === 'workflow'
                ? 'Open workflow'
                : 'Start'
          }}
          <CornerDownLeft :size="13" class="opacity-60" />
        </button>
      </aside>
    </div>

    <div class="v07-dock-wrap">
      <div v-if="!q" class="v07-shelves">
        <MarSeg v-model="shelf" :options="shelfOptions" label="Dock shows" />
      </div>
      <p v-else class="v07-shelves text-ui text-subtle-foreground">
        {{ items.length - 1 }} results for “{{ query.trim() }}”
      </p>
      <div class="v07-dock" aria-label="Starting points">
        <button
          v-for="(item, i) in items"
          :key="item.id"
          type="button"
          class="v07-tile group"
          :class="[i === hover && 'is-at', i === pinned && 'is-on', `is-${item.type}`]"
          :aria-pressed="i === pinned"
          :data-v07-at="i"
          @pointerenter="hover = i"
          @pointerleave="hover = -1"
          @focus="hover = i"
          @blur="hover = -1"
          @click="press(i)"
        >
          <span class="v07-tile-pic">
            <img v-if="item.type === 'template'" :src="item.starter.poster" alt="" loading="lazy" />
            <WorkflowCover v-else-if="item.type === 'workflow'" :name="item.workflow.name" />
            <component :is="NODE_ICONS[item.node]" v-else-if="item.type === 'node'" :size="20" />
            <Plus v-else :size="20" />
          </span>
          <span class="v07-tile-name">{{
            item.type === 'template'
              ? item.starter.makes
              : item.type === 'workflow'
                ? item.workflow.name
                : item.type === 'node'
                  ? NODE_TYPES[item.node].title
                  : 'Blank canvas'
          }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v07 {
  isolation: isolate;
  overflow: hidden;
}
:root .proto-ui.proto-ui.proto-ui .v07-canvas {
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    radial-gradient(ellipse 60% 55% at 50% 45%, transparent, var(--color-content-background) 95%),
    radial-gradient(
        color-mix(in oklch, var(--color-base-foreground) 12%, transparent) 1px,
        transparent 1.4px
      )
      0 0 / 24px 24px,
    var(--color-content-background);
}
:root .proto-ui.proto-ui.proto-ui .v07-top {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 24px 28px 0 32px;
}
:root .proto-ui.proto-ui.proto-ui .v07-field {
  display: flex;
  height: 40px;
  width: 360px;
  align-items: center;
  gap: 10px;
  margin-left: auto;
  padding: 0 8px 0 14px;
  border-radius: 999px;
  background: var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v07-field:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v07-field input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-base-foreground);
  font: inherit;
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v07-field input::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-icon-btn {
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-icon-btn:hover {
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-close {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-control);
}
:root .proto-ui.proto-ui.proto-ui .v07-stage-wrap {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 8px 300px 8px 48px;
}
:root .proto-ui.proto-ui.proto-ui .v07-stage {
  position: relative;
  width: 100%;
  max-width: 900px;
  max-height: 100%;
  aspect-ratio: 1000 / 440;
}
:root .proto-ui.proto-ui.proto-ui .v07-wires {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
:root .proto-ui.proto-ui.proto-ui .v07-wire,
:root .proto-ui.proto-ui.proto-ui .v07-pulse {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
:root .proto-ui.proto-ui.proto-ui .v07-wire {
  stroke: color-mix(in oklch, var(--color-base-foreground) 22%, transparent);
  animation: v07-fade 400ms ease both 120ms;
}
:root .proto-ui.proto-ui.proto-ui .v07-pulse {
  stroke: color-mix(in oklch, var(--color-base-foreground) 70%, transparent);
  stroke-dasharray: 5 95;
  animation: v07-flow 2.6s linear infinite;
}
:root .proto-ui.proto-ui.proto-ui .v07-node {
  position: absolute;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-card-background) 72%, transparent);
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 12%, transparent),
    0 16px 40px -20px oklch(0 0 0 / 0.7);
  backdrop-filter: blur(6px);
  animation: v07-ghost 420ms var(--ease-out-expo) both;
  animation-delay: calc(var(--i, 0) * 60ms);
}
:root .proto-ui.proto-ui.proto-ui .v07-node.is-col2 {
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 22%, transparent),
    0 30px 60px -24px oklch(0 0 0 / 0.8);
}
:root .proto-ui.proto-ui.proto-ui .v07-node-head {
  display: flex;
  height: 30px;
  flex: none;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v07-out {
  position: relative;
  min-height: 0;
  flex: 1;
  margin: 0 6px 6px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v07-out > img,
:root .proto-ui.proto-ui.proto-ui .v07-out > video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v07-in-pic {
  min-height: 0;
  flex: 1;
  margin: 0 6px 6px;
  border-radius: 8px;
  object-fit: cover;
  opacity: 0.8;
}
:root .proto-ui.proto-ui.proto-ui .v07-prompt {
  margin: 0 6px 6px;
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
  font-size: 12px;
  line-height: 17px;
}
:root .proto-ui.proto-ui.proto-ui .v07-widgets {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 6px 6px;
}
:root .proto-ui.proto-ui.proto-ui .v07-widgets span {
  display: flex;
  height: 22px;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border-radius: 6px;
  background: var(--color-secondary-background);
  font-size: 11px;
}
:root .proto-ui.proto-ui.proto-ui .v07-widgets i {
  color: var(--color-subtle-foreground);
  font-style: normal;
}
:root .proto-ui.proto-ui.proto-ui .v07-widgets b {
  color: var(--color-muted-foreground);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v07-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v07-detail {
  position: absolute;
  top: 50%;
  right: 32px;
  display: flex;
  width: 248px;
  flex-direction: column;
  align-items: flex-start;
  padding: 18px;
  border-radius: var(--radius-panel);
  background: color-mix(in oklch, var(--color-card-background) 86%, transparent);
  box-shadow:
    inset 0 0 0 1px var(--color-border-default),
    var(--shadow-popover);
  backdrop-filter: blur(var(--blur-glass));
  transform: translateY(-50%);
  animation: v07-fade 240ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .v07-detail-title {
  color: var(--color-base-foreground);
  font-size: var(--text-heading);
  font-weight: 600;
  line-height: 22px;
}
:root .proto-ui.proto-ui.proto-ui .v07-detail-sub {
  margin-top: 2px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v07-detail-line {
  margin-top: 10px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  line-height: 19px;
}
:root .proto-ui.proto-ui.proto-ui .v07-ready {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v07-ready.is-ready svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v07-ready.is-off {
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-go {
  display: inline-flex;
  height: 36px;
  align-self: stretch;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: var(--text-ui);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v07-go:hover {
  background: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v07-dock-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 0 24px 22px;
}
:root .proto-ui.proto-ui.proto-ui .v07-shelves {
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
:root .proto-ui.proto-ui.proto-ui .v07-dock {
  display: flex;
  max-width: 100%;
  gap: 8px;
  overflow-x: auto;
  padding: 10px;
  border-radius: 22px;
  background: color-mix(in oklch, var(--color-card-background) 80%, transparent);
  box-shadow:
    inset 0 0 0 1px var(--color-border-default),
    var(--shadow-popover);
  backdrop-filter: blur(var(--blur-glass));
  scrollbar-width: none;
}
:root .proto-ui.proto-ui.proto-ui .v07-tile {
  display: flex;
  width: 132px;
  flex: none;
  flex-direction: column;
  gap: 6px;
  padding: 4px;
  border-radius: 14px;
  text-align: left;
  outline: none;
  transition: background-color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v07-tile.is-at,
:root .proto-ui.proto-ui.proto-ui .v07-tile.is-on {
  background: var(--color-secondary-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v07-tile.is-on .v07-tile-pic {
  box-shadow: 0 0 0 2px var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-tile:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v07-tile-pic {
  display: grid;
  height: 80px;
  place-items: center;
  overflow: hidden;
  border-radius: 10px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
  transition: transform 220ms var(--ease-out-expo);
}
:root .proto-ui.proto-ui.proto-ui .v07-tile.is-at .v07-tile-pic {
  transform: translateY(-4px);
}
:root .proto-ui.proto-ui.proto-ui .v07-tile.is-blank .v07-tile-pic {
  background: transparent;
  outline: 1px dashed var(--color-border-strong);
  outline-offset: -1px;
}
:root .proto-ui.proto-ui.proto-ui .v07-tile-pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v07-tile-name {
  overflow: hidden;
  padding: 0 4px 2px;
  color: var(--color-muted-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v07-tile.is-at .v07-tile-name,
:root .proto-ui.proto-ui.proto-ui .v07-tile.is-on .v07-tile-name {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-empty.is-hint {
  animation: v07-fade 400ms ease both;
}
@keyframes v07-ghost {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.98);
  }
}
@keyframes v07-fade {
  from {
    opacity: 0;
  }
}
@keyframes v07-flow {
  from {
    stroke-dashoffset: 100;
  }
  to {
    stroke-dashoffset: 0;
  }
}
@media (max-width: 1100px) {
  :root .proto-ui.proto-ui.proto-ui .v07-stage-wrap {
    padding-right: 48px;
  }
  :root .proto-ui.proto-ui.proto-ui .v07-detail {
    top: 12px;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v07-node,
  :root .proto-ui.proto-ui.proto-ui .v07-wire,
  :root .proto-ui.proto-ui.proto-ui .v07-detail,
  :root .proto-ui.proto-ui.proto-ui .v07-pulse {
    animation: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v07-pulse {
    display: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v07-tile-pic {
    transition: none;
  }
}
</style>
