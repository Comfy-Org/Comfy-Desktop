<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { AgentChat } from '../../icons/agentChat'
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
import { buildOf, readyIcon, reducedMotion, useEscapeCloses } from './lookKitB'
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
  } else if (c.type === 'template') leave(() => openTemplate(c.starter.template))
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

useEscapeCloses(() => composer.value?.field)
</script>

<template>
  <section class="v12 relative flex h-full min-h-[600px]" aria-label="Create">
    <div class="v12-canvas" aria-hidden="true" />

    <div class="v12-main">
      <button type="button" class="v12-close" aria-label="Close" @click="closeCreate">
        <X :size="16" />
      </button>

      <div
        v-if="flow.build.value"
        class="v12-built"
        :class="!flow.panel.value && 'is-faint'"
        aria-hidden="true"
      >
        <GhostGraph :starter="flow.build.value.starter" :agent="flow.ghost.value" />
      </div>

      <div
        class="v12-over"
        :class="[leaving && 'is-leaving', flow.panel.value && 'is-hidden']"
        :aria-hidden="flow.panel.value"
      >
        <h1 class="v12-title">Your canvas is ready</h1>
        <p class="v12-sub">Start from a first step, or describe what you want to make.</p>
        <CreateComposer
          ref="composer"
          v-model="query"
          class="v12-composer"
          :mode="createInput.id"
          :navigated
          external
          @key="key"
          @ask="onAsk"
        />

        <ResultsB v-if="query.trim()" ref="results" :query class="v12-results" />

        <template v-else>
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
                @pointerenter="hover = i"
                @focus="hover = i"
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
                      autoplay
                      class="motion-reduce:hidden"
                    />
                    <span v-if="c.step.agent" class="v12-mark"><AgentChat :size="13" /></span>
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
              {{ shown.step.chain }}, on {{ activeInstance.name }}
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
              {{ buildOf(shown.workflow)?.name }}, edited
              {{ shown.workflow.modified.toLowerCase() }}
            </template>
          </p>
        </template>

        <footer class="v12-foot">
          <button type="button" class="v12-link" @click="leave(startWithNodeSearch)">
            <Plus :size="13" />Add node
          </button>
          <button type="button" class="v12-link" @click="leave(startBlank)">Start blank</button>
        </footer>
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
  padding: 48px 32px;
}
:root .proto-ui.proto-ui.proto-ui .v12-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 3;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: var(--radius-control);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v12-close:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
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
:root .proto-ui.proto-ui.proto-ui .v12-over {
  position: relative;
  z-index: 2;
  display: flex;
  width: 100%;
  max-width: 880px;
  flex-direction: column;
  align-items: center;
  text-align: center;
  transition:
    opacity 220ms ease,
    transform 220ms var(--ease-out-expo);
  animation: v12-in 420ms var(--ease-out-expo) both;
}
:root .proto-ui.proto-ui.proto-ui .v12-over.is-leaving,
:root .proto-ui.proto-ui.proto-ui .v12-over.is-hidden {
  opacity: 0;
  pointer-events: none;
  transform: scale(0.98);
}
:root .proto-ui.proto-ui.proto-ui .v12-title {
  color: var(--color-base-foreground);
  font-size: 30px;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 36px;
}
:root .proto-ui.proto-ui.proto-ui .v12-sub {
  margin-top: 6px;
  color: var(--color-subtle-foreground);
  font-size: 14px;
}
:root .proto-ui.proto-ui.proto-ui .v12-composer {
  width: 100%;
  max-width: 560px;
  margin-top: 24px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .v12-results {
  width: 100%;
  margin-top: 24px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .v12-tabs {
  display: flex;
  gap: 22px;
  margin-top: 36px;
}
:root .proto-ui.proto-ui.proto-ui .v12-tab {
  padding: 4px 0;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v12-tab:hover,
:root .proto-ui.proto-ui.proto-ui .v12-tab.is-on {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v12-tab.is-on {
  box-shadow: inset 0 -2px 0 var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v12-row {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin-top: 18px;
}
:root .proto-ui.proto-ui.proto-ui .v12-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  padding: 6px;
  border-radius: 16px;
  background: color-mix(in oklch, var(--color-card-background) 80%, transparent);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  text-align: left;
  outline: none;
  backdrop-filter: blur(var(--blur-glass));
  transition:
    transform 220ms var(--ease-out-expo),
    box-shadow 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v12-card.is-at {
  transform: translateY(-3px);
  box-shadow:
    inset 0 0 0 1px var(--color-border-strong),
    var(--shadow-popover);
}
:root .proto-ui.proto-ui.proto-ui .v12-card:focus-visible {
  box-shadow: inset 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v12-card.is-empty {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  backdrop-filter: none;
  opacity: 0.5;
}
:root .proto-ui.proto-ui.proto-ui .v12-pic {
  position: relative;
  display: block;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: 10px;
  background: var(--color-secondary-background);
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
:root .proto-ui.proto-ui.proto-ui .v12-mark {
  position: absolute;
  top: 6px;
  left: 6px;
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 999px;
  background: var(--color-media-overlay);
  color: white;
}
:root .proto-ui.proto-ui.proto-ui .v12-name {
  overflow: hidden;
  padding: 0 4px 2px;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v12-line {
  min-height: 20px;
  margin-top: 14px;
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
:root .proto-ui.proto-ui.proto-ui .v12-foot {
  display: flex;
  gap: 6px;
  margin-top: 22px;
}
:root .proto-ui.proto-ui.proto-ui .v12-link {
  display: inline-flex;
  height: 30px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-radius: 999px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v12-link:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
@keyframes v12-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v12-over,
  :root .proto-ui.proto-ui.proto-ui .v12-card,
  :root .proto-ui.proto-ui.proto-ui .v12-built {
    animation: none;
    transition: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v12-card.is-at {
    transform: none;
  }
}
</style>
