<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue'
import {
  ArrowRight,
  CornerDownLeft,
  FileClock,
  LayoutTemplate,
  Plus,
  Search,
  Lightbulb,
  Wand2,
  X
} from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import CategoryChip from '../../CategoryChip.vue'
import { allWorkflows, type ProjectWorkflow } from '../../../gallery'
import { activeInstance } from '../../../useProto'
import { NODE_TYPES, type NodeKind } from '../../graph/canvasData'
import { NODE_ICONS } from '../../graph/nodeIcons'
import { closeCreate, openTemplate, openWorkflow, startBlank, startWithNode } from '../createScreen'
import { readiness, searchStarters, SHELVES, type Starter } from '../createStarters'
import { buildOf, readyIcon, starterById, useEscapeCloses } from './lookKitB'

interface Intent {
  id: string
  label: string
  words: string[]
  template: string
  makes: string
  slot?: string
}

const INTENTS: Intent[] = [
  {
    id: 'upscale',
    label: 'Upscale an image…',
    words: ['upscale', 'sharpen', 'enlarge', 'bigger', 'old photo', 'restore', 'resolution'],
    template: 'utility_seedvr2_7b_int8_upscale_image',
    makes: 'Upscale an image'
  },
  {
    id: 'bg',
    label: 'Remove a background…',
    words: ['background', 'cutout', 'cut out', 'transparent', 'remove'],
    template: 'image_qwen_image_2_1_background_removal',
    makes: 'Remove background'
  },
  {
    id: 'i2v',
    label: 'Turn an image into a video…',
    words: ['video', 'move', 'animate', 'motion', 'clip'],
    template: 'video_ltx2_3_i2v',
    makes: 'Image to video',
    slot: 'dove'
  },
  {
    id: 't2i',
    label: 'Generate an image from a prompt…',
    words: ['image', 'picture', 'generate', 'product shot', 'poster', 'photo of', 'shot'],
    template: 'image_z_image_turbo',
    makes: 'Text to image'
  },
  {
    id: 'edit',
    label: 'Edit an image with words…',
    words: ['edit', 'change', 'replace', 'swap', 'fix'],
    template: 'image_qwen_image_2_1_image_edit',
    makes: 'Edit an image'
  },
  {
    id: '3d',
    label: 'Make a 3D model from an image…',
    words: ['3d', 'model', 'mesh', 'sketch', 'object'],
    template: '3d_hunyuan3d-v2.1',
    makes: 'Image to 3D model'
  },
  {
    id: 'angles',
    label: 'Show a character from every angle…',
    words: ['character', 'angle', 'turnaround', 'sheet', 'pose'],
    template: 'templates-1_click_multiple_character_angles-v1.0',
    makes: 'Character from every angle'
  }
]

const TRIES = [
  'a product shot on wet marble',
  'make my photo move',
  'remove the background from a sneaker',
  'sharpen an old family photo',
  'turn a sketch into a 3D model'
]

type Hit =
  | { id: string; type: 'try'; text: string }
  | { id: string; type: 'intent'; intent: Intent; starter: Starter }
  | { id: string; type: 'template'; starter: Starter }
  | { id: string; type: 'workflow'; workflow: ProjectWorkflow }
  | { id: string; type: 'node'; node: NodeKind }
  | { id: string; type: 'blank' }

const KINDS = Object.keys(NODE_TYPES) as NodeKind[]
const BLANK: Hit = { id: 'blank', type: 'blank' }

const query = ref('')
const at = ref(0)
const field = ref<HTMLInputElement>()
const q = computed(() => query.value.trim().toLowerCase())
const workflows = computed(() => [...allWorkflows.value].sort((a, b) => a.age - b.age))
const has = (text: string): boolean => text.toLowerCase().includes(q.value)

const intentHit = (intent: Intent): Hit | undefined => {
  const starter = starterById(intent.template, intent.makes, intent.slot)
  return starter && { id: `intent:${intent.id}`, type: 'intent', intent, starter }
}
const templateHit = (starter: Starter): Hit => ({
  id: `template:${starter.id}`,
  type: 'template',
  starter
})
const workflowHit = (workflow: ProjectWorkflow): Hit => ({
  id: `workflow:${workflow.id}`,
  type: 'workflow',
  workflow
})

const intentsFor = (text: string): Intent[] =>
  INTENTS.filter(
    (i) =>
      i.label.toLowerCase().includes(text) ||
      i.words.some((w) => text.includes(w) || (text.length > 2 && w.startsWith(text)))
  )

const readyFirst = computed(() =>
  SHELVES[0]!
    .starters()
    .filter((s) => readiness(s.template).tone !== 'off')
    .sort(
      (a, b) =>
        (readiness(a.template).tone === 'ready' ? -1 : 0) -
        (readiness(b.template).tone === 'ready' ? -1 : 0)
    )
    .slice(0, 4)
)

const sections = computed<{ title: string; hits: Hit[] }[]>(() => {
  if (!q.value) {
    return [
      {
        title: 'Try',
        hits: TRIES.map((text): Hit => ({ id: `try:${text}`, type: 'try', text }))
      },
      { title: 'Popular templates', hits: readyFirst.value.map(templateHit) },
      { title: 'Your workflows', hits: workflows.value.slice(0, 3).map(workflowHit) },
      { title: '', hits: [BLANK] }
    ].filter((s) => s.hits.length)
  }
  const intents = intentsFor(q.value)
  const taken = new Set(intents.map((i) => i.template))
  return [
    {
      title: 'Do this',
      hits: intents.flatMap((i) => intentHit(i) ?? []).slice(0, 3)
    },
    {
      title: 'Templates',
      hits: searchStarters(q.value, 6)
        .filter((s) => !taken.has(s.id))
        .slice(0, 4)
        .map(templateHit)
    },
    {
      title: 'Your workflows',
      hits: workflows.value
        .filter((w) => has(w.name))
        .slice(0, 4)
        .map(workflowHit)
    },
    {
      title: 'Nodes',
      hits: KINDS.filter((k) => has(`${NODE_TYPES[k].title} ${NODE_TYPES[k].description}`))
        .slice(0, 3)
        .map((node): Hit => ({ id: `node:${node}`, type: 'node', node }))
    },
    { title: '', hits: [BLANK] }
  ].filter((s) => s.hits.length)
})

const flat = computed(() => sections.value.flatMap((s) => s.hits))
const indexOf = (hit: Hit): number => flat.value.findIndex((h) => h.id === hit.id)
const current = computed(() => flat.value[at.value] ?? flat.value[0])
const found = computed(() => flat.value.some((h) => h.type !== 'blank'))
watch(q, () => (at.value = 0))

const starterIn = (hit: Hit | undefined): Starter | undefined =>
  hit && (hit.type === 'intent' || hit.type === 'template') ? hit.starter : undefined
const tryTarget = (text: string): Starter | undefined => {
  const intent = intentsFor(text.toLowerCase())[0]
  return intent && starterById(intent.template, intent.makes, intent.slot)
}
const shown = computed(() =>
  current.value?.type === 'try' ? tryTarget(current.value.text) : starterIn(current.value)
)

function pick(hit: Hit): void {
  if (hit.type === 'try') {
    query.value = hit.text
    field.value?.focus()
  } else if (hit.type === 'intent' || hit.type === 'template') openTemplate(hit.starter.template)
  else if (hit.type === 'workflow') openWorkflow(hit.workflow)
  else if (hit.type === 'node') startWithNode(hit.node)
  else startBlank()
}

function title(hit: Hit): string {
  if (hit.type === 'try') return hit.text
  if (hit.type === 'intent') return hit.intent.label
  if (hit.type === 'template') return hit.starter.makes
  if (hit.type === 'workflow') return hit.workflow.name
  if (hit.type === 'node') return NODE_TYPES[hit.node].title
  return 'Blank canvas'
}
function meta(hit: Hit): string {
  if (hit.type === 'try') return tryTarget(hit.text)?.makes ?? ''
  if (hit.type === 'intent') return `${hit.starter.makes} with ${hit.starter.model}`
  if (hit.type === 'template') return hit.starter.model
  if (hit.type === 'workflow')
    return `${buildOf(hit.workflow)?.name ?? ''}, ${hit.workflow.modified.toLowerCase()}`
  if (hit.type === 'node') return NODE_TYPES[hit.node].description
  return `Empty canvas on ${activeInstance.value.name}`
}
function icon(hit: Hit): Component {
  if (hit.type === 'try') return Lightbulb
  if (hit.type === 'intent') return Wand2
  if (hit.type === 'template') return LayoutTemplate
  if (hit.type === 'workflow') return FileClock
  if (hit.type === 'node') return NODE_ICONS[hit.node]
  return Plus
}
const verb = (hit: Hit | undefined): string =>
  !hit
    ? ''
    : hit.type === 'try'
      ? 'Search this'
      : hit.type === 'workflow'
        ? 'Open'
        : hit.type === 'intent' || hit.type === 'template'
          ? 'Use template'
          : 'Start'

function key(e: KeyboardEvent): void {
  const last = flat.value.length - 1
  if (e.key === 'ArrowDown') at.value = Math.min(last, at.value + 1)
  else if (e.key === 'ArrowUp') at.value = Math.max(0, at.value - 1)
  else if (e.key === 'Enter') {
    const hit = current.value
    if (hit) pick(hit)
  } else if (e.key === 'Escape') {
    if (query.value) query.value = ''
    else closeCreate()
  } else return
  e.preventDefault()
}

watch(at, (i) =>
  nextTick(() =>
    document.querySelector(`[data-v06-at="${i}"]`)?.scrollIntoView({ block: 'nearest' })
  )
)

useEscapeCloses(() => field.value)
</script>

<template>
  <section
    class="v06 relative flex min-h-full flex-col items-center px-8 pb-16"
    aria-label="Create"
  >
    <div class="v06-glow" aria-hidden="true" />
    <button type="button" class="v06-close" aria-label="Close" title="Close" @click="closeCreate">
      <X :size="16" />
    </button>

    <div class="v06-palette">
      <div class="v06-field">
        <Search :size="22" class="shrink-0 text-subtle-foreground" />
        <input
          ref="field"
          v-model="query"
          type="text"
          placeholder="What do you want to make?"
          aria-label="What do you want to make?"
          aria-controls="v06-list"
          @keydown="key"
        />
        <button
          v-if="query"
          type="button"
          class="v06-clear"
          aria-label="Clear"
          @click="((query = ''), field?.focus())"
        >
          <X :size="14" />
        </button>
      </div>

      <div class="v06-body">
        <div id="v06-list" class="v06-list">
          <template v-for="s in sections" :key="s.title || 'blank'">
            <p v-if="s.title" class="v06-sec">{{ s.title }}</p>
            <button
              v-for="hit in s.hits"
              :key="hit.id"
              type="button"
              class="v06-row"
              :class="[indexOf(hit) === at && 'is-at', `is-${hit.type}`]"
              :aria-current="indexOf(hit) === at || undefined"
              :data-v06-at="indexOf(hit)"
              @pointermove="at = indexOf(hit)"
              @click="pick(hit)"
            >
              <span class="v06-icon" :class="`is-${hit.type}`">
                <img
                  v-if="hit.type === 'template' || hit.type === 'intent'"
                  :src="hit.starter.poster"
                  alt=""
                  loading="lazy"
                />
                <WorkflowCover v-else-if="hit.type === 'workflow'" :name="hit.workflow.name" />
                <component :is="icon(hit)" v-else :size="16" />
              </span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="v06-title">
                  <template v-if="hit.type === 'try'">“{{ title(hit) }}”</template>
                  <template v-else>{{ title(hit) }}</template>
                </span>
                <span class="v06-meta">
                  <template v-if="hit.type === 'try'">
                    <ArrowRight :size="11" class="inline align-[-1px]" /> {{ meta(hit) }}
                  </template>
                  <template v-else>{{ meta(hit) }}</template>
                </span>
              </span>
              <CornerDownLeft v-if="indexOf(hit) === at" :size="14" class="v06-enter" />
            </button>
          </template>
          <p v-if="!found" class="v06-none">
            Nothing matches “{{ query.trim() }}”. Start on a blank canvas, or try “video” or
            “upscale”.
          </p>
        </div>

        <aside class="v06-peek" aria-live="polite">
          <template v-if="shown">
            <div class="v06-peek-media">
              <img :src="shown.poster" alt="" />
              <video
                v-if="shown.clip"
                :key="shown.clip"
                :src="shown.clip"
                muted
                loop
                playsinline
                autoplay
                class="motion-reduce:hidden"
              />
              <span class="absolute top-2.5 left-2.5"
                ><CategoryChip :category="shown.media"
              /></span>
            </div>
            <p class="v06-peek-title">{{ shown.makes }}</p>
            <p class="v06-peek-line">{{ shown.line }}.</p>
            <dl class="v06-facts">
              <div>
                <dt>Model</dt>
                <dd>{{ shown.model }}</dd>
              </div>
              <div>
                <dt>On {{ activeInstance.name }}</dt>
                <dd class="v06-fact-ready" :class="`is-${readiness(shown.template).tone}`">
                  <component
                    :is="readyIcon(readiness(shown.template))"
                    v-if="readiness(shown.template).tone !== 'off'"
                    :size="12"
                  />
                  {{ readiness(shown.template).label }}
                </dd>
              </div>
            </dl>
          </template>
          <template v-else-if="current">
            <div class="v06-peek-media is-plain">
              <WorkflowCover v-if="current.type === 'workflow'" :name="current.workflow.name" />
              <component :is="icon(current)" v-else :size="28" />
            </div>
            <p class="v06-peek-title">{{ title(current) }}</p>
            <p class="v06-peek-line">
              <template v-if="current.type === 'workflow'"
                >On {{ buildOf(current.workflow)?.name }}, edited
                {{ current.workflow.modified.toLowerCase() }}.</template
              >
              <template v-else-if="current.type === 'node'"
                >Starts a canvas on {{ activeInstance.name }} with this node on it.</template
              >
              <template v-else>Empty canvas on {{ activeInstance.name }}.</template>
            </p>
          </template>
        </aside>
      </div>

      <footer class="v06-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> Move</span>
        <span><kbd>↵</kbd> {{ verb(current) }}</span>
        <span><kbd>Esc</kbd> {{ query ? 'Clear' : 'Close' }}</span>
        <button type="button" class="v06-foot-blank" @click="startBlank">
          <Plus :size="13" />Blank canvas
        </button>
      </footer>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v06 {
  isolation: isolate;
  padding-top: clamp(40px, 9vh, 96px);
}
:root .proto-ui.proto-ui.proto-ui .v06-glow {
  position: absolute;
  inset: 0 0 auto;
  z-index: -1;
  height: 520px;
  background: radial-gradient(
    ellipse 40% 60% at 50% 0%,
    color-mix(in oklch, var(--color-base-foreground) 10%, transparent),
    transparent 70%
  );
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v06-close {
  position: absolute;
  top: 16px;
  right: 16px;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: var(--radius-control);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v06-close:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v06-palette {
  display: flex;
  width: 100%;
  max-width: 960px;
  flex-direction: column;
  overflow: hidden;
  border-radius: 20px;
  background: color-mix(in oklch, var(--color-card-background) 88%, transparent);
  box-shadow:
    inset 0 0 0 1px var(--color-border-default),
    var(--shadow-popover),
    0 40px 120px -40px oklch(0 0 0 / 0.7);
  backdrop-filter: blur(var(--blur-glass));
  animation: v06-in 360ms var(--ease-out-expo) both;
}
:root .proto-ui.proto-ui.proto-ui .v06-field {
  display: flex;
  height: 84px;
  align-items: center;
  gap: 16px;
  padding: 0 24px 0 28px;
  border-bottom: 1px solid var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v06-field input {
  min-width: 0;
  flex: 1;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  box-shadow: none;
  color: var(--color-base-foreground);
  font: inherit;
  font-size: 28px;
  font-weight: 450;
  letter-spacing: -0.015em;
}
:root .proto-ui.proto-ui.proto-ui .v06-field input::placeholder {
  color: var(--color-subtle-foreground);
  font-size: 28px;
}
:root .proto-ui.proto-ui.proto-ui .v06-clear {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 999px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v06-clear:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v06-body {
  display: flex;
  min-height: 460px;
  max-height: min(600px, calc(100vh - 300px));
}
:root .proto-ui.proto-ui.proto-ui .v06-list {
  min-width: 0;
  flex: 1;
  overflow-y: auto;
  padding: 8px 8px 12px;
  scrollbar-width: thin;
}
:root .proto-ui.proto-ui.proto-ui .v06-sec {
  margin: 14px 12px 6px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v06-sec:first-child {
  margin-top: 6px;
}
:root .proto-ui.proto-ui.proto-ui .v06-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  padding: 6px 12px 6px 6px;
  border-radius: 10px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v06-row.is-at {
  background: var(--color-secondary-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v06-icon {
  display: grid;
  width: 44px;
  height: 32px;
  flex: none;
  place-items: center;
  overflow: hidden;
  border-radius: 7px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v06-icon.is-try {
  background: transparent;
}
:root .proto-ui.proto-ui.proto-ui .v06-icon.is-blank {
  background: transparent;
  outline: 1px dashed var(--color-border-strong);
  outline-offset: -1px;
}
:root .proto-ui.proto-ui.proto-ui .v06-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v06-title {
  overflow: hidden;
  color: var(--color-base-foreground);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v06-row.is-try .v06-title {
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v06-row.is-try.is-at .v06-title {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v06-meta {
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v06-fact-ready.is-ready svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v06-enter {
  flex: none;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v06-none {
  padding: 16px 12px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v06-peek {
  display: flex;
  width: 340px;
  flex: none;
  flex-direction: column;
  padding: 16px;
  border-left: 1px solid var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v06-peek-media {
  position: relative;
  display: grid;
  aspect-ratio: 4 / 3;
  place-items: center;
  overflow: hidden;
  border-radius: 12px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v06-peek-media > img,
:root .proto-ui.proto-ui.proto-ui .v06-peek-media > video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v06-peek-title {
  margin-top: 16px;
  color: var(--color-base-foreground);
  font-size: var(--text-heading);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v06-peek-line {
  margin-top: 4px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  line-height: 19px;
}
:root .proto-ui.proto-ui.proto-ui .v06-facts {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: auto;
  padding-top: 16px;
}
:root .proto-ui.proto-ui.proto-ui .v06-facts > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v06-facts dt {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v06-facts dd {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--color-base-foreground);
  text-align: right;
}
:root .proto-ui.proto-ui.proto-ui .v06-foot {
  display: flex;
  height: 44px;
  align-items: center;
  gap: 18px;
  padding: 0 12px 0 20px;
  border-top: 1px solid var(--color-border-default);
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v06-foot kbd {
  display: inline-grid;
  min-width: 20px;
  height: 20px;
  margin-right: 4px;
  padding: 0 5px;
  place-items: center;
  border-radius: 5px;
  background: var(--color-secondary-background-hover);
  font: inherit;
  font-size: 11px;
}
:root .proto-ui.proto-ui.proto-ui .v06-foot-blank {
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 0 10px;
  border-radius: var(--radius-control);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v06-foot-blank:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
@keyframes v06-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.99);
  }
}
@media (max-width: 900px) {
  :root .proto-ui.proto-ui.proto-ui .v06-peek {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v06-palette {
    animation: none;
  }
}
</style>
