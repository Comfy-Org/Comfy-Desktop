<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Minus, Plus, Search, Tag } from 'lucide-vue-next'
import type { MarAsset } from '../pages/assetsStore'
import { addTag, removeTag, tagsOf } from '../assets/assetTags'

/**
 * Tag the selection in one go (Media Assets › selection bar). Each tag
 * says how many of the selected assets have it: a check when all do, a
 * dash when some do. A click puts it on all of them, or takes it off all
 * when they all had it. Typing a new name and Enter creates it.
 */
const { selected, pool } = defineProps<{ selected: MarAsset[]; pool: MarAsset[] }>()
const emit = defineEmits<{ close: [] }>()

const query = ref('')
const tags = computed(() => {
  const names = new Set([...pool, ...selected].flatMap((a) => tagsOf(a)))
  const q = query.value.trim().toLowerCase()
  return [...names]
    .filter((t) => !q || t.includes(q))
    .map((t) => ({ t, n: selected.filter((a) => tagsOf(a).includes(t)).length }))
    .sort((a, b) => b.n - a.n || a.t.localeCompare(b.t))
})
const isNew = computed(() => {
  const q = query.value.trim().toLowerCase()
  return !!q && !tags.value.some((x) => x.t === q)
})
function flip(t: string, n: number): void {
  for (const a of selected) (n === selected.length ? removeTag : addTag)(a, t)
}
function create(): void {
  if (!isNew.value) {
    const hit = tags.value[0]
    if (hit) flip(hit.t, hit.n)
    return
  }
  for (const a of selected) addTag(a, query.value)
  query.value = ''
}
</script>

<template>
  <div
    class="ap-tagmenu"
    role="dialog"
    aria-label="Tag selected assets"
    @keydown.esc="emit('close')"
  >
    <label class="ap-tagmenu-search">
      <Search :size="13" />
      <input
        v-model="query"
        placeholder="Search or create a new tag…"
        aria-label="Search or create a tag"
        autofocus
        @keydown.enter.prevent="create"
      />
    </label>
    <div class="ap-tagmenu-list" role="listbox" aria-multiselectable="true">
      <button v-if="isNew" type="button" class="ap-tagmenu-row" @click="create">
        <Plus :size="13" /><span>Create “{{ query.trim().toLowerCase() }}”</span>
      </button>
      <button
        v-for="x in tags"
        :key="x.t"
        type="button"
        role="option"
        class="ap-tagmenu-row"
        :aria-selected="x.n === selected.length"
        @click="flip(x.t, x.n)"
      >
        <Tag :size="13" />
        <span class="ap-tagmenu-name">{{ x.t }}</span>
        <span v-if="x.n" class="ap-tagmenu-n">{{ x.n }} of {{ selected.length }}</span>
        <Check v-if="x.n === selected.length" :size="13" />
        <Minus v-else-if="x.n" :size="13" />
        <span v-else class="ap-tagmenu-pad" />
      </button>
      <p v-if="!tags.length && !isNew" class="ap-tagmenu-empty">No tags yet. Type to create one.</p>
    </div>
  </div>
</template>

<style>
.ap-tagmenu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  z-index: 5;
  display: flex;
  width: 260px;
  flex-direction: column;
  overflow: hidden;
  border-radius: 10px;
  background: var(--rp-surface);
  backdrop-filter: blur(28px) saturate(1.3);
  box-shadow:
    inset 0 0 0 1px var(--rp-ring),
    var(--rp-shadow);
  color: var(--rp-text);
  translate: -50% 0;
}
.ap-tagmenu-search {
  display: flex;
  height: 36px;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid var(--rp-line);
  color: var(--rp-meta);
}
:root .proto-ui.proto-ui.proto-ui .ap-tagmenu-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--rp-text);
  font-size: 13px;
  font-weight: 400;
  outline: none;
}
.ap-tagmenu-list {
  display: flex;
  max-height: 220px;
  flex-direction: column;
  overflow-y: auto;
  padding: 4px;
}
:root .proto-ui.proto-ui.proto-ui .ap-tagmenu-row {
  display: flex;
  height: 30px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border-radius: 6px;
  background: transparent;
  color: var(--rp-text);
  font-size: 13px;
  font-weight: 400;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .ap-tagmenu-row:hover {
  background: var(--rp-hover);
}
.ap-tagmenu-row > svg:first-child {
  flex: none;
  color: var(--rp-meta);
}
.ap-tagmenu-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ap-tagmenu-n {
  color: var(--rp-meta);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.ap-tagmenu-pad {
  width: 13px;
}
.ap-tagmenu-empty {
  padding: 10px 8px;
  color: var(--rp-meta);
  font-size: 12px;
}
</style>
