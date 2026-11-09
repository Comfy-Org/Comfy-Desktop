<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { Calendar, Clock, FolderInput, Search, Sparkles, Tag, X } from 'lucide-vue-next'
import type { AssetFilter } from './assetFilters'

/**
 * Search or filter (Assets): one field for both. Focused and empty, it
 * offers recent searches and the filters people reach for; typed into,
 * it searches the names and offers every filter that matches the words
 * ("hero" → Tag · hero). A filter picked here lands in the Filters menu,
 * so the two never disagree. The names are searched on Enter, so the
 * grid holds still while you type.
 */
const { tags } = defineProps<{ tags: string[] }>()
const query = defineModel<string>('query', { required: true })
const filter = defineModel<AssetFilter>('filter', { required: true })

type Pick = { key: string; group: 'Source' | 'Date' | 'Tag'; label: string; apply: () => void }
const ago = (days: number): string =>
  new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
const ICONS = { Source: FolderInput, Date: Calendar, Tag }

const all = computed<Pick[]>(() => [
  ...(['generated', 'imported'] as const).map((v) => ({
    key: `s-${v}`,
    group: 'Source' as const,
    label: v === 'generated' ? 'Generated' : 'Imported',
    apply: () => (filter.value = { ...filter.value, source: v })
  })),
  ...[
    ['Today', 0],
    ['Past week', 7],
    ['Past month', 30]
  ].map(([label, days]) => ({
    key: `d-${days}`,
    group: 'Date' as const,
    label: label as string,
    apply: () => (filter.value = { ...filter.value, from: ago(days as number), to: '' })
  })),
  ...tags.map((t) => ({
    key: `t-${t}`,
    group: 'Tag' as const,
    label: t,
    apply: () =>
      (filter.value = {
        ...filter.value,
        tags: filter.value.tags.includes(t) ? filter.value.tags : [...filter.value.tags, t]
      })
  }))
])

const open = ref(false)
const draft = ref(query.value)
watch(query, (v) => (draft.value = v))
const box = ref<HTMLElement>()
onClickOutside(box, () => (open.value = false))
const typed = computed(() => draft.value.trim().toLowerCase())
const matches = computed(() =>
  typed.value
    ? all.value.filter((p) => `${p.group} ${p.label}`.toLowerCase().includes(typed.value))
    : all.value.filter((p) => p.group !== 'Tag' || tags.indexOf(p.label) < 4)
)

/** Recent searches, newest first, for this window. */
const recent = ref<string[]>([])
function remember(s: string): void {
  recent.value = [s, ...recent.value.filter((x) => x !== s)].slice(0, 4)
}
function clear(): void {
  query.value = ''
  draft.value = ''
}
function search(): void {
  query.value = draft.value.trim()
  if (query.value) remember(query.value)
  open.value = false
}
function pick(p: Pick): void {
  p.apply()
  remember(`${p.group} · ${p.label}`)
  query.value = ''
  draft.value = ''
  open.value = false
}
function again(s: string): void {
  const p = all.value.find((x) => `${x.group} · ${x.label}` === s)
  if (p) pick(p)
  else {
    query.value = draft.value = s
    open.value = false
  }
}
</script>

<template>
  <div ref="box" class="asr">
    <label class="mar-pfind asr-field">
      <Search :size="14" />
      <input
        v-model="draft"
        type="search"
        placeholder="Search or filter…"
        aria-label="Search or filter assets"
        :aria-expanded="open"
        @focus="open = true"
        @input="open = true"
        @keydown.enter.prevent="search"
        @keydown.esc="open ? (open = false) : clear()"
      />
      <button
        v-if="draft"
        type="button"
        class="mar-pfind-x"
        aria-label="Clear search"
        @click="clear"
      >
        <X :size="13" />
      </button>
    </label>
    <div v-if="open" class="asr-pop" role="listbox" aria-label="Search or filter">
      <button v-if="typed" type="button" class="asr-row is-first" @click="search">
        <Search :size="14" /><span
          >Search for “<b>{{ draft.trim() }}</b
          >”</span
        >
      </button>
      <template v-if="!typed && recent.length">
        <p class="asr-label">Recent</p>
        <button v-for="r in recent" :key="r" type="button" class="asr-row" @click="again(r)">
          <Clock :size="14" /><span>{{ r }}</span>
        </button>
      </template>
      <template v-if="matches.length">
        <p class="asr-label">{{ typed ? 'Filters' : 'Filter by' }}</p>
        <button v-for="p in matches" :key="p.key" type="button" class="asr-row" @click="pick(p)">
          <component :is="ICONS[p.group]" :size="14" />
          <span class="asr-group">{{ p.group }}</span>
          <span class="asr-chip">{{ p.label }}</span>
        </button>
      </template>
      <p v-if="typed && !matches.length" class="asr-none">
        <Sparkles :size="13" />No filter matches. Enter searches the names.
      </p>
    </div>
  </div>
</template>

<style>
.asr {
  position: relative;
}
:root .proto-ui.proto-ui.proto-ui .asr-field {
  width: 240px;
}
:root .proto-ui.proto-ui.proto-ui .asr-pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  display: flex;
  width: 300px;
  max-height: 360px;
  flex-direction: column;
  overflow-y: auto;
  padding: 4px;
  border-radius: 12px;
  background: color-mix(
    in oklch,
    color-mix(in oklch, var(--color-base-foreground) 8%, var(--color-card-background)) 96%,
    transparent
  );
  backdrop-filter: blur(24px) saturate(1.3);
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 10%, transparent),
    0 18px 48px -12px rgb(0 0 0 / 0.55);
  color: var(--color-base-foreground);
}
.asr-label {
  padding: 8px 8px 4px;
  color: var(--color-muted-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
:root .proto-ui.proto-ui.proto-ui .asr-row {
  display: flex;
  height: 32px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border-radius: 7px;
  background: transparent;
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 400;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .asr-row:hover,
:root .proto-ui.proto-ui.proto-ui .asr-row.is-first {
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
.asr-row > svg {
  flex: none;
  color: var(--color-muted-foreground);
}
.asr-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asr-group {
  color: var(--color-muted-foreground);
}
.asr-chip {
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  font-size: 12px;
}
.asr-none {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 8px;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
</style>
