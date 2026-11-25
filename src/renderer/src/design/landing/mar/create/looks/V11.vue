<script setup lang="ts">
import { computed, reactive, ref, type Component } from 'vue'
import { Check, Cloud, Cpu, Download, HardDrive, Plus, Search, X } from 'lucide-vue-next'
import Meter from '../../../ui/Meter.vue'
import MarSeg from '../../pages/MarSeg.vue'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { HUB_WORKFLOWS, type HubWorkflow } from '../../explore/hubWorkflows'
import { MACHINE } from '../../templateModal/templateData'
import { activeInstance } from '../../../useProto'
import { closeCreate, openTemplate, openWorkflow, startBlank } from '../createScreen'
import type { Starter } from '../createStarters'
import CSearch from './CSearch.vue'
import {
  buildOf,
  byUsage,
  fitOf,
  fmtGb,
  machineLabel,
  minutesLabel,
  playIn,
  recentWorkflows,
  starterFor,
  stopIn,
  useCreateKeys,
  type Band,
  type Fit
} from './cLooks'

type Media = 'all' | HubWorkflow['media']

const BAND_MAX = 6
const MEDIA_OPTIONS: { value: Media; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Video' },
  { value: '3d', label: '3D' },
  { value: 'audio', label: 'Audio' }
]

const BANDS: { id: Band; title: string; promise: string; icon: Component }[] = [
  {
    id: 'now',
    title: 'Runs now',
    promise: 'Every model is here. Free, opens in seconds.',
    icon: Check
  },
  {
    id: 'fetch',
    title: 'Runs after a download',
    promise: 'Download its models once, then it runs free.',
    icon: Download
  },
  {
    id: 'power',
    title: 'Needs more power',
    promise: `Over ${MACHINE.memGb} GB of memory, or a partner model. Runs on Comfy Cloud.`,
    icon: Cloud
  }
]

const query = ref('')
const media = ref<Media>('all')
const field = ref<HTMLInputElement>()
const results = ref<InstanceType<typeof CSearch>>()
const opened = ref<Band | null>(null)
useCreateKeys(field)

interface Row {
  starter: Starter
  fit: Fit
}

const rows = computed<Row[]>(() =>
  byUsage(HUB_WORKFLOWS)
    .filter((w) => media.value === 'all' || w.media === media.value)
    .map((w) => {
      const starter = starterFor(w)
      return { starter, fit: fitOf(starter.template) }
    })
)
const bandRows = (band: Band): Row[] => rows.value.filter((r) => r.fit.band === band)
const shown = (band: Band): Row[] =>
  opened.value === band ? bandRows(band) : bandRows(band).slice(0, BAND_MAX)
const focus = reactive<Partial<Record<Band, string>>>({})
const focusOf = (band: Band): Row | undefined =>
  bandRows(band).find((r) => r.starter.id === focus[band]) ?? bandRows(band)[0]

function detailNote(r: Row): string {
  if (r.fit.band === 'power' && r.fit.cloudCost)
    return `Runs on Comfy Cloud for ${r.fit.cloudCost} a run. Nothing to download.`
  if (r.fit.gb > MACHINE.diskFreeGb && r.fit.band === 'fetch')
    return `Downloads ${fmtGb(r.fit.gb)} once. Only ${fmtGb(MACHINE.diskFreeGb)} free on this Mac.`
  return r.fit.local.note || r.fit.local.status
}
const nowCount = computed(() => bandRows('now').length)
const recents = computed(() => recentWorkflows(4))

function costOf(r: Row): { value: string; note: string; warn?: boolean } {
  const { fit } = r
  if (fit.band === 'now') return { value: 'Free', note: 'Ready' }
  if (fit.band === 'power')
    return {
      value: fit.cloudCost || 'Cloud',
      note: fit.vramGb > MACHINE.memGb ? `needs ${fit.vramGb} GB` : 'partner model'
    }
  if (!fit.gb) return { value: 'Update', note: fit.local.status }
  return {
    value: fmtGb(fit.gb),
    note: minutesLabel(fit.minutes),
    warn: fit.gb > MACHINE.diskFreeGb
  }
}

function onKey(e: KeyboardEvent): void {
  if (results.value?.onKey(e)) return
  if (e.key === 'Escape') {
    e.preventDefault()
    closeCreate()
  }
}
</script>

<template>
  <section class="v11 relative min-h-full px-8 pb-20" aria-label="Create">
    <button type="button" class="v11-close" aria-label="Close" title="Close" @click="closeCreate">
      <X :size="16" />
    </button>

    <div class="mx-auto flex w-full max-w-300 flex-col">
      <header class="v11-head">
        <div class="v11-spec">
          <span class="v11-spec-chip"><Cpu :size="14" /></span>
          <span class="text-base-foreground">{{ MACHINE.name }}</span>
          <span>{{ machineLabel() }} memory</span>
          <span class="v11-spec-sep" />
          <HardDrive :size="13" />
          <span>{{ fmtGb(MACHINE.diskFreeGb) }} free</span>
          <span class="v11-spec-sep" />
          <span>{{ activeInstance.name }}</span>
        </div>
        <h1 class="v11-title">Your Mac can run {{ nowCount }} of these right now</h1>
        <p class="mt-2 text-body text-muted-foreground">
          Templates sorted by what this computer can do: ready, one download away, or too big for it
          and better on Comfy Cloud.
        </p>
        <div class="v11-bar">
          <label class="v11-field">
            <Search :size="16" class="shrink-0 text-subtle-foreground" />
            <input
              ref="field"
              v-model="query"
              type="text"
              placeholder="Search workflows, templates and nodes"
              aria-label="Search workflows, templates and nodes"
              @keydown="onKey"
            />
            <button
              v-if="query"
              type="button"
              class="v11-clear"
              aria-label="Clear search"
              @click="((query = ''), field?.focus())"
            >
              <X :size="14" />
            </button>
          </label>
          <button
            type="button"
            class="v11-blank"
            :title="`Empty canvas on ${activeInstance.name}`"
            @click="startBlank"
          >
            <Plus :size="15" />Blank canvas
          </button>
          <div v-if="!query" class="v11-seg">
            <MarSeg v-model="media" :options="MEDIA_OPTIONS" label="Show templates that make" />
          </div>
        </div>
      </header>

      <CSearch v-if="query.trim()" ref="results" :query class="mt-8" @clear="query = ''" />

      <template v-else>
        <div class="v11-bands">
          <section
            v-for="(b, bi) in BANDS"
            :key="b.id"
            class="v11-band"
            :class="`is-${b.id}`"
            :style="{ '--i': bi }"
            :aria-label="b.title"
          >
            <header class="v11-band-head">
              <span class="v11-band-icon"><component :is="b.icon" :size="14" /></span>
              <h2 class="text-heading font-semibold text-base-foreground">{{ b.title }}</h2>
              <span class="v11-band-count">{{ bandRows(b.id).length }}</span>
            </header>
            <p class="v11-band-promise">{{ b.promise }}</p>

            <p v-if="!bandRows(b.id).length" class="v11-band-empty">
              Nothing here for this kind of template.
            </p>

            <template v-for="(r, i) in shown(b.id)" :key="r.starter.id">
              <template v-if="i === 0">
                <button
                  type="button"
                  class="v11-lead group"
                  @pointerenter="(playIn($event.currentTarget), (focus[b.id] = r.starter.id))"
                  @pointerleave="stopIn($event.currentTarget)"
                  @focus="(playIn($event.currentTarget), (focus[b.id] = r.starter.id))"
                  @blur="stopIn($event.currentTarget)"
                  @click="openTemplate(r.starter.template)"
                >
                  <span class="v11-lead-media">
                    <img :src="r.starter.poster" alt="" />
                    <video
                      v-if="r.starter.clip"
                      :src="r.starter.clip"
                      :poster="r.starter.poster"
                      muted
                      loop
                      playsinline
                      preload="none"
                    />
                  </span>
                  <span class="v11-lead-text">
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-heading font-medium text-white">{{
                        r.starter.makes
                      }}</span>
                      <span class="block truncate text-ui text-white/70">{{
                        r.starter.model
                      }}</span>
                    </span>
                  </span>
                </button>
                <div
                  v-for="d in [focusOf(b.id)]"
                  :key="d?.starter.id ?? 'none'"
                  class="v11-detail"
                  aria-live="polite"
                >
                  <template v-if="d">
                    <div class="flex items-baseline justify-between gap-3">
                      <span class="truncate text-ui text-muted-foreground">{{
                        d.starter.makes
                      }}</span>
                      <span
                        v-for="c in [costOf(d)]"
                        :key="c.value"
                        class="v11-detail-cost"
                        :class="c.warn && 'is-warn'"
                        ><b>{{ c.value }}</b> {{ c.note }}</span
                      >
                    </div>
                    <div v-if="d.fit.vramGb" class="mt-2 flex items-center gap-2">
                      <Meter
                        :value="d.fit.vramGb"
                        :max="MACHINE.memGb"
                        class="flex-1"
                        :aria-label="`Needs ${d.fit.vramGb} of ${MACHINE.memGb} GB memory`"
                      />
                      <span class="shrink-0 text-[12px] text-subtle-foreground tabular-nums"
                        >{{ d.fit.vramGb }} of {{ MACHINE.memGb }} GB memory</span
                      >
                    </div>
                    <p class="mt-2 text-[12px] leading-[18px] text-subtle-foreground">
                      {{ detailNote(d) }}
                    </p>
                  </template>
                </div>
              </template>
              <button
                v-else
                type="button"
                class="v11-row"
                :class="focusOf(b.id)?.starter.id === r.starter.id && 'is-at'"
                @pointerenter="focus[b.id] = r.starter.id"
                @focus="focus[b.id] = r.starter.id"
                @click="openTemplate(r.starter.template)"
              >
                <img :src="r.starter.poster" alt="" class="v11-row-pic" loading="lazy" />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-ui font-medium text-base-foreground">{{
                    r.starter.makes
                  }}</span>
                  <span class="truncate text-ui text-subtle-foreground">{{ r.starter.model }}</span>
                </span>
              </button>
            </template>

            <button
              v-if="bandRows(b.id).length > BAND_MAX"
              type="button"
              class="v11-more"
              @click="opened = opened === b.id ? null : b.id"
            >
              {{ opened === b.id ? 'Show fewer' : `Show all ${bandRows(b.id).length}` }}
            </button>
          </section>
        </div>

        <section v-if="recents.length" class="mt-12" aria-label="Recent workflows">
          <h2 class="mb-3 text-ui text-subtle-foreground">Pick up where you left off</h2>
          <div class="v11-recents">
            <button
              v-for="w in recents"
              :key="w.id"
              type="button"
              class="v11-recent"
              @click="openWorkflow(w)"
            >
              <span class="v11-recent-cover"><WorkflowCover :name="w.name" /></span>
              <span class="flex min-w-0 flex-col text-left">
                <span class="truncate text-ui font-medium text-base-foreground">{{ w.name }}</span>
                <span class="truncate text-ui text-subtle-foreground"
                  >{{ buildOf(w)?.name }} · {{ w.modified }}</span
                >
              </span>
            </button>
          </div>
        </section>
      </template>
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
  z-index: 2;
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
:root .proto-ui.proto-ui.proto-ui .v11-head {
  padding-top: clamp(32px, 6vh, 64px);
  animation: v11-rise 480ms var(--mar-ease, ease-out) both;
}
:root .proto-ui.proto-ui.proto-ui .v11-spec {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 5px 14px 5px 5px;
  border-radius: 999px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v11-spec-chip {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v11-spec-sep {
  width: 1px;
  height: 12px;
  background: var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v11-title {
  margin-top: 20px;
  color: var(--color-base-foreground);
  font-size: 40px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.025em;
  font-variant-numeric: tabular-nums;
}
:root .proto-ui.proto-ui.proto-ui .v11-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 24px;
}
:root .proto-ui.proto-ui.proto-ui .v11-field {
  display: flex;
  height: 40px;
  width: 360px;
  max-width: 100%;
  align-items: center;
  gap: 10px;
  padding: 0 10px 0 14px;
  border-radius: var(--radius-control);
  background: var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v11-field:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v11-field input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-base-foreground);
  font: inherit;
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v11-field input::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v11-clear {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v11-blank {
  display: inline-flex;
  height: 40px;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  border-radius: var(--radius-control);
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v11-blank:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v11-seg {
  margin-left: auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
:root .proto-ui.proto-ui.proto-ui .v11-bands {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 28px;
}
:root .proto-ui.proto-ui.proto-ui .v11-band {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  padding: 16px 12px 12px;
  border-radius: var(--radius-panel);
  background: var(--color-card-background);
  animation: v11-rise 480ms var(--mar-ease, ease-out) both;
  animation-delay: calc(120ms + var(--i) * 90ms);
}
:root .proto-ui.proto-ui.proto-ui .v11-band-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 4px;
}
:root .proto-ui.proto-ui.proto-ui .v11-band-icon {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 999px;
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v11-band.is-now .v11-band-icon {
  background: color-mix(in oklch, var(--color-status-running) 22%, transparent);
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v11-band-count {
  margin-left: auto;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
  font-variant-numeric: tabular-nums;
}
:root .proto-ui.proto-ui.proto-ui .v11-band-promise {
  min-height: 40px;
  margin: 2px 4px 8px 38px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  line-height: 20px;
}
:root .proto-ui.proto-ui.proto-ui .v11-band-empty {
  padding: 24px 4px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v11-lead {
  position: relative;
  display: block;
  margin-bottom: 6px;
  overflow: hidden;
  border-radius: var(--radius-card);
  aspect-ratio: 2 / 1;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v11-lead:focus-visible,
:root .proto-ui.proto-ui.proto-ui .v11-row:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-card-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v11-lead-media img,
:root .proto-ui.proto-ui.proto-ui .v11-lead-media video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 600ms var(--mar-ease, ease-out);
}
:root .proto-ui.proto-ui.proto-ui .v11-lead-media video {
  opacity: 0;
  transition: opacity 300ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v11-lead:hover .v11-lead-media video,
:root .proto-ui.proto-ui.proto-ui .v11-lead:focus-visible .v11-lead-media video {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v11-lead:hover .v11-lead-media img {
  transform: scale(1.04);
}
:root .proto-ui.proto-ui.proto-ui .v11-lead::after {
  content: '';
  position: absolute;
  inset: 40% 0 0;
  background: linear-gradient(to top, var(--color-media-overlay), transparent);
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v11-lead-text {
  position: absolute;
  inset: auto 0 0;
  z-index: 1;
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 12px 14px;
}
:root .proto-ui.proto-ui.proto-ui .v11-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px;
  border-radius: 10px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v11-row:hover {
  background: var(--color-card-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v11-row-pic {
  width: 56px;
  height: 40px;
  flex: none;
  border-radius: 6px;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v11-row.is-at {
  background: var(--color-card-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v11-detail {
  margin: 0 0 8px;
  padding: 4px 8px 12px;
  border-bottom: 1px solid var(--color-border-default);
  animation: v11-fade 160ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .v11-detail-cost {
  flex: none;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
:root .proto-ui.proto-ui.proto-ui .v11-detail-cost b {
  color: var(--color-base-foreground);
  font-size: var(--text-heading);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v11-band.is-now .v11-detail-cost b {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v11-detail-cost.is-warn {
  color: var(--color-status-warning);
}
:root .proto-ui.proto-ui.proto-ui .v11-more {
  align-self: flex-start;
  margin: 6px 6px 0;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v11-more:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v11-recents {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v11-recent {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
  padding: 6px;
  border-radius: var(--radius-card);
}
:root .proto-ui.proto-ui.proto-ui .v11-recent:hover {
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v11-recent-cover {
  display: block;
  width: 64px;
  height: 44px;
  flex: none;
  overflow: hidden;
  border-radius: 8px;
  background: var(--color-card-background);
}
@keyframes v11-fade {
  from {
    opacity: 0;
  }
}
@keyframes v11-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
@media (max-width: 1100px) {
  :root .proto-ui.proto-ui.proto-ui .v11-bands {
    grid-template-columns: minmax(0, 1fr);
  }
  :root .proto-ui.proto-ui.proto-ui .v11-recents {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  :root .proto-ui.proto-ui.proto-ui .v11-seg {
    margin-left: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v11-head,
  :root .proto-ui.proto-ui.proto-ui .v11-detail,
  :root .proto-ui.proto-ui.proto-ui .v11-band {
    animation: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v11-lead-media img {
    transition: none;
    transform: none;
  }
}
</style>
