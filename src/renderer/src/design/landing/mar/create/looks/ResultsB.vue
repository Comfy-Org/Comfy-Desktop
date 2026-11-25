<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { CornerDownLeft, Plus, Search } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { allWorkflows, type ProjectWorkflow } from '../../../gallery'
import { activeInstance } from '../../../useProto'
import { NODE_TYPES, type NodeKind } from '../../graph/canvasData'
import { NODE_ICONS } from '../../graph/nodeIcons'
import { openTemplate, openWorkflow, startBlank, startWithNode } from '../createScreen'
import { readiness, searchStarters, type Starter } from '../createStarters'
import { buildOf, readyIcon } from './lookKitB'
import { quickPicks } from './v07Agent'

type Hit =
  | { id: string; type: 'workflow'; workflow: ProjectWorkflow }
  | { id: string; type: 'template'; starter: Starter }
  | { id: string; type: 'node'; node: NodeKind }
  | { id: string; type: 'blank' }

const { query } = defineProps<{ query: string }>()

const KINDS = Object.keys(NODE_TYPES) as NodeKind[]
const BLANK: Hit = { id: 'blank', type: 'blank' }
const at = ref(0)
const q = computed(() => query.trim().toLowerCase())
const matches = (text: string): boolean => text.toLowerCase().includes(q.value)

const sections = computed<{ title: string; hits: Hit[] }[]>(() =>
  [
    {
      title: 'Your workflows',
      hits: [...allWorkflows.value]
        .sort((a, b) => a.age - b.age)
        .filter((w) => matches(w.name))
        .slice(0, 5)
        .map((workflow): Hit => ({ id: `w:${workflow.id}`, type: 'workflow', workflow }))
    },
    {
      title: 'Templates',
      hits: (searchStarters(q.value, 6).length
        ? searchStarters(q.value, 6)
        : quickPicks(q.value, 6)
      ).map(
        (starter): Hit => ({
          id: `t:${starter.id}`,
          type: 'template',
          starter
        })
      )
    },
    {
      title: 'Nodes',
      hits: KINDS.filter((k) => matches(`${NODE_TYPES[k].title} ${NODE_TYPES[k].description}`))
        .slice(0, 4)
        .map((node): Hit => ({ id: `n:${node}`, type: 'node', node }))
    },
    { title: '', hits: [BLANK] }
  ].filter((s) => s.hits.length)
)

const flat = computed(() => sections.value.flatMap((s) => s.hits))
const found = computed(() => flat.value.some((h) => h.type !== 'blank'))
const indexOf = (hit: Hit): number => flat.value.findIndex((h) => h.id === hit.id)
const current = computed(() => flat.value[at.value])
watch(q, () => (at.value = 0))

function pick(hit: Hit): void {
  if (hit.type === 'workflow') openWorkflow(hit.workflow)
  else if (hit.type === 'template') openTemplate(hit.starter.template)
  else if (hit.type === 'node') startWithNode(hit.node)
  else startBlank()
}

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

function key(e: KeyboardEvent): boolean {
  const last = flat.value.length - 1
  if (e.key === 'ArrowDown') at.value = Math.min(last, at.value + 1)
  else if (e.key === 'ArrowUp') at.value = Math.max(0, at.value - 1)
  else if (e.key === 'Enter' && current.value) pick(current.value)
  else return false
  e.preventDefault()
  return true
}

watch(at, (i) =>
  nextTick(() =>
    document.querySelector(`[data-rb-at="${i}"]`)?.scrollIntoView({ block: 'nearest' })
  )
)

defineExpose({ key })
</script>

<template>
  <div class="rb">
    <div class="flex min-w-0 flex-1 flex-col">
      <template v-for="s in sections" :key="s.title || 'blank'">
        <h2 v-if="s.title" class="rb-sec">{{ s.title }}</h2>
        <button
          v-for="hit in s.hits"
          :key="hit.id"
          type="button"
          class="rb-row"
          :class="indexOf(hit) === at && 'is-at'"
          :data-rb-at="indexOf(hit)"
          @pointermove="at = indexOf(hit)"
          @click="pick(hit)"
        >
          <span class="rb-thumb" :class="`is-${hit.type}`">
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
            <span class="truncate text-[14px] text-base-foreground">{{ title(hit) }}</span>
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
        No template, workflow or node matches “{{ query.trim() }}”.
      </p>
    </div>

    <aside v-if="current" class="rb-peek" aria-live="polite">
      <div class="rb-peek-media">
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
            class="motion-reduce:hidden"
          />
        </template>
        <component :is="icon(current)" v-else :size="28" />
      </div>
      <p class="mt-4 text-heading font-semibold text-base-foreground">{{ title(current) }}</p>
      <p class="mt-1 text-ui text-muted-foreground">
        <template v-if="current.type === 'template'">{{ current.starter.line }}.</template>
        <template v-else-if="current.type === 'workflow'"
          >On {{ meta(current) }}, edited {{ current.workflow.modified.toLowerCase() }}.</template
        >
        <template v-else-if="current.type === 'node'"
          >Starts a canvas on {{ activeInstance.name }} with this node on it.</template
        >
        <template v-else>{{ meta(current) }}.</template>
      </p>
      <p
        v-if="current.type === 'template'"
        class="rb-ready"
        :class="`is-${readiness(current.starter.template).tone}`"
      >
        <component
          :is="readyIcon(readiness(current.starter.template))"
          v-if="readiness(current.starter.template).tone !== 'off'"
          :size="13"
        />
        {{ readiness(current.starter.template).label }}
      </p>
    </aside>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .rb {
  display: flex;
  align-items: flex-start;
  gap: 32px;
  animation: rb-fade 200ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .rb-sec {
  margin: 22px 12px 8px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .rb-sec:first-child {
  margin-top: 4px;
}
:root .proto-ui.proto-ui.proto-ui .rb-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 14px;
  padding: 8px 12px 8px 8px;
  border-radius: 12px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .rb-row.is-at {
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .rb-thumb {
  display: grid;
  width: 72px;
  height: 48px;
  flex: none;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .rb-thumb.is-blank {
  background: transparent;
  outline: 1px dashed var(--color-border-strong);
  outline-offset: -1px;
}
:root .proto-ui.proto-ui.proto-ui .rb-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .rb-peek {
  position: sticky;
  top: 24px;
  display: flex;
  width: 320px;
  flex: none;
  flex-direction: column;
  align-items: flex-start;
  padding: 12px 12px 16px;
  border-radius: 14px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .rb-peek > p {
  padding: 0 6px;
}
:root .proto-ui.proto-ui.proto-ui .rb-peek-media {
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
:root .proto-ui.proto-ui.proto-ui .rb-peek-media img,
:root .proto-ui.proto-ui.proto-ui .rb-peek-media video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .rb-ready {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .rb-ready.is-ready svg {
  color: var(--color-status-running);
}
@keyframes rb-fade {
  from {
    opacity: 0;
  }
}
@media (max-width: 1000px) {
  :root .proto-ui.proto-ui.proto-ui .rb-peek {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .rb {
    animation: none;
  }
}
</style>
