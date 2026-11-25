<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowUpRight, Check, Download, Search, X } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { allWorkflows } from '../../../gallery'
import { activeInstance } from '../../../useProto'
import { closeCreate, openTemplate, openWorkflow, startBlank } from '../createScreen'
import { readiness, searchStarters, SHELVES, type Starter } from '../createStarters'
import { CATEGORY_WIRE, costLine, useCloseOnEsc, type CategoryId } from './lookD'

interface Field {
  id: CategoryId
  word: string
  span: string
  starters: Starter[]
}

const LAYOUT: { id: CategoryId; word: string; span: string }[] = [
  { id: 'video', word: 'Move', span: 'v18-w7' },
  { id: 'image', word: 'Imagine', span: 'v18-w5' },
  { id: 'edit', word: 'Edit', span: 'v18-w4' },
  { id: 'upscale', word: 'Sharpen', span: 'v18-w4' },
  { id: '3d', word: 'Sculpt', span: 'v18-w6' },
  { id: 'audio', word: 'Listen', span: 'v18-w6' }
]

const fields = computed<Field[]>(() =>
  LAYOUT.map((f) => ({
    ...f,
    starters: (SHELVES.find((s) => s.id === f.id)?.starters() ?? []).slice(0, 3)
  }))
)
const labelOf = (id: CategoryId): string => SHELVES.find((s) => s.id === id)?.label ?? id
const wireOf = (s: Starter): string =>
  CATEGORY_WIRE[
    s.media === 'video'
      ? 'video'
      : s.media === '3d'
        ? '3d'
        : s.media === 'audio'
          ? 'audio'
          : 'image'
  ]

const query = ref('')
const field = ref<HTMLInputElement>()
const q = computed(() => query.value.trim().toLowerCase())
const results = computed(() => (q.value ? searchStarters(q.value, 8) : []))
const myHits = computed(() =>
  q.value
    ? allWorkflows.value.filter((w) => w.name.toLowerCase().includes(q.value)).slice(0, 4)
    : []
)
const recents = computed(() => [...allWorkflows.value].sort((a, b) => a.age - b.age).slice(0, 5))

const focus = ref<Record<string, Starter | undefined>>({})
const at = ref(0)

function key(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (query.value) query.value = ''
    else closeCreate()
  } else if (q.value && e.key === 'ArrowDown')
    at.value = Math.min(results.value.length - 1, at.value + 1)
  else if (q.value && e.key === 'ArrowUp') at.value = Math.max(0, at.value - 1)
  else if (e.key === 'Enter' && q.value) {
    const s = results.value[at.value]
    if (s) openTemplate(s.template)
    else startBlank()
  } else return
  e.preventDefault()
}

useCloseOnEsc(field)
</script>

<template>
  <section class="v18" aria-label="Create">
    <button type="button" class="v18-close" aria-label="Close" title="Close" @click="closeCreate">
      <X :size="18" />
    </button>

    <div class="v18-wrap">
      <header class="v18-head">
        <h1 class="v18-title">What are we<br />making today?</h1>
        <label class="v18-field">
          <Search :size="22" class="shrink-0" />
          <input
            ref="field"
            v-model="query"
            type="text"
            placeholder="Try “video”, “logo”, “upscale”"
            aria-label="Search templates and workflows"
            @keydown="key"
            @input="at = 0"
          />
          <button
            v-if="query"
            type="button"
            class="v18-clear"
            aria-label="Clear search"
            @click="((query = ''), field?.focus())"
          >
            <X :size="16" />
          </button>
        </label>
      </header>

      <div v-if="!q" class="v18-bento">
        <div
          v-for="(f, fi) in fields"
          :key="f.id"
          class="v18-color"
          :class="f.span"
          :style="{ '--wire': CATEGORY_WIRE[f.id], '--fi': fi }"
          @pointerleave="focus[f.id] = undefined"
        >
          <p class="v18-kicker">{{ labelOf(f.id) }}</p>
          <p class="v18-word" aria-hidden="true">{{ f.word }}</p>
          <div class="v18-stack" role="group" :aria-label="`${labelOf(f.id)} templates`">
            <button
              v-for="(s, i) in f.starters"
              :key="s.id"
              type="button"
              class="v18-card"
              :style="{ '--n': i - (f.starters.length - 1) / 2, '--z': f.starters.length - i }"
              :aria-label="`${s.makes}, ${s.model}`"
              @pointerenter="focus[f.id] = s"
              @focus="focus[f.id] = s"
              @blur="focus[f.id] = undefined"
              @click="openTemplate(s.template)"
            >
              <img :src="s.poster" alt="" loading="lazy" />
            </button>
          </div>
          <div class="v18-info" :class="focus[f.id] && 'is-on'" aria-live="polite">
            <template v-for="s in [focus[f.id]]" :key="s?.id ?? 'none'">
              <template v-if="s">
                <p class="v18-info-name">
                  {{ s.makes }} <span>with {{ s.model }}</span>
                </p>
                <p v-for="r in [readiness(s.template)]" :key="r.label" class="v18-info-ready">
                  <Check v-if="r.tone === 'ready'" :size="13" />
                  <Download v-else-if="r.tone === 'fetch'" :size="13" />
                  {{ r.label }}
                </p>
                <p class="v18-info-cost">{{ costLine(s.template) }}</p>
              </template>
            </template>
          </div>
        </div>

        <button
          type="button"
          class="v18-blank v18-w4"
          :title="`Empty canvas on ${activeInstance.name}`"
          :style="{ '--v18-in': CATEGORY_WIRE.image, '--v18-out': CATEGORY_WIRE.upscale }"
          @click="startBlank"
        >
          <svg class="v18-node" viewBox="0 0 220 150" aria-hidden="true">
            <path class="v18-wire-in" d="M0 92 C30 92 30 80 56 80" />
            <g class="v18-arm">
              <path d="M164 70 C184 70 188 40 200 26" />
              <circle cx="200" cy="26" r="7" />
            </g>
            <rect x="56" y="34" width="108" height="86" rx="16" class="v18-node-body" />
            <rect x="56" y="34" width="108" height="26" rx="13" class="v18-node-head" />
            <circle cx="72" cy="47" r="4" class="v18-node-dot" />
            <g class="v18-eyes">
              <circle cx="96" cy="88" r="5" />
              <circle cx="124" cy="88" r="5" />
            </g>
            <path d="M100 103 Q110 110 120 103" class="v18-smile" />
            <circle cx="56" cy="80" r="5" class="v18-slot" />
            <circle cx="164" cy="70" r="5" class="v18-slot" />
          </svg>
          <span class="v18-blank-text">
            <b>Blank canvas</b>
            <span>Wire it up yourself, node by node.</span>
          </span>
        </button>
      </div>

      <div v-else class="v18-results">
        <button
          v-for="(s, i) in results"
          :key="s.id"
          type="button"
          class="v18-hit"
          :class="at === i && 'is-at'"
          :style="{ '--wire': wireOf(s) }"
          @pointerenter="at = i"
          @click="openTemplate(s.template)"
        >
          <span class="v18-hit-pic"><img :src="s.poster" alt="" loading="lazy" /></span>
          <span class="v18-hit-name">{{ s.makes }}</span>
          <span class="v18-hit-model">{{ s.model }}</span>
          <span v-if="at === i" class="v18-hit-ready">
            {{ readiness(s.template).label }}. {{ costLine(s.template) }}
          </span>
          <ArrowUpRight :size="18" class="v18-hit-go" />
        </button>
        <button
          v-for="w in myHits"
          :key="w.id"
          type="button"
          class="v18-hit is-mine"
          @click="openWorkflow(w)"
        >
          <span class="v18-hit-pic"><WorkflowCover :name="w.name" /></span>
          <span class="v18-hit-name">{{ w.name }}</span>
          <span class="v18-hit-model">Your workflow, {{ w.modified.toLowerCase() }}</span>
          <ArrowUpRight :size="18" class="v18-hit-go" />
        </button>
        <div v-if="!results.length && !myHits.length" class="v18-none">
          <p>Nothing called “{{ query.trim() }}” yet.</p>
          <button type="button" class="v18-none-go" @click="startBlank">
            Start on a blank canvas
          </button>
        </div>
      </div>

      <section v-if="!q && recents.length" class="v18-recent">
        <h2 class="v18-h2">Back to it</h2>
        <div class="v18-recent-row">
          <button
            v-for="(w, i) in recents"
            :key="w.id"
            type="button"
            class="v18-wf"
            :style="{ '--r': (i % 2 ? 1 : -1) * 1.5 }"
            @click="openWorkflow(w)"
          >
            <span class="v18-wf-cover"><WorkflowCover :name="w.name" /></span>
            <span class="v18-wf-name">{{ w.name }}</span>
          </button>
        </div>
      </section>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v18 {
  position: relative;
  min-height: 100%;
  padding: 0 32px 72px;
  overflow-x: hidden;
}
:root .proto-ui.proto-ui.proto-ui .v18-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 5;
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 999px;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v18-close:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v18-wrap {
  max-width: 1200px;
  margin: 0 auto;
}
:root .proto-ui.proto-ui.proto-ui .v18-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
  padding: 48px 0 28px;
}
:root .proto-ui.proto-ui.proto-ui .v18-title {
  color: var(--color-base-foreground);
  font-size: clamp(48px, 6.2vw, 84px);
  font-weight: 800;
  line-height: 0.92;
  letter-spacing: -0.045em;
}
:root .proto-ui.proto-ui.proto-ui .v18-field {
  display: flex;
  height: 64px;
  width: min(440px, 40%);
  flex: none;
  align-items: center;
  gap: 12px;
  padding: 0 14px 0 22px;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  transition: transform 200ms var(--mar-ease, ease-out);
}
:root .proto-ui.proto-ui.proto-ui .v18-field:focus-within {
  box-shadow:
    0 0 0 3px var(--color-content-background),
    0 0 0 5px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v18-field input {
  height: auto;
  min-width: 0;
  flex: 1;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  box-shadow: none;
  color: inherit;
  font: inherit;
  font-size: 18px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v18-field input::placeholder {
  color: color-mix(in oklch, var(--color-inverted-foreground) 50%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .v18-clear {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 999px;
}
:root .proto-ui.proto-ui.proto-ui .v18-bento {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-auto-rows: 250px;
  gap: 14px;
}
:root .proto-ui.proto-ui.proto-ui .v18-w4 {
  grid-column: span 4;
}
:root .proto-ui.proto-ui.proto-ui .v18-w5 {
  grid-column: span 5;
}
:root .proto-ui.proto-ui.proto-ui .v18-w6 {
  grid-column: span 6;
}
:root .proto-ui.proto-ui.proto-ui .v18-w7 {
  grid-column: span 7;
}
:root .proto-ui.proto-ui.proto-ui .v18-color {
  --ink: color-mix(in oklch, var(--wire) 18%, black);
  position: relative;
  overflow: hidden;
  border-radius: 28px;
  background: var(--wire);
  container-type: inline-size;
  order: calc(var(--fi) * 2);
  color: var(--ink);
  animation: v18-pop 560ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  animation-delay: calc(var(--fi) * 60ms);
}
:root .proto-ui.proto-ui.proto-ui .v18-kicker {
  position: absolute;
  top: 22px;
  left: 26px;
  font-size: 14px;
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v18-word {
  position: absolute;
  bottom: 4px;
  left: 20px;
  font-size: min(19cqi, 100px);
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.055em;
  pointer-events: none;
  transition:
    transform 400ms var(--mar-ease, ease-out),
    opacity 240ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v18-color:hover .v18-word,
:root .proto-ui.proto-ui.proto-ui .v18-color:focus-within .v18-word {
  transform: translateY(-6px);
}
:root .proto-ui.proto-ui.proto-ui .v18-color:has(.v18-info.is-on) .v18-word {
  opacity: 0;
  transform: translateY(24px);
}
:root .proto-ui.proto-ui.proto-ui .v18-stack {
  position: absolute;
  top: 26px;
  right: max(112px, 14cqi);
  width: 104px;
  height: 132px;
}
:root .proto-ui.proto-ui.proto-ui .v18-card {
  position: absolute;
  inset: 0;
  z-index: var(--z);
  overflow: hidden;
  border-radius: 14px;
  background: var(--color-card-background);
  box-shadow:
    0 0 0 3px color-mix(in oklch, white 85%, var(--wire)),
    0 18px 30px -14px color-mix(in oklch, var(--ink) 80%, transparent);
  outline: none;
  transform: rotate(calc(var(--n) * 7deg)) translateX(calc(var(--n) * 10px));
  transition: transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
:root .proto-ui.proto-ui.proto-ui .v18-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v18-color:hover .v18-card,
:root .proto-ui.proto-ui.proto-ui .v18-color:focus-within .v18-card {
  transform: rotate(calc(var(--n) * 9deg)) translateX(calc(var(--n) * 84px))
    translateY(calc(var(--n) * var(--n) * 14px));
}
:root .proto-ui.proto-ui.proto-ui .v18-color .v18-card:hover,
:root .proto-ui.proto-ui.proto-ui .v18-color .v18-card:focus-visible {
  z-index: 9;
  transform: rotate(0deg) translateX(calc(var(--n) * 84px)) translateY(-10px) scale(1.08);
}
:root .proto-ui.proto-ui.proto-ui .v18-card:focus-visible {
  box-shadow:
    0 0 0 3px var(--ink),
    0 18px 30px -14px color-mix(in oklch, var(--ink) 80%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .v18-info {
  position: absolute;
  inset: auto auto 20px 26px;
  max-width: 38%;
  z-index: 10;
  opacity: 0;
  transform: translateY(8px);
  transition:
    opacity 180ms ease,
    transform 240ms var(--mar-ease, ease-out);
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v18-info.is-on {
  opacity: 1;
  transform: none;
}
:root .proto-ui.proto-ui.proto-ui .v18-info-name {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
:root .proto-ui.proto-ui.proto-ui .v18-info-name span {
  font-weight: 500;
  opacity: 0.7;
}
:root .proto-ui.proto-ui.proto-ui .v18-info-ready {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  font-size: 13px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v18-info-cost {
  font-size: 12px;
  opacity: 0.75;
}
:root .proto-ui.proto-ui.proto-ui .v18-blank {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  padding: 16px 24px 22px;
  border-radius: 28px;
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
  text-align: left;
  outline: 2px dashed color-mix(in oklch, var(--color-base-foreground) 18%, transparent);
  outline-offset: -8px;
  order: 7;
  transition: background-color 200ms ease;
  animation: v18-pop 560ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  animation-delay: 300ms;
}
:root .proto-ui.proto-ui.proto-ui .v18-blank:hover {
  background: var(--color-secondary-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v18-blank:focus-visible {
  outline: 2px solid var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v18-node {
  width: 200px;
  height: 136px;
  overflow: visible;
  align-self: center;
}
:root .proto-ui.proto-ui.proto-ui .v18-node path {
  fill: none;
  stroke-width: 4;
  stroke-linecap: round;
}
:root .proto-ui.proto-ui.proto-ui .v18-wire-in {
  stroke: var(--v18-in);
}
:root .proto-ui.proto-ui.proto-ui .v18-arm path {
  stroke: var(--v18-out);
}
:root .proto-ui.proto-ui.proto-ui .v18-arm circle {
  fill: var(--v18-out);
}
:root .proto-ui.proto-ui.proto-ui .v18-arm {
  transform-box: view-box;
  transform-origin: 164px 70px;
  animation: v18-wave 1.6s ease-in-out infinite;
}
:root .proto-ui.proto-ui.proto-ui .v18-node-body {
  fill: var(--color-card-background);
  stroke: color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
  stroke-width: 1.5;
}
:root .proto-ui.proto-ui.proto-ui .v18-node-head {
  fill: color-mix(in oklch, var(--color-base-foreground) 8%, var(--color-card-background));
}
:root .proto-ui.proto-ui.proto-ui .v18-node-dot {
  fill: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v18-eyes circle {
  fill: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v18-eyes {
  transform-box: fill-box;
  transform-origin: center;
  animation: v18-blink 4s ease-in-out infinite;
}
:root .proto-ui.proto-ui.proto-ui .v18 .v18-smile {
  stroke: var(--color-base-foreground);
  stroke-width: 3;
}
:root .proto-ui.proto-ui.proto-ui .v18-slot {
  fill: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v18-blank-text {
  display: flex;
  flex-direction: column;
}
:root .proto-ui.proto-ui.proto-ui .v18-blank-text b {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.03em;
}
:root .proto-ui.proto-ui.proto-ui .v18-blank-text span {
  color: var(--color-muted-foreground);
  font-size: 14px;
}
:root .proto-ui.proto-ui.proto-ui .v18-results {
  display: flex;
  flex-direction: column;
}
:root .proto-ui.proto-ui.proto-ui .v18-hit {
  --wire: var(--color-secondary-background-hover);
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) auto;
  grid-template-rows: auto auto auto;
  align-items: center;
  column-gap: 20px;
  padding: 12px 20px 12px 12px;
  border-radius: 22px;
  text-align: left;
  transition: background-color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v18-hit.is-at {
  --ink: color-mix(in oklch, var(--wire) 18%, black);
  background: var(--wire);
  color: var(--ink);
}
:root .proto-ui.proto-ui.proto-ui .v18-hit.is-mine:hover {
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v18-hit-pic {
  position: relative;
  grid-row: span 3;
  width: 96px;
  height: 72px;
  overflow: hidden;
  border-radius: 14px;
  transform: rotate(-3deg);
}
:root .proto-ui.proto-ui.proto-ui .v18-hit-pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v18-hit-name {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--ink, var(--color-base-foreground));
}
:root .proto-ui.proto-ui.proto-ui .v18-hit-model {
  color: var(--ink, var(--color-muted-foreground));
  font-size: 14px;
  opacity: 0.8;
}
:root .proto-ui.proto-ui.proto-ui .v18-hit-ready {
  font-size: 13px;
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v18-hit-go {
  grid-column: 3;
  grid-row: 1 / span 3;
}
:root .proto-ui.proto-ui.proto-ui .v18-none {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
  padding: 24px 12px;
  color: var(--color-muted-foreground);
  font-size: 18px;
}
:root .proto-ui.proto-ui.proto-ui .v18-none-go {
  height: 48px;
  padding: 0 22px;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-weight: 700;
}
:root .proto-ui.proto-ui.proto-ui .v18-recent {
  margin-top: 48px;
}
:root .proto-ui.proto-ui.proto-ui .v18-h2 {
  color: var(--color-base-foreground);
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.03em;
}
:root .proto-ui.proto-ui.proto-ui .v18-recent-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16px;
  margin-top: 16px;
}
:root .proto-ui.proto-ui.proto-ui .v18-wf {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .v18-wf-cover {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: 16px;
  transform: rotate(calc(var(--r) * 1deg));
  transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
:root .proto-ui.proto-ui.proto-ui .v18-wf:hover .v18-wf-cover,
:root .proto-ui.proto-ui.proto-ui .v18-wf:focus-visible .v18-wf-cover {
  transform: rotate(0deg) scale(1.03);
}
:root .proto-ui.proto-ui.proto-ui .v18-wf-name {
  overflow: hidden;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@keyframes v18-pop {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(12px);
  }
}
@keyframes v18-wave {
  0%,
  100% {
    transform: rotate(0deg);
  }
  20% {
    transform: rotate(-22deg);
  }
  40% {
    transform: rotate(8deg);
  }
  60% {
    transform: rotate(-18deg);
  }
  80% {
    transform: rotate(4deg);
  }
}
@keyframes v18-blink {
  0%,
  92%,
  100% {
    transform: scaleY(1);
  }
  95% {
    transform: scaleY(0.1);
  }
}
@media (max-width: 1000px) {
  :root .proto-ui.proto-ui.proto-ui .v18-bento > * {
    grid-column: span 6;
  }
  :root .proto-ui.proto-ui.proto-ui .v18-head {
    flex-direction: column;
    align-items: stretch;
  }
  :root .proto-ui.proto-ui.proto-ui .v18-field {
    width: 100%;
  }
  :root .proto-ui.proto-ui.proto-ui .v18-recent-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v18-color,
  :root .proto-ui.proto-ui.proto-ui .v18-blank,
  :root .proto-ui.proto-ui.proto-ui .v18-arm,
  :root .proto-ui.proto-ui.proto-ui .v18-eyes {
    animation: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v18-card,
  :root .proto-ui.proto-ui.proto-ui .v18-word,
  :root .proto-ui.proto-ui.proto-ui .v18-wf-cover {
    transition: none;
  }
}
</style>
