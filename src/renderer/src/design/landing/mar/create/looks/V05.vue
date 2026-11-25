<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Cloud, HardDrive, Plus, Search, X } from 'lucide-vue-next'
import Button from '../../../ui/Button.vue'
import MarSeg from '../../pages/MarSeg.vue'
import { activeInstance } from '../../../useProto'
import { closeCreate, openTemplate, openWorkflow, startBlank } from '../createScreen'
import { SHELVES, type Starter } from '../createStarters'
import LookAResults from './LookAResults.vue'
import {
  buildOf,
  costOf,
  runOnCloud,
  shelfStarters,
  sortedWorkflows,
  useCreateEscape,
  useCreateSearch
} from './lookA'

const WHATS = [
  { id: 'image', label: 'An image' },
  { id: 'video', label: 'A video' },
  { id: 'edit', label: 'An edit' },
  { id: 'upscale', label: 'An upscale' },
  { id: '3d', label: 'A 3D model' },
  { id: 'audio', label: 'Sound' }
]

const query = ref('')
const field = ref<HTMLInputElement>()
const search = useCreateSearch(query)
useCreateEscape(field, false)

const what = ref('video')
const options = computed(() => shelfStarters(what.value, 3))
const whichId = ref<string | null>(null)
const which = computed<Starter>(
  () => options.value.find((s) => s.id === whichId.value) ?? options.value[0]!
)
watch(what, () => (whichId.value = null))

const cost = computed(() => costOf(which.value.template))
const where = ref<'local' | 'cloud'>('local')
watch(
  cost,
  (c) => {
    if (where.value === 'cloud' && !c.cloud) where.value = 'local'
  },
  { immediate: true }
)

const go = computed(() => {
  if (where.value === 'cloud') return 'Run on Comfy Cloud'
  if (cost.value.local.tone === 'fetch') return 'Download and run'
  if (cost.value.local.tone === 'ready') return 'Run'
  return 'Open template'
})
const goNote = computed(() => {
  if (where.value === 'cloud')
    return cost.value.cloud?.signIn
      ? 'Sign in first. New accounts get free credits.'
      : `${cost.value.cloud?.credits} a run, nothing to download.`
  if (cost.value.local.tone === 'fetch')
    return `${cost.value.local.label.split(' · ')[0]} downloads once, in about ${cost.value.local.minutes} min.`
  if (cost.value.local.tone === 'ready')
    return `Every model is already on ${activeInstance.value.name}.`
  return cost.value.local.label
})

function run(): void {
  if (where.value === 'cloud') runOnCloud(which.value.template)
  else openTemplate(which.value.template)
}

const shelf = ref(SHELVES[0]!.id)
const shelfOptions = SHELVES.map((s) => ({ value: s.id, label: s.label }))
const catalogue = computed(() => {
  const all = shelfStarters(shelf.value, 12)
  return all.slice(0, Math.floor(all.length / 6) * 6 || all.length)
})
const recents = computed(() => sortedWorkflows.value.slice(0, 5))
</script>

<template>
  <section class="v05 relative min-h-full px-8 pb-20" aria-label="Create">
    <button type="button" class="v05-close" aria-label="Close" title="Close" @click="closeCreate">
      <X :size="16" />
    </button>

    <div class="relative mx-auto flex w-full max-w-280 flex-col">
      <h1 class="v05-title">Start something new in three steps</h1>

      <ol class="v05-wizard">
        <li class="v05-step">
          <p class="v05-step-head"><span class="v05-num">1</span>What do you want to make?</p>
          <div class="v05-whats" role="radiogroup" data-no-pill aria-label="What to make">
            <button
              v-for="w in WHATS"
              :key="w.id"
              type="button"
              role="radio"
              class="v05-what"
              :class="what === w.id && 'is-on'"
              :aria-checked="what === w.id"
              @click="what = w.id"
            >
              {{ w.label }}
            </button>
          </div>
        </li>

        <li class="v05-step">
          <p class="v05-step-head"><span class="v05-num">2</span>Pick a template</p>
          <div class="v05-which" role="radiogroup" data-no-pill aria-label="Template">
            <button
              v-for="s in options"
              :key="s.id"
              type="button"
              role="radio"
              class="v05-pick"
              :class="which.id === s.id && 'is-on'"
              :aria-checked="which.id === s.id"
              @click="whichId = s.id"
              @dblclick="openTemplate(s.template)"
            >
              <img :src="s.poster" alt="" loading="lazy" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-body font-medium text-base-foreground">{{
                  s.makes
                }}</span>
                <span class="truncate text-ui text-subtle-foreground">{{ s.model }}</span>
              </span>
              <Check v-if="which.id === s.id" :size="15" class="shrink-0 text-base-foreground" />
            </button>
          </div>
        </li>

        <li class="v05-step">
          <p class="v05-step-head"><span class="v05-num">3</span>Where should it run?</p>
          <div class="v05-wheres" role="radiogroup" data-no-pill aria-label="Where it runs">
            <button
              type="button"
              role="radio"
              class="v05-where"
              :class="where === 'local' && 'is-on'"
              :aria-checked="where === 'local'"
              @click="where = 'local'"
            >
              <HardDrive :size="16" class="shrink-0" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="text-body font-medium text-base-foreground">{{
                  activeInstance.name
                }}</span>
                <span class="text-ui text-subtle-foreground">{{
                  cost.local.tone === 'ready'
                    ? 'Ready, nothing to download'
                    : cost.local.tone === 'fetch'
                      ? `Downloads ${cost.local.label}`
                      : cost.local.label
                }}</span>
              </span>
            </button>
            <button
              type="button"
              role="radio"
              class="v05-where"
              :class="where === 'cloud' && 'is-on'"
              :aria-checked="where === 'cloud'"
              :disabled="!cost.cloud"
              @click="where = 'cloud'"
            >
              <Cloud :size="16" class="shrink-0" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="text-body font-medium text-base-foreground">Comfy Cloud</span>
                <span class="text-ui text-subtle-foreground">{{
                  cost.cloud
                    ? cost.cloud.signIn
                      ? 'Runs now · free credits to start'
                      : `Runs now · ${cost.cloud.credits}`
                    : 'Not available for this one'
                }}</span>
              </span>
            </button>
          </div>
          <div class="v05-go">
            <Button variant="primary" block class="v05-go-btn" @click="run">{{ go }}</Button>
            <p class="v05-go-note">{{ goNote }}</p>
          </div>
        </li>
      </ol>

      <section class="v05-catalogue">
        <div class="v05-cat-head">
          <h2 class="text-heading font-medium text-base-foreground">Or browse everything</h2>
          <div class="flex items-center gap-2">
            <label class="v05-field">
              <Search :size="14" class="shrink-0 text-subtle-foreground" />
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
                <X :size="13" />
              </button>
            </label>
            <Button
              variant="ghost"
              :title="`Empty canvas on ${activeInstance.name}`"
              @click="startBlank"
            >
              <Plus :size="14" />Blank canvas
            </Button>
          </div>
        </div>

        <LookAResults v-if="search.q.value" :search :query class="mt-4" />

        <template v-else>
          <div class="v05-shelves">
            <MarSeg v-model="shelf" :options="shelfOptions" label="Browse templates" />
          </div>
          <div class="v05-grid">
            <button
              v-for="s in catalogue"
              :key="s.id"
              type="button"
              class="v05-item"
              @click="openTemplate(s.template)"
            >
              <span class="v05-item-pic"><img :src="s.poster" alt="" loading="lazy" /></span>
              <span class="truncate text-ui text-base-foreground">{{ s.makes }}</span>
              <span class="truncate text-[12px] text-subtle-foreground">{{ s.model }}</span>
            </button>
          </div>

          <div v-if="recents.length" class="v05-recents">
            <span class="text-ui text-subtle-foreground">Recent</span>
            <button
              v-for="w in recents"
              :key="w.id"
              type="button"
              class="v05-recent"
              :title="`${buildOf(w)?.name ?? ''} · ${w.modified}`"
              @click="openWorkflow(w)"
            >
              {{ w.name }}
            </button>
          </div>
        </template>
      </section>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v05 {
  isolation: isolate;
}
:root .proto-ui.proto-ui.proto-ui .v05-close {
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
:root .proto-ui.proto-ui.proto-ui .v05-close:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v05-title {
  padding-top: clamp(40px, 7vh, 72px);
  color: var(--color-base-foreground);
  font-size: var(--text-display);
  font-weight: 600;
  line-height: var(--text-display--line-height);
  letter-spacing: -0.025em;
}
:root .proto-ui.proto-ui.proto-ui .v05-wizard {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.15fr) minmax(0, 1fr);
  margin-top: 24px;
  overflow: hidden;
  border-radius: 18px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v05-step {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 20px;
}
:root .proto-ui.proto-ui.proto-ui .v05-step + .v05-step {
  border-left: 1px solid var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v05-step:last-child {
  background: color-mix(in oklch, var(--color-base-foreground) 3%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .v05-step-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  color: var(--color-base-foreground);
  font-size: var(--text-body);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v05-num {
  display: grid;
  width: 22px;
  height: 22px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: 12px;
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v05-whats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
:root .proto-ui.proto-ui.proto-ui .v05-what {
  height: 44px;
  padding: 0 12px;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  color: var(--color-muted-foreground);
  font-size: var(--text-body);
  text-align: left;
  outline: none;
  transition:
    background-color 140ms ease,
    color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v05-what:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v05-what.is-on {
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v05-which,
:root .proto-ui.proto-ui.proto-ui .v05-wheres {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
:root .proto-ui.proto-ui.proto-ui .v05-pick,
:root .proto-ui.proto-ui.proto-ui .v05-where {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px 6px 6px;
  border-radius: 12px;
  background: var(--color-card-background);
  color: var(--color-muted-foreground);
  text-align: left;
  outline: none;
  box-shadow: inset 0 0 0 1px transparent;
  transition: box-shadow 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v05-where {
  padding: 12px 14px;
}
:root .proto-ui.proto-ui.proto-ui .v05-pick img {
  width: 72px;
  height: 48px;
  flex: none;
  border-radius: 8px;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v05-pick.is-on,
:root .proto-ui.proto-ui.proto-ui .v05-where.is-on {
  box-shadow: inset 0 0 0 1.5px var(--color-base-foreground);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v05-where:disabled {
  opacity: 0.5;
}
:root .proto-ui.proto-ui.proto-ui .v05-what:focus-visible,
:root .proto-ui.proto-ui.proto-ui .v05-pick:focus-visible,
:root .proto-ui.proto-ui.proto-ui .v05-where:focus-visible {
  box-shadow: inset 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v05-go {
  margin-top: auto;
  padding-top: 14px;
}
:root .proto-ui.proto-ui.proto-ui .v05-go-btn {
  height: 44px;
  border-radius: 12px;
  font-size: var(--text-body);
}
:root .proto-ui.proto-ui.proto-ui .v05-go-note {
  margin-top: 8px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-align: center;
}
:root .proto-ui.proto-ui.proto-ui .v05-catalogue {
  margin-top: 56px;
}
:root .proto-ui.proto-ui.proto-ui .v05-cat-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
}
:root .proto-ui.proto-ui.proto-ui .v05-field {
  display: flex;
  width: 280px;
  height: 32px;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v05-field:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v05-field input {
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
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v05-field input::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v05-shelves {
  margin-top: 14px;
  overflow-x: auto;
  scrollbar-width: none;
}
:root .proto-ui.proto-ui.proto-ui .v05-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 18px 12px;
  margin-top: 16px;
}
:root .proto-ui.proto-ui.proto-ui .v05-item {
  display: flex;
  min-width: 0;
  flex-direction: column;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v05-item-pic {
  aspect-ratio: 4 / 3;
  margin-bottom: 8px;
  overflow: hidden;
  border-radius: 10px;
  background: var(--color-card-background);
}
:root .proto-ui.proto-ui.proto-ui .v05-item-pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: saturate(0.75);
  opacity: 0.85;
  transition:
    filter 200ms ease,
    opacity 200ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v05-item:hover .v05-item-pic img,
:root .proto-ui.proto-ui.proto-ui .v05-item:focus-visible .v05-item-pic img {
  filter: none;
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v05-item:focus-visible .v05-item-pic {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v05-recents {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  margin-top: 32px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v05-recent {
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v05-recent:hover {
  color: var(--color-base-foreground);
  text-decoration: underline;
  text-underline-offset: 3px;
}
@media (max-width: 1000px) {
  :root .proto-ui.proto-ui.proto-ui .v05-wizard {
    grid-template-columns: minmax(0, 1fr);
  }
  :root .proto-ui.proto-ui.proto-ui .v05-step + .v05-step {
    border-top: 1px solid var(--color-border-default);
    border-left: 0;
  }
  :root .proto-ui.proto-ui.proto-ui .v05-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v05-what,
  :root .proto-ui.proto-ui.proto-ui .v05-pick,
  :root .proto-ui.proto-ui.proto-ui .v05-where,
  :root .proto-ui.proto-ui.proto-ui .v05-item-pic img {
    transition: none;
  }
}
</style>
