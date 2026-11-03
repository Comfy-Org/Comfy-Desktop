<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { Bookmark, ChevronDown, Folder, SearchX, SlidersHorizontal } from 'lucide-vue-next'
import RailPanel from './RailPanel.vue'
import { NODE_ICONS } from '../nodeIcons'
import { CATEGORIES, NODE_TYPES, type NodeKind } from '../canvasData'
import { ComfyNode } from '../../icons/comfyIcons'
import MarSeg from '../../pages/MarSeg.vue'
import MarSearchField from '../../pages/MarSearchField.vue'
import MarEmpty from '../../pages/MarEmpty.vue'

/**
 * Nodes (ComfyUI's NodeLibrarySidebarTabV2). Essentials, a curated grid by
 * section, ships where its flag is on (Comfy Cloud); a local build opens
 * on All nodes: Bookmarked, then the library as a tree. A click or a drag
 * adds the node to the canvas.
 */
const { cloud } = defineProps<{ cloud: boolean }>()
const emit = defineEmits<{ close: []; add: [kind: NodeKind] }>()

const tab = ref<'essentials' | 'all'>(cloud ? 'essentials' : 'all')
const query = ref('')
const menu = ref(false)
const filter = ref('All')
const sort = ref<'Categorized' | 'A-Z'>('Categorized')
const TABS = [
  { value: 'essentials' as const, label: 'Essentials' },
  { value: 'all' as const, label: 'All nodes' }
]
onMounted(() =>
  nextTick(() => document.querySelector<HTMLInputElement>('.rp .mar-pfind input')?.focus())
)

const match = (k: NodeKind): boolean => {
  const q = query.value.trim().toLowerCase()
  return !q || `${NODE_TYPES[k].title} ${NODE_TYPES[k].description}`.toLowerCase().includes(q)
}

// Essentials: the product's sections, holding this graph's nodes.
const ESSENTIALS: { title: string; groups: { title?: string; kinds: NodeKind[] }[] }[] = [
  {
    title: 'Inputs & Outputs',
    groups: [{ kinds: ['prompt', 'image', 'video', 'audio', 'output', 'gallery', 'compare'] }]
  },
  {
    title: 'Generate',
    groups: [
      { title: 'Image', kinds: ['generate'] },
      { title: 'Video', kinds: ['generateVideo'] },
      { title: 'Text', kinds: ['llm', 'promptConstructor'] },
      { title: 'Audio', kinds: ['generateAudio'] }
    ]
  },
  {
    title: 'Editing & Utilities',
    groups: [
      { title: 'Image Transform', kinds: ['upscale'] },
      { title: 'Image Selection & Masking', kinds: ['removeBg'] }
    ]
  }
]
const MEDIA_OF: Partial<Record<NodeKind, string>> = {
  image: 'Image',
  generate: 'Image',
  upscale: 'Image',
  removeBg: 'Image',
  output: 'Image',
  gallery: 'Image',
  compare: 'Image',
  video: 'Video',
  generateVideo: 'Video',
  prompt: 'Text',
  llm: 'Text',
  promptConstructor: 'Text',
  audio: 'Audio',
  generateAudio: 'Audio'
}
const essentials = computed(() =>
  ESSENTIALS.map((s) => ({
    ...s,
    groups: s.groups
      .map((g) => ({
        ...g,
        kinds: g.kinds.filter(
          (k) => match(k) && (filter.value === 'All' || MEDIA_OF[k] === filter.value)
        )
      }))
      .filter((g) => g.kinds.length)
  })).filter((s) => s.groups.length)
)

// All nodes: bookmarks, then the sections as a tree.
const bookmarks = ref<NodeKind[]>([])
const shut = ref(new Set<string>())
const toggle = (key: string): void => {
  const s = new Set(shut.value)
  if (s.has(key)) s.delete(key)
  else s.add(key)
  shut.value = s
}
const KINDS = Object.keys(NODE_TYPES) as NodeKind[]
const comfy = computed(() =>
  CATEGORIES.map((c) => ({
    name: c,
    kinds: KINDS.filter((k) => NODE_TYPES[k].category === c && k !== 'workflow' && match(k))
  })).filter((f) => f.kinds.length)
)
const blueprints = computed(() => (match('workflow') ? (['workflow'] as NodeKind[]) : []))
const flat = computed(() =>
  KINDS.filter(match).sort((a, b) => NODE_TYPES[a].title.localeCompare(NODE_TYPES[b].title))
)
const show = (section: string): boolean => filter.value === 'All' || filter.value === section

function mark(k: NodeKind): void {
  bookmarks.value = bookmarks.value.includes(k)
    ? bookmarks.value.filter((b) => b !== k)
    : [...bookmarks.value, k]
}
function drag(k: NodeKind, e: DragEvent): void {
  e.dataTransfer?.setData('text/x-mg-node', k)
}
const FILTERS = computed(() =>
  tab.value === 'essentials'
    ? ['All', 'Image', 'Video', 'Text', 'Audio', '3D']
    : ['All', 'Blueprints', 'Comfy Nodes', 'Partner Nodes', 'Extensions']
)
const nothing = computed(() =>
  tab.value === 'essentials'
    ? !essentials.value.length
    : sort.value === 'A-Z'
      ? !flat.value.length
      : !comfy.value.length && !blueprints.value.length
)
</script>

<template>
  <RailPanel title="Nodes" @close="emit('close')">
    <template #header>
      <MarSeg
        v-if="cloud"
        :model-value="tab"
        :options="TABS"
        label="Nodes"
        @update:model-value="((tab = $event), (filter = 'All'))"
      />
      <div class="rp-top">
        <MarSearchField v-model="query" placeholder="Search Nodes..." />
        <span class="rp-anchor">
          <button
            type="button"
            class="rp-icon is-field"
            :class="menu && 'is-on'"
            :aria-label="tab === 'all' ? 'Filter and sort' : 'Filter'"
            :title="tab === 'all' ? 'Filter and sort' : 'Filter'"
            :aria-expanded="menu"
            @click="menu = !menu"
          >
            <SlidersHorizontal :size="15" /><i v-if="filter !== 'All'" class="rp-dot" />
          </button>
          <div v-if="menu" class="rp-menu is-end" role="menu">
            <p class="rp-menu-label">Filter</p>
            <button
              v-for="f in FILTERS"
              :key="f"
              type="button"
              role="menuitemradio"
              class="rp-row"
              :data-state="filter === f ? 'checked' : 'unchecked'"
              @click="((filter = f), (menu = false))"
            >
              {{ f }}
            </button>
            <template v-if="tab === 'all'">
              <span class="rp-menu-sep" />
              <p class="rp-menu-label">Sort</p>
              <button
                v-for="o in ['Categorized', 'A-Z'] as const"
                :key="o"
                type="button"
                role="menuitemradio"
                class="rp-row"
                :data-state="sort === o ? 'checked' : 'unchecked'"
                @click="((sort = o), (menu = false))"
              >
                {{ o }}
              </button>
            </template>
          </div>
        </span>
      </div>
    </template>

    <!-- Essentials: tiles by section. -->
    <template v-if="tab === 'essentials'">
      <section v-for="s in essentials" :key="s.title" class="np-section">
        <h3 class="rp-section np-head">{{ s.title }}</h3>
        <div v-for="g in s.groups" :key="g.title ?? s.title" class="np-group">
          <p v-if="g.title" class="np-sub">{{ g.title }}</p>
          <div class="np-grid">
            <button
              v-for="k in g.kinds"
              :key="k"
              type="button"
              class="np-card"
              draggable="true"
              :title="NODE_TYPES[k].description"
              @click="emit('add', k)"
              @dragstart="drag(k, $event)"
            >
              <component :is="NODE_ICONS[k]" :size="26" :stroke-width="1.5" class="np-card-icon" />
              <span>{{ NODE_TYPES[k].title }}</span>
            </button>
          </div>
        </div>
      </section>
    </template>

    <!-- All nodes: bookmarks, then the tree. -->
    <div v-else class="rp-list">
      <p class="rp-section">Bookmarked</p>
      <template v-if="bookmarks.length">
        <button
          v-for="k in bookmarks"
          :key="`b-${k}`"
          type="button"
          class="rp-row np-leaf"
          @click="emit('add', k)"
        >
          <ComfyNode :size="14" class="rp-row-icon" /><span class="rp-row-text">{{
            NODE_TYPES[k].title
          }}</span>
        </button>
      </template>
      <p v-else class="rp-note">No bookmarks yet</p>

      <template v-if="sort === 'A-Z'">
        <div v-for="k in flat" :key="k" class="np-line">
          <button
            type="button"
            class="rp-row np-leaf"
            draggable="true"
            @click="emit('add', k)"
            @dragstart="drag(k, $event)"
          >
            <ComfyNode :size="14" class="rp-row-icon" /><span class="rp-row-text">{{
              NODE_TYPES[k].title
            }}</span>
          </button>
          <button
            type="button"
            class="rp-icon np-mark"
            :class="bookmarks.includes(k) && 'is-on'"
            aria-label="Bookmark"
            @click="mark(k)"
          >
            <Bookmark :size="13" :fill="bookmarks.includes(k) ? 'currentColor' : 'none'" />
          </button>
        </div>
      </template>
      <template v-else>
        <template v-if="show('Blueprints') && blueprints.length">
          <p class="rp-section">Subgraph Blueprints</p>
          <button type="button" class="rp-row" @click="toggle('my')">
            <ChevronDown :size="14" class="rp-chev" :class="shut.has('my') && 'is-shut'" />
            <Folder :size="14" class="rp-row-icon" /><span class="rp-row-text">My Blueprints</span>
          </button>
          <div v-if="!shut.has('my')" class="np-line is-in">
            <button type="button" class="rp-row np-leaf" @click="emit('add', 'workflow')">
              <ComfyNode :size="14" class="rp-row-icon" /><span class="rp-row-text">Relight</span>
            </button>
          </div>
        </template>
        <template v-if="show('Comfy Nodes') && comfy.length">
          <p class="rp-section">Comfy Nodes</p>
          <template v-for="f in comfy" :key="f.name">
            <button type="button" class="rp-row" @click="toggle(f.name)">
              <ChevronDown :size="14" class="rp-chev" :class="shut.has(f.name) && 'is-shut'" />
              <Folder :size="14" class="rp-row-icon" /><span class="rp-row-text">{{ f.name }}</span>
            </button>
            <template v-if="!shut.has(f.name) || query">
              <div v-for="k in f.kinds" :key="k" class="np-line is-in">
                <button
                  type="button"
                  class="rp-row np-leaf"
                  draggable="true"
                  :title="NODE_TYPES[k].description"
                  @click="emit('add', k)"
                  @dragstart="drag(k, $event)"
                >
                  <ComfyNode :size="14" class="rp-row-icon" /><span class="rp-row-text">{{
                    NODE_TYPES[k].title
                  }}</span>
                </button>
                <button
                  type="button"
                  class="rp-icon np-mark"
                  :class="bookmarks.includes(k) && 'is-on'"
                  aria-label="Bookmark"
                  @click="mark(k)"
                >
                  <Bookmark :size="13" :fill="bookmarks.includes(k) ? 'currentColor' : 'none'" />
                </button>
              </div>
            </template>
          </template>
        </template>
      </template>
    </div>
    <MarEmpty
      v-if="nothing"
      compact
      :icon="SearchX"
      title="No results"
      :text="query ? `No nodes match “${query}”.` : 'No nodes in this filter.'"
      action="Clear filters"
      @action="((query = ''), (filter = 'All'))"
    />
  </RailPanel>
</template>

<style>
.np-section {
  padding: 0 12px 14px;
}
.np-section + .np-section {
  box-shadow: inset 0 1px 0 var(--rp-line);
}
:root .proto-ui.proto-ui.proto-ui .np-head {
  padding: 14px 0 8px;
}
.np-group + .np-group {
  margin-top: 12px;
}
.np-sub {
  margin: 0 0 6px;
  color: var(--rp-meta);
  font-size: 12px;
}
.np-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
/* Tiles: the DS's raised surface, so they read as things to pick up. */
:root .proto-ui.proto-ui.proto-ui .np-card {
  display: flex;
  aspect-ratio: 1;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 6px;
  border-radius: var(--mar-tab-radius);
  background: var(--rp-raised);
  box-shadow: var(--rp-raised-shadow);
  color: var(--rp-text);
  font-size: 12px;
  line-height: 15px;
  text-align: center;
  cursor: grab;
  transition: background-color 120ms ease;
}
:root .proto-ui.proto-ui.proto-ui .np-card:hover {
  background: var(--rp-chip-on);
}
.np-card > span {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.np-card-icon {
  color: var(--rp-meta);
}
.np-card:hover .np-card-icon {
  color: var(--rp-text);
}
.np-line {
  display: flex;
  align-items: center;
}
.np-line.is-in {
  margin-left: 15px;
  padding-left: 7px;
  box-shadow: inset 1px 0 0 var(--rp-line);
}
.np-line .rp-row {
  flex: 1;
}
.np-leaf {
  cursor: grab;
}
.np-mark {
  opacity: 0;
}
.np-line:hover .np-mark,
.np-mark.is-on {
  opacity: 1;
}
</style>
