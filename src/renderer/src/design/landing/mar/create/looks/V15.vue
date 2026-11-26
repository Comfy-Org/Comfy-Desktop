<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import {
  Box,
  ChevronRight,
  Flame,
  Image as ImageIcon,
  ImageUpscale,
  Plus,
  Video,
  WandSparkles
} from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { allWorkflows, type ProjectWorkflow } from '../../../gallery'
import { activeInstance, go, proto } from '../../../useProto'
import { openAppPage } from '../../../appFlow'
import { exploreStart } from '../../explore/exploreStart'
import {
  closeCreate,
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
import { composerSearch } from '../composerSearch'
import {
  edited,
  lastOutput,
  remember,
  templateMeta,
  useSmartSearch,
  type Row
} from '../smartSearch'
import { buildOf, playIn, reducedMotion, stopIn, useEscapeCloses } from './lookKitB'
import { agentStart, answer, type AgentAnswer } from './v07Agent'
import { useCreateAgent } from './createAgent'
import CreateComposer from './CreateComposer.vue'
import CreateAgentPanel from './CreateAgentPanel.vue'
import GhostGraph from './GhostGraph.vue'
import ResultsB from './ResultsB.vue'
import SmartDrop from './SmartDrop.vue'

interface TemplateCard {
  id: string
  starter: Starter
  name: string
  meta: string
  tone: string
}

interface RecentRow {
  id: string
  workflow: ProjectWorkflow
  build: string
  edited: string
}

const USE_CASES: { id: string; label: string; glyph: Component }[] = [
  { id: 'popular', label: 'Popular', glyph: Flame },
  { id: 'image', label: 'Image', glyph: ImageIcon },
  { id: 'video', label: 'Video', glyph: Video },
  { id: 'edit', label: 'Edit', glyph: WandSparkles },
  { id: 'upscale', label: 'Upscale', glyph: ImageUpscale },
  { id: '3d', label: '3D', glyph: Box }
]
const BLANK = 'blank'
const CARDS = 4
const RECENTS = 5
const LEAVE_MS = 220

const query = ref('')
const useCase = ref(USE_CASES[0]!.id)
const composer = ref<InstanceType<typeof CreateComposer>>()
const results = ref<InstanceType<typeof ResultsB>>()
const navigated = ref(false)
const hover = ref('')
const leaving = ref(false)
const flow = useCreateAgent()
watch(query, () => (navigated.value = false))
watch(useCase, () => (hover.value = ''))

const smart = computed(() => composerSearch.id === 'smart')
const LIST_ID = 'v15-smart-list'
const finder = useSmartSearch(query)
const dropOpen = ref(false)
let autofocused = true
watch(query, (q) => q && (dropOpen.value = true))

const smartShown = computed(
  () => smart.value && dropOpen.value && !flow.panel.value && finder.results.value.rows.length > 0
)
const activeOption = computed(() =>
  smartShown.value && finder.current.value ? `${LIST_ID}-opt-${finder.active.value}` : undefined
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

const cardIds = computed(() => [...templates.value.map((c) => c.id), BLANK])

const order = computed(() => [...cardIds.value, ...recents.value.map((r) => r.id)])

function leave(then: () => void): void {
  if (reducedMotion()) return then()
  leaving.value = true
  setTimeout(then, LEAVE_MS)
}

function pickTemplate(c: TemplateCard): void {
  openTemplate(c.starter.template)
}

function pickRecent(r: RecentRow): void {
  leave(() => openWorkflow(r.workflow))
}

function pickBlank(): void {
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

function act(row: Row | undefined): void {
  const text = finder.q.value
  if (row?.kind === 'suggest') {
    query.value = row.text
    dropOpen.value = true
    composer.value?.field?.focus()
    return
  }
  if (!text) return
  remember(text)
  dropOpen.value = false
  if (!row || row.kind === 'agent') onAsk(answer(text))
  else if (row.kind === 'template') openTemplate(row.starter.template)
  else if (row.kind === 'workflow') leave(() => openWorkflow(row.workflow))
  else openAppPage(row.app.id)
}

function smartKey(e: KeyboardEvent): boolean {
  if (e.key === 'Escape' && smartShown.value) dropOpen.value = false
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!smartShown.value && !query.value.trim()) return false
    if (smartShown.value) finder.move(e.key === 'ArrowDown' ? 1 : -1)
    dropOpen.value = true
  } else if (e.key === 'Enter' && (smartShown.value || query.value.trim()))
    act(smartShown.value ? finder.current.value : undefined)
  else return false
  e.preventDefault()
  return true
}

function onFocusIn(): void {
  if (autofocused) autofocused = false
  else dropOpen.value = true
}

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
  if (smart.value && smartKey(e)) return
  if (e.key === 'Escape') {
    e.preventDefault()
    if (flow.panel.value) flow.close()
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
}

const inputMode = computed(() => (smart.value ? 'agent' : createInput.id))

const placeholder = computed(() =>
  smart.value
    ? 'Describe what you want to make, or search templates and apps'
    : createInput.id === 'agent'
      ? 'Describe what you want to make, or search templates'
      : 'Search templates, workflows and nodes'
)

const dropping = computed(() => !smart.value && createInput.id === 'search' && !!query.value.trim())

function enter(id: string, el: EventTarget | null): void {
  hover.value = id
  if (!reducedMotion()) playIn(el)
}

useEscapeCloses(() => composer.value?.field)
</script>

<template>
  <section class="v15 relative flex h-full min-h-[600px]" aria-label="Create">
    <div class="v15-canvas" aria-hidden="true" />

    <div class="v15-main">
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
        :class="(leaving || flow.panel.value) && 'is-hidden'"
        aria-hidden="true"
      />

      <div
        class="v15-over"
        :class="[leaving && 'is-leaving', flow.panel.value && 'is-hidden']"
        :aria-hidden="flow.panel.value"
      >
        <h1 class="v15-title">What do you want to make?</h1>
        <div class="v15-ask">
          <CreateComposer
            ref="composer"
            v-model="query"
            class="v15-composer"
            :mode="inputMode"
            :navigated
            :placeholder
            :enter-label="smart ? finder.enterLabel.value : ''"
            :combo="smart ? { open: smartShown, list: LIST_ID, active: activeOption } : undefined"
            hero
            send
            external
            @key="key"
            @ask="onAsk"
            @enter="act(smartShown ? finder.current.value : undefined)"
            @focusin="smart && onFocusIn()"
            @focusout="dropOpen = false"
            @pointerdown="smart && (dropOpen = true)"
          />
          <div v-if="dropping" class="v15-drop">
            <ResultsB ref="results" :query />
          </div>
          <div v-else-if="smartShown" class="v15-drop is-smart">
            <SmartDrop
              :results="finder.results.value"
              :active="finder.active.value"
              :query="finder.q.value"
              :list-id="LIST_ID"
              @hover="finder.active.value = $event"
              @pick="act"
            />
          </div>
        </div>

        <div
          class="v15-starts"
          :class="[dropping && 'is-under', smartShown && 'is-dim']"
          @pointerleave="hover = ''"
        >
          <section class="v15-section" aria-labelledby="v15-templates">
            <h2 id="v15-templates" class="sr-only">Templates</h2>
            <header class="v15-head">
              <div class="v15-pills" role="tablist" aria-label="Use case">
                <button
                  v-for="u in USE_CASES"
                  :key="u.id"
                  type="button"
                  role="tab"
                  class="v15-pill"
                  :class="useCase === u.id && 'is-on'"
                  :aria-selected="useCase === u.id"
                  @click="useCase = u.id"
                >
                  <component :is="u.glyph" :size="16" aria-hidden="true" />
                  {{ u.label }}
                </button>
              </div>
              <button type="button" class="hsh-link" @click="seeAll">
                See all<ChevronRight :size="13" aria-hidden="true" />
              </button>
            </header>
            <div :key="useCase" class="v15-row">
              <button
                v-for="c in templates"
                :key="c.id"
                type="button"
                class="v15-card"
                :class="hover === c.id && 'is-at'"
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
                  <span class="v15-meta" :class="`is-${c.tone}`" :title="c.meta">{{ c.meta }}</span>
                </span>
              </button>
              <button
                type="button"
                class="v15-card v15-blank"
                :class="hover === BLANK && 'is-at'"
                @pointerenter="hover = BLANK"
                @focus="hover = BLANK"
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

          <section v-if="recents.length" class="v15-section" aria-label="Recents">
            <HomeSectionHeader
              title="Recents"
              link-tip="All workflows"
              add-label="New workflow"
              @open="openLibrary"
            />
            <ul class="v15-list">
              <li v-for="r in recents" :key="r.id">
                <button
                  type="button"
                  class="v15-item"
                  :class="hover === r.id && 'is-at'"
                  @pointerenter="hover = r.id"
                  @focus="hover = r.id"
                  @click="pickRecent(r)"
                >
                  <span class="v15-thumb">
                    <img
                      v-if="lastOutput(r.workflow)"
                      :src="lastOutput(r.workflow)"
                      alt=""
                      loading="lazy"
                    />
                    <WorkflowCover v-else :name="r.workflow.name" />
                  </span>
                  <span class="v15-file">{{ r.workflow.name }}</span>
                  <span class="v15-build">{{ r.build }}</span>
                  <span class="v15-when">{{ r.edited }}</span>
                </button>
              </li>
            </ul>
          </section>
        </div>
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
:root .proto-ui.proto-ui.proto-ui .v15-ask {
  position: relative;
  z-index: 3;
  width: min(640px, 100%);
  margin-top: 22px;
  text-align: left;
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
:root .proto-ui.proto-ui.proto-ui .v15-item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v15-starts {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 28px;
  margin-top: 32px;
  text-align: left;
  transition: opacity 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-starts.is-under {
  opacity: 0;
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v15-starts.is-dim {
  opacity: 0.28;
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v15-title {
  transition: opacity 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-over:has(.v15-drop.is-smart) .v15-title {
  opacity: 0.5;
}
:root .proto-ui.proto-ui.proto-ui .v15-drop.is-smart {
  width: 100%;
  max-height: min(500px, calc(100vh - 300px));
  padding: 6px;
}
:root .proto-ui.proto-ui.proto-ui .v15-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
:root .proto-ui.proto-ui.proto-ui .v15-pills {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: 8px;
}
:root .proto-ui.proto-ui.proto-ui .v15-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  border-radius: 6px;
  background: color-mix(in oklch, var(--color-base-foreground) 3%, transparent);
  color: var(--color-muted-foreground);
  font-size: 13px;
  font-weight: 400;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-pill:hover {
  border-color: color-mix(in oklch, var(--color-base-foreground) 18%, transparent);
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .v15-pill:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}
:root .proto-ui.proto-ui.proto-ui .v15-pill.is-on,
:root .proto-ui.proto-ui.proto-ui .v15-pill.is-on:hover {
  border-color: color-mix(in oklch, var(--color-base-foreground) 45%, transparent);
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v15-row {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16px;
  margin-top: 14px;
  animation: v15-fade 200ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .v15-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v15-pic {
  position: relative;
  display: block;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  transition:
    transform 260ms var(--ease-out-expo),
    box-shadow 200ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-pic > img,
:root .proto-ui.proto-ui.proto-ui .v15-pic > video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v15-pic > video {
  opacity: 0;
  transition: opacity 240ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-card.is-at .v15-pic > video {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v15-card.is-at .v15-pic {
  transform: translateY(-3px);
  box-shadow: var(--shadow-elev-hover);
}
:root .proto-ui.proto-ui.proto-ui .v15-blank .v15-pic {
  display: grid;
  place-items: center;
  border: 1px dashed color-mix(in oklch, var(--color-base-foreground) 18%, transparent);
  background: transparent;
  box-shadow: none;
  transition:
    transform 260ms var(--ease-out-expo),
    box-shadow 200ms ease,
    border-color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-plus {
  color: var(--color-muted-foreground);
  transition: color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-blank.is-at .v15-pic {
  border-color: color-mix(in oklch, var(--color-base-foreground) 34%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .v15-blank.is-at .v15-plus {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v15-card:focus-visible .v15-pic {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v15-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  padding: 0 2px;
}
:root .proto-ui.proto-ui.proto-ui .v15-name,
:root .proto-ui.proto-ui.proto-ui .v15-meta,
:root .proto-ui.proto-ui.proto-ui .v15-file,
:root .proto-ui.proto-ui.proto-ui .v15-build {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v15-name {
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
  transition: color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-card.is-at .v15-name {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v15-meta {
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v15-list {
  display: flex;
  flex-direction: column;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}
:root .proto-ui.proto-ui.proto-ui .v15-item {
  display: grid;
  width: 100%;
  height: 44px;
  grid-template-columns: 40px minmax(0, 1fr) minmax(0, 180px) 120px;
  align-items: center;
  gap: 14px;
  padding: 0 10px 0 6px;
  border-radius: var(--radius-control);
  text-align: left;
  transition: background-color 120ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-item.is-at {
  background: color-mix(in oklch, var(--color-secondary-background) 80%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .v15-thumb {
  position: relative;
  display: block;
  width: 40px;
  height: 30px;
  overflow: hidden;
  border-radius: 6px;
  background: var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v15-thumb > img,
:root .proto-ui.proto-ui.proto-ui .v15-thumb > .wfc {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v15-file {
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v15-build,
:root .proto-ui.proto-ui.proto-ui .v15-when {
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v15-when {
  text-align: right;
  white-space: nowrap;
}
@keyframes v15-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}
@keyframes v15-fade {
  from {
    opacity: 0;
  }
}
@media (max-width: 1180px) {
  :root .proto-ui.proto-ui.proto-ui .v15-row {
    gap: 12px;
  }
  :root .proto-ui.proto-ui.proto-ui .v15-item {
    grid-template-columns: 40px minmax(0, 1fr) minmax(0, 160px) 100px;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v15-over,
  :root .proto-ui.proto-ui.proto-ui .v15-drop,
  :root .proto-ui.proto-ui.proto-ui .v15-row,
  :root .proto-ui.proto-ui.proto-ui .v15-pic,
  :root .proto-ui.proto-ui.proto-ui .v15-scrim,
  :root .proto-ui.proto-ui.proto-ui .v15-built {
    animation: none;
    transition: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v15-card.is-at .v15-pic {
    transform: none;
  }
}
</style>
