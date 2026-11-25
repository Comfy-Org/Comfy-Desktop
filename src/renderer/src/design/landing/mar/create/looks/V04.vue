<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronsLeftRight, Cloud, HardDrive, Plus, Search, X } from 'lucide-vue-next'
import Button from '../../../ui/Button.vue'
import { activeInstance } from '../../../useProto'
import { closeCreate, openTemplate, openWorkflow, startBlank } from '../createScreen'
import type { Starter } from '../createStarters'
import LookAResults from './LookAResults.vue'
import {
  buildOf,
  costOf,
  prefersReducedMotion,
  runOnCloud,
  shelfStarters,
  sortedWorkflows,
  useCreateEscape,
  useCreateSearch
} from './lookA'
import { inputOf } from './v04-inputs'
import { needsFor } from '../../templateModal/templateData'

const pool: Starter[] = (() => {
  const seen = new Set<string>()
  return [
    ...shelfStarters('popular'),
    ...shelfStarters('edit', 2),
    ...shelfStarters('upscale', 2),
    ...shelfStarters('image', 2)
  ]
    .filter((s) => !seen.has(s.id) && seen.add(s.id))
    .slice(0, 10)
})()

const query = ref('')
const field = ref<HTMLInputElement>()
const search = useCreateSearch(query)
useCreateEscape(field, false)

const pickedId = ref(pool[0]!.id)
const picked = computed(() => pool.find((s) => s.id === pickedId.value) ?? pool[0]!)
const input = computed(() => inputOf(picked.value))
const cost = computed(() => costOf(picked.value.template))
const files = computed(() => needsFor(picked.value.template))
const where = ref<'local' | 'cloud'>('local')
const split = ref(50)
const still = prefersReducedMotion()
const recents = computed(() => sortedWorkflows.value.slice(0, 4))

watch(
  cost,
  (c) => {
    where.value = c.local.tone !== 'ready' && c.cloud ? 'cloud' : 'local'
  },
  { immediate: true }
)
watch(pickedId, () => (split.value = 50))

const action = computed(() => {
  if (where.value === 'cloud')
    return cost.value.cloud?.signIn ? 'Sign in and run on Cloud' : 'Run on Cloud now'
  if (cost.value.local.tone === 'ready') return `Run on ${activeInstance.value.name}`
  if (cost.value.local.tone === 'fetch')
    return `Download ${cost.value.local.label.split(' · ')[0]} and open`
  return 'Open template'
})

function run(): void {
  if (where.value === 'cloud') runOnCloud(picked.value.template)
  else openTemplate(picked.value.template)
}

function pick(s: Starter): void {
  pickedId.value = s.id
  document
    .querySelector('.v04-stage')
    ?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
}
</script>

<template>
  <section class="v04 relative min-h-full px-8 pb-16" aria-label="Create">
    <button type="button" class="v04-close" aria-label="Close" title="Close" @click="closeCreate">
      <X :size="16" />
    </button>

    <div class="relative mx-auto flex w-full max-w-280 flex-col">
      <header class="v04-head">
        <div>
          <h1 class="text-display font-semibold tracking-[-0.025em] text-base-foreground">
            Create a workflow
          </h1>
          <p class="mt-1 text-body text-muted-foreground">
            See what goes in, what comes out, and what it takes to run, before you download
            anything.
          </p>
        </div>
        <div class="flex gap-2">
          <label class="v04-field">
            <Search :size="15" class="shrink-0 text-subtle-foreground" />
            <input
              ref="field"
              v-model="query"
              type="text"
              placeholder="Search"
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
          <Button
            variant="ghost"
            size="lg"
            :title="`Empty canvas on ${activeInstance.name}`"
            @click="startBlank"
          >
            <Plus :size="15" />Blank canvas
          </Button>
        </div>
      </header>

      <LookAResults v-if="search.q.value" :search :query class="mt-8" />

      <template v-else>
        <div class="v04-stage">
          <div class="v04-compare">
            <div class="v04-after">
              <img :key="picked.poster" :src="picked.poster" alt="" />
              <video
                v-if="picked.clip && !still"
                :key="picked.clip"
                :src="picked.clip"
                muted
                loop
                playsinline
                autoplay
              />
            </div>
            <div class="v04-before" :style="{ clipPath: `inset(0 ${100 - split}% 0 0)` }">
              <div v-if="input.kind === 'prompt'" class="v04-prompt">
                <p>{{ input.text }}</p>
              </div>
              <div v-else-if="input.look === 'still'" class="v04-prompt v04-still">
                <img :src="input.src" alt="" />
              </div>
              <img v-else :src="input.src" alt="" :class="`is-${input.look}`" />
            </div>
            <span class="v04-tag is-before">{{ input.label }}</span>
            <span class="v04-tag is-after">{{ picked.makes }}</span>
            <span class="v04-handle" :style="{ left: `${split}%` }">
              <span><ChevronsLeftRight :size="14" /></span>
            </span>
            <input
              v-model.number="split"
              type="range"
              min="0"
              max="100"
              aria-label="Compare what goes in with what comes out"
              class="v04-range"
            />
          </div>

          <aside class="v04-ledger" aria-live="polite">
            <p class="text-title font-semibold tracking-[-0.01em] text-base-foreground">
              {{ picked.makes }}
            </p>
            <p class="mt-1 text-ui text-muted-foreground">{{ picked.line }}. {{ picked.model }}.</p>

            <ul v-if="files.length" class="v04-files">
              <li v-for="f in files" :key="f.name">
                <span class="truncate">{{ f.name }}</span>
                <span class="shrink-0 tabular-nums">{{ f.size }}</span>
              </li>
              <li class="v04-files-total">
                <span>{{
                  cost.local.tone === 'ready' ? `Already on ${activeInstance.name}` : 'To download'
                }}</span>
                <span class="shrink-0 tabular-nums">{{
                  cost.local.tone === 'ready' ? '0 GB' : cost.local.label.split(' · ')[0]
                }}</span>
              </li>
            </ul>
            <p v-else class="v04-files-none">Nothing to download. It runs on partner models.</p>

            <div class="v04-options" role="radiogroup" data-no-pill aria-label="Where it runs">
              <button
                type="button"
                role="radio"
                class="v04-opt"
                :class="[where === 'local' && 'is-on', `is-${cost.local.tone}`]"
                :aria-checked="where === 'local'"
                @click="where = 'local'"
              >
                <span class="v04-opt-where"><HardDrive :size="14" />{{ activeInstance.name }}</span>
                <span class="v04-figure">
                  <template v-if="cost.local.tone === 'ready'">Ready</template>
                  <template v-else-if="cost.local.tone === 'fetch'">{{
                    cost.local.label.split(' · ')[0]
                  }}</template>
                  <template v-else>Not yet</template>
                </span>
                <span class="v04-opt-sub">
                  <template v-if="cost.local.tone === 'ready'">Nothing to download</template>
                  <template v-else-if="cost.local.tone === 'fetch'"
                    >~{{ cost.local.minutes }} min to download, once</template
                  >
                  <template v-else>{{ cost.local.label }}</template>
                </span>
              </button>
              <button
                v-if="cost.cloud"
                type="button"
                role="radio"
                class="v04-opt"
                :class="where === 'cloud' && 'is-on'"
                :aria-checked="where === 'cloud'"
                @click="where = 'cloud'"
              >
                <span class="v04-opt-where"><Cloud :size="14" />Comfy Cloud</span>
                <span class="v04-figure">Now</span>
                <span class="v04-opt-sub">
                  {{ cost.cloud.signIn ? 'Free credits to start' : `${cost.cloud.credits} a run` }}
                </span>
              </button>
            </div>

            <Button variant="primary" block class="v04-go" @click="run">{{ action }}</Button>
          </aside>
        </div>

        <div class="v04-grid" role="group" aria-label="Templates">
          <button
            v-for="s in pool"
            :key="s.id"
            type="button"
            class="v04-card"
            :class="s.id === pickedId && 'is-on'"
            :aria-current="s.id === pickedId"
            @click="pick(s)"
            @dblclick="openTemplate(s.template)"
          >
            <span class="v04-card-pic"><img :src="s.poster" alt="" loading="lazy" /></span>
            <span class="truncate text-ui font-medium text-base-foreground">{{ s.makes }}</span>
            <span class="truncate text-[12px] text-subtle-foreground">{{ s.model }}</span>
          </button>
        </div>

        <section v-if="recents.length" class="v04-recents">
          <h2 class="text-ui text-subtle-foreground">Your recent workflows</h2>
          <div class="v04-recent-row">
            <button
              v-for="w in recents"
              :key="w.id"
              type="button"
              class="v04-recent"
              @click="openWorkflow(w)"
            >
              <span class="truncate text-body text-base-foreground">{{ w.name }}</span>
              <span class="truncate text-ui text-subtle-foreground"
                >{{ buildOf(w)?.name }} · {{ w.modified }}</span
              >
            </button>
          </div>
        </section>
      </template>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v04 {
  isolation: isolate;
}
:root .proto-ui.proto-ui.proto-ui .v04-close {
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
:root .proto-ui.proto-ui.proto-ui .v04-close:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v04-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px 32px;
  padding-top: clamp(40px, 7vh, 72px);
}
:root .proto-ui.proto-ui.proto-ui .v04-field {
  display: flex;
  width: 240px;
  height: 36px;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v04-field:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v04-field input {
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
:root .proto-ui.proto-ui.proto-ui .v04-field input::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v04-stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 12px;
  margin-top: 28px;
  scroll-margin-top: 24px;
}
:root .proto-ui.proto-ui.proto-ui .v04-compare {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: 16px;
  background: var(--color-card-background);
  color: white;
}
:root .proto-ui.proto-ui.proto-ui .v04-after,
:root .proto-ui.proto-ui.proto-ui .v04-before {
  position: absolute;
  inset: 0;
}
:root .proto-ui.proto-ui.proto-ui .v04-after img,
:root .proto-ui.proto-ui.proto-ui .v04-after video,
:root .proto-ui.proto-ui.proto-ui .v04-before img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v04-before img.is-soft {
  filter: blur(5px) saturate(0.8) contrast(0.92);
  transform: scale(1.04);
}
:root .proto-ui.proto-ui.proto-ui .v04-before img.is-flat {
  filter: grayscale(1) contrast(0.9) brightness(0.92);
}
:root .proto-ui.proto-ui.proto-ui .v04-prompt {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding: 0 8% 0 6%;
  background: var(--color-card-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v04-prompt p {
  max-width: 22ch;
  font-size: clamp(20px, 2.2vw, 30px);
  font-weight: 500;
  line-height: 1.25;
  letter-spacing: -0.015em;
}
:root .proto-ui.proto-ui.proto-ui .v04-before .v04-still {
  justify-content: flex-start;
  padding: 0 0 0 8%;
}
:root .proto-ui.proto-ui.proto-ui .v04-before .v04-still img {
  position: relative;
  inset: auto;
  width: 36%;
  height: auto;
  aspect-ratio: 4 / 3;
  border-radius: 10px;
  box-shadow: 0 18px 40px -16px oklch(0 0 0 / 0.7);
  transform: rotate(-2deg);
}
:root .proto-ui.proto-ui.proto-ui .v04-files {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 20px;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v04-files li {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}
:root .proto-ui.proto-ui.proto-ui .v04-files-total {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border-default);
  color: var(--color-base-foreground);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v04-files-none {
  margin-top: 20px;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v04-tag {
  position: absolute;
  bottom: 14px;
  z-index: 2;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--color-media-overlay);
  color: white;
  font-size: 12px;
  font-weight: 500;
  backdrop-filter: blur(14px);
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v04-tag.is-before {
  left: 14px;
}
:root .proto-ui.proto-ui.proto-ui .v04-tag.is-after {
  right: 14px;
}
:root .proto-ui.proto-ui.proto-ui .v04-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  width: 2px;
  background: white;
  transform: translateX(-1px);
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v04-handle span {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 999px;
  background: white;
  color: black;
  transform: translate(-50%, -50%);
  box-shadow: 0 4px 18px oklch(0 0 0 / 0.35);
}
:root .proto-ui.proto-ui.proto-ui .v04-range {
  position: absolute;
  inset: 0;
  z-index: 3;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: ew-resize;
}
:root .proto-ui.proto-ui.proto-ui .v04-compare:has(.v04-range:focus-visible) {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v04-ledger {
  display: flex;
  flex-direction: column;
  padding: 20px;
  border-radius: 16px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v04-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  padding-top: 20px;
}
:root .proto-ui.proto-ui.proto-ui .v04-opt {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas:
    'where figure'
    'sub figure';
  align-items: center;
  gap: 2px 12px;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--color-card-background);
  text-align: left;
  outline: none;
  box-shadow: inset 0 0 0 1px transparent;
  transition:
    box-shadow 160ms ease,
    background-color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v04-opt:hover {
  background: var(--color-card-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v04-opt.is-on {
  box-shadow: inset 0 0 0 1.5px var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v04-opt:focus-visible {
  box-shadow: inset 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v04-opt-where {
  display: inline-flex;
  grid-area: where;
  align-items: center;
  gap: 6px;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v04-opt-sub {
  grid-area: sub;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v04-figure {
  grid-area: figure;
  color: var(--color-base-foreground);
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}
:root .proto-ui.proto-ui.proto-ui .v04-opt.is-ready .v04-figure {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v04-opt.is-off .v04-figure {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v04-go {
  height: 44px;
  margin-top: 14px;
  border-radius: 12px;
  font-size: var(--text-body);
}
:root .proto-ui.proto-ui.proto-ui .v04-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 18px 12px;
  margin-top: 28px;
}
:root .proto-ui.proto-ui.proto-ui .v04-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v04-card-pic {
  position: relative;
  aspect-ratio: 16 / 10;
  margin-bottom: 8px;
  overflow: hidden;
  border-radius: 12px;
  background: var(--color-card-background);
  transition: box-shadow 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v04-card-pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.82;
  transition: opacity 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v04-card:hover .v04-card-pic img,
:root .proto-ui.proto-ui.proto-ui .v04-card.is-on .v04-card-pic img {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v04-card.is-on .v04-card-pic,
:root .proto-ui.proto-ui.proto-ui .v04-card:focus-visible .v04-card-pic {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v04-recents {
  margin-top: 40px;
}
:root .proto-ui.proto-ui.proto-ui .v04-recent-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 10px;
}
:root .proto-ui.proto-ui.proto-ui .v04-recent {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--color-secondary-background);
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .v04-recent:hover {
  background: var(--color-secondary-background-hover);
}
@media (max-width: 1000px) {
  :root .proto-ui.proto-ui.proto-ui .v04-stage {
    grid-template-columns: minmax(0, 1fr);
  }
  :root .proto-ui.proto-ui.proto-ui .v04-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  :root .proto-ui.proto-ui.proto-ui .v04-recent-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v04-opt,
  :root .proto-ui.proto-ui.proto-ui .v04-card-pic img {
    transition: none;
  }
}
</style>
