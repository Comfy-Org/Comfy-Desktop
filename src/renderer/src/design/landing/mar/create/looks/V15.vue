<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus } from 'lucide-vue-next'
import RecentList, { type RecentListRow } from '../../RecentList.vue'
import { allWorkflows, type ProjectWorkflow } from '../../../gallery'
import { activeInstance, go, proto } from '../../../useProto'
import { exploreStart } from '../../explore/exploreStart'
import {
  closeCreate,
  createScreen,
  openTemplate,
  openWorkflow,
  startBlank,
  startWithAgentAsk
} from '../createScreen'
import { SHELVES, type Starter } from '../createStarters'
import { minComfyFor, targetFor, totalGb } from '../../templateModal/templateData'
import HomeSectionHeader from '../../HomeSectionHeader.vue'
import { createInput } from '../createInput'
import { agentOpens } from '../agentOpens'
import { graphHover } from '../graphHover'
import { composerSearch } from '../composerSearch'
import { edited, lastOutput, templateMeta } from '../smartSearch'
import { buildOf, playIn, reducedMotion, stopIn, useEscapeCloses } from './lookKitB'
import { agentStart, answer, type AgentAnswer } from './v07Agent'
import { useCreateAgent } from './createAgent'
import CreateAgentPanel from './CreateAgentPanel.vue'
import GhostGraph from './GhostGraph.vue'
import GraphPreview, { type GraphPreviewItem } from './GraphPreview.vue'
import { useGraphPreview } from './graphPreview'
import ResultsB from './ResultsB.vue'
import SmartSearch from '../SmartSearch.vue'

interface TemplateCard {
  id: string
  starter: Starter
  name: string
  meta: string
  tone: string
}

interface PreviewItem extends GraphPreviewItem {
  kind: 'template' | 'recent'
}

interface StageBox {
  top: number
  height: number
}

interface RecentRow {
  id: string
  workflow: ProjectWorkflow
  build: string
  edited: string
}

const USE_CASES: { id: string; label: string }[] = [
  { id: 'popular', label: 'Popular' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'edit', label: 'Edit' },
  { id: 'upscale', label: 'Upscale' },
  { id: '3d', label: '3D' }
]
const BLANK = 'blank'
const CARDS = 4
const RECENTS = 8
const LEAVE_MS = 220
const STAGE_GAP = 8

const query = ref('')
const useCase = ref(USE_CASES[0]!.id)
const search = ref<InstanceType<typeof SmartSearch>>()
const results = ref<InstanceType<typeof ResultsB>>()
const navigated = ref(false)
const hover = ref('')
const leaving = ref(false)
const flow = useCreateAgent()
const {
  preview,
  dragging,
  show,
  endPreview,
  endSoon,
  onStageEnter,
  onStageLeave,
  onDown,
  onMove,
  onUp,
  onWheel,
  panStyle,
  dotsStyle
} = useGraphPreview<PreviewItem>()
watch(query, () => {
  navigated.value = false
  endPreview()
})
watch(useCase, () => (hover.value = ''))

const smart = computed(() => composerSearch.id === 'smart')
const LIST_ID = 'v15-smart-list'
const over = ref<HTMLElement>()
const pinTop = ref<number | null>(null)

const smartShown = computed(() => !!search.value?.shown)

watch(
  smartShown,
  (on) => {
    const el = over.value
    const main = el?.parentElement
    pinTop.value =
      on && el && main ? el.offsetTop - parseFloat(getComputedStyle(main).paddingTop) : null
  },
  { flush: 'pre' }
)

const modelOf = (s: Starter): string =>
  s.template.title.includes(':') ? s.template.title.split(':')[0]!.trim() : s.model

const needsUpdate = (s: Starter): boolean =>
  targetFor(s.template, activeInstance.value, proto.signedIn).state === 'update'

function runRank(s: Starter): number {
  const tone = templateMeta(s).tone
  if (tone === 'ready') return 0
  if (needsUpdate(s)) return 1
  return tone === 'fetch' ? 2 : 3
}

const runnableFirst = (starters: Starter[]): Starter[] =>
  starters
    .map((starter) => ({ starter, rank: runRank(starter), gb: totalGb(starter.template) }))
    .sort((a, b) => a.rank - b.rank || (a.rank === 2 ? a.gb - b.gb : 0))
    .map((x) => x.starter)

function metaOf(s: Starter): Pick<TemplateCard, 'meta' | 'tone'> {
  const meta = templateMeta(s)
  return needsUpdate(s)
    ? { ...meta, meta: `Needs ComfyUI ${minComfyFor(s.template)} or newer` }
    : meta
}

const templates = computed<TemplateCard[]>(() => {
  const shelf = SHELVES.find((s) => s.id === useCase.value) ?? SHELVES[0]!
  const starters = runnableFirst(shelf.starters()).slice(0, CARDS)
  const repeats = (makes: string): boolean => starters.filter((s) => s.makes === makes).length > 1
  return starters.map((starter) => ({
    id: starter.id,
    starter,
    name: repeats(starter.makes) ? `${modelOf(starter)} ${starter.makes}` : starter.makes,
    ...metaOf(starter)
  }))
})

const recents = computed<RecentRow[]>(() =>
  [...allWorkflows.value]
    .sort((a, b) => a.age - b.age)
    .slice(0, RECENTS)
    .map((workflow) => ({
      id: `recent-${workflow.id}`,
      workflow,
      build: buildOf(workflow)?.name ?? '',
      edited: edited(workflow.modified)
    }))
)

const recentRows = computed<RecentListRow[]>(() =>
  recents.value.map((r) => ({
    id: r.id,
    name: r.workflow.name,
    build: r.build,
    edited: r.edited,
    src: lastOutput(r.workflow)
  }))
)

const cardIds = computed(() => [...templates.value.map((c) => c.id), BLANK])

const order = computed(() => [...cardIds.value, ...recents.value.map((r) => r.id)])

const main = ref<HTMLElement>()
const templatesEl = ref<HTMLElement>()
const recentsEl = ref<HTMLElement>()
const stage = ref<StageBox>({ top: 0, height: 0 })
const graphOn = computed(() => graphHover.id === 'on')
const at = computed(() => hover.value || preview.value?.id || '')
const canvasStyle = computed(() => dotsStyle(22, 2, 0))
const stageStyle = computed(() => ({
  top: `${stage.value.top}px`,
  height: `${stage.value.height}px`
}))

function previewOf(id: string): PreviewItem | null {
  const card = templates.value.find((c) => c.id === id)
  if (card) return { id, kind: 'template', name: card.name, starter: card.starter, workflow: null }
  const row = recents.value.find((r) => r.id === id)
  if (!row) return null
  const workflow = { name: row.workflow.name, cover: lastOutput(row.workflow) }
  return { id, kind: 'recent', name: row.workflow.name, starter: null, workflow }
}

function stageFor(kind: PreviewItem['kind']): StageBox | null {
  const box = main.value
  const section = (kind === 'template' ? templatesEl : recentsEl).value
  if (!box || !section) return null
  const origin = box.getBoundingClientRect().top
  const edge = section.getBoundingClientRect()
  if (kind === 'recent') return { top: box.scrollTop, height: edge.top - origin - STAGE_GAP }
  const from = edge.bottom - origin + box.scrollTop + STAGE_GAP
  return { top: from, height: box.scrollTop + box.clientHeight - from }
}

function peek(id: string): void {
  if (!graphOn.value) return
  const item = previewOf(id)
  const box = item && !flow.panel.value && !leaving.value ? stageFor(item.kind) : null
  if (!item || !box) return endSoon()
  stage.value = box
  show(item)
}

function onStartsLeave(): void {
  hover.value = ''
  if (graphOn.value) endSoon()
}

function onStartsFocusOut(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null
  if (graphOn.value && !(e.currentTarget as Element).contains(next)) endSoon()
}

function leave(then: () => void): void {
  if (reducedMotion()) return then()
  leaving.value = true
  setTimeout(then, LEAVE_MS)
}

function pickTemplate(c: TemplateCard): void {
  endPreview()
  openTemplate(c.starter.template)
}

function pickRecent(r: RecentRow): void {
  endPreview()
  leave(() => openWorkflow(r.workflow))
}

function pickBlank(): void {
  endPreview()
  leave(startBlank)
}

function openAt(id: string): void {
  if (id === BLANK) return pickBlank()
  const card = templates.value.find((c) => c.id === id)
  if (card) return pickTemplate(card)
  const row = recents.value.find((r) => r.id === id)
  if (row) pickRecent(row)
}

function seeAll(): void {
  exploreStart.value = 'templates'
  closeCreate()
  go('explore')
}

function openLibrary(): void {
  closeCreate()
  go('workflows')
}

function onAsk(a: AgentAnswer): void {
  if (agentOpens.id === 'comfy') leave(() => startWithAgentAsk(agentStart(a.prompt)))
  else flow.ask(a)
}

watch(
  () => createScreen.ask,
  (prompt) => {
    if (!prompt) return
    createScreen.ask = ''
    query.value = prompt
    onAsk(answer(prompt))
  },
  { immediate: true }
)

function moveAcross(step: number): void {
  const ids = cardIds.value
  const now = ids.indexOf(hover.value)
  if (now < 0 && hover.value) return
  hover.value = ids[now < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, now + step))] ?? ''
}

function moveDown(step: number): void {
  const ids = order.value
  const now = ids.indexOf(hover.value)
  const cards = cardIds.value.length
  const inCards = now >= 0 && now < cards
  if (now < 0) hover.value = ids[0] ?? ''
  else if (inCards && step > 0) hover.value = recents.value[0]?.id ?? hover.value
  else if (inCards) hover.value = ''
  else if (now + step < cards) hover.value = ids[0] ?? ''
  else hover.value = ids[Math.min(ids.length - 1, now + step)] ?? hover.value
}

function key(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (preview.value) endPreview()
    else if (flow.panel.value) flow.close()
    else if (query.value) query.value = ''
    else closeCreate()
    return
  }
  if (query.value.trim()) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') navigated.value = true
    results.value?.key(e)
    return
  }
  if (e.key === 'ArrowRight') moveAcross(1)
  else if (e.key === 'ArrowLeft') moveAcross(-1)
  else if (e.key === 'ArrowDown') moveDown(1)
  else if (e.key === 'ArrowUp' && hover.value) moveDown(-1)
  else if (e.key === 'Enter' && hover.value) openAt(hover.value)
  else return
  e.preventDefault()
  if (e.key !== 'Enter') peek(hover.value)
}

const placeholder = computed(() =>
  createInput.id === 'agent'
    ? 'Describe what you want to make, or search templates'
    : 'Search templates, workflows and nodes'
)

const dropping = computed(() => !smart.value && createInput.id === 'search' && !!query.value.trim())

function enter(id: string, el: EventTarget | null): void {
  hover.value = id
  peek(id)
  if (!reducedMotion()) playIn(el)
}

function enterBlank(): void {
  hover.value = BLANK
  peek(BLANK)
}

function enterRecent(id: string): void {
  hover.value = id
  peek(id)
}

function endOnEscape(): boolean {
  if (!preview.value) return false
  endPreview()
  return true
}

useEscapeCloses(() => search.value?.field, endOnEscape)
</script>

<template>
  <section class="v15 relative flex h-full min-h-[600px]" aria-label="Create">
    <div class="v15-canvas" :style="preview ? canvasStyle : undefined" aria-hidden="true" />

    <div ref="main" class="v15-main">
      <div
        v-if="flow.build.value"
        class="v15-built"
        :class="!flow.panel.value && 'is-faint'"
        aria-hidden="true"
      >
        <GhostGraph :starter="flow.build.value.starter" :agent="flow.ghost.value" />
      </div>
      <div
        class="v15-scrim"
        :class="(leaving || flow.panel.value || preview) && 'is-hidden'"
        aria-hidden="true"
      />
      <div
        v-if="graphOn"
        class="v15-graph"
        :class="[preview && 'is-preview', dragging && 'is-dragging']"
        :style="stageStyle"
        @pointerenter="onStageEnter"
        @pointerleave="onStageLeave"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @wheel="onWheel"
      >
        <GraphPreview
          :item="preview"
          :pan="panStyle"
          :opens="preview?.kind === 'recent' ? 'row' : 'card'"
        />
      </div>

      <div
        ref="over"
        class="v15-over"
        :class="[
          leaving && 'is-leaving',
          flow.panel.value && 'is-hidden',
          graphOn && 'has-graph',
          preview && ['is-peek', `is-peek-${preview.kind}`]
        ]"
        :style="pinTop === null ? undefined : { marginTop: `${pinTop}px`, marginBottom: 'auto' }"
        :aria-hidden="flow.panel.value"
      >
        <h1 class="v15-title">What do you want to make?</h1>
        <SmartSearch
          ref="search"
          v-model="query"
          :list-id="LIST_ID"
          :smart
          :suspended="flow.panel.value"
          :mode="createInput.id"
          :placeholder
          :navigated
          @key="key"
          @ask="onAsk"
          @workflow="(w) => leave(() => openWorkflow(w))"
        >
          <template #drop>
            <div v-if="dropping" class="v15-drop">
              <ResultsB ref="results" :query />
            </div>
          </template>
          <div
            class="v15-starts"
            :class="dropping && 'is-under'"
            @pointerleave="onStartsLeave"
            @focusout="onStartsFocusOut"
          >
            <section
              ref="templatesEl"
              class="v15-section v15-section-templates"
              aria-labelledby="v15-templates"
            >
              <h2 id="v15-templates" class="sr-only">Templates</h2>
              <HomeSectionHeader
                title="Templates"
                link-tip="All templates"
                add-label="New workflow"
                @open="seeAll"
              />
              <div :key="useCase" class="v15-row">
                <button
                  v-for="c in templates"
                  :key="c.id"
                  type="button"
                  class="v15-card"
                  :class="at === c.id && 'is-at'"
                  @pointerenter="enter(c.id, $event.currentTarget)"
                  @pointerleave="stopIn($event.currentTarget)"
                  @focus="enter(c.id, $event.currentTarget)"
                  @blur="stopIn($event.currentTarget)"
                  @click="pickTemplate(c)"
                >
                  <span class="v15-pic">
                    <img :src="c.starter.poster" alt="" loading="lazy" />
                    <video
                      v-if="c.starter.clip"
                      :src="c.starter.clip"
                      :poster="c.starter.poster"
                      muted
                      loop
                      playsinline
                      preload="none"
                    />
                  </span>
                  <span class="v15-text">
                    <span class="v15-name" :title="c.name">{{ c.name }}</span>
                    <span class="v15-meta" :class="`is-${c.tone}`" :title="c.meta">{{
                      c.meta
                    }}</span>
                  </span>
                </button>
                <button
                  type="button"
                  class="v15-card v15-blank"
                  :class="at === BLANK && 'is-at'"
                  @pointerenter="enterBlank"
                  @focus="enterBlank"
                  @click="pickBlank"
                >
                  <span class="v15-pic">
                    <Plus :size="22" class="v15-plus" />
                  </span>
                  <span class="v15-text">
                    <span class="v15-name">Blank canvas</span>
                    <span class="v15-meta">Start from scratch</span>
                  </span>
                </button>
              </div>
            </section>

            <section
              v-if="recents.length"
              ref="recentsEl"
              class="v15-section v15-section-recents"
              aria-label="Recents"
            >
              <HomeSectionHeader
                title="Recents"
                link-tip="All workflows"
                add-label="New workflow"
                @open="openLibrary"
              />
              <RecentList
                :rows="recentRows"
                :active="at"
                @hover="enterRecent"
                @open="(row) => openAt(row.id)"
              />
            </section>
          </div>
        </SmartSearch>
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
:root .proto-ui.proto-ui.proto-ui .v15 {
  isolation: isolate;
  overflow: hidden;
}
:root .proto-ui.proto-ui.proto-ui .v15-canvas {
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    radial-gradient(
        color-mix(in oklch, var(--color-base-foreground) 10%, transparent) 1px,
        transparent 1.4px
      )
      0 0 / 22px 22px,
    var(--color-content-background);
}
:root .proto-ui.proto-ui.proto-ui .v15-main {
  position: relative;
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  padding: 40px 40px;
  scrollbar-width: thin;
}
:root .proto-ui.proto-ui.proto-ui .v15-built {
  position: absolute;
  inset: 48px 40px;
  display: grid;
  place-items: center;
  transition: opacity 300ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-built.is-faint {
  opacity: 0.2;
}
:root .proto-ui.proto-ui.proto-ui .v15-scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: radial-gradient(
    ellipse 46% 58% at 50% 50%,
    color-mix(in oklch, var(--color-content-background) 92%, transparent) 45%,
    transparent 85%
  );
  pointer-events: none;
  transition: opacity 260ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-scrim.is-hidden {
  opacity: 0;
}
:root .proto-ui.proto-ui.proto-ui .v15-over {
  position: relative;
  z-index: 2;
  display: flex;
  width: 100%;
  max-width: 840px;
  margin: auto 0;
  flex-direction: column;
  align-items: center;
  text-align: center;
  transition:
    opacity 220ms ease,
    transform 220ms var(--ease-out-expo);
  animation: v15-in 520ms var(--ease-out-expo) both;
}
:root .proto-ui.proto-ui.proto-ui .v15-over.is-leaving,
:root .proto-ui.proto-ui.proto-ui .v15-over.is-hidden {
  opacity: 0;
  pointer-events: none;
  transform: scale(0.98);
}
:root .proto-ui.proto-ui.proto-ui .v15-title {
  color: var(--color-base-foreground);
  font-size: 32px;
  font-weight: 650;
  letter-spacing: -0.022em;
  line-height: 38px;
}
:root .proto-ui.proto-ui.proto-ui .v15-drop {
  position: absolute;
  top: calc(100% + 10px);
  left: 50%;
  z-index: 6;
  width: min(860px, calc(100vw - 96px));
  max-height: min(440px, 50vh);
  overflow-y: auto;
  padding: 10px;
  border-radius: var(--radius-panel);
  background: var(--color-card-background);
  box-shadow:
    inset 0 0 0 1px var(--color-border-default),
    var(--shadow-popover);
  transform: translateX(-50%);
  backdrop-filter: blur(var(--blur-glass));
  scrollbar-width: thin;
  animation: v15-fade 160ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .v15-starts.is-under {
  opacity: 0;
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v15-graph {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 3;
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v15-graph.is-preview {
  cursor: grab;
  pointer-events: auto;
  touch-action: none;
}
:root .proto-ui.proto-ui.proto-ui .v15-graph.is-dragging {
  cursor: grabbing;
  user-select: none;
}
:root .proto-ui.proto-ui.proto-ui .v15-over.has-graph .v15-title,
:root .proto-ui.proto-ui.proto-ui .v15-over.has-graph .v15-ask,
:root .proto-ui.proto-ui.proto-ui .v15-over.has-graph .v15-section {
  transition: opacity 180ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-over.is-peek .v15-title,
:root .proto-ui.proto-ui.proto-ui .v15-over.is-peek .v15-ask,
:root .proto-ui.proto-ui.proto-ui .v15-over.is-peek-template .v15-section-recents,
:root .proto-ui.proto-ui.proto-ui .v15-over.is-peek-recent .v15-section-templates {
  opacity: 0;
  pointer-events: none;
}
@keyframes v15-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v15-over,
  :root .proto-ui.proto-ui.proto-ui .v15-drop,
  :root .proto-ui.proto-ui.proto-ui .v15-scrim,
  :root .proto-ui.proto-ui.proto-ui .v15-built,
  :root .proto-ui.proto-ui.proto-ui .v15-over.has-graph .v15-title,
  :root .proto-ui.proto-ui.proto-ui .v15-over.has-graph .v15-ask,
  :root .proto-ui.proto-ui.proto-ui .v15-over.has-graph .v15-section {
    animation: none;
    transition: none;
  }
}
</style>
