<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Play, Plus } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { allWorkflows, type ProjectWorkflow } from '../../../gallery'
import { activeInstance } from '../../../useProto'
import { thumb } from '../../../mock'
import { MOCK } from '../../assets/mock'
import { closeCreate, openTemplate, openWorkflow, startBlank } from '../createScreen'
import { readiness, SHELVES, type Starter } from '../createStarters'
import { buildOf, hueOf, readyIcon, useEscapeCloses } from './lookKitB'
import ResultsB from './ResultsB.vue'
import CreateComposer from './CreateComposer.vue'
import { createInput } from '../createInput'

const TABS = [
  { id: 'popular', label: 'Popular' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'edit', label: 'Edit' },
  { id: '3d', label: '3D' },
  { id: 'audio', label: 'Audio' }
]
const RECENT_MAX = 5
const STRIP_MAX = 4
const BLANK = 'blank'

const query = ref('')
const composer = ref<InstanceType<typeof CreateComposer>>()
const results = ref<InstanceType<typeof ResultsB>>()
const shelf = ref(TABS[0]!.id)

const recents = computed(() =>
  [...allWorkflows.value].sort((a, b) => a.age - b.age).slice(0, RECENT_MAX)
)
const starters = computed(() =>
  (SHELVES.find((s) => s.id === shelf.value) ?? SHELVES[0]!).starters().slice(0, STRIP_MAX)
)
const chosenId = ref<string | null>(null)
const chosen = computed<Starter>(
  () => starters.value.find((s) => s.id === chosenId.value) ?? starters.value[0]!
)
const chosenReady = computed(() => readiness(chosen.value.template))
const blankOn = computed(() => chosenId.value === BLANK)
const strip = computed(() => [BLANK, ...starters.value.map((s) => s.id)])

function start(): void {
  if (blankOn.value) startBlank()
  else openTemplate(chosen.value.template)
}

const lastOutput = (w: ProjectWorkflow): string | undefined =>
  MOCK[w.name] ?? (w.thumbId ? thumb(w.thumbId) : undefined)

function step(by: number): void {
  const list = strip.value
  const i = list.indexOf(blankOn.value ? BLANK : chosen.value.id)
  chosenId.value = list[Math.min(list.length - 1, Math.max(0, i + by))]!
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
  if (e.key === 'ArrowRight') step(1)
  else if (e.key === 'ArrowLeft') step(-1)
  else if (e.key === 'Enter') start()
  else return
  e.preventDefault()
}

const navigated = ref(false)
watch(query, () => (navigated.value = false))

useEscapeCloses(() => composer.value?.field)
</script>

<template>
  <section class="v10 relative min-h-full px-10 pb-16" aria-label="Create">
    <header class="v10-head">
      <CreateComposer
        ref="composer"
        v-model="query"
        class="v10-composer"
        :mode="createInput.id"
        :navigated
        @key="key"
        @build="(s) => openTemplate(s.template)"
      />
    </header>

    <ResultsB v-if="query.trim()" ref="results" :query class="v10-results" />

    <div v-else class="v10-split">
      <section class="v10-col" aria-labelledby="v10-yours">
        <div class="v10-col-head">
          <h2 id="v10-yours" class="v10-h">Pick up where you left off</h2>
        </div>
        <ul v-if="recents.length" class="v10-recents">
          <li v-for="w in recents" :key="w.id" class="v10-recent" :style="hueOf(w)">
            <button
              type="button"
              class="v10-recent-open"
              :aria-label="`Open ${w.name}`"
              @click="openWorkflow(w)"
            >
              <span class="v10-recent-pic">
                <img v-if="lastOutput(w)" :src="lastOutput(w)" alt="" loading="lazy" />
                <WorkflowCover v-else :name="w.name" />
              </span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-[14px] text-base-foreground">{{ w.name }}</span>
                <span class="v10-recent-meta">
                  <i class="v10-dot" />
                  <span class="truncate">{{ buildOf(w)?.name }}</span>
                  <span class="shrink-0">, {{ w.modified.toLowerCase() }}</span>
                </span>
              </span>
            </button>
            <button type="button" class="v10-again" @click="openWorkflow(w)">
              <Play :size="12" />Run again
            </button>
          </li>
        </ul>
        <p v-else class="v10-none">What you open or save shows up here.</p>
      </section>

      <section class="v10-col" aria-labelledby="v10-new">
        <div class="v10-col-head">
          <h2 id="v10-new" class="v10-h">Start something new</h2>
        </div>

        <nav class="v10-tabs" aria-label="Templates for">
          <button
            v-for="t in TABS"
            :key="t.id"
            type="button"
            class="v10-tab"
            :class="shelf === t.id && 'is-on'"
            :aria-pressed="shelf === t.id"
            @click="((shelf = t.id), (chosenId = null))"
          >
            {{ t.label }}
          </button>
        </nav>

        <div v-if="blankOn" class="v10-detail">
          <button
            type="button"
            class="v10-detail-media v10-canvas"
            aria-label="Start blank"
            @click="startBlank"
          >
            <Plus :size="28" />
          </button>
          <div class="v10-detail-text">
            <p class="v10-detail-title">Blank canvas</p>
            <p class="v10-line">Build it node by node on {{ activeInstance.name }}.</p>
            <button type="button" class="v10-use" @click="startBlank">Start blank</button>
          </div>
        </div>
        <div v-else class="v10-detail">
          <button
            type="button"
            class="v10-detail-media"
            :aria-label="`Use ${chosen.makes}`"
            @click="openTemplate(chosen.template)"
          >
            <img :src="chosen.poster" alt="" />
            <video
              v-if="chosen.clip"
              :key="chosen.clip"
              :src="chosen.clip"
              muted
              loop
              playsinline
              autoplay
              class="motion-reduce:hidden"
            />
          </button>
          <div class="v10-detail-text">
            <p class="v10-detail-title">{{ chosen.makes }}</p>
            <p class="v10-line">{{ chosen.line }}.</p>
            <p class="v10-ready" :class="`is-${chosenReady.tone}`">
              <component
                :is="readyIcon(chosenReady)"
                v-if="chosenReady.tone !== 'off'"
                :size="13"
              />
              {{ chosenReady.label }}
            </p>
            <button type="button" class="v10-use" @click="openTemplate(chosen.template)">
              Use template
            </button>
          </div>
        </div>

        <div :key="shelf" class="v10-strip">
          <button
            type="button"
            class="v10-tpl is-blank"
            :class="blankOn && 'is-on'"
            :aria-pressed="blankOn"
            :title="`Empty canvas on ${activeInstance.name}`"
            @pointerenter="chosenId = BLANK"
            @focus="chosenId = BLANK"
            @click="blankOn ? startBlank() : (chosenId = BLANK)"
          >
            <span class="v10-tpl-pic v10-canvas"><Plus :size="20" /></span>
            <span class="v10-tpl-name">Blank canvas</span>
          </button>
          <button
            v-for="s in starters"
            :key="s.id"
            type="button"
            class="v10-tpl"
            :class="!blankOn && s.id === chosen.id && 'is-on'"
            :aria-pressed="!blankOn && s.id === chosen.id"
            @pointerenter="chosenId = s.id"
            @focus="chosenId = s.id"
            @click="openTemplate(s.template)"
          >
            <span class="v10-tpl-pic"><img :src="s.poster" alt="" loading="lazy" /></span>
            <span class="v10-tpl-name">{{ s.makes }}</span>
          </button>
        </div>
      </section>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v10 {
  isolation: isolate;
}
:root .proto-ui.proto-ui.proto-ui .v10-head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: 1200px;
  margin: 0 auto;
  padding-top: 20px;
}
:root .proto-ui.proto-ui.proto-ui .v10-composer {
  width: 100%;
  max-width: 540px;
}
:root .proto-ui.proto-ui.proto-ui .v10-icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v10-icon:hover {
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v10-results {
  max-width: 1000px;
  margin: 32px auto 0;
}
:root .proto-ui.proto-ui.proto-ui .v10-split {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  gap: 72px;
  max-width: 1200px;
  margin: 36px auto 0;
}
:root .proto-ui.proto-ui.proto-ui .v10-col {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
:root .proto-ui.proto-ui.proto-ui .v10-col-head {
  display: flex;
  min-height: 36px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
:root .proto-ui.proto-ui.proto-ui .v10-h {
  color: var(--color-muted-foreground);
  font-size: 14px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v10-recents {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 16px -8px 0;
}
:root .proto-ui.proto-ui.proto-ui .v10-recent {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 10px;
  border-radius: 14px;
  transition: background-color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v10-recent:hover,
:root .proto-ui.proto-ui.proto-ui .v10-recent:focus-within {
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v10-recent-open {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 16px;
  padding: 8px;
  border-radius: 14px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v10-recent-open:focus-visible {
  box-shadow: inset 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v10-recent-pic {
  width: 88px;
  height: 58px;
  flex: none;
  overflow: hidden;
  border-radius: 10px;
  background: var(--color-card-background);
}
:root .proto-ui.proto-ui.proto-ui .v10-recent-pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v10-recent-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  margin-top: 2px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v10-dot {
  width: 6px;
  height: 6px;
  flex: none;
  margin-right: 6px;
  border-radius: 999px;
  background: oklch(0.74 0.16 var(--h, 250));
}
:root .proto-ui.proto-ui.proto-ui .v10-again {
  display: inline-flex;
  height: 30px;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: 12px;
  font-weight: 600;
  opacity: 0;
  transition: opacity 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v10-recent:hover .v10-again,
:root .proto-ui.proto-ui.proto-ui .v10-recent:focus-within .v10-again {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v10-again:hover {
  background: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v10-none {
  margin-top: 16px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v10-tabs {
  display: flex;
  gap: 20px;
  margin-top: 20px;
  overflow-x: auto;
  scrollbar-width: none;
}
:root .proto-ui.proto-ui.proto-ui .v10-tab {
  flex: none;
  padding: 4px 0;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
  transition: color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v10-tab:hover,
:root .proto-ui.proto-ui.proto-ui .v10-tab.is-on {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v10-tab.is-on {
  box-shadow: inset 0 -2px 0 var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v10-detail {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 28px;
  margin-top: 20px;
}
:root .proto-ui.proto-ui.proto-ui .v10-detail-media {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: var(--radius-panel);
  background: var(--color-card-background);
}
:root .proto-ui.proto-ui.proto-ui .v10-detail-media:focus-visible {
  box-shadow: 0 0 0 3px var(--color-border-focus);
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v10-detail-media > img,
:root .proto-ui.proto-ui.proto-ui .v10-detail-media > video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v10-detail-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-end;
  padding-bottom: 4px;
}
:root .proto-ui.proto-ui.proto-ui .v10-detail-title {
  color: var(--color-base-foreground);
  font-size: var(--text-title);
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: var(--text-title--line-height);
}
:root .proto-ui.proto-ui.proto-ui .v10-line {
  display: -webkit-box;
  margin-top: 8px;
  overflow: hidden;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  line-height: 20px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
:root .proto-ui.proto-ui.proto-ui .v10-ready {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v10-ready.is-ready svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v10-ready.is-off {
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v10-use {
  height: 40px;
  margin-top: 16px;
  padding: 0 20px;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: var(--text-ui);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v10-use:hover {
  background: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v10-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin-top: 20px;
}
:root .proto-ui.proto-ui.proto-ui .v10-tpl {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v10-tpl-pic {
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: 10px;
  background: var(--color-card-background);
  opacity: 0.55;
  transition:
    opacity 160ms ease,
    box-shadow 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v10-tpl:hover .v10-tpl-pic,
:root .proto-ui.proto-ui.proto-ui .v10-tpl.is-on .v10-tpl-pic {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v10-tpl.is-on .v10-tpl-pic,
:root .proto-ui.proto-ui.proto-ui .v10-tpl:focus-visible .v10-tpl-pic {
  box-shadow:
    0 0 0 2px var(--color-app-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v10-canvas {
  display: grid;
  place-items: center;
  background:
    radial-gradient(
        color-mix(in oklch, var(--color-base-foreground) 16%, transparent) 1px,
        transparent 1.4px
      )
      0 0 / 14px 14px,
    var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v10-detail-media.v10-canvas {
  background-size: 22px 22px;
}
:root .proto-ui.proto-ui.proto-ui .v10-tpl.is-blank .v10-tpl-pic {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v10-tpl-pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v10-tpl-name {
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v10-tpl.is-on .v10-tpl-name {
  color: var(--color-base-foreground);
}
@media (max-width: 1240px) {
  :root .proto-ui.proto-ui.proto-ui .v10-split {
    gap: 48px;
  }
  :root .proto-ui.proto-ui.proto-ui .v10-detail {
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 20px;
  }
}
@media (max-width: 980px) {
  :root .proto-ui.proto-ui.proto-ui .v10-split {
    grid-template-columns: 1fr;
  }
  :root .proto-ui.proto-ui.proto-ui .v10-col:last-child {
    order: -1;
  }
}
@media (hover: none) {
  :root .proto-ui.proto-ui.proto-ui .v10-again {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v10-tpl-pic,
  :root .proto-ui.proto-ui.proto-ui .v10-again {
    transition: none;
  }
}
</style>
