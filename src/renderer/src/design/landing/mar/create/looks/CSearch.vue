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
import { buildOf } from './cLooks'

type Hit =
  | { id: string; type: 'workflow'; workflow: ProjectWorkflow }
  | { id: string; type: 'template'; starter: Starter }
  | { id: string; type: 'node'; node: NodeKind }
  | { id: string; type: 'blank' }

const { query, plain = false } = defineProps<{ query: string; plain?: boolean }>()
const emit = defineEmits<{ clear: [] }>()

const KINDS = Object.keys(NODE_TYPES) as NodeKind[]
const at = ref(0)
const q = computed(() => query.trim().toLowerCase())
const matches = (text: string): boolean => text.toLowerCase().includes(q.value)

const sections = computed<{ title: string; hits: Hit[] }[]>(() => {
  if (!q.value) return []
  return [
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
      hits: searchStarters(q.value, 6).map((starter): Hit => ({
        id: `t:${starter.id}`,
        type: 'template',
        starter
      }))
    },
    {
      title: 'Nodes',
      hits: KINDS.filter((k) => matches(`${NODE_TYPES[k].title} ${NODE_TYPES[k].description}`))
        .slice(0, 4)
        .map((node): Hit => ({ id: `n:${node}`, type: 'node', node }))
    },
    { title: '', hits: [{ id: 'blank', type: 'blank' }] }
  ].filter((s) => s.hits.length)
})

const flat = computed(() => sections.value.flatMap((s) => s.hits))
const found = computed(() => flat.value.some((h) => h.type !== 'blank'))
const current = computed(() => flat.value[at.value])
const indexOf = (hit: Hit): number => flat.value.findIndex((h) => h.id === hit.id)
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

function onKey(e: KeyboardEvent): boolean {
  if (!q.value) return false
  const last = flat.value.length - 1
  if (e.key === 'ArrowDown') at.value = Math.min(last, at.value + 1)
  else if (e.key === 'ArrowUp') at.value = Math.max(0, at.value - 1)
  else if (e.key === 'Enter') {
    const hit = flat.value[at.value]
    if (hit) pick(hit)
  } else if (e.key === 'Escape') emit('clear')
  else return false
  e.preventDefault()
  return true
}

watch(at, (i) =>
  nextTick(() =>
    document.querySelector(`[data-cxs-at="${i}"]`)?.scrollIntoView({ block: 'nearest' })
  )
)

defineExpose({ onKey })
</script>

<template>
  <div class="cxs" :class="plain && 'is-plain'">
    <div class="cxs-list" aria-label="Search results">
      <template v-for="s in sections" :key="s.title || 'blank'">
        <h2 v-if="s.title" class="cxs-sec">{{ s.title }}</h2>
        <button
          v-for="hit in s.hits"
          :key="hit.id"
          type="button"
          class="cxs-row"
          :class="indexOf(hit) === at && 'is-at'"
          :data-cxs-at="indexOf(hit)"
          @pointermove="at = indexOf(hit)"
          @click="pick(hit)"
        >
          <span class="cxs-thumb" :class="`is-${hit.type}`">
            <WorkflowCover v-if="hit.type === 'workflow'" :name="hit.workflow.name" />
            <img v-else-if="hit.type === 'template'" :src="hit.starter.poster" alt="" />
            <component :is="icon(hit)" v-else :size="plain ? 14 : 18" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-ui text-base-foreground">{{ title(hit) }}</span>
            <span v-if="!plain" class="truncate text-ui text-subtle-foreground">{{
              meta(hit)
            }}</span>
          </span>
          <span v-if="hit.type === 'workflow'" class="cxs-aside">{{ hit.workflow.modified }}</span>
          <span
            v-else-if="hit.type === 'template' && plain && indexOf(hit) === at"
            class="cxs-aside"
            >{{ readiness(hit.starter.template).label }}</span
          >
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
    <aside v-if="!plain && current" class="cxs-peek" aria-live="polite">
      <div class="cxs-peek-media">
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
        <template v-else>{{ meta(current) }}</template>
      </p>
      <p v-if="current.type === 'template'" class="mt-3 text-ui text-subtle-foreground">
        {{ readiness(current.starter.template).label }}
      </p>
    </aside>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .cxs {
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 28px;
  animation: cxs-fade 180ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .cxs-list {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
:root .proto-ui.proto-ui.proto-ui .cxs-sec {
  margin: 20px 12px 6px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .cxs-sec:first-child {
  margin-top: 0;
}
:root .proto-ui.proto-ui.proto-ui .cxs-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 14px;
  padding: 7px 12px 7px 7px;
  border-radius: 12px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .cxs-row.is-at {
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .cxs-row:focus-visible {
  box-shadow: inset 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .cxs-aside {
  flex: none;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .cxs-thumb {
  display: grid;
  width: 72px;
  height: 46px;
  flex: none;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .cxs.is-plain .cxs-thumb {
  width: 28px;
  height: 28px;
  border-radius: 6px;
}
:root .proto-ui.proto-ui.proto-ui .cxs-thumb.is-blank {
  background: transparent;
  outline: 1px dashed color-mix(in oklch, var(--color-base-foreground) 16%, transparent);
  outline-offset: -1px;
}
:root .proto-ui.proto-ui.proto-ui .cxs-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .cxs-peek {
  position: sticky;
  top: 24px;
  width: 300px;
  flex: none;
  padding: 12px 14px 16px;
  border-radius: 14px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, var(--color-content-background));
}
:root .proto-ui.proto-ui.proto-ui .cxs-peek-media {
  position: relative;
  display: grid;
  aspect-ratio: 4 / 3;
  place-items: center;
  overflow: hidden;
  border-radius: 10px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .cxs-peek-media img,
:root .proto-ui.proto-ui.proto-ui .cxs-peek-media video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
@keyframes cxs-fade {
  from {
    opacity: 0;
  }
}
@media (max-width: 1000px) {
  :root .proto-ui.proto-ui.proto-ui .cxs-peek {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .cxs {
    animation: none;
  }
}
</style>
