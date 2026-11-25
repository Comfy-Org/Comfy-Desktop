<script setup lang="ts">
import { computed, ref } from 'vue'
import { Play, Plus, Search, X } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import CategoryChip from '../../CategoryChip.vue'
import MarSeg from '../../pages/MarSeg.vue'
import { allWorkflows, type ProjectWorkflow } from '../../../gallery'
import { activeInstance } from '../../../useProto'
import { thumb } from '../../../mock'
import { MOCK } from '../../assets/mock'
import { closeCreate, openTemplate, openWorkflow, startBlank } from '../createScreen'
import { readiness, SHELVES, type Starter } from '../createStarters'
import { buildOf, hueOf, readyIcon, useEscapeCloses } from './lookKitB'
import ResultsB from './ResultsB.vue'

const query = ref('')
const field = ref<HTMLInputElement>()
const results = ref<InstanceType<typeof ResultsB>>()
const shelf = ref(SHELVES[0]!.id)
const shelfOptions = SHELVES.map((s) => ({ value: s.id, label: s.label }))

const recents = computed(() => [...allWorkflows.value].sort((a, b) => a.age - b.age).slice(0, 6))
const starters = computed(() =>
  (SHELVES.find((s) => s.id === shelf.value) ?? SHELVES[0]!).starters().slice(0, 6)
)
const chosenId = ref<string | null>(null)
const chosen = computed<Starter>(
  () => starters.value.find((s) => s.id === chosenId.value) ?? starters.value[0]!
)
const chosenReady = computed(() => readiness(chosen.value.template))

const lastOutput = (w: ProjectWorkflow): string | undefined =>
  MOCK[w.name] ?? (w.thumbId ? thumb(w.thumbId) : undefined)

function key(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (query.value) query.value = ''
    else closeCreate()
    return
  }
  if (query.value.trim()) results.value?.key(e)
}

useEscapeCloses(() => field.value)
</script>

<template>
  <section class="v10 relative min-h-full px-8 pb-12" aria-label="Create">
    <header class="v10-head">
      <label class="v10-field">
        <Search :size="16" class="shrink-0 text-subtle-foreground" />
        <input
          ref="field"
          v-model="query"
          type="text"
          placeholder="Search your workflows, templates and nodes"
          aria-label="Search your workflows, templates and nodes"
          @keydown="key"
        />
        <button
          v-if="query"
          type="button"
          class="v10-icon"
          aria-label="Clear"
          @click="((query = ''), field?.focus())"
        >
          <X :size="13" />
        </button>
      </label>
      <button type="button" class="v10-icon v10-close" aria-label="Close" @click="closeCreate">
        <X :size="16" />
      </button>
    </header>

    <ResultsB v-if="query.trim()" ref="results" :query class="v10-results" />

    <div v-else class="v10-split">
      <section class="v10-col is-yours" aria-labelledby="v10-yours">
        <h2 id="v10-yours" class="v10-h">Pick up where you left off</h2>
        <p class="v10-sub">Your latest workflows, with what they made last time.</p>
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
                <span class="truncate text-[14px] font-medium text-base-foreground">{{
                  w.name
                }}</span>
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
        <p v-else class="v10-none">
          Nothing yet. What you open or save shows up here, ready to run again.
        </p>
      </section>

      <section class="v10-col is-new" aria-labelledby="v10-new">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="v10-new" class="v10-h">Start something new</h2>
            <p class="v10-sub">Templates that already work. Pick one to see what it needs.</p>
          </div>
        </div>
        <div class="v10-shelves">
          <MarSeg v-model="shelf" :options="shelfOptions" label="Templates for" />
        </div>

        <div class="v10-detail">
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
            <span class="absolute top-2.5 left-2.5"><CategoryChip :category="chosen.media" /></span>
          </button>
          <div class="v10-detail-text">
            <p class="text-heading font-semibold text-base-foreground">{{ chosen.makes }}</p>
            <p class="text-ui text-subtle-foreground">{{ chosen.model }}</p>
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

        <div :key="shelf" class="v10-grid">
          <button
            v-for="s in starters"
            :key="s.id"
            type="button"
            class="v10-tpl"
            :class="s.id === chosen.id && 'is-on'"
            :aria-pressed="s.id === chosen.id"
            @pointerenter="chosenId = s.id"
            @focus="chosenId = s.id"
            @click="chosenId === s.id ? openTemplate(s.template) : (chosenId = s.id)"
          >
            <span class="v10-tpl-pic"><img :src="s.poster" alt="" loading="lazy" /></span>
            <span class="v10-tpl-name">{{ s.makes }}</span>
          </button>
        </div>

        <button
          type="button"
          class="v10-blank"
          :title="`Empty canvas on ${activeInstance.name}`"
          @click="startBlank"
        >
          <Plus :size="14" />
          <span class="font-medium text-base-foreground">Blank canvas</span>
          <span class="text-subtle-foreground"
            >Build it node by node on {{ activeInstance.name }}</span
          >
        </button>
      </section>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v10 {
  isolation: isolate;
}
:root .proto-ui.proto-ui.proto-ui .v10-head {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 1280px;
  margin: 0 auto;
  padding-top: 24px;
}
:root .proto-ui.proto-ui.proto-ui .v10-field {
  display: flex;
  height: 44px;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 12px;
  padding: 0 10px 0 16px;
  border-radius: 999px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v10-field:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v10-field input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-base-foreground);
  font: inherit;
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
:root .proto-ui.proto-ui.proto-ui .v10-close {
  width: 36px;
  height: 36px;
}
:root .proto-ui.proto-ui.proto-ui .v10-results {
  max-width: 1000px;
  margin: 28px auto 0;
}
:root .proto-ui.proto-ui.proto-ui .v10-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
  gap: 0;
  max-width: 1280px;
  margin: 24px auto 0;
  overflow: hidden;
  border-radius: 20px;
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v10-col {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 28px;
}
:root .proto-ui.proto-ui.proto-ui .v10-col.is-yours {
  background: color-mix(in oklch, var(--color-base-foreground) 3%, transparent);
  box-shadow: inset -1px 0 0 var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v10-h {
  color: var(--color-base-foreground);
  font-size: var(--text-title);
  font-weight: 650;
  letter-spacing: -0.015em;
  line-height: var(--text-title--line-height);
}
:root .proto-ui.proto-ui.proto-ui .v10-sub {
  margin-top: 4px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v10-recents {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 20px;
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
  gap: 14px;
  padding: 8px;
  border-radius: 14px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v10-recent-open:focus-visible {
  box-shadow: inset 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v10-recent-pic {
  width: 104px;
  height: 68px;
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
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v10-again:hover {
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v10-none {
  margin-top: 20px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v10-shelves {
  margin-top: 16px;
  overflow-x: auto;
  scrollbar-width: none;
}
:root .proto-ui.proto-ui.proto-ui .v10-detail {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 20px;
  margin-top: 16px;
}
:root .proto-ui.proto-ui.proto-ui .v10-detail-media {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: 14px;
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
  padding: 4px 0;
}
:root .proto-ui.proto-ui.proto-ui .v10-line {
  display: -webkit-box;
  margin-top: 10px;
  overflow: hidden;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  line-height: 19px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
:root .proto-ui.proto-ui.proto-ui .v10-ready {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding-top: 12px;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v10-ready.is-ready svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v10-use {
  height: 38px;
  margin-top: 12px;
  padding: 0 18px;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: var(--text-ui);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v10-use:hover {
  background: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v10-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  margin-top: 16px;
}
:root .proto-ui.proto-ui.proto-ui .v10-tpl {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v10-tpl-pic {
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 10px;
  background: var(--color-card-background);
  opacity: 0.62;
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
:root .proto-ui.proto-ui.proto-ui .v10-blank {
  display: flex;
  height: 44px;
  align-items: center;
  gap: 10px;
  margin-top: 20px;
  padding: 0 14px;
  border-radius: 12px;
  outline: 1px dashed var(--color-border-strong);
  outline-offset: -1px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .v10-blank:hover {
  background: var(--color-secondary-background);
}
@media (max-width: 1100px) {
  :root .proto-ui.proto-ui.proto-ui .v10-split {
    grid-template-columns: 1fr;
  }
  :root .proto-ui.proto-ui.proto-ui .v10-col.is-yours {
    box-shadow: inset 0 -1px 0 var(--color-border-default);
  }
  :root .proto-ui.proto-ui.proto-ui .v10-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v10-tpl-pic {
    transition: none;
  }
}
</style>
