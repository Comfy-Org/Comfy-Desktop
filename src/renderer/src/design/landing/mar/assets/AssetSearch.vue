<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Box,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Image,
  Puzzle,
  Search,
  Tag,
  Workflow,
  X
} from 'lucide-vue-next'
import type { MarAsset } from '../pages/assetsStore'
import { metaIn, tagsIn, type AssetFilter, type AssetType } from './assetFilters'

/**
 * Search (Assets): the names, as the PRD asks (Better Asset Management,
 * P2-03). Focused, it also offers the shortcuts into the filters from the
 * media assets prototype: recent searches, then attributes and what the
 * run recorded. Typing suggests matching values under the name match.
 * Without a filter model it stays a plain name search.
 */
const query = defineModel<string>('query', { required: true })
const filter = defineModel<AssetFilter>('filter')
const { pool = [], types = [] } = defineProps<{
  /** The assets in view, for the values each attribute offers. */
  pool?: MarAsset[]
  types?: readonly { value: AssetType; label: string }[]
}>()

type Key = 'date' | 'tags' | 'types' | 'models' | 'loras' | 'workflows'
type MetaKey = 'models' | 'loras' | 'workflows'

const recent = ref<string[]>([])
const open = ref(false)
const group = ref<Key | ''>('')

const DATES = [
  { days: 0, label: 'Today' },
  { days: 7, label: 'Past week' },
  { days: 30, label: 'Past month' },
  { days: 365, label: 'This year' }
]
const ago = (days: number): string =>
  new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
const short = (v: string): string => v.replace(/\.(safetensors|ckpt|pt|json)$/, '')

const meta = computed(() => metaIn(pool))
const GROUPS = computed(() => [
  {
    title: 'Filter by attribute',
    items: [
      { key: 'date' as Key, label: 'Date', icon: Calendar },
      { key: 'tags' as Key, label: 'Tag', icon: Tag },
      { key: 'types' as Key, label: 'Media type', icon: Image }
    ]
  },
  {
    title: 'Filter by metadata',
    items: [
      { key: 'models' as MetaKey, label: 'Model', icon: Box },
      { key: 'loras' as MetaKey, label: 'LoRA', icon: Puzzle },
      { key: 'workflows' as MetaKey, label: 'Workflow name', icon: Workflow }
    ].filter((i) => meta.value[i.key].length)
  }
])
const label = (k: Key): string =>
  GROUPS.value.flatMap((g) => g.items).find((i) => i.key === k)?.label ?? ''

/** The values one attribute offers, and whether each is on. */
function values(k: Key): { id: string; text: string; on: boolean }[] {
  const f = filter.value
  if (!f) return []
  if (k === 'date')
    return DATES.map((d) => ({
      id: String(d.days),
      text: d.label,
      on: !f.to && f.from === ago(d.days)
    }))
  if (k === 'types')
    return types.map((t) => ({ id: t.value, text: t.label, on: f.types.includes(t.value) }))
  if (k === 'tags') return tagsIn(pool).map((v) => ({ id: v, text: v, on: f.tags.includes(v) }))
  return meta.value[k].map((v) => ({ id: v, text: short(v), on: f[k].includes(v) }))
}
const flip = <T,>(l: T[], v: T): T[] => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v])
function pick(k: Key, id: string): void {
  const f = filter.value
  if (!f) return
  if (k === 'date') {
    const from = ago(Number(id))
    filter.value = { ...f, from: f.from === from && !f.to ? '' : from, to: '' }
  } else if (k === 'types') filter.value = { ...f, types: flip(f.types, id as AssetType) }
  else filter.value = { ...f, [k]: flip(f[k], id) }
}

// Typing: values from every attribute that match, under their attribute.
const hits = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q || !filter.value) return []
  return GROUPS.value
    .flatMap((g) => g.items)
    .flatMap((i) =>
      values(i.key)
        .filter((v) => v.text.toLowerCase().includes(q))
        .map((v) => ({ ...v, key: i.key, attr: i.label }))
    )
    .slice(0, 8)
})

function remember(): void {
  const q = query.value.trim()
  if (q) recent.value = [q, ...recent.value.filter((r) => r !== q)].slice(0, 4)
}
function close(): void {
  open.value = false
  group.value = ''
  remember()
}
// Clicks inside the list keep the focus in the field.
const keep = (e: MouseEvent): void => e.preventDefault()
function onEsc(e: KeyboardEvent): void {
  if (query.value) query.value = ''
  else (e.target as HTMLInputElement).blur()
}
</script>

<template>
  <div class="asr" @focusout="close">
    <label class="mar-pfind asr-field">
      <Search :size="14" />
      <input
        v-model="query"
        type="search"
        placeholder="Search"
        aria-label="Search assets by name"
        @focus="open = true"
        @keydown.esc="onEsc"
        @keydown.enter="remember"
      />
      <button
        v-if="query"
        type="button"
        class="mar-pfind-x"
        aria-label="Clear search"
        @mousedown="keep"
        @click="query = ''"
      >
        <X :size="13" />
      </button>
    </label>
    <div v-if="open && filter && (!query.trim() || hits.length)" class="asr-pop" @mousedown="keep">
      <template v-if="query.trim()">
        <p class="asr-label">Filter by</p>
        <button
          v-for="h in hits"
          :key="`${h.key}-${h.id}`"
          type="button"
          :class="['asr-row', h.on && 'is-on']"
          @click="pick(h.key, h.id)"
        >
          <span class="asr-attr">{{ h.attr }}</span
          ><span class="asr-grow">{{ h.text }}</span
          ><Check v-if="h.on" :size="14" class="asr-icon" />
        </button>
      </template>
      <template v-else-if="group">
        <button type="button" class="asr-row is-back" @click="group = ''">
          <ChevronLeft :size="14" /><span class="asr-grow">{{ label(group) }}</span>
        </button>
        <button
          v-for="v in values(group)"
          :key="v.id"
          type="button"
          :class="['asr-row', v.on && 'is-on']"
          @click="pick(group, v.id)"
        >
          <span class="asr-grow">{{ v.text }}</span
          ><Check v-if="v.on" :size="14" class="asr-icon" />
        </button>
        <p v-if="!values(group).length" class="asr-none">Nothing to pick here yet</p>
      </template>
      <template v-else>
        <template v-if="recent.length">
          <p class="asr-label">Recent</p>
          <button v-for="r in recent" :key="r" type="button" class="asr-row" @click="query = r">
            <Clock :size="14" class="asr-icon" /><span class="asr-grow">{{ r }}</span>
          </button>
        </template>
        <template v-for="g in GROUPS" :key="g.title">
          <template v-if="g.items.length">
            <p class="asr-label">{{ g.title }}</p>
            <button
              v-for="i in g.items"
              :key="i.key"
              type="button"
              class="asr-row"
              @click="group = i.key"
            >
              <component :is="i.icon" :size="14" class="asr-icon" /><span class="asr-grow">{{
                i.label
              }}</span
              ><ChevronRight :size="14" class="asr-icon" />
            </button>
          </template>
        </template>
      </template>
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
.asr-pop {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  left: 0;
  display: flex;
  width: 260px;
  max-height: 360px;
  flex-direction: column;
  gap: 1px;
  overflow-y: auto;
  padding: 6px;
  border-radius: 10px;
  background: var(--color-content-background);
  box-shadow:
    0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 10%, transparent),
    0 10px 15px -3px rgb(0 0 0 / 0.3);
  color: var(--color-base-foreground);
  font-size: 13px;
}
.asr-label {
  padding: 8px 8px 4px;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
:root .proto-ui.proto-ui.proto-ui .asr-row {
  display: flex;
  min-height: 30px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border-radius: 6px;
  background: transparent;
  color: var(--color-base-foreground);
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .asr-row:hover,
:root .proto-ui.proto-ui.proto-ui .asr-row.is-on {
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .asr-row.is-back {
  color: var(--color-muted-foreground);
}
.asr-grow {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asr-icon {
  flex: none;
  color: var(--color-muted-foreground);
}
.asr-attr {
  flex: none;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
.asr-none {
  padding: 8px;
  color: var(--color-muted-foreground);
}
</style>
