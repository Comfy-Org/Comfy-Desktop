<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { allWorkflows, type ProjectWorkflow } from '../../../gallery'
import { activeInstance } from '../../../useProto'
import { thumb } from '../../../mock'
import { MOCK } from '../../assets/mock'
import { NODE_TYPES, type NodeKind } from '../../graph/canvasData'
import { NODE_ICONS } from '../../graph/nodeIcons'
import {
  closeCreate,
  openTemplate,
  openWorkflow,
  startBlank,
  startWithAgentAsk,
  startWithNode
} from '../createScreen'
import { readiness, searchStarters, SHELVES, type Starter } from '../createStarters'
import { createInput } from '../createInput'
import { agentOpens } from '../agentOpens'
import { buildOf, useEscapeCloses } from './lookKitB'
import { agentStart, quickPicks, type AgentAnswer } from './v07Agent'
import { useCreateAgent } from './createAgent'
import CreateComposer from './CreateComposer.vue'
import CreateAgentPanel from './CreateAgentPanel.vue'
import GhostGraph from './GhostGraph.vue'

type Item =
  | { id: string; type: 'blank' }
  | { id: string; type: 'template'; starter: Starter }
  | { id: string; type: 'workflow'; workflow: ProjectWorkflow }
  | { id: string; type: 'node'; node: NodeKind }

const YOURS = 'yours'
const TABS = [
  { id: 'popular', label: 'Popular' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'edit', label: 'Edit' },
  { id: '3d', label: '3D' },
  { id: 'audio', label: 'Audio' },
  { id: YOURS, label: 'Yours' }
]
const SLOTS = 7
const BLANK: Item = { id: 'blank', type: 'blank' }

const query = ref('')
const shelf = ref('popular')
const hover = ref(-1)
const navigated = ref(false)
const composer = ref<InstanceType<typeof CreateComposer>>()
const flow = useCreateAgent()

const q = computed(() => query.value.trim().toLowerCase())
const workflows = computed(() => [...allWorkflows.value].sort((a, b) => a.age - b.age))
const tpl = (starter: Starter): Item => ({ id: `t:${starter.id}`, type: 'template', starter })
const wf = (workflow: ProjectWorkflow): Item => ({
  id: `w:${workflow.id}`,
  type: 'workflow',
  workflow
})
const lastOutput = (w: ProjectWorkflow): string | undefined =>
  MOCK[w.name] ?? (w.thumbId ? thumb(w.thumbId) : undefined)

function unique(list: Starter[]): Starter[] {
  const seen = new Set<string>()
  return list.filter((s) => (seen.has(s.poster) ? false : (seen.add(s.poster), true)))
}

const items = computed<Item[]>(() => {
  if (q.value) {
    const found = searchStarters(q.value, 8).length
      ? searchStarters(q.value, 8)
      : quickPicks(q.value, 6)
    const kinds = (Object.keys(NODE_TYPES) as NodeKind[]).filter((k) =>
      `${NODE_TYPES[k].title} ${NODE_TYPES[k].description}`.toLowerCase().includes(q.value)
    )
    return [
      BLANK,
      ...unique(found).map(tpl),
      ...workflows.value.filter((w) => w.name.toLowerCase().includes(q.value)).map(wf),
      ...kinds.map((node): Item => ({ id: `n:${node}`, type: 'node', node }))
    ].slice(0, SLOTS)
  }
  if (shelf.value === YOURS) return [BLANK, ...workflows.value.map(wf)].slice(0, SLOTS)
  return [
    BLANK,
    ...unique((SHELVES.find((s) => s.id === shelf.value) ?? SHELVES[0]!).starters()).map(tpl)
  ].slice(0, SLOTS)
})
const slots = computed(() =>
  Array.from({ length: SLOTS }, (_, i) => ({ key: items.value[i]?.id ?? `empty-${i}`, i }))
)
watch([q, shelf], () => {
  hover.value = -1
  navigated.value = false
})

const current = computed(() => items.value[hover.value])
const ghostStarter = computed(() =>
  current.value?.type === 'template' ? current.value.starter : null
)
const ghostWorkflow = computed(() =>
  current.value?.type === 'workflow'
    ? { name: current.value.workflow.name, cover: lastOutput(current.value.workflow) }
    : null
)
const ghostOn = computed(() => !!ghostStarter.value || !!ghostWorkflow.value)

const line = computed(() => {
  const c = current.value
  if (!c) return ''
  if (c.type === 'template')
    return `${c.starter.makes} · ${c.starter.model} · ${readiness(c.starter.template).label}`
  if (c.type === 'workflow')
    return `${c.workflow.name} · ${buildOf(c.workflow)?.name ?? ''} · edited ${c.workflow.modified.toLowerCase()}`
  if (c.type === 'node') return `${NODE_TYPES[c.node].title} · ${NODE_TYPES[c.node].description}`
  return `Blank canvas · build it node by node on ${activeInstance.value.name}`
})

function nameOf(item: Item): string {
  if (item.type === 'template') return item.starter.makes
  if (item.type === 'workflow') return item.workflow.name
  if (item.type === 'node') return NODE_TYPES[item.node].title
  return 'Blank canvas'
}

function pick(item: Item): void {
  if (item.type === 'template') openTemplate(item.starter.template)
  else if (item.type === 'workflow') openWorkflow(item.workflow)
  else if (item.type === 'node') startWithNode(item.node)
  else startBlank()
}

function onAsk(a: AgentAnswer): void {
  if (agentOpens.id === 'comfy') startWithAgentAsk(agentStart(a.prompt))
  else flow.ask(a)
}

function key(e: KeyboardEvent): void {
  const last = items.value.length - 1
  const sideways = !query.value && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')
  if (e.key === 'Escape') {
    if (flow.panel.value) flow.close()
    else if (query.value) query.value = ''
    else closeCreate()
  } else if (e.key === 'Enter') {
    if (current.value) pick(current.value)
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || sideways) {
    navigated.value = true
    const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight'
    hover.value = forward ? Math.min(last, hover.value + 1) : Math.max(0, hover.value - 1)
  } else return
  e.preventDefault()
}

useEscapeCloses(() => composer.value?.field)
</script>

<template>
  <section
    class="v13 relative flex h-full min-h-[600px]"
    :class="current?.type === 'blank' && 'is-blank'"
    aria-label="Create"
  >
    <div class="v13-canvas" aria-hidden="true" />

    <div class="v13-main">
      <div class="v13-ghost" :class="ghostOn && !flow.panel.value && 'is-on'" aria-hidden="true">
        <GhostGraph
          v-if="ghostStarter || ghostWorkflow"
          :key="current?.id"
          :starter="ghostStarter"
          :workflow="ghostWorkflow"
        />
      </div>

      <div
        v-if="flow.build.value"
        class="v13-built"
        :class="!flow.panel.value && 'is-faint'"
        aria-hidden="true"
      >
        <GhostGraph :starter="flow.build.value.starter" :agent="flow.ghost.value" />
      </div>

      <div
        class="v13-col"
        :class="[ghostOn && 'is-dim', flow.panel.value && 'is-hidden']"
        :aria-hidden="flow.panel.value"
      >
        <h1 class="v13-title">What do you want to make?</h1>
        <CreateComposer
          ref="composer"
          v-model="query"
          class="v13-composer"
          :mode="createInput.id"
          :navigated
          external
          @key="key"
          @ask="onAsk"
        />
        <nav v-if="!q" class="v13-tabs" aria-label="Show">
          <button
            v-for="t in TABS"
            :key="t.id"
            type="button"
            class="v13-tab"
            :class="shelf === t.id && 'is-on'"
            :aria-pressed="shelf === t.id"
            @click="shelf = t.id"
          >
            {{ t.label }}
          </button>
        </nav>
        <p v-else class="v13-tabs v13-count">Matches for “{{ query.trim() }}”</p>

        <div class="v13-row" @pointerleave="hover = -1">
          <template v-for="s in slots" :key="s.key">
            <button
              v-if="items[s.i]"
              type="button"
              class="v13-tile"
              :class="[hover === s.i && 'is-at', `is-${items[s.i]!.type}`]"
              @pointerenter="hover = s.i"
              @focus="hover = s.i"
              @blur="hover = -1"
              @click="pick(items[s.i]!)"
            >
              <span class="v13-pic">
                <img
                  v-if="items[s.i]!.type === 'template'"
                  :src="(items[s.i] as { starter: Starter }).starter.poster"
                  alt=""
                  loading="lazy"
                />
                <template v-else-if="items[s.i]!.type === 'workflow'">
                  <img
                    v-if="lastOutput((items[s.i] as { workflow: ProjectWorkflow }).workflow)"
                    :src="lastOutput((items[s.i] as { workflow: ProjectWorkflow }).workflow)"
                    alt=""
                    loading="lazy"
                  />
                  <WorkflowCover
                    v-else
                    :name="(items[s.i] as { workflow: ProjectWorkflow }).workflow.name"
                  />
                </template>
                <component
                  :is="NODE_ICONS[(items[s.i] as { node: NodeKind }).node]"
                  v-else-if="items[s.i]!.type === 'node'"
                  :size="16"
                />
                <Plus v-else :size="18" />
              </span>
              <span class="v13-name">{{ nameOf(items[s.i]!) }}</span>
            </button>
            <span v-else class="v13-tile is-empty" aria-hidden="true">
              <span class="v13-pic" />
            </span>
          </template>
        </div>
        <p class="v13-line" aria-live="polite">{{ line }}</p>
      </div>
    </div>

    <Transition name="ca-dock">
      <CreateAgentPanel
        v-if="flow.panel.value"
        :flow
        @close="flow.close()"
        @use="(s) => openTemplate(s.template)"
      />
    </Transition>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v13 {
  isolation: isolate;
  overflow: hidden;
}
:root .proto-ui.proto-ui.proto-ui .v13-canvas {
  position: absolute;
  inset: 0;
  z-index: -1;
  --v13-dot: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  background:
    radial-gradient(var(--v13-dot) 1px, transparent 1.4px) 0 0 / 22px 22px,
    var(--color-content-background);
}
:root .proto-ui.proto-ui.proto-ui .v13.is-blank .v13-canvas {
  --v13-dot: color-mix(in oklch, var(--color-base-foreground) 22%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .v13-main {
  position: relative;
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 48px 32px;
}
:root .proto-ui.proto-ui.proto-ui .v13-ghost,
:root .proto-ui.proto-ui.proto-ui .v13-built {
  position: absolute;
  inset: 32px 24px;
  display: grid;
  place-items: center;
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v13-ghost .gg-stage,
:root .proto-ui.proto-ui.proto-ui .v13-built .gg-stage {
  width: min(1240px, 100%);
  max-width: none;
}
:root .proto-ui.proto-ui.proto-ui .v13-ghost {
  opacity: 0;
  transition: opacity 360ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v13-ghost.is-on {
  opacity: 0.34;
}
:root .proto-ui.proto-ui.proto-ui .v13-built.is-faint {
  opacity: 0.2;
}
:root .proto-ui.proto-ui.proto-ui .v13-col {
  position: relative;
  z-index: 2;
  display: flex;
  width: 100%;
  max-width: 1000px;
  flex-direction: column;
  align-items: center;
  text-align: center;
  transition: opacity 260ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v13-col.is-dim > :not(.v13-row) {
  opacity: 0.6;
}
:root .proto-ui.proto-ui.proto-ui .v13-col.is-hidden {
  opacity: 0;
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v13-title {
  color: var(--color-base-foreground);
  font-size: 30px;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 36px;
  transition: opacity 260ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v13-composer {
  width: 100%;
  max-width: 560px;
  margin-top: 22px;
  text-align: left;
  transition: opacity 260ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v13-tabs {
  display: flex;
  min-height: 24px;
  align-items: center;
  gap: 16px;
  margin-top: 30px;
  transition: opacity 260ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v13-tab {
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v13-tab:hover,
:root .proto-ui.proto-ui.proto-ui .v13-tab.is-on {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v13-count {
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v13-row {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}
:root .proto-ui.proto-ui.proto-ui .v13-tile {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v13-pic {
  position: relative;
  display: grid;
  aspect-ratio: 4 / 3;
  place-items: center;
  overflow: hidden;
  border-radius: 12px;
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
  transition:
    transform 220ms var(--ease-out-expo),
    box-shadow 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v13-pic > img,
:root .proto-ui.proto-ui.proto-ui .v13-pic > .wfc {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v13-tile.is-at .v13-pic {
  transform: translateY(-3px);
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v13-tile.is-blank .v13-pic {
  background:
    radial-gradient(
        color-mix(in oklch, var(--color-base-foreground) 18%, transparent) 1px,
        transparent 1.4px
      )
      0 0 / 10px 10px,
    var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v13-tile.is-empty .v13-pic {
  background: transparent;
  outline: 1px dashed var(--color-border-default);
  outline-offset: -1px;
}
:root .proto-ui.proto-ui.proto-ui .v13-name {
  overflow: hidden;
  color: var(--color-muted-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v13-tile.is-at .v13-name {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v13-line {
  min-height: 20px;
  margin-top: 16px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v13-ghost,
  :root .proto-ui.proto-ui.proto-ui .v13-col,
  :root .proto-ui.proto-ui.proto-ui .v13-pic,
  :root .proto-ui.proto-ui.proto-ui .v13-canvas {
    transition: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v13-tile.is-at .v13-pic {
    transform: none;
  }
}
</style>
