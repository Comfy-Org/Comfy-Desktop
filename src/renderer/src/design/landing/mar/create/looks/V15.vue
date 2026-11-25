<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ArrowLeft, Plus, Search, X } from 'lucide-vue-next'
import CategoryChip from '../../CategoryChip.vue'
import { activeInstance } from '../../../useProto'
import { closeCreate, openTemplate, startBlank } from '../createScreen'
import type { Starter } from '../createStarters'
import CSearch from './CSearch.vue'
import {
  CLOUD_FAMILIES,
  LOCAL_FAMILIES,
  familyOf,
  fitOf,
  fmtGb,
  minutesLabel,
  playIn,
  stopIn,
  useCreateKeys,
  type Family
} from './cLooks'

const query = ref('')
const field = ref<HTMLInputElement>()
const results = ref<InstanceType<typeof CSearch>>()
const picked = ref<string | null>(null)
const peek = ref<string | null>(null)
const detail = ref<HTMLElement>()
useCreateKeys(field)

const local = computed(() => LOCAL_FAMILIES.map(familyOf).filter((f) => f.workflows.length))
const cloud = computed(() => CLOUD_FAMILIES.map(familyOf).filter((f) => f.workflows.length))
const all = computed(() => [...local.value, ...cloud.value])
const family = computed(() => all.value.find((f) => f.name === picked.value))
const installed = (f: Family): boolean => f.starters.some((s) => fitOf(s.template).band === 'now')
const peeked = computed(
  () => family.value?.starters.find((s) => s.id === peek.value) ?? family.value?.starters[0]
)

function pick(name: string): void {
  picked.value = name
  peek.value = null
  nextTick(() => detail.value?.focus({ preventScroll: true }))
}

function fitLine(s: Starter): { head: string; note: string } {
  const fit = fitOf(s.template)
  if (fit.band === 'now') return { head: 'Ready to run', note: fit.local.note }
  if (fit.band === 'power')
    return {
      head: fit.cloudCost ? `${fit.cloudCost} a run on Comfy Cloud` : 'Runs on Comfy Cloud',
      note: fit.local.status
    }
  if (!fit.gb) return { head: fit.local.status, note: fit.local.note }
  return {
    head: `Needs ${fmtGb(fit.gb)} · ${minutesLabel(fit.minutes)}`,
    note: fit.local.note
  }
}

function onKey(e: KeyboardEvent): void {
  if (results.value?.onKey(e)) return
  if (e.key === 'Escape') {
    e.preventDefault()
    if (picked.value) picked.value = null
    else closeCreate()
  }
}
function onDetailKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  picked.value = null
}
</script>

<template>
  <section class="v15 relative min-h-full px-8 pb-20" aria-label="Create">
    <button type="button" class="v15-close" aria-label="Close" title="Close" @click="closeCreate">
      <X :size="16" />
    </button>

    <div class="mx-auto flex w-full max-w-300 flex-col">
      <header class="v15-head">
        <div>
          <h1 class="text-display font-bold tracking-[-0.02em] text-base-foreground">
            Start from a model
          </h1>
          <p class="mt-1 text-body text-muted-foreground">
            Pick the model you want to work with and see everything it can make.
          </p>
        </div>
        <div class="flex items-center gap-1.5">
          <label class="v15-field">
            <Search :size="15" class="shrink-0 text-subtle-foreground" />
            <input
              ref="field"
              v-model="query"
              type="text"
              placeholder="Search models, templates and nodes"
              aria-label="Search workflows, templates and nodes"
              @keydown="onKey"
            />
            <button
              v-if="query"
              type="button"
              class="text-subtle-foreground"
              aria-label="Clear search"
              @click="((query = ''), field?.focus())"
            >
              <X :size="14" />
            </button>
          </label>
          <button
            type="button"
            class="v15-blank"
            :title="`Empty canvas on ${activeInstance.name}`"
            @click="startBlank"
          >
            <Plus :size="15" />Blank canvas
          </button>
        </div>
      </header>

      <CSearch v-if="query.trim()" ref="results" :query class="mt-8" @clear="query = ''" />

      <div
        v-else-if="family"
        ref="detail"
        class="v15-detail"
        tabindex="-1"
        :aria-label="family.name"
        @keydown="onDetailKey"
      >
        <nav class="v15-rail" aria-label="Models">
          <button type="button" class="v15-back" @click="picked = null">
            <ArrowLeft :size="14" />All models
          </button>
          <button
            v-for="f in all"
            :key="f.name"
            type="button"
            class="v15-rail-item"
            :aria-current="f.name === family.name ? 'true' : undefined"
            @click="pick(f.name)"
          >
            <img :src="f.samples[0]" alt="" />
            <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
            <span class="text-[12px] text-subtle-foreground tabular-nums">{{
              f.workflows.length
            }}</span>
          </button>
        </nav>

        <div class="min-w-0 flex-1">
          <header class="v15-fam">
            <div class="v15-fam-samples" aria-hidden="true">
              <img v-for="src in family.samples" :key="src" :src="src" alt="" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-ui text-subtle-foreground">{{ family.maker }}</p>
              <h2 class="text-title font-semibold text-base-foreground">{{ family.name }}</h2>
              <p class="mt-1 text-ui text-muted-foreground">{{ family.blurb }}.</p>
              <p class="v15-facts">
                <span
                  >{{ family.workflows.length }} template{{
                    family.workflows.length === 1 ? '' : 's'
                  }}</span
                >
                <span v-if="!family.cloudOnly">From {{ fmtGb(family.gb) }}</span>
                <span v-if="family.vramGb">{{ family.vramGb }} GB memory or more</span>
                <span>{{
                  family.cloudOnly
                    ? 'Partner model on Comfy Cloud'
                    : installed(family)
                      ? `Installed on ${activeInstance.name}`
                      : 'Not installed'
                }}</span>
              </p>
            </div>
          </header>

          <h3 class="mt-8 mb-3 text-heading font-medium text-base-foreground">
            What you can make with {{ family.name }}
          </h3>
          <div class="v15-make">
            <div class="v15-grid">
              <button
                v-for="s in family.starters"
                :key="s.id"
                type="button"
                class="v15-tpl group"
                :class="peeked?.id === s.id && 'is-at'"
                @pointerenter="((peek = s.id), playIn($event.currentTarget))"
                @pointerleave="stopIn($event.currentTarget)"
                @focus="((peek = s.id), playIn($event.currentTarget))"
                @blur="stopIn($event.currentTarget)"
                @click="openTemplate(s.template)"
              >
                <span class="v15-tpl-pic">
                  <img :src="s.poster" alt="" loading="lazy" />
                  <video v-if="s.clip" :src="s.clip" muted loop playsinline preload="none" />
                  <span class="v15-tpl-chip"><CategoryChip :category="s.media" /></span>
                </span>
                <span class="mt-2 block truncate text-ui font-medium text-base-foreground">{{
                  s.template.title.split(':')[1]?.trim() ?? s.template.title
                }}</span>
              </button>
            </div>
            <aside v-if="peeked" class="v15-peek" aria-live="polite">
              <p class="text-heading font-medium text-base-foreground">
                {{ peeked.template.title }}
              </p>
              <p class="mt-2 text-ui text-muted-foreground">{{ peeked.line }}.</p>
              <div v-for="l in [fitLine(peeked)]" :key="l.head" class="v15-peek-fit">
                <p class="text-ui font-medium text-base-foreground">{{ l.head }}</p>
                <p v-if="l.note" class="mt-1 text-[12px] leading-[18px] text-subtle-foreground">
                  {{ l.note }}
                </p>
              </div>
              <button type="button" class="v15-use" @click="openTemplate(peeked.template)">
                Use this template
              </button>
            </aside>
          </div>
        </div>
      </div>

      <template v-else>
        <section
          v-for="group in [
            { id: 'local', title: 'Open models · run on your Mac or Cloud', list: local },
            { id: 'cloud', title: 'Partner models · Comfy Cloud', list: cloud }
          ]"
          :key="group.id"
          class="mt-10"
          :aria-label="group.title"
        >
          <h2 class="mb-3 text-ui text-subtle-foreground">{{ group.title }}</h2>
          <div class="v15-families" :class="`is-${group.id}`">
            <button
              v-for="(f, i) in group.list"
              :key="f.name"
              type="button"
              class="v15-family"
              :style="{ '--i': i }"
              @click="pick(f.name)"
            >
              <span class="v15-family-samples" aria-hidden="true">
                <img v-for="src in f.samples" :key="src" :src="src" alt="" loading="lazy" />
              </span>
              <span class="v15-family-body">
                <span class="flex items-baseline justify-between gap-2">
                  <span class="truncate text-heading font-semibold text-base-foreground">{{
                    f.name
                  }}</span>
                  <span class="shrink-0 text-[12px] text-subtle-foreground">{{ f.maker }}</span>
                </span>
                <span class="mt-1 block truncate text-ui text-muted-foreground">{{ f.blurb }}</span>
                <span class="v15-family-foot">
                  <span v-if="f.cloudOnly">Cloud</span>
                  <span v-else-if="installed(f)" class="is-on"><i />Installed</span>
                  <span v-else>{{ fmtGb(f.gb) }}</span>
                  <span
                    >{{ f.workflows.length }} template{{
                      f.workflows.length === 1 ? '' : 's'
                    }}</span
                  >
                </span>
              </span>
            </button>
          </div>
        </section>
      </template>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v15 {
  isolation: isolate;
}
:root .proto-ui.proto-ui.proto-ui .v15-close {
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
:root .proto-ui.proto-ui.proto-ui .v15-close:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v15-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding-top: clamp(40px, 7vh, 72px);
}
:root .proto-ui.proto-ui.proto-ui .v15-field {
  display: flex;
  height: 36px;
  width: 300px;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 12px;
  border-radius: var(--radius-control);
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v15-field:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v15-field input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-base-foreground);
  font: inherit;
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v15-field input::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v15-blank {
  display: inline-flex;
  height: 36px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-radius: var(--radius-control);
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v15-blank:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v15-families {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v15-families.is-cloud {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}
:root .proto-ui.proto-ui.proto-ui .v15-family {
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--color-card-background);
  text-align: left;
  outline: none;
  animation: v15-rise 420ms var(--mar-ease, ease-out) both;
  animation-delay: calc(var(--i) * 30ms);
}
:root .proto-ui.proto-ui.proto-ui .v15-family:hover {
  background: var(--color-card-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v15-family:focus-visible,
:root .proto-ui.proto-ui.proto-ui .v15-tpl:focus-visible .v15-tpl-pic {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v15-family-samples {
  display: grid;
  height: 132px;
  grid-template-columns: 2fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 2px;
}
:root .proto-ui.proto-ui.proto-ui .v15-family-samples img {
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: cover;
  transition: transform 500ms var(--mar-ease, ease-out);
}
:root .proto-ui.proto-ui.proto-ui .v15-family-samples img:first-child {
  grid-row: span 2;
}
:root .proto-ui.proto-ui.proto-ui .v15-family-samples img:only-child {
  grid-column: span 2;
}
:root .proto-ui.proto-ui.proto-ui .v15-family-samples img:first-child:nth-last-child(2) ~ img {
  grid-row: span 2;
}
:root .proto-ui.proto-ui.proto-ui .v15-families.is-cloud .v15-family-samples {
  height: 96px;
}
:root .proto-ui.proto-ui.proto-ui .v15-family-body {
  display: flex;
  flex-direction: column;
  padding: 12px 14px 14px;
}
:root .proto-ui.proto-ui.proto-ui .v15-family-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
:root .proto-ui.proto-ui.proto-ui .v15-family-foot .is-on {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v15-family-foot .is-on i {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v15-detail {
  display: flex;
  gap: 28px;
  margin-top: 32px;
  outline: none;
  animation: v15-rise 320ms var(--mar-ease, ease-out) both;
}
:root .proto-ui.proto-ui.proto-ui .v15-rail {
  display: flex;
  width: 200px;
  flex: none;
  flex-direction: column;
  gap: 1px;
}
:root .proto-ui.proto-ui.proto-ui .v15-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding: 6px 8px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v15-back:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v15-rail-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px 5px 5px;
  border-radius: var(--radius-control);
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .v15-rail-item img {
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: 6px;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v15-rail-item:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v15-rail-item[aria-current='true'] {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v15-fam {
  display: flex;
  align-items: center;
  gap: 24px;
}
:root .proto-ui.proto-ui.proto-ui .v15-fam-samples {
  display: flex;
  flex: none;
}
:root .proto-ui.proto-ui.proto-ui .v15-fam-samples img {
  width: 112px;
  height: 140px;
  border-radius: var(--radius-card);
  object-fit: cover;
  box-shadow: 0 0 0 3px var(--color-content-background);
}
:root .proto-ui.proto-ui.proto-ui .v15-fam-samples img + img {
  margin-left: -40px;
}
:root .proto-ui.proto-ui.proto-ui .v15-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v15-facts span {
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v15-make {
  display: flex;
  align-items: flex-start;
  gap: 20px;
}
:root .proto-ui.proto-ui.proto-ui .v15-grid {
  display: grid;
  min-width: 0;
  flex: 1;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px 12px;
}
:root .proto-ui.proto-ui.proto-ui .v15-tpl {
  min-width: 0;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v15-tpl-pic {
  position: relative;
  display: block;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--color-card-background);
}
:root .proto-ui.proto-ui.proto-ui .v15-tpl.is-at .v15-tpl-pic {
  box-shadow: 0 0 0 2px var(--color-border-strong);
}
:root .proto-ui.proto-ui.proto-ui .v15-tpl-pic img,
:root .proto-ui.proto-ui.proto-ui .v15-tpl-pic video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v15-tpl-pic video {
  opacity: 0;
  transition: opacity 240ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-tpl:hover .v15-tpl-pic video,
:root .proto-ui.proto-ui.proto-ui .v15-tpl:focus-visible .v15-tpl-pic video {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v15-tpl-chip {
  position: absolute;
  top: 8px;
  left: 8px;
}
:root .proto-ui.proto-ui.proto-ui .v15-peek {
  position: sticky;
  top: 24px;
  width: 280px;
  flex: none;
  padding: 16px;
  border-radius: var(--radius-panel);
  background: var(--color-card-background);
}
:root .proto-ui.proto-ui.proto-ui .v15-peek-fit {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v15-use {
  width: 100%;
  height: 36px;
  margin-top: 16px;
  border-radius: var(--radius-control);
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v15-use:hover {
  background: var(--color-inverted-background-hover);
}
@keyframes v15-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
@media (max-width: 1100px) {
  :root .proto-ui.proto-ui.proto-ui .v15-families,
  :root .proto-ui.proto-ui.proto-ui .v15-families.is-cloud {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  :root .proto-ui.proto-ui.proto-ui .v15-rail,
  :root .proto-ui.proto-ui.proto-ui .v15-peek {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v15-family,
  :root .proto-ui.proto-ui.proto-ui .v15-detail {
    animation: none;
  }
}
</style>
