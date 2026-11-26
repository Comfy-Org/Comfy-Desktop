<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowRight, Plus } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { allWorkflows, type ProjectWorkflow } from '../../../gallery'
import { activeInstance, go, proto } from '../../../useProto'
import { thumb } from '../../../mock'
import { MOCK } from '../../assets/mock'
import { exploreStart } from '../../explore/exploreStart'
import { fmtGb, targetFor, totalGb } from '../../templateModal/templateData'
import { firstResultFor, fmtDuration } from '../../templateModal/firstResult'
import {
  closeCreate,
  openTemplate,
  openWorkflow,
  startBlank,
  startWithAgentAsk
} from '../createScreen'
import { readiness, SHELVES, type Starter } from '../createStarters'
import { createInput } from '../createInput'
import { agentOpens } from '../agentOpens'
import { playIn, reducedMotion, stopIn, useEscapeCloses } from './lookKitB'
import { agentStart, type AgentAnswer } from './v07Agent'
import { useCreateAgent } from './createAgent'
import CreateComposer from './CreateComposer.vue'
import CreateAgentPanel from './CreateAgentPanel.vue'
import GhostGraph from './GhostGraph.vue'
import ResultsB from './ResultsB.vue'

type Card =
  | { id: string; type: 'template'; starter: Starter; meta: string; tone: string }
  | { id: string; type: 'workflow'; workflow: ProjectWorkflow; meta: string; tone: string }

interface Row {
  id: 'continue' | 'templates'
  label: string
  cards: Card[]
}

const SLOTS = 5
const LEAVE_MS = 220
const SUGGESTIONS = [
  'Product shot on wet stone',
  'Animate my photo',
  'Remove the background',
  'Upscale to 4K'
]

const query = ref('')
const composer = ref<InstanceType<typeof CreateComposer>>()
const results = ref<InstanceType<typeof ResultsB>>()
const navigated = ref(false)
const hover = ref('')
const leaving = ref(false)
const flow = useCreateAgent()
watch(query, () => (navigated.value = false))

const lastOutput = (w: ProjectWorkflow): string | undefined =>
  MOCK[w.name] ?? (w.thumbId ? thumb(w.thumbId) : undefined)

const edited = (modified: string): string =>
  `Edited ${modified
    .toLowerCase()
    .replace(/ min ago$/, 'm ago')
    .replace(/ hours? ago$/, 'h ago')
    .replace(/ days? ago$/, 'd ago')}`

const roughly = (secs: number): string =>
  secs < 60 ? fmtDuration(secs) : `${Math.round(secs / 60)} min`

function templateMeta(s: Starter): { meta: string; tone: string } {
  const r = readiness(s.template)
  if (r.tone === 'ready') {
    const first = firstResultFor(
      s.template,
      targetFor(s.template, activeInstance.value, proto.signedIn)
    )
    return {
      meta: first ? `Ready · first result ~${roughly(first.secs)}` : 'Ready to run',
      tone: 'ready'
    }
  }
  if (r.tone === 'fetch') return { meta: `Needs ${fmtGb(totalGb(s.template))}`, tone: 'fetch' }
  return { meta: r.label, tone: 'off' }
}

const templates = computed<Card[]>(() => {
  const all = SHELVES[0]!.starters().map(
    (starter): Card => ({
      id: starter.id,
      type: 'template',
      starter,
      ...templateMeta(starter)
    })
  )
  return [
    ...all.filter((c) => c.tone === 'ready'),
    ...all.filter((c) => c.tone === 'fetch'),
    ...all.filter((c) => c.tone === 'off')
  ].slice(0, SLOTS)
})

const recents = computed<Card[]>(() =>
  [...allWorkflows.value]
    .sort((a, b) => a.age - b.age)
    .slice(0, SLOTS)
    .map((workflow) => ({
      id: workflow.id,
      type: 'workflow',
      workflow,
      meta: edited(workflow.modified),
      tone: 'off'
    }))
)

const rows = computed<Row[]>(() => [
  ...(recents.value.length
    ? [{ id: 'continue' as const, label: 'Continue', cards: recents.value }]
    : []),
  { id: 'templates', label: 'Start from a template', cards: templates.value }
])

const flat = computed(() => rows.value.flatMap((r) => r.cards))
const shown = computed(() => flat.value.find((c) => c.id === hover.value))

function leave(then: () => void): void {
  if (reducedMotion()) return then()
  leaving.value = true
  setTimeout(then, LEAVE_MS)
}

function pick(c: Card): void {
  if (c.type === 'template') openTemplate(c.starter.template)
  else leave(() => openWorkflow(c.workflow))
}

function seeAll(): void {
  exploreStart.value = 'templates'
  closeCreate()
  go('explore')
}

async function suggest(text: string): Promise<void> {
  query.value = text
  await nextTick()
  const field = composer.value?.field as HTMLInputElement | HTMLTextAreaElement | undefined
  field?.focus()
  field?.setSelectionRange(text.length, text.length)
}

function onAsk(a: AgentAnswer): void {
  if (agentOpens.id === 'comfy') leave(() => startWithAgentAsk(agentStart(a.prompt)))
  else flow.ask(a)
}

function moveAcross(step: number): void {
  const list = flat.value
  const now = list.findIndex((c) => c.id === hover.value)
  const next = now < 0 ? 0 : Math.max(0, Math.min(list.length - 1, now + step))
  hover.value = list[next]?.id ?? ''
}

function moveRow(step: number): void {
  const at = rows.value.findIndex((r) => r.cards.some((c) => c.id === hover.value))
  if (at < 0) return moveAcross(0)
  const col = rows.value[at]!.cards.findIndex((c) => c.id === hover.value)
  const row = rows.value[Math.max(0, Math.min(rows.value.length - 1, at + step))]!
  hover.value = row.cards[Math.min(col, row.cards.length - 1)]?.id ?? hover.value
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
  if (e.key === 'ArrowRight') moveAcross(1)
  else if (e.key === 'ArrowLeft') moveAcross(-1)
  else if (e.key === 'ArrowDown' && hover.value) moveRow(1)
  else if (e.key === 'ArrowUp' && hover.value) moveRow(-1)
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

function enter(id: string, el: EventTarget | null): void {
  hover.value = id
  if (!reducedMotion()) playIn(el)
}

useEscapeCloses(() => composer.value?.field)
</script>

<template>
  <section class="v14 relative flex h-full min-h-[600px]" aria-label="Create">
    <div class="v14-canvas" aria-hidden="true" />

    <div class="v14-main">
      <div
        v-if="flow.build.value"
        class="v14-built"
        :class="!flow.panel.value && 'is-faint'"
        aria-hidden="true"
      >
        <GhostGraph :starter="flow.build.value.starter" :agent="flow.ghost.value" />
      </div>
      <div
        class="v14-scrim"
        :class="(leaving || flow.panel.value) && 'is-hidden'"
        aria-hidden="true"
      />

      <div
        class="v14-over"
        :class="[leaving && 'is-leaving', flow.panel.value && 'is-hidden']"
        :aria-hidden="flow.panel.value"
      >
        <h1 class="v14-title">What do you want to make?</h1>
        <div class="v14-ask">
          <CreateComposer
            ref="composer"
            v-model="query"
            class="v14-composer"
            :mode="createInput.id"
            :navigated
            :placeholder
            hero
            send
            external
            @key="key"
            @ask="onAsk"
          />
          <div v-if="dropping" class="v14-drop">
            <ResultsB ref="results" :query />
          </div>
        </div>

        <div class="v14-under" :class="dropping && 'is-under'">
          <div class="v14-chips" aria-label="Try">
            <button
              v-for="s in SUGGESTIONS"
              :key="s"
              type="button"
              class="v14-chip"
              @click="suggest(s)"
            >
              {{ s }}
            </button>
          </div>
          <button type="button" class="v14-link" @click="leave(startBlank)">
            <Plus :size="14" />Start with a blank canvas
          </button>
        </div>

        <div class="v14-starts" :class="dropping && 'is-under'" @pointerleave="hover = ''">
          <section
            v-for="r in rows"
            :key="r.id"
            class="v14-section"
            :aria-labelledby="`v14-${r.id}`"
          >
            <header class="v14-head">
              <h2 :id="`v14-${r.id}`" class="v14-label">{{ r.label }}</h2>
              <button v-if="r.id === 'templates'" type="button" class="v14-all" @click="seeAll">
                See all<ArrowRight :size="13" />
              </button>
            </header>
            <div class="v14-row">
              <button
                v-for="c in r.cards"
                :key="c.id"
                type="button"
                class="v14-card"
                :class="hover === c.id && 'is-at'"
                @pointerenter="enter(c.id, $event.currentTarget)"
                @pointerleave="stopIn($event.currentTarget)"
                @focus="enter(c.id, $event.currentTarget)"
                @blur="stopIn($event.currentTarget)"
                @click="pick(c)"
              >
                <span class="v14-pic">
                  <template v-if="c.type === 'template'">
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
                  </template>
                  <template v-else>
                    <img
                      v-if="lastOutput(c.workflow)"
                      :src="lastOutput(c.workflow)"
                      alt=""
                      loading="lazy"
                    />
                    <WorkflowCover v-else :name="c.workflow.name" />
                  </template>
                </span>
                <span class="v14-text">
                  <span class="v14-name">{{
                    c.type === 'template' ? c.starter.makes : c.workflow.name
                  }}</span>
                  <span class="v14-meta" :class="`is-${c.tone}`" :title="c.meta">{{ c.meta }}</span>
                </span>
              </button>
            </div>
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
:root .proto-ui.proto-ui.proto-ui .v14 {
  isolation: isolate;
  overflow: hidden;
}
:root .proto-ui.proto-ui.proto-ui .v14-canvas {
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
:root .proto-ui.proto-ui.proto-ui .v14-main {
  position: relative;
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  padding: 40px 40px;
}
:root .proto-ui.proto-ui.proto-ui .v14-built {
  position: absolute;
  inset: 48px 40px;
  display: grid;
  place-items: center;
  transition: opacity 300ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v14-built.is-faint {
  opacity: 0.2;
}
:root .proto-ui.proto-ui.proto-ui .v14-scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: radial-gradient(
    ellipse 46% 54% at 50% 50%,
    color-mix(in oklch, var(--color-content-background) 90%, transparent) 40%,
    transparent 82%
  );
  pointer-events: none;
  transition: opacity 260ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v14-scrim.is-hidden {
  opacity: 0;
}
:root .proto-ui.proto-ui.proto-ui .v14-over {
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
  animation: v14-in 520ms var(--ease-out-expo) both;
}
:root .proto-ui.proto-ui.proto-ui .v14-over.is-leaving,
:root .proto-ui.proto-ui.proto-ui .v14-over.is-hidden {
  opacity: 0;
  pointer-events: none;
  transform: scale(0.98);
}
:root .proto-ui.proto-ui.proto-ui .v14-title {
  color: var(--color-base-foreground);
  font-size: 32px;
  font-weight: 650;
  letter-spacing: -0.022em;
  line-height: 38px;
}
:root .proto-ui.proto-ui.proto-ui .v14-ask {
  position: relative;
  z-index: 3;
  width: min(640px, 100%);
  margin-top: 22px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .v14-drop {
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
  animation: v14-fade 160ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .v14-under {
  display: flex;
  flex-direction: column;
  align-items: center;
}
:root .proto-ui.proto-ui.proto-ui .v14-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v14-chip {
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-secondary-background) 70%, transparent);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-weight: 500;
  transition:
    background-color 140ms ease,
    color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v14-chip:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v14-chip:focus-visible,
:root .proto-ui.proto-ui.proto-ui .v14-link:focus-visible,
:root .proto-ui.proto-ui.proto-ui .v14-all:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v14-link {
  display: inline-flex;
  height: 30px;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 0 14px;
  border-radius: 999px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
  transition:
    background-color 140ms ease,
    color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v14-link:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v14-under,
:root .proto-ui.proto-ui.proto-ui .v14-starts {
  transition: opacity 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v14-under.is-under,
:root .proto-ui.proto-ui.proto-ui .v14-starts.is-under {
  opacity: 0;
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v14-starts {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 24px;
  margin-top: 32px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .v14-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding: 0 2px;
}
:root .proto-ui.proto-ui.proto-ui .v14-label {
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v14-all {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 4px;
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-weight: 500;
  transition: color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v14-all:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v14-row {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16px;
  margin-top: 10px;
}
:root .proto-ui.proto-ui.proto-ui .v14-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v14-pic {
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
:root .proto-ui.proto-ui.proto-ui .v14-pic > img,
:root .proto-ui.proto-ui.proto-ui .v14-pic > video,
:root .proto-ui.proto-ui.proto-ui .v14-pic > .wfc {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v14-pic > video {
  opacity: 0;
  transition: opacity 240ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v14-card.is-at .v14-pic > video {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v14-card.is-at .v14-pic {
  transform: translateY(-3px);
  box-shadow: var(--shadow-elev-hover);
}
:root .proto-ui.proto-ui.proto-ui .v14-card:focus-visible .v14-pic {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v14-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  padding: 0 2px;
}
:root .proto-ui.proto-ui.proto-ui .v14-name,
:root .proto-ui.proto-ui.proto-ui .v14-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v14-name {
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
  transition: color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v14-card.is-at .v14-name {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v14-meta {
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
@keyframes v14-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}
@keyframes v14-fade {
  from {
    opacity: 0;
  }
}
@media (max-width: 1180px) {
  :root .proto-ui.proto-ui.proto-ui .v14-row {
    gap: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v14-over,
  :root .proto-ui.proto-ui.proto-ui .v14-drop,
  :root .proto-ui.proto-ui.proto-ui .v14-pic,
  :root .proto-ui.proto-ui.proto-ui .v14-scrim,
  :root .proto-ui.proto-ui.proto-ui .v14-built {
    animation: none;
    transition: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v14-card.is-at .v14-pic {
    transform: none;
  }
}
</style>
