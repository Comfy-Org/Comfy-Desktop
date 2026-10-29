<script setup lang="ts">
import { computed, ref } from 'vue'
import { Search, X } from 'lucide-vue-next'
import { savedAssets } from './savedAssets'

/**
 * The Assets panel (rail › Assets): everything made or brought in, to
 * search and drag onto the canvas. Opens beside the rail.
 */
defineEmits<{ close: [] }>()

const files = import.meta.glob('../assets/*.jpg', { eager: true, import: 'default' })
const ALL = Object.entries(files).map(([path, src], i) => ({
  name: path.split('/').pop()!.replace('.jpg', ''),
  src: src as string,
  kind: i % 3 === 0 ? 'Imported' : 'Generated'
}))

const FILTERS = ['All', 'Generated', 'Imported'] as const
const filter = ref<(typeof FILTERS)[number]>('All')
const query = ref('')
/** Dragged onto the canvas, an asset becomes an Image node. */
function drop(a: { name: string; src: string }, e: DragEvent): void {
  e.dataTransfer?.setData('text/x-mg-asset', a.src)
  e.dataTransfer?.setData('text/x-mg-name', `${a.name}.jpg`)
}
const shown = computed(() =>
  [...savedAssets.map((a) => ({ ...a, kind: 'Generated' })), ...ALL].filter(
    (a) =>
      (filter.value === 'All' || a.kind === filter.value) &&
      a.name.toLowerCase().includes(query.value.trim().toLowerCase())
  )
)
</script>

<template>
  <aside class="ga" aria-label="Assets">
    <header class="ga-head">
      <span class="ga-title">Assets</span>
      <button type="button" class="ga-close" aria-label="Close" @click="$emit('close')">
        <X :size="14" />
      </button>
    </header>
    <label class="ga-search">
      <Search :size="14" />
      <input v-model="query" type="search" placeholder="Search assets" />
    </label>
    <div class="ga-filters">
      <button
        v-for="f in FILTERS"
        :key="f"
        type="button"
        class="ga-filter"
        :class="filter === f && 'is-on'"
        @click="filter = f"
      >
        {{ f }}
      </button>
    </div>
    <div class="ga-grid">
      <figure
        v-for="a in shown"
        :key="a.name"
        class="ga-item"
        draggable="true"
        :title="`Drag ${a.name} onto the canvas`"
        @dragstart="drop(a, $event)"
      >
        <img :src="a.src" alt="" />
        <figcaption>{{ a.name }}</figcaption>
      </figure>
      <p v-if="!shown.length" class="ga-empty">No assets match “{{ query }}”.</p>
    </div>
  </aside>
</template>

<style>
.ga {
  position: absolute;
  top: calc(var(--mg-top) + 16px);
  bottom: 16px;
  left: 76px;
  z-index: 4;
  display: flex;
  width: 280px;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius-card);
  background: color-mix(in oklch, var(--color-content-background) 70%, transparent);
  backdrop-filter: blur(32px) saturate(1.2);
  color: var(--mg-text);
}
.ga-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 2px 0 6px;
}
.ga-title {
  font-size: 13px;
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .ga-close {
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--mg-muted);
}
.ga-search {
  display: flex;
  height: 34px;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-radius: var(--mar-tab-radius);
  background: var(--mg-well);
  color: var(--mg-dim);
}
.ga-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--mg-text);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.ga-filters {
  display: flex;
  gap: 4px;
}
:root .proto-ui.proto-ui.proto-ui .ga-filter {
  height: 26px;
  padding: 0 10px;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  color: var(--mg-muted);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .ga-filter.is-on {
  background: var(--mg-hover);
  color: var(--mg-text);
}
.ga-grid {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: 1fr 1fr;
  align-content: start;
  gap: 8px;
  overflow-y: auto;
}
.ga-item {
  margin: 0;
  cursor: grab;
}
.ga-item img {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 5;
  border-radius: var(--mar-tab-item-radius);
  object-fit: cover;
}
.ga-item figcaption {
  overflow: hidden;
  padding: 5px 2px 0;
  color: var(--mg-muted);
  font-size: 11.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.ga-empty {
  grid-column: 1 / -1;
  color: var(--mg-dim);
  font-size: 12px;
}
.is-current .ga {
  top: calc(var(--mg-top) + 38px);
  bottom: 0;
  left: 52px;
  border-radius: 0;
  background: var(--mg-chrome);
  box-shadow: inset -1px 0 0 var(--mg-chrome-line);
  backdrop-filter: none;
}
.is-current .ga-search,
.is-current .ga-item img {
  border-radius: var(--mar-tab-item-radius);
}
</style>
