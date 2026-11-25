<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowUpRight, Check, Download, Plus, Search, TrendingUp, X } from 'lucide-vue-next'
import CategoryChip from '../../CategoryChip.vue'
import MarSeg from '../../pages/MarSeg.vue'
import { activeInstance } from '../../../useProto'
import { thumb } from '../../../mock'
import { closeCreate, openTemplate, openWorkflow, startBlank } from '../createScreen'
import { readiness, SHELVES, starterOf, type Starter } from '../createStarters'
import { HUB_WORKFLOWS } from '../../explore/hubWorkflows'
import LookAResults from './LookAResults.vue'
import {
  buildOf,
  playIn,
  runsThisWeek,
  shelfStarters,
  sortedWorkflows,
  stopIn,
  useCreateEscape,
  useCreateSearch
} from './lookA'

const AREAS = ['f', 'a', 'd', 'e', 'g', 'h', 'i']

const query = ref('')
const field = ref<HTMLInputElement>()
const search = useCreateSearch(query)
useCreateEscape(field)

const shelf = ref(SHELVES[0]!.id)
const shelfOptions = SHELVES.map((s) => ({ value: s.id, label: s.label }))
const tiles = computed(() => shelfStarters(shelf.value, 7))
const latest = computed(() => sortedWorkflows.value[0])
const trending = HUB_WORKFLOWS.filter((w) => w.sizeGb > 0)
  .sort((a, b) => b.usage - a.usage)
  .slice(0, 5)
  .map((w) => ({ starter: starterOf(w), runs: runsThisWeek(w.usage) }))

const readyText = (s: Starter): string => {
  const r = readiness(s.template)
  return r.tone === 'ready' ? `Ready to run on ${activeInstance.value.name}` : r.label
}
</script>

<template>
  <section class="v03 relative min-h-full px-8 pb-16" aria-label="Create">
    <button type="button" class="v03-close" aria-label="Close" title="Close" @click="closeCreate">
      <X :size="16" />
    </button>

    <div class="relative mx-auto flex w-full max-w-280 flex-col">
      <header class="v03-head">
        <h1 class="text-display font-semibold tracking-[-0.025em] text-base-foreground">
          Create a workflow
        </h1>
        <label class="v03-field">
          <Search :size="16" class="shrink-0 text-subtle-foreground" />
          <input
            ref="field"
            v-model="query"
            type="text"
            placeholder="Search workflows, templates and nodes"
            aria-label="Search workflows, templates and nodes"
            @keydown="search.onKey"
          />
          <button
            v-if="query"
            type="button"
            class="text-subtle-foreground hover:text-base-foreground"
            aria-label="Clear search"
            @click="((query = ''), field?.focus())"
          >
            <X :size="14" />
          </button>
        </label>
      </header>

      <LookAResults v-if="search.q.value" :search :query class="mt-8" />

      <template v-else>
        <div class="v03-filter">
          <MarSeg v-model="shelf" :options="shelfOptions" label="Templates for" />
        </div>

        <div :key="shelf" class="v03-bento">
          <button
            v-for="(s, i) in tiles"
            :key="s.id"
            type="button"
            class="v03-tile v03-tpl group"
            :class="i === 0 && 'is-feature'"
            :style="{ gridArea: AREAS[i], '--i': i }"
            @click="openTemplate(s.template)"
            @pointerenter="playIn($event.currentTarget)"
            @pointerleave="stopIn($event.currentTarget)"
            @focus="playIn($event.currentTarget)"
            @blur="stopIn($event.currentTarget)"
          >
            <img :src="s.poster" alt="" loading="lazy" class="v03-pic" />
            <video
              v-if="s.clip"
              :src="s.clip"
              :poster="s.poster"
              muted
              loop
              playsinline
              preload="none"
              class="v03-pic v03-video"
            />
            <span class="v03-chip"><CategoryChip :category="s.media" /></span>
            <span class="v03-cap">
              <span class="v03-cap-title">{{ s.makes }}</span>
              <span class="v03-cap-model">{{ s.model }}</span>
              <span class="v03-more">
                <span class="v03-more-in">
                  <span v-if="i === 0" class="v03-line">{{ s.line }}.</span>
                  <span class="v03-ready" :class="`is-${readiness(s.template).tone}`">
                    <Check v-if="readiness(s.template).tone === 'ready'" :size="12" />
                    <Download v-else-if="readiness(s.template).tone === 'fetch'" :size="12" />
                    {{ readyText(s) }}
                  </span>
                </span>
              </span>
            </span>
          </button>

          <button
            v-if="latest"
            type="button"
            class="v03-tile v03-continue group"
            style="grid-area: c"
            @click="openWorkflow(latest)"
          >
            <span class="v03-continue-out">
              <img :src="thumb(latest.thumbId)" alt="" loading="lazy" />
            </span>
            <span class="v03-continue-text">
              <span class="text-ui text-muted-foreground">Continue where you left off</span>
              <span class="v03-continue-name">{{ latest.name }}</span>
              <span class="text-ui text-subtle-foreground">
                {{ buildOf(latest)?.name }} · {{ latest.modified }}
              </span>
              <span class="v03-open">Open <ArrowUpRight :size="14" /></span>
            </span>
          </button>
          <div v-else class="v03-tile v03-continue is-empty" style="grid-area: c">
            <span class="v03-continue-text">
              <span class="v03-continue-name">Your workflows land here</span>
              <span class="text-ui text-subtle-foreground">
                Open a template and the last one you worked on comes back to this spot.
              </span>
            </span>
          </div>

          <button
            type="button"
            class="v03-tile v03-blank"
            style="grid-area: b"
            :title="`Empty canvas on ${activeInstance.name}`"
            @click="startBlank"
          >
            <span class="v03-blank-plus"><Plus :size="20" /></span>
            <span class="text-body font-medium text-base-foreground">Blank canvas</span>
            <span class="text-ui text-subtle-foreground">Empty, on {{ activeInstance.name }}</span>
          </button>

          <section class="v03-tile v03-trend" style="grid-area: t" aria-label="Trending this week">
            <h2 class="v03-trend-head">
              <TrendingUp :size="15" />
              Trending this week
            </h2>
            <ol class="v03-trend-list">
              <li v-for="(t, i) in trending" :key="t.starter.id">
                <button
                  type="button"
                  class="v03-trend-row"
                  @click="openTemplate(t.starter.template)"
                >
                  <span class="v03-rank">{{ i + 1 }}</span>
                  <img :src="t.starter.poster" alt="" loading="lazy" />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-ui font-medium text-base-foreground">{{
                      t.starter.makes
                    }}</span>
                    <span class="truncate text-[11px] text-subtle-foreground">
                      {{ t.starter.model }} · {{ t.runs }} runs
                    </span>
                  </span>
                </button>
              </li>
            </ol>
          </section>
        </div>
      </template>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v03 {
  isolation: isolate;
}
:root .proto-ui.proto-ui.proto-ui .v03-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 8px;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v03-close:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v03-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px 32px;
  padding-top: clamp(40px, 7vh, 72px);
}
:root .proto-ui.proto-ui.proto-ui .v03-field {
  display: flex;
  width: min(440px, 100%);
  height: 44px;
  align-items: center;
  gap: 10px;
  padding: 0 14px 0 16px;
  border-radius: 12px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v03-field:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v03-field input {
  height: auto;
  min-width: 0;
  flex: 1;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  box-shadow: none;
  color: var(--color-base-foreground);
  font: inherit;
  font-size: var(--text-body);
}
:root .proto-ui.proto-ui.proto-ui .v03-field input::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v03-filter {
  margin-top: 28px;
  overflow-x: auto;
  scrollbar-width: none;
}
:root .proto-ui.proto-ui.proto-ui .v03-bento {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: repeat(4, 176px);
  grid-template-areas:
    'f f c c'
    'f f b t'
    'a d e t'
    'g g h i';
  gap: 10px;
  margin-top: 14px;
}
:root .proto-ui.proto-ui.proto-ui .v03-tile {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border-radius: 18px;
  background: var(--color-card-background);
  text-align: left;
  outline: none;
  animation: v03-in 520ms var(--mar-ease, ease-out) both;
  animation-delay: calc(var(--i, 3) * 40ms);
}
:root .proto-ui.proto-ui.proto-ui button.v03-tile:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v03-pic {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition:
    transform 700ms var(--mar-ease, ease-out),
    opacity 300ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v03-video {
  opacity: 0;
}
:root .proto-ui.proto-ui.proto-ui .v03-tpl:hover .v03-pic,
:root .proto-ui.proto-ui.proto-ui .v03-tpl:focus-visible .v03-pic {
  transform: scale(1.03);
}
:root .proto-ui.proto-ui.proto-ui .v03-tpl:hover .v03-video,
:root .proto-ui.proto-ui.proto-ui .v03-tpl:focus-visible .v03-video {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v03-tpl::after {
  content: '';
  position: absolute;
  inset: 45% 0 0;
  background: linear-gradient(to top, var(--color-media-overlay), transparent);
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v03-chip {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 1;
}
:root .proto-ui.proto-ui.proto-ui .v03-cap {
  position: absolute;
  inset: auto 0 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  padding: 14px 16px 16px;
  color: white;
}
:root .proto-ui.proto-ui.proto-ui .v03-cap-title {
  overflow: hidden;
  font-size: var(--text-body);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v03-tpl.is-feature .v03-cap {
  padding: 22px 24px 24px;
}
:root .proto-ui.proto-ui.proto-ui .v03-tpl.is-feature .v03-cap-title {
  font-size: 30px;
  line-height: 1.05;
  letter-spacing: -0.025em;
}
:root .proto-ui.proto-ui.proto-ui .v03-cap-model {
  font-size: 12px;
  opacity: 0.72;
}
:root .proto-ui.proto-ui.proto-ui .v03-more {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows 320ms var(--mar-ease, ease-out),
    opacity 220ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v03-more-in {
  display: flex;
  min-height: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  overflow: hidden;
}
:root .proto-ui.proto-ui.proto-ui .v03-tpl:hover .v03-more,
:root .proto-ui.proto-ui.proto-ui .v03-tpl:focus-visible .v03-more {
  grid-template-rows: 1fr;
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v03-line {
  max-width: 46ch;
  padding-top: 8px;
  font-size: var(--text-ui);
  line-height: 19px;
  opacity: 0.86;
}
:root .proto-ui.proto-ui.proto-ui .v03-ready {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  font-size: 12px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v03-ready.is-ready svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v03-continue {
  display: grid;
  grid-template-columns: 1fr 1fr;
  background: var(--color-secondary-background);
  transition: background-color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v03-continue:hover {
  background: var(--color-secondary-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v03-continue.is-empty {
  display: flex;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v03-continue-out {
  position: relative;
  grid-row: span 2;
  margin: 10px 0 10px 10px;
  overflow: hidden;
  border-radius: 10px;
}
:root .proto-ui.proto-ui.proto-ui .v03-continue-out img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v03-continue-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: flex-end;
  gap: 2px;
  padding: 18px 20px;
}
:root .proto-ui.proto-ui.proto-ui .v03-continue-name {
  overflow: hidden;
  color: var(--color-base-foreground);
  font-size: var(--text-title);
  font-weight: 600;
  line-height: var(--text-title--line-height);
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v03-open {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v03-blank {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 2px;
  padding: 18px 20px;
  background-color: var(--color-secondary-background);
  background-image: radial-gradient(
    color-mix(in oklch, var(--color-base-foreground) 14%, transparent) 1px,
    transparent 1.5px
  );
  background-size: 16px 16px;
  transition: background-color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v03-blank:hover {
  background-color: var(--color-secondary-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v03-blank-plus {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  margin-bottom: auto;
  border-radius: 12px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v03-trend {
  display: flex;
  flex-direction: column;
  padding: 16px 12px 10px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v03-trend-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px 10px;
  color: var(--color-base-foreground);
  font-size: var(--text-body);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v03-trend-head svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v03-trend-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: space-between;
}
:root .proto-ui.proto-ui.proto-ui .v03-trend-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 6px;
  border-radius: 10px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v03-trend-row:hover,
:root .proto-ui.proto-ui.proto-ui .v03-trend-row:focus-visible {
  background: var(--color-secondary-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v03-trend-row img {
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 8px;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v03-rank {
  width: 14px;
  flex: none;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
@keyframes v03-in {
  from {
    opacity: 0;
    transform: scale(0.985);
  }
}
@media (max-width: 960px) {
  :root .proto-ui.proto-ui.proto-ui .v03-bento {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(8, 180px);
    grid-template-areas:
      'f f'
      'f f'
      'c c'
      'b t'
      'a t'
      'd e'
      'g g'
      'h i';
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v03-tile {
    animation: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v03-pic,
  :root .proto-ui.proto-ui.proto-ui .v03-more {
    transition: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v03-tpl:hover .v03-pic {
    transform: none;
  }
}
</style>
