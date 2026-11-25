<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import {
  ArrowRight,
  AudioLines,
  Box,
  Check,
  Download,
  Image as ImageIcon,
  Maximize2,
  Plus,
  Search,
  Video,
  Wand2,
  X
} from 'lucide-vue-next'
import { activeInstance } from '../../../useProto'
import { closeCreate, openTemplate, openWorkflow, startBlank } from '../createScreen'
import { readiness, type Starter } from '../createStarters'
import Button from '../../../ui/Button.vue'
import LookAResults from './LookAResults.vue'
import { buildOf, shelfStarters, sortedWorkflows, useCreateEscape, useCreateSearch } from './lookA'

interface Intent {
  id: string
  label: string
  ask: string
  icon: Component
}

const INTENTS: Intent[] = [
  { id: 'image', label: 'Image', ask: 'an image from words', icon: ImageIcon },
  { id: 'video', label: 'Video', ask: 'a video', icon: Video },
  { id: 'edit', label: 'Edit', ask: 'a change to a photo', icon: Wand2 },
  { id: 'upscale', label: 'Upscale', ask: 'a sharper, bigger picture', icon: Maximize2 },
  { id: '3d', label: '3D', ask: 'a 3D model', icon: Box },
  { id: 'audio', label: 'Audio', ask: 'music or a voice', icon: AudioLines }
]

const TONE_ORDER = { ready: 0, fetch: 1, off: 2 } as const

const query = ref('')
const field = ref<HTMLInputElement>()
const search = useCreateSearch(query)
useCreateEscape(field, false)

const picked = ref<string | null>(null)
const pool = Object.fromEntries(INTENTS.map((i) => [i.id, shelfStarters(i.id, 6)])) as Record<
  string,
  Starter[]
>
const pickedIntent = computed(() => INTENTS.find((i) => i.id === picked.value))
const best = computed(() =>
  picked.value
    ? [...pool[picked.value]!]
        .sort(
          (a, b) => TONE_ORDER[readiness(a.template).tone] - TONE_ORDER[readiness(b.template).tone]
        )
        .slice(0, 4)
    : []
)
const focusedId = ref<string | null>(null)
const focused = computed(() => best.value.find((s) => s.id === focusedId.value) ?? best.value[0])
const recents = computed(() => sortedWorkflows.value.slice(0, 4))

function choose(id: string): void {
  picked.value = picked.value === id ? null : id
  focusedId.value = null
}
</script>

<template>
  <section class="v01 relative min-h-full px-8 pb-16" aria-label="Create">
    <button type="button" class="v01-close" aria-label="Close" title="Close" @click="closeCreate">
      <X :size="16" />
    </button>

    <div class="relative mx-auto flex w-full max-w-280 flex-col">
      <header class="v01-head">
        <h1 class="v01-ask">What do you want to make?</h1>
        <div class="v01-tools">
          <label class="v01-field">
            <Search :size="15" class="shrink-0 text-subtle-foreground" />
            <input
              ref="field"
              v-model="query"
              type="text"
              placeholder="Search templates, workflows, nodes"
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
          <button
            type="button"
            class="v01-blank"
            :title="`Empty canvas on ${activeInstance.name}`"
            @click="startBlank"
          >
            <Plus :size="15" />Blank canvas
          </button>
        </div>
      </header>

      <LookAResults v-if="search.q.value" :search :query class="mt-8" />

      <template v-else>
        <div
          class="v01-intents"
          :class="picked && 'is-narrow'"
          role="tablist"
          data-no-pill
          aria-label="Outcome"
        >
          <button
            v-for="(intent, i) in INTENTS"
            :key="intent.id"
            type="button"
            role="tab"
            class="v01-intent group"
            :class="picked === intent.id && 'is-on'"
            :aria-selected="picked === intent.id"
            :style="{ '--i': i }"
            @click="choose(intent.id)"
          >
            <span class="v01-mosaic" aria-hidden="true">
              <span
                v-for="(s, j) in pool[intent.id]!.slice(0, 3)"
                :key="s.id"
                class="v01-tile"
                :style="{ '--j': j }"
              >
                <img :src="s.poster" alt="" loading="lazy" />
                <video
                  v-if="s.clip && j === 0"
                  :src="s.clip"
                  :poster="s.poster"
                  muted
                  loop
                  playsinline
                  autoplay
                />
              </span>
            </span>
            <span class="v01-intent-text">
              <component :is="intent.icon" :size="16" class="v01-intent-icon" />
              <span class="v01-intent-label">{{ intent.label }}</span>
            </span>
          </button>
        </div>

        <section v-if="pickedIntent" :key="pickedIntent.id" class="v01-reveal">
          <h2 class="v01-reveal-title">Best ways to make {{ pickedIntent.ask }}</h2>
          <div class="v01-split">
            <div class="v01-list" role="group" :aria-label="`Templates for ${pickedIntent.label}`">
              <button
                v-for="(s, i) in best"
                :key="s.id"
                type="button"
                class="v01-row"
                :class="focused?.id === s.id && 'is-on'"
                :aria-current="focused?.id === s.id"
                :style="{ '--i': i }"
                @pointerenter="focusedId = s.id"
                @focus="focusedId = s.id"
                @click="openTemplate(s.template)"
              >
                <img :src="s.poster" alt="" loading="lazy" class="v01-row-pic" />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-body font-medium text-base-foreground">{{
                    s.makes
                  }}</span>
                  <span class="truncate text-ui text-subtle-foreground">{{ s.model }}</span>
                </span>
                <ArrowRight :size="14" class="v01-row-go" />
              </button>
            </div>
            <aside v-if="focused" class="v01-pane" aria-live="polite">
              <div class="v01-pane-media">
                <img :key="focused.poster" :src="focused.poster" alt="" />
                <video
                  v-if="focused.clip"
                  :key="focused.clip"
                  :src="focused.clip"
                  :poster="focused.poster"
                  muted
                  loop
                  playsinline
                  autoplay
                />
              </div>
              <div class="v01-pane-body">
                <p class="text-heading font-medium text-base-foreground">{{ focused.makes }}</p>
                <p class="mt-1 text-ui text-muted-foreground">{{ focused.line }}.</p>
                <div class="v01-pane-foot">
                  <span
                    v-for="r in [readiness(focused.template)]"
                    :key="r.label"
                    class="v01-ready"
                    :class="`is-${r.tone}`"
                  >
                    <Check v-if="r.tone === 'ready'" :size="14" />
                    <Download v-else-if="r.tone === 'fetch'" :size="14" />
                    <span>
                      {{ r.tone === 'ready' ? `Ready to run on ${activeInstance.name}` : r.label }}
                    </span>
                  </span>
                  <Button variant="primary" size="lg" @click="openTemplate(focused.template)">
                    Use template
                  </Button>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <p v-else class="v01-hint">
          Pick one to see the templates that do it best, and what each needs to run.
        </p>

        <section v-if="recents.length" class="v01-recents">
          <h2 class="text-ui text-subtle-foreground">Or pick up where you left off</h2>
          <div class="v01-recent-list">
            <button
              v-for="w in recents"
              :key="w.id"
              type="button"
              class="v01-recent"
              @click="openWorkflow(w)"
            >
              <span class="truncate text-body text-base-foreground">{{ w.name }}</span>
              <span class="shrink-0 text-ui text-subtle-foreground">
                {{ buildOf(w)?.name }} · {{ w.modified }}
              </span>
            </button>
          </div>
        </section>
      </template>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v01 {
  isolation: isolate;
}
:root .proto-ui.proto-ui.proto-ui .v01-close {
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
:root .proto-ui.proto-ui.proto-ui .v01-close:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v01-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px 32px;
  padding-top: clamp(48px, 9vh, 96px);
}
:root .proto-ui.proto-ui.proto-ui .v01-ask {
  max-width: 14ch;
  color: var(--color-base-foreground);
  font-size: clamp(40px, 5.2vw, 64px);
  font-weight: 650;
  line-height: 1;
  letter-spacing: -0.035em;
}
:root .proto-ui.proto-ui.proto-ui .v01-tools {
  display: flex;
  gap: 8px;
  padding-bottom: 4px;
}
:root .proto-ui.proto-ui.proto-ui .v01-field {
  display: flex;
  width: 300px;
  height: 40px;
  align-items: center;
  gap: 10px;
  padding: 0 12px 0 14px;
  border-radius: 999px;
  background: var(--color-secondary-background);
  transition: box-shadow 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v01-field:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v01-field input {
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
:root .proto-ui.proto-ui.proto-ui .v01-field input::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v01-blank {
  display: inline-flex;
  height: 40px;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  border-radius: 999px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v01-blank:hover {
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v01-intents {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 40px;
}
:root .proto-ui.proto-ui.proto-ui .v01-intents.is-narrow {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}
:root .proto-ui.proto-ui.proto-ui .v01-intent {
  position: relative;
  height: 196px;
  overflow: hidden;
  border-radius: 16px;
  background: var(--color-card-background);
  text-align: left;
  outline: none;
  animation: v01-rise 560ms var(--mar-ease, ease-out) both;
  animation-delay: calc(60ms + var(--i) * 50ms);
  transition:
    height 360ms var(--mar-ease, ease-out),
    opacity 240ms ease,
    box-shadow 200ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v01-intents.is-narrow .v01-intent {
  height: 88px;
  border-radius: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v01-intents.is-narrow .v01-intent:not(.is-on) {
  opacity: 0.55;
}
:root .proto-ui.proto-ui.proto-ui .v01-intents.is-narrow .v01-intent:not(.is-on):hover {
  opacity: 0.9;
}
:root .proto-ui.proto-ui.proto-ui .v01-intent:focus-visible,
:root .proto-ui.proto-ui.proto-ui .v01-intent.is-on {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v01-mosaic {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 2fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 2px;
}
:root .proto-ui.proto-ui.proto-ui .v01-tile {
  position: relative;
  overflow: hidden;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v01-tile:first-child {
  grid-row: span 2;
}
:root .proto-ui.proto-ui.proto-ui .v01-tile img,
:root .proto-ui.proto-ui.proto-ui .v01-tile video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v01-tile img {
  animation: v01-drift 14s ease-in-out infinite alternate;
  animation-delay: calc(var(--j) * -4s);
}
:root .proto-ui.proto-ui.proto-ui .v01-intent::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    var(--color-media-overlay),
    color-mix(in oklch, var(--color-media-overlay) 30%, transparent) 55%,
    transparent
  );
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v01-intent-text {
  position: absolute;
  inset: auto 0 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 20px;
  color: white;
}
:root .proto-ui.proto-ui.proto-ui .v01-intent-label {
  font-size: 28px;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1;
}
:root .proto-ui.proto-ui.proto-ui .v01-intents.is-narrow .v01-intent-text {
  padding: 12px 14px;
}
:root .proto-ui.proto-ui.proto-ui .v01-intents.is-narrow .v01-intent-label {
  font-size: var(--text-heading);
}
:root .proto-ui.proto-ui.proto-ui .v01-hint {
  margin-top: 20px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-body);
}
:root .proto-ui.proto-ui.proto-ui .v01-reveal {
  margin-top: 36px;
  animation: v01-rise 420ms var(--mar-ease, ease-out) both;
}
:root .proto-ui.proto-ui.proto-ui .v01-reveal-title {
  margin-bottom: 14px;
  color: var(--color-base-foreground);
  font-size: var(--text-title);
  font-weight: 600;
  letter-spacing: -0.01em;
}
:root .proto-ui.proto-ui.proto-ui .v01-split {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  gap: 16px;
  align-items: start;
}
:root .proto-ui.proto-ui.proto-ui .v01-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
:root .proto-ui.proto-ui.proto-ui .v01-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 14px 8px 8px;
  border-radius: 12px;
  text-align: left;
  outline: none;
  animation: v01-rise 420ms var(--mar-ease, ease-out) both;
  animation-delay: calc(var(--i) * 50ms);
  transition: background-color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v01-row.is-on {
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v01-row:focus-visible {
  box-shadow: inset 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v01-row-pic {
  width: 96px;
  height: 64px;
  flex: none;
  border-radius: 8px;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v01-row-go {
  flex: none;
  color: var(--color-subtle-foreground);
  opacity: 0;
  transition: opacity 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v01-row.is-on .v01-row-go {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v01-pane {
  overflow: hidden;
  border-radius: 16px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v01-pane-media {
  position: relative;
  aspect-ratio: 16 / 7;
  overflow: hidden;
  background: var(--color-card-background);
}
:root .proto-ui.proto-ui.proto-ui .v01-pane-media img,
:root .proto-ui.proto-ui.proto-ui .v01-pane-media video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  animation: v01-fade 260ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .v01-pane-body {
  padding: 16px 18px 18px;
}
:root .proto-ui.proto-ui.proto-ui .v01-pane-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
}
:root .proto-ui.proto-ui.proto-ui .v01-ready {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-muted-foreground);
  font-size: var(--text-body);
}
:root .proto-ui.proto-ui.proto-ui .v01-ready.is-ready svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v01-recents {
  margin-top: 48px;
}
:root .proto-ui.proto-ui.proto-ui .v01-recent-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 32px;
  margin-top: 8px;
}
:root .proto-ui.proto-ui.proto-ui .v01-recent {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border-default);
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .v01-recent:hover span:first-child {
  text-decoration: underline;
  text-underline-offset: 3px;
}
@keyframes v01-rise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
}
@keyframes v01-fade {
  from {
    opacity: 0;
  }
}
@keyframes v01-drift {
  from {
    transform: scale(1.02) translate(0, 0);
  }
  to {
    transform: scale(1.12) translate(-2%, -1.5%);
  }
}
@media (max-width: 960px) {
  :root .proto-ui.proto-ui.proto-ui .v01-intents,
  :root .proto-ui.proto-ui.proto-ui .v01-intents.is-narrow {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  :root .proto-ui.proto-ui.proto-ui .v01-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v01-intent,
  :root .proto-ui.proto-ui.proto-ui .v01-reveal,
  :root .proto-ui.proto-ui.proto-ui .v01-row,
  :root .proto-ui.proto-ui.proto-ui .v01-pane-media img,
  :root .proto-ui.proto-ui.proto-ui .v01-tile img {
    animation: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v01-intent {
    transition: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v01 video {
    display: none;
  }
}
</style>
