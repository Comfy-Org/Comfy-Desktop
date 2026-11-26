<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  closeCreate,
  createScreen,
  openTemplate,
  openWorkflow,
  startBlank,
  startWithAgentAsk
} from '../createScreen'
import { SHELVES, type Starter } from '../createStarters'
import { agentOpens } from '../agentOpens'
import { agentStart, answer, type AgentAnswer } from './v07Agent'
import { useCreateAgent } from './createAgent'
import CreateAgentPanel from './CreateAgentPanel.vue'
import GhostGraph from './GhostGraph.vue'
import GraphPreview, { type GraphPreviewItem } from './GraphPreview.vue'
import { useGraphPreview } from './graphPreview'
import SmartSearch from '../SmartSearch.vue'
import { Plus } from 'lucide-vue-next'

interface Card {
  id: string
  name: string
  starter: Starter
}

const PER_PAGE = 8
const LIST_ID = 'v16-smart-list'
const EXIT_TOP = 96

const query = ref('')
const search = ref<InstanceType<typeof SmartSearch>>()
const hero = ref<HTMLElement>()
const dock = ref<HTMLElement>()
const navigated = ref(false)
const pinTop = ref<number | null>(null)
const flow = useCreateAgent()

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

const cards = computed<Card[]>(() =>
  topUp(SHELVES[0]!.starters()).map((starter) => ({
    id: `t:${starter.id}`,
    name: starter.makes,
    starter
  }))
)

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
} = useGraphPreview<Card>({ top: () => EXIT_TOP })

const previewItem = computed<GraphPreviewItem | null>(() => {
  const c = preview.value
  return c ? { id: c.id, name: c.name, starter: c.starter, workflow: null } : null
})
const searching = computed(() => !!search.value?.shown)
const heroHidden = computed(() => !!preview.value || flow.panel.value)
const bandGone = computed(() => flow.panel.value || searching.value)

watch(query, () => {
  navigated.value = false
  endPreview()
})

watch(
  searching,
  (on) => {
    pinTop.value = on && hero.value ? hero.value.offsetTop : null
  },
  { flush: 'pre' }
)

function showPreview(c: Card): void {
  if (flow.panel.value || query.value.trim()) return stay()
  show(c)
}

function onBandLeave(e: PointerEvent): void {
  const top = (e.currentTarget as Element).getBoundingClientRect().top
  if (e.clientY > top) endSoon()
}

const canvasStyle = computed(() => dotsStyle(24, 1, 0))

function open(c: Card): void {
  endPreview()
  openTemplate(c.starter.template)
}

function onDockKey(e: KeyboardEvent): void {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
  const buttons = [...(dock.value?.querySelectorAll<HTMLElement>('.v16-tile') ?? [])]
  const at = buttons.indexOf(document.activeElement as HTMLElement)
  if (at < 0) return
  e.preventDefault()
  buttons[at + (e.key === 'ArrowRight' ? 1 : -1)]?.focus()
}

function onAsk(a: AgentAnswer): void {
  endPreview()
  if (agentOpens.id === 'comfy') startWithAgentAsk(agentStart(a.prompt))
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

function key(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (preview.value) endPreview()
    else if (flow.panel.value) flow.close()
    else if (query.value) query.value = ''
    else closeCreate()
  }
}

function onWindowKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || document.activeElement === search.value?.field) return
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
    <div
      class="v16-canvas"
      :class="preview && 'is-preview'"
      :style="preview ? canvasStyle : undefined"
      aria-hidden="true"
    />

    <div class="v16-main">
      <div
        class="v16-stage"
        :class="[preview && 'is-preview', dragging && 'is-dragging', searching && 'is-searching']"
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

        <GraphPreview
          :item="previewItem"
          :pan="panStyle"
          @open="preview && open(preview)"
          @close="endPreview"
        />

        <div
          ref="hero"
          class="v16-hero"
          :class="heroHidden && 'is-hidden'"
          :style="pinTop === null ? undefined : { marginTop: `${pinTop}px`, marginBottom: 'auto' }"
          :aria-hidden="heroHidden"
        >
          <h1 class="v16-title">What do you want to make?</h1>
          <SmartSearch
            ref="search"
            v-model="query"
            :list-id="LIST_ID"
            :suspended="flow.panel.value"
            :navigated
            @key="key"
            @ask="onAsk"
            @workflow="openWorkflow"
          >
            <button type="button" class="v16-blank" @click="startBlank">
              <Plus :size="14" />Start with a blank canvas
            </button>
          </SmartSearch>
        </div>
      </div>

      <div
        class="v16-dock-wrap"
        :class="bandGone && 'is-gone'"
        :aria-hidden="bandGone"
        @pointerleave="onBandLeave"
      >
        <div class="v16-band">
          <p class="v16-stuck">Or start from a template</p>
          <div ref="dock" class="v16-dock" aria-label="Starting points" @keydown="onDockKey">
            <button
              v-for="c in cards"
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
                <img :src="c.starter.poster" alt="" loading="lazy" />
              </span>
              <span class="v16-tile-name">{{ c.name }}</span>
            </button>
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
  background: var(--color-content-background);
}
:root .proto-ui.proto-ui.proto-ui .v16-canvas {
  position: absolute;
  inset: 0;
  z-index: -1;
  background: radial-gradient(
      color-mix(in oklch, var(--color-base-foreground) 12%, transparent) 1px,
      transparent 1.4px
    )
    0 0 / 24px 24px;
  mask-image: radial-gradient(ellipse 48% 46% at 50% 42%, #000 0%, transparent 100%);
}
:root .proto-ui.proto-ui.proto-ui .v16-canvas.is-preview {
  mask-image: none;
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
:root .proto-ui.proto-ui.proto-ui .v16-stage.is-searching {
  overflow-y: auto;
  scrollbar-width: thin;
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
  max-width: 904px;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 0 32px 24px;
  transition: opacity 180ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v16-hero > .v15-ask {
  margin-top: 0;
}
:root .proto-ui.proto-ui.proto-ui .v16-hero > .v15-starts {
  margin-top: 18px;
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
:root .proto-ui.proto-ui.proto-ui .v16-stuck {
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
  text-align: center;
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
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v16-hero,
  :root .proto-ui.proto-ui.proto-ui .v16-title,
  :root .proto-ui.proto-ui.proto-ui .v16-built,
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
