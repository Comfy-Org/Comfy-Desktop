<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Search } from 'lucide-vue-next'
import { CATEGORIES, NODE_TYPES, SOCKETS, type NodeKind, type SocketType } from './canvasData'
import { NODE_ICONS } from './nodeIcons'

/**
 * Adding a node: a search over the catalog, by category. It opens where
 * you asked for it (a double-click on the canvas, "/", the rail's Nodes),
 * and when a link is dropped on empty canvas it lists only the nodes that
 * can take it, so the link lands wired.
 */
const { x, y, fit } = defineProps<{
  /** Where it opens, in the canvas's pixels. */
  x: number
  y: number
  /** Only the nodes that can take this link. */
  fit?: { type: SocketType; side: 'in' | 'out' }
}>()
const emit = defineEmits<{ pick: [kind: NodeKind]; close: [] }>()

const query = ref('')
const at = ref(0)
const input = ref<HTMLInputElement>()

const ALL = Object.keys(NODE_TYPES) as NodeKind[]
const items = computed(() => {
  const q = query.value.trim().toLowerCase()
  return ALL.filter((k) => {
    const t = NODE_TYPES[k]
    if (fit) {
      // A link from an output needs a node that takes it; from an input,
      // one that makes it.
      const sockets = fit.side === 'out' ? t.ins : t.outs
      if (!sockets.some((s) => s.type === fit.type)) return false
    }
    return !q || `${t.title} ${t.description} ${t.category}`.toLowerCase().includes(q)
  }).sort(
    (a, b) =>
      CATEGORIES.indexOf(NODE_TYPES[a].category) - CATEGORIES.indexOf(NODE_TYPES[b].category)
  )
})
watch(query, () => (at.value = 0))

const startsGroup = (i: number): boolean =>
  i === 0 || NODE_TYPES[items.value[i - 1]!].category !== NODE_TYPES[items.value[i]!].category

function key(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') at.value = Math.min(items.value.length - 1, at.value + 1)
  else if (e.key === 'ArrowUp') at.value = Math.max(0, at.value - 1)
  else if (e.key === 'Enter' && items.value[at.value]) emit('pick', items.value[at.value]!)
  else if (e.key === 'Escape') emit('close')
  else return
  e.preventDefault()
  nextTick(() => document.querySelector('.ns-item.is-at')?.scrollIntoView({ block: 'nearest' }))
}

onMounted(() => input.value?.focus())
</script>

<template>
  <div
    class="ns"
    role="dialog"
    aria-label="Add a node"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @pointerdown.stop
    @wheel.stop
  >
    <label class="ns-search">
      <Search :size="14" />
      <input
        ref="input"
        v-model="query"
        type="text"
        :placeholder="fit ? `Nodes that take ${fit.type.toLowerCase()}` : 'Search nodes'"
        @keydown="key"
      />
      <i v-if="fit" class="ns-type" :style="{ background: SOCKETS[fit.type] }" />
    </label>
    <div class="ns-list" role="listbox">
      <template v-for="(k, i) in items" :key="k">
        <p v-if="startsGroup(i)" class="ns-cat">{{ NODE_TYPES[k].category }}</p>
        <button
          type="button"
          class="ns-item"
          :class="i === at && 'is-at'"
          role="option"
          :aria-selected="i === at"
          @pointerenter="at = i"
          @click="emit('pick', k)"
        >
          <span class="ns-icon"><component :is="NODE_ICONS[k]" :size="14" /></span>
          <span class="ns-text">
            <span class="ns-title">{{ NODE_TYPES[k].title }}</span>
            <span class="ns-desc">{{ NODE_TYPES[k].description }}</span>
          </span>
        </button>
      </template>
      <p v-if="!items.length" class="ns-none">No node matches “{{ query }}”.</p>
    </div>
  </div>
</template>

<style>
.ns {
  position: absolute;
  z-index: 6;
  display: flex;
  width: 300px;
  max-height: 420px;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: color-mix(in oklch, var(--color-content-background) 84%, transparent);
  backdrop-filter: blur(32px) saturate(1.2);
  box-shadow: 0 18px 50px rgb(0 0 0 / 0.32);
  color: var(--mg-text);
  animation: ns-in 0.14s ease-out;
}
@keyframes ns-in {
  from {
    opacity: 0;
    scale: 0.97;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ns {
    animation: none;
  }
}
.ns-search {
  display: flex;
  height: 44px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  box-shadow: inset 0 -1px 0 color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--mg-dim);
}
:root .proto-ui.proto-ui.proto-ui .ns-search input {
  height: auto;
  padding: 0;
  box-shadow: none;
  min-width: 0;
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--mg-text);
  font: inherit;
  font-size: 13px;
}
.ns-search input::placeholder {
  color: var(--mg-dim);
}
.ns-type {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}
.ns-list {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 4px 6px 6px;
}
.ns-cat {
  margin: 8px 8px 4px;
  color: var(--mg-dim);
  font-size: 11px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .ns-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  color: var(--mg-text);
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .ns-item.is-at {
  background: var(--mg-hover);
}
.ns-icon {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: var(--mar-tab-item-radius);
  background: var(--mg-well);
  color: var(--mg-muted);
}
.ns-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.ns-title {
  font-size: 13px;
  line-height: 18px;
}
.ns-desc {
  overflow: hidden;
  color: var(--mg-dim);
  font-size: 11.5px;
  line-height: 15px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.ns-none {
  padding: 16px;
  color: var(--mg-dim);
  font-size: 12px;
  text-align: center;
}
.is-current .ns {
  border-radius: var(--radius-card);
  background: var(--mg-chrome-2);
  box-shadow:
    0 0 0 1px var(--mg-chrome-line),
    0 12px 30px rgb(0 0 0 / 0.35);
  backdrop-filter: none;
}
</style>
