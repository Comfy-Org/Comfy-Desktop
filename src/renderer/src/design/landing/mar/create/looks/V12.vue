<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { allWorkflows, type ProjectWorkflow } from '../../../gallery'
import { activeInstance } from '../../../useProto'
import { thumb } from '../../../mock'
import { MOCK } from '../../assets/mock'
import {
  closeCreate,
  openTemplate,
  openWorkflow,
  startBlank,
  startWithAgent,
  startWithAgentAsk,
  startWithNodeSearch,
  startWithRecipe
} from '../createScreen'
import { readiness, SHELVES, type Starter } from '../createStarters'
import { createInput } from '../createInput'
import { agentOpens } from '../agentOpens'
import { buildOf, playIn, readyIcon, reducedMotion, stopIn, useEscapeCloses } from './lookKitB'
import { agentStart, type AgentAnswer } from './v07Agent'
import { STEPS, type Step } from './firstSteps'
import { useCreateAgent } from './createAgent'
import CreateComposer from './CreateComposer.vue'
import CreateAgentPanel from './CreateAgentPanel.vue'
import GhostGraph from './GhostGraph.vue'
import ResultsB from './ResultsB.vue'

type Tab = 'start' | 'templates' | 'yours'
type Card =
  | { id: string; type: 'step'; step: Step }
  | { id: string; type: 'template'; starter: Starter }
  | { id: string; type: 'workflow'; workflow: ProjectWorkflow }
  | { id: string; type: 'empty' }

const TABS: { id: Tab; label: string }[] = [
  { id: 'start', label: 'Start' },
  { id: 'templates', label: 'Templates' },
  { id: 'yours', label: 'Yours' }
]
const SLOTS = 5
const LEAVE_MS = 220

const query = ref('')
const tab = ref<Tab>('start')
const composer = ref<InstanceType<typeof CreateComposer>>()
const results = ref<InstanceType<typeof ResultsB>>()
const navigated = ref(false)
const hover = ref(-1)
const leaving = ref(false)
const flow = useCreateAgent()
watch(query, () => (navigated.value = false))
watch(tab, () => (hover.value = -1))

const recents = computed(() => [...allWorkflows.value].sort((a, b) => a.age - b.age))
const lastOutput = (w: ProjectWorkflow): string | undefined =>
  MOCK[w.name] ?? (w.thumbId ? thumb(w.thumbId) : undefined)

const fill = (list: Card[]): Card[] =>
  [
    ...list,
    ...Array.from({ length: SLOTS }, (_, i): Card => ({ id: `empty-${i}`, type: 'empty' }))
  ].slice(0, SLOTS)

const cards = computed<Card[]>(() => {
  if (tab.value === 'start')
    return fill(STEPS.map((step): Card => ({ id: step.id, type: 'step', step })))
  if (tab.value === 'templates')
    return fill(
      SHELVES[0]!.starters().map((starter): Card => ({ id: starter.id, type: 'template', starter }))
    )
  return fill(
    recents.value.map((workflow): Card => ({ id: workflow.id, type: 'workflow', workflow }))
  )
})
const shown = computed(() => {
  const c = cards.value[hover.value]
  return c && c.type !== 'empty' ? c : undefined
})

function leave(then: () => void): void {
  if (reducedMotion()) return then()
  leaving.value = true
  setTimeout(then, LEAVE_MS)
}

function askAgent(): void {
  if (createInput.id === 'agent') composer.value?.focus()
  else leave(startWithAgent)
}

function pick(c: Card): void {
  if (c.type === 'step') {
    if (c.step.agent) askAgent()
    else if (c.step.recipe) leave(() => startWithRecipe(c.step.recipe!))
  } else if (c.type === 'template') openTemplate(c.starter.template)
  else if (c.type === 'workflow') leave(() => openWorkflow(c.workflow))
}

function onAsk(a: AgentAnswer): void {
  if (agentOpens.id === 'comfy') leave(() => startWithAgentAsk(agentStart(a.prompt)))
  else flow.ask(a)
}

function key(e: KeyboardEvent): void {
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
  const live = cards.value.map((c, i) => (c.type === 'empty' ? -1 : i)).filter((i) => i >= 0)
  const now = live.indexOf(hover.value)
  if (e.key === 'ArrowRight') hover.value = live[Math.min(live.length - 1, now + 1)] ?? -1
  else if (e.key === 'ArrowLeft') hover.value = live[Math.max(0, now - 1)] ?? -1
  else if (e.key === 'Enter' && shown.value) pick(shown.value)
  else return
  e.preventDefault()
}

const placeholder = computed(() =>
  createInput.id === 'agent'
    ? 'Describe what you want to make, or search templates'
    : 'Search templates, workflows and nodes'
)

const dropping = computed(() => createInput.id === 'search' && !!query.value.trim())

function enter(i: number, el: EventTarget | null): void {
  hover.value = i
  if (!reducedMotion()) playIn(el)
}

useEscapeCloses(() => composer.value?.field)
</script>

<template>
  <section class="v12 relative flex h-full min-h-[600px]" aria-label="Create">
    <div class="v12-canvas" aria-hidden="true" />

    <div class="v12-main">
      <div
        v-if="flow.build.value"
        class="v12-built"
        :class="!flow.panel.value && 'is-faint'"
        aria-hidden="true"
      >
        <GhostGraph :starter="flow.build.value.starter" :agent="flow.ghost.value" />
      </div>
      <div
        class="v12-scrim"
        :class="(leaving || flow.panel.value) && 'is-hidden'"
        aria-hidden="true"
      />

      <div
        class="v12-over"
        :class="[leaving && 'is-leaving', flow.panel.value && 'is-hidden']"
        :aria-hidden="flow.panel.value"
      >
        <h1 class="v12-title">What do you want to make?</h1>
        <div class="v12-ask">
          <CreateComposer
            ref="composer"
            v-model="query"
            class="v12-composer"
            :mode="createInput.id"
            :navigated
            :placeholder
            hero
            send
            external
            @key="key"
            @ask="onAsk"
          />
          <div v-if="dropping" class="v12-drop">
            <ResultsB ref="results" :query />
          </div>
        </div>
        <button type="button" class="v12-link" @click="leave(startBlank)">
          <Plus :size="14" />Start with a blank canvas
        </button>

        <div class="v12-starts" :class="dropping && 'is-under'">
          <nav class="v12-tabs" aria-label="Start from">
            <button
              v-for="t in TABS"
              :key="t.id"
              type="button"
              class="v12-tab"
              :class="tab === t.id && 'is-on'"
              :aria-pressed="tab === t.id"
              @click="tab = t.id"
            >
              {{ t.label }}
            </button>
          </nav>

          <div class="v12-row" @pointerleave="hover = -1">
            <template v-for="(c, i) in cards" :key="c.id">
              <span v-if="c.type === 'empty'" class="v12-card is-empty" aria-hidden="true">
                <span class="v12-pic" />
              </span>
              <button
                v-else
                type="button"
                class="v12-card"
                :class="hover === i && 'is-at'"
                @pointerenter="enter(i, $event.currentTarget)"
                @pointerleave="stopIn($event.currentTarget)"
                @focus="enter(i, $event.currentTarget)"
                @blur="stopIn($event.currentTarget)"
                @click="pick(c)"
              >
                <span class="v12-pic">
                  <template v-if="c.type === 'step'">
                    <img :src="c.step.src" alt="" loading="lazy" />
                    <video
                      v-if="c.step.clip"
                      :src="c.step.clip"
                      :poster="c.step.src"
                      muted
                      loop
                      playsinline
                      preload="none"
                    />
                  </template>
                  <img
                    v-else-if="c.type === 'template'"
                    :src="c.starter.poster"
                    alt=""
                    loading="lazy"
                  />
                  <template v-else-if="c.type === 'workflow'">
                    <img
                      v-if="lastOutput(c.workflow)"
                      :src="lastOutput(c.workflow)"
                      alt=""
                      loading="lazy"
                    />
                    <WorkflowCover v-else :name="c.workflow.name" />
                  </template>
                </span>
                <span class="v12-name">{{
                  c.type === 'step'
                    ? c.step.title
                    : c.type === 'template'
                      ? c.starter.makes
                      : c.workflow.name
                }}</span>
              </button>
            </template>
          </div>

          <p class="v12-line" aria-live="polite">
            <template v-if="shown?.type === 'step'">
              {{ shown.step.line }} Runs on {{ activeInstance.name }}.
            </template>
            <template v-else-if="shown?.type === 'template'">
              <span
                v-for="r in [readiness(shown.starter.template)]"
                :key="r.label"
                class="v12-ready"
                :class="`is-${r.tone}`"
              >
                {{ shown.starter.model }}
                <component :is="readyIcon(r)" v-if="r.tone !== 'off'" :size="12" />{{ r.label }}
              </span>
            </template>
            <template v-else-if="shown?.type === 'workflow'">
              On {{ buildOf(shown.workflow)?.name }}, edited
              {{ shown.workflow.modified.toLowerCase() }}
            </template>
          </p>
        </div>

        <button
          type="button"
          class="v12-link v12-add"
          :class="dropping && 'is-under'"
          @click="leave(startWithNodeSearch)"
        >
          <Plus :size="14" />Add node
        </button>
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
:root .proto-ui.proto-ui.proto-ui .v12 {
  isolation: isolate;
  overflow: hidden;
}
:root .proto-ui.proto-ui.proto-ui .v12-canvas {
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
:root .proto-ui.proto-ui.proto-ui .v12-main {
  position: relative;
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 48px 40px;
}
:root .proto-ui.proto-ui.proto-ui .v12-built {
  position: absolute;
  inset: 48px 40px;
  display: grid;
  place-items: center;
  transition: opacity 300ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v12-built.is-faint {
  opacity: 0.2;
}
:root .proto-ui.proto-ui.proto-ui .v12-scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: radial-gradient(
    ellipse 44% 50% at 50% 50%,
    color-mix(in oklch, var(--color-content-background) 90%, transparent) 35%,
    transparent 80%
  );
  pointer-events: none;
  transition: opacity 260ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v12-scrim.is-hidden {
  opacity: 0;
}
:root .proto-ui.proto-ui.proto-ui .v12-over {
  position: relative;
  z-index: 2;
  display: flex;
  width: 100%;
  max-width: 840px;
  flex-direction: column;
  align-items: center;
  text-align: center;
  transition:
    opacity 220ms ease,
    transform 220ms var(--ease-out-expo);
  animation: v12-in 520ms var(--ease-out-expo) both;
}
:root .proto-ui.proto-ui.proto-ui .v12-over.is-leaving,
:root .proto-ui.proto-ui.proto-ui .v12-over.is-hidden {
  opacity: 0;
  pointer-events: none;
  transform: scale(0.98);
}
:root .proto-ui.proto-ui.proto-ui .v12-title {
  color: var(--color-base-foreground);
  font-size: 32px;
  font-weight: 650;
  letter-spacing: -0.022em;
  line-height: 38px;
}
:root .proto-ui.proto-ui.proto-ui .v12-ask {
  position: relative;
  width: min(640px, 100%);
  margin-top: 24px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .v12-drop {
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
  animation: v12-fade 160ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .v12-link {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 0 14px;
  border-radius: 999px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  transition:
    background-color 140ms ease,
    color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v12-link:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v12-link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v12-starts {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: center;
  margin-top: 48px;
}
:root .proto-ui.proto-ui.proto-ui .v12-starts,
:root .proto-ui.proto-ui.proto-ui .v12-add {
  transition: opacity 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v12-starts.is-under,
:root .proto-ui.proto-ui.proto-ui .v12-add.is-under {
  opacity: 0;
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v12-tabs {
  display: flex;
  gap: 24px;
}
:root .proto-ui.proto-ui.proto-ui .v12-tab {
  padding: 4px 0 6px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
  transition: color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v12-tab:hover,
:root .proto-ui.proto-ui.proto-ui .v12-tab.is-on {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v12-tab.is-on {
  box-shadow: inset 0 -2px 0 var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v12-tab:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-border-focus);
  border-radius: 4px;
}
:root .proto-ui.proto-ui.proto-ui .v12-row {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16px;
  margin-top: 18px;
}
:root .proto-ui.proto-ui.proto-ui .v12-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v12-pic {
  position: relative;
  display: block;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  transition:
    transform 260ms var(--ease-out-expo),
    box-shadow 200ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v12-pic > img,
:root .proto-ui.proto-ui.proto-ui .v12-pic > video,
:root .proto-ui.proto-ui.proto-ui .v12-pic > .wfc {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v12-pic > video {
  opacity: 0;
  transition: opacity 240ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v12-card.is-at .v12-pic > video {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v12-card.is-at .v12-pic {
  transform: translateY(-3px);
  box-shadow: var(--shadow-elev-hover);
}
:root .proto-ui.proto-ui.proto-ui .v12-card:focus-visible .v12-pic {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v12-card.is-empty .v12-pic {
  background: transparent;
  box-shadow: none;
  outline: 1px dashed var(--color-border-default);
  outline-offset: -1px;
}
:root .proto-ui.proto-ui.proto-ui .v12-name {
  overflow: hidden;
  padding: 0 2px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v12-card.is-at .v12-name {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v12-line {
  min-height: 20px;
  margin-top: 16px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v12-ready {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
:root .proto-ui.proto-ui.proto-ui .v12-ready.is-ready svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v12-add {
  margin-top: 28px;
  color: var(--color-subtle-foreground);
}
@keyframes v12-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}
@keyframes v12-fade {
  from {
    opacity: 0;
  }
}
@media (max-width: 1180px) {
  :root .proto-ui.proto-ui.proto-ui .v12-row {
    gap: 12px;
  }
  :root .proto-ui.proto-ui.proto-ui .v12-starts {
    margin-top: 40px;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v12-over,
  :root .proto-ui.proto-ui.proto-ui .v12-drop,
  :root .proto-ui.proto-ui.proto-ui .v12-pic,
  :root .proto-ui.proto-ui.proto-ui .v12-scrim,
  :root .proto-ui.proto-ui.proto-ui .v12-built {
    animation: none;
    transition: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v12-card.is-at .v12-pic {
    transform: none;
  }
}
</style>
