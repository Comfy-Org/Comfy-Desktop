<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { allWorkflows, type ProjectWorkflow } from '../../../gallery'
import { openAppPage } from '../../../appFlow'
import {
  closeCreate,
  openTemplate,
  openWorkflow,
  startBlank,
  startWithAgentAsk
} from '../createScreen'
import { SHELVES, type Starter } from '../createStarters'
import { agentOpens } from '../agentOpens'
import { lastOutput, remember, useSmartSearch, type Row } from '../smartDrop'
import { agentStart, answer, type AgentAnswer } from './v07Agent'
import { useCreateAgent } from './createAgent'
import CreateComposer from './CreateComposer.vue'
import CreateAgentPanel from './CreateAgentPanel.vue'
import GhostGraph from './GhostGraph.vue'
import GraphPreview, { type GraphPreviewItem } from './GraphPreview.vue'
import { useGraphPreview } from './graphPreview'
import SmartDrop from './SmartDrop.vue'

type Card =
  | { id: string; type: 'template'; name: string; starter: Starter }
  | { id: string; type: 'workflow'; name: string; workflow: ProjectWorkflow }

const YOURS = 'yours'
const TABS = [
  { id: 'popular', label: 'Popular' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'edit', label: 'Edit' },
  { id: '3d', label: '3D' },
  { id: 'audio', label: 'Audio' },
  { id: YOURS, label: 'Yours' }
]
const PER_PAGE = 8
const LIST_ID = 'v16-smart-list'

const query = ref('')
const shelf = ref(TABS[0]!.id)
const page = ref(0)
const composer = ref<InstanceType<typeof CreateComposer>>()
const dock = ref<HTMLElement>()
const flow = useCreateAgent()

const finder = useSmartSearch(query)
const dropOpen = ref(false)
watch(query, (q) => q && (dropOpen.value = true))
const dropShown = computed(
  () => dropOpen.value && !flow.panel.value && finder.results.value.rows.length > 0
)
const activeOption = computed(() =>
  dropShown.value && finder.current.value ? `${LIST_ID}-opt-${finder.active.value}` : undefined
)

function topUp(own: Starter[]): Starter[] {
  const keys = (s: Starter): string[] => [s.id, s.poster, s.makes.toLowerCase()]
  const seen = new Set(own.flatMap(keys))
  const fresh = (s: Starter): boolean => {
    if (keys(s).some((k) => seen.has(k))) return false
    keys(s).forEach((k) => seen.add(k))
    return true
  }
  return [...own, ...SHELVES.flatMap((s) => s.starters()).filter(fresh)].slice(0, PER_PAGE)
}

const cards = computed<Card[]>(() => {
  if (shelf.value === YOURS)
    return [...allWorkflows.value]
      .sort((a, b) => a.age - b.age)
      .map((workflow) => ({
        id: `w:${workflow.id}`,
        type: 'workflow',
        name: workflow.name,
        workflow
      }))
  const own = (SHELVES.find((s) => s.id === shelf.value) ?? SHELVES[0]!).starters()
  const starters = own.length >= PER_PAGE ? own : topUp(own)
  return starters.map((starter) => ({
    id: `t:${starter.id}`,
    type: 'template',
    name: starter.makes,
    starter
  }))
})
const pages = computed(() => Math.max(1, Math.ceil(cards.value.length / PER_PAGE)))
const shown = computed(() => cards.value.slice(page.value * PER_PAGE, (page.value + 1) * PER_PAGE))
const blanks = computed(() => Math.max(0, PER_PAGE - shown.value.length))

const {
  preview,
  dragging,
  stay,
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
} = useGraphPreview<Card>()

const previewItem = computed<GraphPreviewItem | null>(() => {
  const c = preview.value
  if (!c) return null
  return {
    id: c.id,
    name: c.name,
    starter: c.type === 'template' ? c.starter : null,
    workflow: c.type === 'workflow' ? { name: c.name, cover: lastOutput(c.workflow) } : null
  }
})
const heroHidden = computed(() => !!preview.value || flow.panel.value)
const bandGone = computed(() => flow.panel.value)

function showPreview(c: Card): void {
  if (flow.panel.value) return stay()
  show(c)
  dropOpen.value = false
}

function onBandLeave(e: PointerEvent): void {
  const top = (e.currentTarget as Element).getBoundingClientRect().top
  if (e.clientY > top) endSoon()
}

const canvasStyle = computed(() => dotsStyle(24, 3, 1))

watch(shelf, () => {
  page.value = 0
  endPreview()
})

function open(c: Card): void {
  endPreview()
  if (c.type === 'template') openTemplate(c.starter.template)
  else openWorkflow(c.workflow)
}

function onDockKey(e: KeyboardEvent): void {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
  const buttons = [...(dock.value?.querySelectorAll<HTMLElement>('.v16-tile') ?? [])]
  const at = buttons.indexOf(document.activeElement as HTMLElement)
  if (at < 0) return
  e.preventDefault()
  const next = at + (e.key === 'ArrowRight' ? 1 : -1)
  if (next >= 0 && next < buttons.length) buttons[next]!.focus()
  else if (next >= buttons.length && page.value < pages.value - 1) page.value++
  else if (next < 0 && page.value > 0) page.value--
}

function onAsk(a: AgentAnswer): void {
  endPreview()
  if (agentOpens.id === 'comfy') startWithAgentAsk(agentStart(a.prompt))
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
  else if (row.kind === 'workflow') openWorkflow(row.workflow)
  else openAppPage(row.app.id)
}

function key(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (preview.value) endPreview()
    else if (dropShown.value) dropOpen.value = false
    else if (flow.panel.value) flow.close()
    else if (query.value) query.value = ''
    else closeCreate()
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!dropShown.value && !query.value.trim()) return
    e.preventDefault()
    if (dropShown.value) finder.move(e.key === 'ArrowDown' ? 1 : -1)
    dropOpen.value = true
  } else if (e.key === 'Enter' && (dropShown.value || query.value.trim())) {
    e.preventDefault()
    act(dropShown.value ? finder.current.value : undefined)
  }
}

function onFocusIn(): void {
  dropOpen.value = true
}

function onWindowKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || document.activeElement === composer.value?.field) return
  if (preview.value) endPreview()
  else if (flow.panel.value) flow.close()
  else closeCreate()
}

onMounted(() => window.addEventListener('keydown', onWindowKey))
onBeforeUnmount(() => {
  stay()
  window.removeEventListener('keydown', onWindowKey)
})
</script>

<template>
  <section class="v16 relative flex h-full min-h-[600px]" aria-label="Create">
    <div class="v16-canvas" :style="preview ? canvasStyle : undefined" aria-hidden="true" />

    <div class="v16-main">
      <div
        class="v16-stage"
        :class="[preview && 'is-preview', dragging && 'is-dragging']"
        @pointerenter="onStageEnter"
        @pointerleave="onStageLeave"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @wheel="onWheel"
      >
        <div
          v-if="flow.build.value"
          class="v16-built"
          :class="[!flow.panel.value && 'is-faint', preview && 'is-gone']"
          aria-hidden="true"
        >
          <GhostGraph :starter="flow.build.value.starter" :agent="flow.ghost.value" />
        </div>

        <GraphPreview :item="previewItem" :pan="panStyle" />

        <div class="v16-hero" :class="heroHidden && 'is-hidden'" :aria-hidden="heroHidden">
          <h1 class="v16-title">What do you want to make?</h1>
          <div class="v16-ask">
            <CreateComposer
              ref="composer"
              v-model="query"
              class="v16-composer"
              mode="agent"
              placeholder="Describe what you want to make, or search templates and apps"
              :enter-label="finder.enterLabel.value"
              :combo="{ open: dropShown, list: LIST_ID, active: activeOption }"
              hero
              send
              external
              @key="key"
              @ask="onAsk"
              @enter="act(dropShown ? finder.current.value : undefined)"
              @focusin="onFocusIn"
              @focusout="dropOpen = false"
              @pointerdown="dropOpen = true"
            />
            <div v-if="dropShown" class="v16-drop">
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
          <button type="button" class="v16-blank" @click="startBlank">
            <Plus :size="14" />Start with a blank canvas
          </button>
        </div>
      </div>

      <div
        class="v16-dock-wrap"
        :class="bandGone && 'is-gone'"
        :aria-hidden="bandGone"
        @pointerleave="onBandLeave"
      >
        <div class="v16-band">
          <div class="v16-bar">
            <p class="v16-stuck">Or start from a template</p>
            <nav class="v16-shelves" aria-label="Templates for">
              <button
                v-for="t in TABS"
                :key="t.id"
                type="button"
                class="v16-tab"
                :class="shelf === t.id && 'is-on'"
                :aria-pressed="shelf === t.id"
                @click="shelf = t.id"
              >
                {{ t.label }}
              </button>
            </nav>
            <span v-if="pages > 1" class="v16-pager">
              <button
                type="button"
                class="v16-icon-btn"
                aria-label="Previous"
                :disabled="page === 0"
                @click="page--"
              >
                <ChevronLeft :size="15" />
              </button>
              <button
                type="button"
                class="v16-icon-btn"
                aria-label="Next"
                :disabled="page >= pages - 1"
                @click="page++"
              >
                <ChevronRight :size="15" />
              </button>
            </span>
          </div>
          <div ref="dock" class="v16-dock" aria-label="Starting points" @keydown="onDockKey">
            <button
              v-for="c in shown"
              :key="c.id"
              type="button"
              class="v16-tile"
              :class="preview?.id === c.id && 'is-at'"
              :aria-label="`${c.name}, preview on the canvas, press to open`"
              @pointerenter="showPreview(c)"
              @focus="showPreview(c)"
              @blur="endSoon"
              @click="open(c)"
            >
              <span class="v16-tile-pic">
                <img v-if="c.type === 'template'" :src="c.starter.poster" alt="" loading="lazy" />
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
              <span class="v16-tile-name">{{ c.name }}</span>
            </button>
            <span
              v-for="n in blanks"
              :key="`empty-${n}`"
              class="v16-tile is-empty"
              aria-hidden="true"
            >
              <span class="v16-tile-pic" />
            </span>
          </div>
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
:root .proto-ui.proto-ui.proto-ui .v16 {
  isolation: isolate;
  overflow: hidden;
}
:root .proto-ui.proto-ui.proto-ui .v16-canvas {
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    radial-gradient(ellipse 60% 55% at 50% 45%, transparent, var(--color-content-background) 95%),
    radial-gradient(
        color-mix(in oklch, var(--color-base-foreground) 12%, transparent) 1px,
        transparent 1.4px
      )
      0 0 / 24px 24px,
    var(--color-content-background);
}
:root .proto-ui.proto-ui.proto-ui .v16-main {
  position: relative;
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
:root .proto-ui.proto-ui.proto-ui .v16-stage {
  position: relative;
  z-index: 2;
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
}
:root .proto-ui.proto-ui.proto-ui .v16-stage.is-preview {
  cursor: grab;
  touch-action: none;
}
:root .proto-ui.proto-ui.proto-ui .v16-stage.is-dragging {
  cursor: grabbing;
  user-select: none;
}
:root .proto-ui.proto-ui.proto-ui .v16-built {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
:root .proto-ui.proto-ui.proto-ui .v16-built {
  display: grid;
  place-items: center;
  padding: 48px;
  transition: opacity 180ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v16-built.is-faint {
  opacity: 0.2;
}
:root .proto-ui.proto-ui.proto-ui .v16-built.is-gone {
  opacity: 0;
}
:root .proto-ui.proto-ui.proto-ui .v16-hero {
  position: relative;
  z-index: 5;
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 0 32px 24px;
  transition: opacity 180ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v16-hero.is-hidden {
  opacity: 0;
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v16-title {
  margin-bottom: 8px;
  color: var(--color-base-foreground);
  font-size: 30px;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 36px;
  text-align: center;
  transition: opacity 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v16-hero:has(.v16-drop) .v16-title {
  opacity: 0.5;
}
:root .proto-ui.proto-ui.proto-ui .v16-ask {
  position: relative;
  width: min(640px, 100%);
}
:root .proto-ui.proto-ui.proto-ui .v16-drop {
  position: absolute;
  top: calc(100% + 10px);
  left: 0;
  z-index: 6;
  width: 100%;
  max-height: min(460px, calc(100vh - 330px));
  overflow-y: auto;
  padding: 6px;
  border-radius: var(--radius-panel);
  background: var(--color-card-background);
  box-shadow:
    inset 0 0 0 1px var(--color-border-default),
    var(--shadow-popover);
  scrollbar-width: thin;
  animation: v16-fade-in 160ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .v16-blank {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  border-radius: 999px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v16-blank:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v16-blank:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v16-icon-btn {
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v16-icon-btn:hover {
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v16-stuck {
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v16-bar {
  display: flex;
  align-items: center;
  gap: 24px;
}
:root .proto-ui.proto-ui.proto-ui .v16-bar .v16-shelves {
  margin-left: auto;
}
:root .proto-ui.proto-ui.proto-ui .v16-dock-wrap.is-gone {
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  border-top-color: transparent;
  opacity: 0;
  transform: translateY(24px);
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v16-dock-wrap {
  max-height: 320px;
  overflow: hidden;
  transition:
    max-height 360ms var(--ease-out-expo),
    padding 360ms var(--ease-out-expo),
    opacity 240ms ease,
    transform 360ms var(--ease-out-expo);
  flex: none;
  padding: 14px 32px 18px;
  border-top: 1px solid var(--color-border-default);
  background: color-mix(
    in oklch,
    var(--color-base-foreground) 2.5%,
    var(--color-content-background)
  );
}
:root .proto-ui.proto-ui.proto-ui .v16-band {
  position: relative;
  display: flex;
  max-width: 1280px;
  flex-direction: column;
  gap: 14px;
  margin: 0 auto;
}
:root .proto-ui.proto-ui.proto-ui .v16-pager {
  display: inline-flex;
  flex: none;
  gap: 2px;
}
:root .proto-ui.proto-ui.proto-ui .v16-pager button:disabled {
  opacity: 0.35;
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v16-shelves {
  display: flex;
  max-width: 100%;
  gap: 18px;
  overflow-x: auto;
  scrollbar-width: none;
}
:root .proto-ui.proto-ui.proto-ui .v16-tab {
  flex: none;
  padding: 3px 0;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-weight: 500;
  transition: color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v16-tab:hover,
:root .proto-ui.proto-ui.proto-ui .v16-tab.is-on {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v16-tab.is-on {
  box-shadow: inset 0 -2px 0 var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v16-dock {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v16-tile {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v16-tile-pic {
  display: grid;
  width: 100%;
  aspect-ratio: 16 / 10;
  place-items: center;
  overflow: hidden;
  border-radius: 10px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
  opacity: 0.7;
  transition:
    opacity 160ms ease,
    transform 220ms var(--ease-out-expo),
    box-shadow 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v16-tile.is-at .v16-tile-pic {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v16-tile.is-at .v16-tile-pic {
  transform: translateY(-3px);
}
:root .proto-ui.proto-ui.proto-ui .v16-tile:focus-visible .v16-tile-pic {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v16-tile-pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v16-tile-name {
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v16-tile.is-at .v16-tile-name {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v16-tile.is-empty .v16-tile-pic {
  background: transparent;
  outline: 1px dashed var(--color-border-default);
  outline-offset: -1px;
}
@keyframes v16-fade-in {
  from {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v16-hero,
  :root .proto-ui.proto-ui.proto-ui .v16-title,
  :root .proto-ui.proto-ui.proto-ui .v16-built,
  :root .proto-ui.proto-ui.proto-ui .v16-drop,
  :root .proto-ui.proto-ui.proto-ui .v16-dock-wrap,
  :root .proto-ui.proto-ui.proto-ui .v16-tile-pic,
  :root .proto-ui.proto-ui.proto-ui .v16-tile-name {
    animation: none;
    transition: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v16-tile.is-at .v16-tile-pic {
    transform: none;
  }
}
</style>
