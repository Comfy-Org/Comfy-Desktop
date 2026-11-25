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
  startWithNodeSearch,
  startWithRecipe
} from '../createScreen'
import { readiness, SHELVES, type Starter } from '../createStarters'
import { createInput } from '../createInput'
import { buildOf, readyIcon, useEscapeCloses } from './lookKitB'
import CreateComposer from './CreateComposer.vue'
import { STEPS, type Step } from './firstSteps'
import ResultsB from './ResultsB.vue'

type Tab = 'first' | 'templates' | 'yours'

type Card =
  | { id: string; type: 'blank' }
  | { id: string; type: 'step'; step: Step }
  | { id: string; type: 'template'; starter: Starter }
  | { id: string; type: 'workflow'; workflow: ProjectWorkflow }
  | { id: string; type: 'empty' }

const TABS: { id: Tab; label: string }[] = [
  { id: 'first', label: 'First step' },
  { id: 'templates', label: 'Templates' },
  { id: 'yours', label: 'Your workflows' }
]
const SLOTS = 6

const query = ref('')
const tab = ref<Tab>('first')
const composer = ref<InstanceType<typeof CreateComposer>>()
const results = ref<InstanceType<typeof ResultsB>>()
const navigated = ref(false)
const hover = ref(-1)
const at = ref(-1)
watch(query, () => (navigated.value = false))
watch(tab, () => {
  hover.value = -1
  at.value = -1
})

const recents = computed(() => [...allWorkflows.value].sort((a, b) => a.age - b.age))
const fill = (list: Card[]): Card[] =>
  [
    ...list,
    ...Array.from({ length: SLOTS }, (_, i): Card => ({ id: `empty-${i}`, type: 'empty' }))
  ].slice(0, SLOTS)

const cards = computed<Card[]>(() => {
  if (tab.value === 'first')
    return fill([
      { id: 'blank', type: 'blank' },
      ...STEPS.map((step): Card => ({ id: step.id, type: 'step', step }))
    ])
  if (tab.value === 'templates')
    return fill(
      SHELVES[0]!.starters().map((starter): Card => ({ id: starter.id, type: 'template', starter }))
    )
  return fill(
    recents.value.map((workflow): Card => ({ id: workflow.id, type: 'workflow', workflow }))
  )
})

const shown = computed(() => {
  const i = hover.value >= 0 ? hover.value : at.value
  const c = cards.value[i]
  return c && c.type !== 'empty' ? c : undefined
})

const lastOutput = (w: ProjectWorkflow): string | undefined =>
  MOCK[w.name] ?? (w.thumbId ? thumb(w.thumbId) : undefined)

function titleOf(c: Card): string {
  if (c.type === 'blank') return 'Start blank'
  if (c.type === 'step') return c.step.title
  if (c.type === 'template') return c.starter.makes
  if (c.type === 'workflow') return c.workflow.name
  return ''
}

function askAgent(): void {
  if (createInput.id === 'agent') composer.value?.focus()
  else startWithAgent()
}

function pick(c: Card): void {
  if (c.type === 'blank') startBlank()
  else if (c.type === 'step') {
    if (c.step.agent) askAgent()
    else if (c.step.recipe) startWithRecipe(c.step.recipe)
  } else if (c.type === 'template') openTemplate(c.starter.template)
  else if (c.type === 'workflow') openWorkflow(c.workflow)
}

function move(by: number): void {
  const live = cards.value.map((c, i) => (c.type === 'empty' ? -1 : i)).filter((i) => i >= 0)
  const now = live.indexOf(at.value)
  at.value = live[Math.min(live.length - 1, Math.max(0, now + by))] ?? -1
  hover.value = -1
}

function key(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (query.value) query.value = ''
    else closeCreate()
    return
  }
  if (query.value.trim()) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') navigated.value = true
    results.value?.key(e)
    return
  }
  if (e.key === 'ArrowRight') move(1)
  else if (e.key === 'ArrowLeft') move(-1)
  else if (e.key === 'Enter' && shown.value) pick(shown.value)
  else return
  e.preventDefault()
}

useEscapeCloses(() => composer.value?.field)
</script>

<template>
  <section class="v11 relative min-h-full px-10 pb-12" aria-label="Create">
    <button type="button" class="v11-close" aria-label="Close" @click="closeCreate">
      <X :size="16" />
    </button>

    <div class="v11-col">
      <h1 class="v11-ask">What do you want to make?</h1>
      <CreateComposer
        ref="composer"
        v-model="query"
        class="v11-composer"
        :mode="createInput.id"
        :navigated
        @key="key"
        @build="(s) => openTemplate(s.template)"
      />

      <ResultsB v-if="query.trim()" ref="results" :query class="v11-results" />

      <template v-else>
        <nav class="v11-tabs" aria-label="Start from">
          <button
            v-for="t in TABS"
            :key="t.id"
            type="button"
            class="v11-tab"
            :class="tab === t.id && 'is-on'"
            :aria-pressed="tab === t.id"
            @click="tab = t.id"
          >
            {{ t.label }}
          </button>
        </nav>

        <div class="v11-grid" @pointerleave="hover = -1">
          <template v-for="(c, i) in cards" :key="c.id">
            <span v-if="c.type === 'empty'" class="v11-card is-empty" aria-hidden="true">
              <span class="v11-pic" />
            </span>
            <button
              v-else
              type="button"
              class="v11-card"
              :class="[`is-${c.type}`, (hover === i || at === i) && 'is-at']"
              :data-v11-at="i"
              @pointerenter="hover = i"
              @focus="at = i"
              @click="pick(c)"
            >
              <span class="v11-pic">
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
                  <span v-if="c.step.agent" class="v11-agent-mark"><AgentChat :size="14" /></span>
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
                <Plus v-else :size="20" />
              </span>
              <span class="v11-name">{{ titleOf(c) }}</span>
              <span v-if="c.type === 'step'" class="v11-line">{{ c.step.line }}</span>
              <span v-else-if="c.type === 'blank'" class="v11-line">An empty canvas</span>
            </button>
          </template>
        </div>

        <p class="v11-detail" aria-live="polite">
          <template v-if="shown?.type === 'step'">
            <b>{{ shown.step.title }}</b>
            <span>{{ shown.step.chain }}</span>
            <span>Runs on {{ activeInstance.name }}</span>
          </template>
          <template v-else-if="shown?.type === 'template'">
            <b>{{ shown.starter.makes }}</b>
            <span>{{ shown.starter.model }}</span>
            <span
              v-for="r in [readiness(shown.starter.template)]"
              :key="r.label"
              class="v11-ready"
              :class="`is-${r.tone}`"
            >
              <component :is="readyIcon(r)" v-if="r.tone !== 'off'" :size="12" />{{ r.label }}
            </span>
          </template>
          <template v-else-if="shown?.type === 'workflow'">
            <b>{{ shown.workflow.name }}</b>
            <span>{{ buildOf(shown.workflow)?.name }}</span>
            <span>Edited {{ shown.workflow.modified.toLowerCase() }}</span>
          </template>
          <template v-else-if="shown?.type === 'blank'">
            <b>Start blank</b>
            <span>Build it node by node</span>
            <span>Runs on {{ activeInstance.name }}</span>
          </template>
          <span v-else class="v11-hint">Point at a card to see what it sets up.</span>
        </p>
      </template>

      <footer class="v11-foot">
        <button type="button" class="v11-add" @click="startWithNodeSearch">
          <Plus :size="13" />Add node
        </button>
      </footer>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v11 {
  isolation: isolate;
}
:root .proto-ui.proto-ui.proto-ui .v11-close {
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
:root .proto-ui.proto-ui.proto-ui .v11-close:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v11-col {
  display: flex;
  max-width: 1040px;
  flex-direction: column;
  margin: 0 auto;
  padding-top: clamp(40px, 9vh, 88px);
}
:root .proto-ui.proto-ui.proto-ui .v11-ask {
  color: var(--color-base-foreground);
  font-size: 40px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 44px;
}
:root .proto-ui.proto-ui.proto-ui .v11-composer {
  max-width: 620px;
  margin-top: 20px;
}
:root .proto-ui.proto-ui.proto-ui .v11-results {
  margin-top: 32px;
}
:root .proto-ui.proto-ui.proto-ui .v11-tabs {
  display: flex;
  gap: 24px;
  margin-top: 44px;
  border-bottom: 1px solid var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v11-tab {
  margin-bottom: -1px;
  padding: 8px 0 10px;
  color: var(--color-subtle-foreground);
  font-size: 14px;
  font-weight: 500;
  transition: color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v11-tab:hover,
:root .proto-ui.proto-ui.proto-ui .v11-tab.is-on {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v11-tab.is-on {
  box-shadow: inset 0 -2px 0 var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v11-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 14px;
  margin-top: 20px;
}
:root .proto-ui.proto-ui.proto-ui .v11-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v11-pic {
  position: relative;
  display: grid;
  aspect-ratio: 4 / 5;
  place-items: center;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--color-card-background);
  color: var(--color-base-foreground);
  transition:
    transform 260ms var(--ease-out-expo),
    box-shadow 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v11-pic > img,
:root .proto-ui.proto-ui.proto-ui .v11-pic > video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v11-pic > div {
  position: absolute;
  inset: 0;
}
:root .proto-ui.proto-ui.proto-ui .v11-card.is-at .v11-pic {
  transform: translateY(-3px);
}
:root .proto-ui.proto-ui.proto-ui .v11-card:focus-visible .v11-pic {
  box-shadow:
    0 0 0 2px var(--color-app-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v11-card.is-blank .v11-pic {
  background:
    radial-gradient(
        color-mix(in oklch, var(--color-base-foreground) 16%, transparent) 1px,
        transparent 1.4px
      )
      0 0 / 14px 14px,
    var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v11-card.is-empty .v11-pic {
  background: transparent;
  outline: 1px dashed var(--color-border-default);
  outline-offset: -1px;
}
:root .proto-ui.proto-ui.proto-ui .v11-agent-mark {
  position: absolute;
  top: 8px;
  left: 8px;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 999px;
  background: var(--color-media-overlay);
  color: white;
  backdrop-filter: blur(12px);
}
:root .proto-ui.proto-ui.proto-ui .v11-name {
  margin-top: 10px;
  overflow: hidden;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v11-card.is-blank .v11-name {
  color: var(--color-muted-foreground);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v11-line {
  margin-top: 2px;
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v11-detail {
  display: flex;
  min-height: 44px;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
  margin-top: 16px;
  padding: 0 14px;
  border-radius: var(--radius-card);
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v11-detail b {
  color: var(--color-base-foreground);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v11-hint {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v11-ready {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v11-ready.is-ready svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v11-foot {
  display: flex;
  justify-content: center;
  margin-top: 28px;
}
:root .proto-ui.proto-ui.proto-ui .v11-add {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-radius: 999px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v11-add:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
@media (max-width: 1100px) {
  :root .proto-ui.proto-ui.proto-ui .v11-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v11-pic {
    transition: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v11-card.is-at .v11-pic {
    transform: none;
  }
}
</style>
