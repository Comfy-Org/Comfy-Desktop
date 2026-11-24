<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { CornerDownLeft, Plus, Search, X } from 'lucide-vue-next'
import WorkflowCover from '../brand/WorkflowCover.vue'
import { allWorkflows, type ProjectWorkflow } from '../../gallery'
import { activeInstance, instanceById } from '../../useProto'
import { TEMPLATES, thumb, type Template } from '../../mock'
import { NODE_TYPES, type NodeKind } from '../graph/canvasData'
import { NODE_ICONS } from '../graph/nodeIcons'
import { PICTURES } from '../graph/panels/panelData'
import { closeCreate, openTemplate, openWorkflow, startBlank, startWithNode } from './createScreen'

type Hit =
  | { id: string; type: 'workflow'; workflow: ProjectWorkflow }
  | { id: string; type: 'template'; template: Template }
  | { id: string; type: 'node'; node: NodeKind }
  | { id: string; type: 'blank' }

const KINDS = Object.keys(NODE_TYPES) as NodeKind[]
const BLANK: Hit = { id: 'blank', type: 'blank' }
const workflowHit = (workflow: ProjectWorkflow): Hit => ({
  id: `workflow:${workflow.id}`,
  type: 'workflow',
  workflow
})

const query = ref('')
const at = ref(0)
const field = ref<HTMLInputElement>()

const workflows = computed(() => [...allWorkflows.value].sort((a, b) => a.age - b.age))
const matches = (text: string, q: string): boolean => text.toLowerCase().includes(q)

const sections = computed<{ title: string; hits: Hit[] }[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q)
    return [
      { title: '', hits: [BLANK] },
      { title: 'Recent workflows', hits: workflows.value.slice(0, 6).map(workflowHit) }
    ].filter((s) => s.hits.length)
  return [
    {
      title: 'Workflows',
      hits: workflows.value
        .filter((w) => matches(w.name, q))
        .slice(0, 5)
        .map(workflowHit)
    },
    {
      title: 'Templates',
      hits: TEMPLATES.filter((t) => t.kind === 'graph' && matches(`${t.title} ${t.category}`, q))
        .slice(0, 4)
        .map((template): Hit => ({ id: `template:${template.id}`, type: 'template', template }))
    },
    {
      title: 'Nodes',
      hits: KINDS.filter((k) => matches(`${NODE_TYPES[k].title} ${NODE_TYPES[k].description}`, q))
        .slice(0, 4)
        .map((node): Hit => ({ id: `node:${node}`, type: 'node', node }))
    },
    { title: '', hits: [BLANK] }
  ].filter((s) => s.hits.length)
})
const flat = computed(() => sections.value.flatMap((s) => s.hits))
const found = computed(() => flat.value.some((h) => h.type !== 'blank'))
const indexOf = (hit: Hit): number => flat.value.findIndex((h) => h.id === hit.id)
watch(query, () => (at.value = query.value.trim() ? 0 : -1))
at.value = -1

function pick(hit: Hit): void {
  if (hit.type === 'workflow') openWorkflow(hit.workflow)
  else if (hit.type === 'template') openTemplate(hit.template)
  else if (hit.type === 'node') startWithNode(hit.node)
  else startBlank()
}

function title(hit: Hit): string {
  if (hit.type === 'workflow') return hit.workflow.name
  if (hit.type === 'template') return hit.template.title
  if (hit.type === 'node') return NODE_TYPES[hit.node].title
  return 'Blank workflow'
}
function meta(hit: Hit): string {
  if (hit.type === 'workflow')
    return (hit.workflow.envId && instanceById(hit.workflow.envId)?.name) || ''
  if (hit.type === 'template') return 'Template'
  if (hit.type === 'node') return `Node · ${NODE_TYPES[hit.node].description}`
  return `Empty canvas on ${activeInstance.value.name}`
}
const icon = (hit: Hit): Component =>
  hit.type === 'node' ? NODE_ICONS[hit.node] : hit.type === 'blank' ? Plus : Search

function fallback(e: Event, i: number): void {
  const img = e.target as HTMLImageElement
  const alt = PICTURES[i % PICTURES.length]?.src
  if (alt && img.src !== alt) img.src = alt
}

function key(e: KeyboardEvent): void {
  const last = flat.value.length - 1
  if (e.key === 'ArrowDown') at.value = Math.min(last, at.value + 1)
  else if (e.key === 'ArrowUp') at.value = Math.max(0, at.value - 1)
  else if (e.key === 'Enter') {
    const hit = flat.value[Math.max(0, at.value)]
    if (hit) pick(hit)
  } else if (e.key === 'Escape') {
    if (query.value) query.value = ''
    else closeCreate()
  } else return
  e.preventDefault()
  nextTick(() => document.querySelector('.mcs-row.is-at')?.scrollIntoView({ block: 'nearest' }))
}

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
  <section class="mcs relative min-h-full px-4 pb-16" aria-label="Create">
    <button type="button" class="mcs-close" aria-label="Close" title="Close" @click="closeCreate">
      <X :size="16" />
    </button>
    <div class="mx-auto flex w-full max-w-160 flex-col pt-[14vh]">
      <h1 class="mb-5 text-title font-medium text-base-foreground">Create a workflow</h1>
      <label class="mcs-field">
        <Search :size="18" class="shrink-0 text-subtle-foreground" />
        <input
          ref="field"
          v-model="query"
          type="text"
          placeholder="Search workflows, templates and nodes"
          aria-label="Search workflows, templates and nodes"
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

      <div id="mcs-list" class="mt-6 flex flex-col">
        <template v-for="s in sections" :key="s.title || 'blank'">
          <h2 v-if="s.title" class="mcs-heading">{{ s.title }}</h2>
          <button
            v-for="hit in s.hits"
            :key="hit.id"
            type="button"
            class="mcs-row"
            :class="indexOf(hit) === at && 'is-at'"
            @pointermove="at = indexOf(hit)"
            @click="pick(hit)"
          >
            <span class="mcs-thumb" :class="hit.type === 'blank' && 'is-blank'">
              <WorkflowCover v-if="hit.type === 'workflow'" :name="hit.workflow.name" />
              <img
                v-else-if="hit.type === 'template'"
                :src="thumb(hit.template.id)"
                alt=""
                loading="lazy"
                @error="fallback($event, indexOf(hit))"
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
              v-else-if="indexOf(hit) === at"
              :size="14"
              class="shrink-0 text-subtle-foreground"
            />
          </button>
        </template>
        <p v-if="query.trim() && !found" class="px-3 pt-2 pb-4 text-ui text-subtle-foreground">
          No workflow, template or node matches “{{ query.trim() }}”.
        </p>
      </div>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mcs-close {
  position: absolute;
  top: 16px;
  right: 16px;
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
:root .proto-ui.proto-ui.proto-ui .mcs-field {
  display: flex;
  height: 52px;
  align-items: center;
  gap: 12px;
  padding: 0 16px 0 20px;
  border-radius: 999px;
  background: var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mcs-field:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
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
:root .proto-ui.proto-ui.proto-ui .mcs-heading {
  margin: 28px 12px 8px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .mcs-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 16px;
  padding: 10px 12px;
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
  width: 72px;
  height: 48px;
  flex: none;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mcs-thumb.is-blank {
  background: transparent;
  box-shadow: none;
  outline: 1px dashed color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  outline-offset: -1px;
}
:root .proto-ui.proto-ui.proto-ui .mcs-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
