<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowUpRight, Plus, Search, X } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { allWorkflows } from '../../../gallery'
import { activeInstance } from '../../../useProto'
import { closeCreate, openTemplate, openWorkflow, startBlank } from '../createScreen'
import { readiness } from '../createStarters'
import { buildOf, OUTPUTS, readyIcon, useEscapeCloses, type Output } from './lookKitB'
import ResultsB from './ResultsB.vue'

type Filter = 'all' | 'image' | 'edit' | 'video' | 'upscale' | '3d' | 'yours'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'image', label: 'Images' },
  { value: 'edit', label: 'Edits' },
  { value: 'video', label: 'Video' },
  { value: 'upscale', label: 'Upscale' },
  { value: '3d', label: '3D and characters' },
  { value: 'yours', label: 'Your workflows' }
]

function filterOf(o: Output): Filter {
  const m = o.starter.makes.toLowerCase()
  if (o.starter.media === 'video') return 'video'
  if (o.starter.media === '3d' || m.includes('angle')) return '3d'
  if (m.includes('upscale')) return 'upscale'
  if (m.includes('edit') || m.includes('background')) return 'edit'
  return 'image'
}

const query = ref('')
const field = ref<HTMLInputElement>()
const results = ref<InstanceType<typeof ResultsB>>()
const filter = ref<Filter>('all')

const tiles = computed(() =>
  filter.value === 'all' ? OUTPUTS : OUTPUTS.filter((o) => filterOf(o) === filter.value)
)
const recents = computed(() => [...allWorkflows.value].sort((a, b) => a.age - b.age).slice(0, 12))

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
  <section class="v09 relative min-h-full px-8 pb-20" aria-label="Create">
    <header class="v09-head">
      <div class="v09-head-row">
        <h1 class="v09-title">Make something like this</h1>
        <label class="v09-field">
          <Search :size="15" class="shrink-0 text-subtle-foreground" />
          <input
            ref="field"
            v-model="query"
            type="text"
            placeholder="Search templates, workflows and nodes"
            aria-label="Search templates, workflows and nodes"
            @keydown="key"
          />
          <button
            v-if="query"
            type="button"
            class="v09-icon"
            aria-label="Clear"
            @click="((query = ''), field?.focus())"
          >
            <X :size="13" />
          </button>
        </label>
        <button
          type="button"
          class="v09-blank"
          :title="`Empty canvas on ${activeInstance.name}`"
          @click="startBlank"
        >
          <Plus :size="15" />Blank canvas
        </button>
        <button type="button" class="v09-icon v09-close" aria-label="Close" @click="closeCreate">
          <X :size="16" />
        </button>
      </div>
      <div v-if="!query.trim()" class="v09-chips" aria-label="Show">
        <button
          v-for="f in FILTERS"
          :key="f.value"
          type="button"
          class="v09-chip"
          :class="filter === f.value && 'is-on'"
          :aria-pressed="filter === f.value"
          @click="filter = f.value"
        >
          {{ f.label }}
        </button>
      </div>
    </header>

    <ResultsB v-if="query.trim()" ref="results" :query class="v09-results" />

    <div v-else-if="filter === 'yours'" :key="filter" class="v09-wall">
      <button
        v-for="(w, i) in recents"
        :key="w.id"
        type="button"
        class="v09-tile"
        :class="i % 3 === 0 && 'is-tall'"
        @click="openWorkflow(w)"
      >
        <span class="v09-pic"><WorkflowCover :name="w.name" /></span>
        <span class="v09-cap">
          <span class="v09-made">{{ w.name }}</span>
          <span class="v09-model">{{ buildOf(w)?.name }}, {{ w.modified.toLowerCase() }}</span>
        </span>
        <span class="v09-panel">
          <span class="v09-make">Open <ArrowUpRight :size="14" /></span>
        </span>
      </button>
    </div>

    <div v-else :key="filter" class="v09-wall">
      <button
        v-for="(o, i) in tiles"
        :key="o.id"
        type="button"
        class="v09-tile"
        :class="o.tall && 'is-tall'"
        :style="{ '--i': i }"
        :aria-label="`Make this with ${o.starter.makes}`"
        @click="openTemplate(o.starter.template)"
      >
        <span class="v09-pic">
          <img :src="o.src" alt="" loading="lazy" />
          <video
            v-if="o.clip"
            :src="o.clip"
            :poster="o.src"
            muted
            loop
            playsinline
            autoplay
            class="motion-reduce:hidden"
          />
        </span>
        <span class="v09-cap">
          <span class="v09-made">Made with {{ o.starter.makes }}</span>
          <span class="v09-model">{{ o.starter.model }}</span>
        </span>
        <span class="v09-panel">
          <span
            v-for="r in [readiness(o.starter.template)]"
            :key="r.label"
            class="v09-ready"
            :class="`is-${r.tone}`"
          >
            <component :is="readyIcon(r)" v-if="r.tone !== 'off'" :size="12" />
            {{ r.label }}
          </span>
          <span class="v09-make">Make this <ArrowUpRight :size="14" /></span>
        </span>
      </button>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v09 {
  isolation: isolate;
}
:root .proto-ui.proto-ui.proto-ui .v09-head {
  position: sticky;
  top: 0;
  z-index: 3;
  margin: 0 -32px;
  padding: 20px 32px 14px;
  background: var(--color-app-background);
  box-shadow: 0 10px 14px -6px var(--color-app-background);
}
:root .proto-ui.proto-ui.proto-ui .v09-head-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
:root .proto-ui.proto-ui.proto-ui .v09-title {
  margin-right: auto;
  color: var(--color-base-foreground);
  font-size: var(--text-title);
  font-weight: 650;
  letter-spacing: -0.015em;
}
:root .proto-ui.proto-ui.proto-ui .v09-field {
  display: flex;
  width: 340px;
  height: 38px;
  align-items: center;
  gap: 10px;
  padding: 0 8px 0 14px;
  border-radius: 999px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v09-field:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v09-field input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-base-foreground);
  font: inherit;
}
:root .proto-ui.proto-ui.proto-ui .v09-icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v09-icon:hover {
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v09-close {
  width: 36px;
  height: 36px;
}
:root .proto-ui.proto-ui.proto-ui .v09-blank {
  display: inline-flex;
  height: 38px;
  align-items: center;
  gap: 7px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v09-blank:hover {
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v09-chips {
  display: flex;
  gap: 6px;
  margin-top: 16px;
  overflow-x: auto;
  scrollbar-width: none;
}
:root .proto-ui.proto-ui.proto-ui .v09-chip {
  height: 32px;
  flex: none;
  padding: 0 14px;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v09-chip:hover {
  color: var(--color-base-foreground);
  box-shadow: inset 0 0 0 1px var(--color-border-strong);
}
:root .proto-ui.proto-ui.proto-ui .v09-chip.is-on,
:root .proto-ui.proto-ui.proto-ui .v09-chip.is-on:hover {
  background: var(--color-inverted-background);
  box-shadow: none;
  color: var(--color-inverted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v09-results {
  max-width: 1000px;
  margin: 16px auto 0;
}
:root .proto-ui.proto-ui.proto-ui .v09-wall {
  columns: 4 240px;
  column-gap: 12px;
  margin-top: 8px;
}
:root .proto-ui.proto-ui.proto-ui .v09-tile {
  position: relative;
  display: block;
  width: 100%;
  margin-bottom: 12px;
  overflow: hidden;
  border-radius: 16px;
  background: var(--color-card-background);
  text-align: left;
  outline: none;
  break-inside: avoid;
  animation: v09-in 500ms var(--ease-out-expo) both;
  animation-delay: calc(min(var(--i, 0), 12) * 30ms);
}
:root .proto-ui.proto-ui.proto-ui .v09-tile:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-app-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v09-pic {
  position: relative;
  display: block;
  aspect-ratio: 1;
}
:root .proto-ui.proto-ui.proto-ui .v09-tile.is-tall .v09-pic {
  aspect-ratio: 3 / 4;
}
:root .proto-ui.proto-ui.proto-ui .v09-tile:nth-child(4n + 3):not(.is-tall) .v09-pic {
  aspect-ratio: 4 / 3;
}
:root .proto-ui.proto-ui.proto-ui .v09-pic > img,
:root .proto-ui.proto-ui.proto-ui .v09-pic > video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 700ms var(--ease-out-expo);
}
:root .proto-ui.proto-ui.proto-ui .v09-tile:hover .v09-pic > *,
:root .proto-ui.proto-ui.proto-ui .v09-tile:focus-visible .v09-pic > * {
  transform: scale(1.035);
}
:root .proto-ui.proto-ui.proto-ui .v09-cap {
  position: absolute;
  inset: auto 0 0;
  display: flex;
  flex-direction: column;
  padding: 40px 14px 12px;
  background: linear-gradient(to top, var(--color-media-overlay), transparent);
  color: white;
  text-shadow: 0 1px 2px oklch(0 0 0 / 0.35);
  transition: opacity 200ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v09-made {
  overflow: hidden;
  font-size: var(--text-ui);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v09-model {
  font-size: 12px;
  opacity: 0.72;
}
:root .proto-ui.proto-ui.proto-ui .v09-panel {
  position: absolute;
  inset: auto 8px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 12px;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-card-background) 88%, transparent);
  box-shadow: var(--shadow-popover);
  backdrop-filter: blur(var(--blur-glass));
  opacity: 0;
  transform: translateY(8px);
  transition:
    opacity 200ms ease,
    transform 260ms var(--ease-out-expo);
}
:root .proto-ui.proto-ui.proto-ui .v09-tile:hover .v09-panel,
:root .proto-ui.proto-ui.proto-ui .v09-tile:focus-visible .v09-panel {
  opacity: 1;
  transform: none;
}
:root .proto-ui.proto-ui.proto-ui .v09-tile:hover .v09-cap,
:root .proto-ui.proto-ui.proto-ui .v09-tile:focus-visible .v09-cap {
  opacity: 0;
}
:root .proto-ui.proto-ui.proto-ui .v09-ready {
  display: inline-flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  color: var(--color-base-foreground);
  font-size: 12px;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v09-ready.is-ready svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v09-make {
  display: inline-flex;
  height: 30px;
  flex: none;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: 12px;
  font-weight: 600;
}
@keyframes v09-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v09-tile {
    animation: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v09-pic > *,
  :root .proto-ui.proto-ui.proto-ui .v09-panel {
    transition: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v09-tile:hover .v09-pic > * {
    transform: none;
  }
}
</style>
