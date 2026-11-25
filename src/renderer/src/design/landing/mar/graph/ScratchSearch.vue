<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch, type Component } from 'vue'
import { CornerDownLeft, Search, SquareDashed } from 'lucide-vue-next'
import { NODE_TYPES, type NodeKind } from './canvasData'
import { NODE_ICONS } from './nodeIcons'
import { ComfyModel, ComfyTemplate } from '../icons/comfyIcons'
import { TEMPLATES, thumb, type Template } from '../../mock'
import { PICTURES } from './panels/panelData'

const emit = defineEmits<{
  node: [kind: NodeKind, model?: string]
  template: [t: Template]
  blank: []
}>()

type Hit =
  | { id: string; type: 'node'; node: NodeKind }
  | { id: string; type: 'model'; node: NodeKind; model: string; provider: string }
  | { id: string; type: 'template'; template: Template }
  | { id: string; type: 'blank' }

interface Section {
  title: string
  hits: Hit[]
}

const STARTERS: NodeKind[] = ['image', 'prompt', 'generate', 'generateVideo']
const KINDS = Object.keys(NODE_TYPES) as NodeKind[]
const nodeHit = (node: NodeKind): Hit => ({ id: `node:${node}`, type: 'node', node })
const templateHit = (template: Template): Hit => ({
  id: `template:${template.id}`,
  type: 'template',
  template
})
const BLANK: Hit = { id: 'blank', type: 'blank' }

const MODELS = KINDS.flatMap((node) =>
  NODE_TYPES[node].controls().flatMap((c) =>
    c.kind === 'model'
      ? c.options.map(
          (o): Hit => ({
            id: `model:${node}:${o.value}`,
            type: 'model',
            node,
            model: o.value,
            provider: o.provider
          })
        )
      : []
  )
)
const GRAPH_TEMPLATES = TEMPLATES.filter((t) => t.kind === 'graph')

const query = ref('')
const at = ref(0)
const input = ref<HTMLInputElement>()

const matches = (text: string, q: string): boolean => text.toLowerCase().includes(q)

const sections = computed<Section[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q)
    return [
      { title: 'Popular nodes', hits: STARTERS.map(nodeHit) },
      { title: 'Templates', hits: GRAPH_TEMPLATES.slice(0, 2).map(templateHit) },
      { title: '', hits: [BLANK] }
    ]
  const nodes = KINDS.filter((k) => {
    const t = NODE_TYPES[k]
    return matches(`${t.title} ${t.description} ${t.category}`, q)
  })
    .slice(0, 5)
    .map(nodeHit)
  const models = MODELS.filter(
    (m) => m.type === 'model' && matches(`${m.model} ${m.provider}`, q)
  ).slice(0, 4)
  const templates = TEMPLATES.filter((t) => matches(`${t.title} ${t.category}`, q))
    .slice(0, 4)
    .map(templateHit)
  return [
    { title: 'Nodes', hits: nodes },
    { title: 'Models', hits: models },
    { title: 'Templates', hits: templates },
    { title: '', hits: [BLANK] }
  ].filter((s) => s.hits.length)
})
const flat = computed(() => sections.value.flatMap((s) => s.hits))
const found = computed(() => flat.value.some((h) => h.type !== 'blank'))
watch(query, () => (at.value = 0))

const indexOf = (hit: Hit): number => flat.value.findIndex((h) => h.id === hit.id)

function pick(hit: Hit): void {
  if (hit.type === 'node') emit('node', hit.node)
  else if (hit.type === 'model') emit('node', hit.node, hit.model)
  else if (hit.type === 'template') emit('template', hit.template)
  else emit('blank')
}

function key(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') at.value = Math.min(flat.value.length - 1, at.value + 1)
  else if (e.key === 'ArrowUp') at.value = Math.max(0, at.value - 1)
  else if (e.key === 'Enter' && flat.value[at.value]) pick(flat.value[at.value]!)
  else if (e.key === 'Escape') emit('blank')
  else return
  e.preventDefault()
  nextTick(() => document.querySelector('.ss-item.is-at')?.scrollIntoView({ block: 'nearest' }))
}

function icon(hit: Hit): Component {
  if (hit.type === 'node') return NODE_ICONS[hit.node]
  if (hit.type === 'model') return ComfyModel
  if (hit.type === 'template') return ComfyTemplate
  return SquareDashed
}
function title(hit: Hit): string {
  if (hit.type === 'node') return NODE_TYPES[hit.node].title
  if (hit.type === 'model') return hit.model
  if (hit.type === 'template') return hit.template.title
  return 'Start from a blank canvas'
}
function detail(hit: Hit): string {
  if (hit.type === 'node') return NODE_TYPES[hit.node].description
  if (hit.type === 'model') return `${hit.provider} · in a ${NODE_TYPES[hit.node].title} node`
  if (hit.type === 'template')
    return `${hit.template.category === '3d' ? '3D' : hit.template.category[0]!.toUpperCase() + hit.template.category.slice(1)} template`
  return 'Double-click the canvas or press / to add nodes later'
}
function fallback(e: Event, i: number): void {
  const img = e.target as HTMLImageElement
  const alt = PICTURES[i % PICTURES.length]?.src
  if (alt && img.src !== alt) img.src = alt
}

onMounted(() => input.value?.focus())
</script>

<template>
  <div class="ss" @pointerdown.stop @wheel.stop @dblclick.stop>
    <div class="ss-panel" role="dialog" aria-label="Start your workflow">
      <p class="ss-lead">Search nodes, models or templates to start</p>
      <div class="ss-card">
        <label class="ss-field">
          <Search :size="18" />
          <input
            ref="input"
            v-model="query"
            type="text"
            placeholder="Image, Flux, image to video…"
            aria-label="Search nodes, models or templates"
            @keydown="key"
          />
          <kbd class="ss-kbd">Esc</kbd>
        </label>
        <div id="ss-list" class="ss-list">
          <template v-for="s in sections" :key="s.title || 'end'">
            <p v-if="s.title" class="ss-cat">{{ s.title }}</p>
            <i v-else class="ss-rule" />
            <button
              v-for="hit in s.hits"
              :id="`ss-${hit.id}`"
              :key="hit.id"
              type="button"
              class="ss-item"
              :class="indexOf(hit) === at && 'is-at'"
              @pointermove="at = indexOf(hit)"
              @click="pick(hit)"
            >
              <span v-if="hit.type === 'template'" class="ss-thumb">
                <img
                  :src="thumb(hit.template.id)"
                  alt=""
                  loading="lazy"
                  @error="fallback($event, indexOf(hit))"
                />
              </span>
              <span v-else class="ss-icon"><component :is="icon(hit)" :size="15" /></span>
              <span class="ss-text">
                <span class="ss-title">{{ title(hit) }}</span>
                <span class="ss-desc">{{ detail(hit) }}</span>
              </span>
              <CornerDownLeft v-if="indexOf(hit) === at" :size="14" class="ss-enter" />
            </button>
          </template>
          <p v-if="query.trim() && !found" class="ss-none">Nothing matches “{{ query.trim() }}”.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .ss {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: max(96px, calc(var(--mg-top, 0px) + 13vh)) 24px 24px;
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .ss-panel {
  display: flex;
  width: min(560px, 100%);
  max-height: 100%;
  flex-direction: column;
  gap: 14px;
  pointer-events: auto;
  animation: ss-in 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes ss-in {
  from {
    opacity: 0;
    translate: 0 6px;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .ss-panel {
    animation: none;
  }
}
:root .proto-ui.proto-ui.proto-ui .ss-lead {
  margin: 0;
  color: var(--mg-text);
  font-size: 18px;
  font-weight: 500;
  letter-spacing: -0.01em;
  text-align: center;
}
:root .proto-ui.proto-ui.proto-ui .ss-card {
  display: flex;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: color-mix(in oklch, var(--color-content-background) 84%, transparent);
  backdrop-filter: blur(32px) saturate(1.2);
  box-shadow:
    0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 8%, transparent),
    0 24px 60px rgb(0 0 0 / 0.32);
  color: var(--mg-text);
}
:root .proto-ui.proto-ui.proto-ui .ss-field {
  display: flex;
  height: 56px;
  flex: none;
  align-items: center;
  gap: 12px;
  padding: 0 16px 0 18px;
  box-shadow: inset 0 -1px 0 color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--mg-dim);
}
:root .proto-ui.proto-ui.proto-ui .ss-field input {
  height: auto;
  min-width: 0;
  flex: 1;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  box-shadow: none;
  color: var(--mg-text);
  font: inherit;
  font-size: 16px;
}
:root .proto-ui.proto-ui.proto-ui .ss-field input::placeholder {
  color: var(--mg-dim);
}
:root .proto-ui.proto-ui.proto-ui .ss-kbd {
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--mg-well);
  color: var(--mg-dim);
  font: inherit;
  font-size: 11px;
}
:root .proto-ui.proto-ui.proto-ui .ss-list {
  min-height: 0;
  max-height: 440px;
  overflow: auto;
  padding: 4px 8px 8px;
}
:root .proto-ui.proto-ui.proto-ui .ss-cat {
  margin: 10px 10px 4px;
  color: var(--mg-dim);
  font-size: 11px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .ss-rule {
  display: block;
  height: 1px;
  margin: 8px 6px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .ss-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  padding: 7px 10px;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  color: var(--mg-text);
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .ss-item.is-at {
  background: var(--mg-hover);
}
:root .proto-ui.proto-ui.proto-ui .ss-icon,
:root .proto-ui.proto-ui.proto-ui .ss-thumb {
  display: inline-flex;
  width: 32px;
  height: 32px;
  flex: none;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: var(--mar-tab-item-radius);
  background: var(--mg-well);
  color: var(--mg-muted);
}
:root .proto-ui.proto-ui.proto-ui .ss-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .ss-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
:root .proto-ui.proto-ui.proto-ui .ss-title {
  overflow: hidden;
  font-size: 13.5px;
  line-height: 18px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
:root .proto-ui.proto-ui.proto-ui .ss-desc {
  overflow: hidden;
  color: var(--mg-dim);
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
:root .proto-ui.proto-ui.proto-ui .ss-enter {
  flex: none;
  color: var(--mg-dim);
}
:root .proto-ui.proto-ui.proto-ui .ss-none {
  margin: 0;
  padding: 14px 10px 6px;
  color: var(--mg-dim);
  font-size: 12.5px;
}
:root .proto-ui.proto-ui.proto-ui .is-current .ss-card {
  background: var(--mg-chrome-2);
  backdrop-filter: none;
  box-shadow:
    0 0 0 1px var(--mg-chrome-line),
    0 12px 30px rgb(0 0 0 / 0.35);
}
</style>
