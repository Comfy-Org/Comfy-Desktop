<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Calendar,
  Download,
  Ellipsis,
  Grid3x3,
  Image,
  Info,
  Layers,
  LayoutGrid,
  ListFilter,
  Search,
  Settings2,
  TableOfContents
} from 'lucide-vue-next'
import RailPanel from './panels/RailPanel.vue'
import { PICTURES } from './panels/panelData'
import { savedAssets } from './savedAssets'

/**
 * Media Assets (ComfyUI's AssetsSidebarTab): Generated and Imported, a
 * search with View settings (list, small or large grid) and, on Comfy
 * Cloud, a filter by media type and date and the sort orders. An asset
 * drags onto the canvas as an Image node.
 */
const { cloud } = defineProps<{ cloud: boolean }>()
defineEmits<{ close: [] }>()

type View = 'list' | 'small' | 'large'
const tab = ref<'Generated' | 'Imported'>('Generated')
const query = ref('')
const menu = ref<'' | 'filter' | 'view'>('')
const view = ref<View>(
  (() => {
    try {
      return (localStorage.getItem('Comfy.Assets.Sidebar.ViewMode') as View) || 'large'
    } catch {
      return 'large'
    }
  })()
)
function setView(v: View): void {
  view.value = v
  try {
    localStorage.setItem('Comfy.Assets.Sidebar.ViewMode', v)
  } catch {
    // Storage blocked: the pick lasts for this window only.
  }
}
const sort = ref('Newest first')
const date = ref('All time')

const ALL = PICTURES.map((p, i) => ({
  ...p,
  file: `${p.name}.png`,
  kind: i % 3 === 0 ? ('Imported' as const) : ('Generated' as const),
  seconds: 6 + ((i * 7.3) % 24),
  outputs: i % 4 === 1 ? 4 : 1
}))
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = [
    ...savedAssets.map((a) => ({
      ...a,
      file: `${a.name}.png`,
      kind: 'Generated' as const,
      seconds: 12.4,
      outputs: 1
    })),
    ...ALL
  ].filter((a) => a.kind === tab.value && (!q || a.file.toLowerCase().includes(q)))
  if (sort.value === 'Oldest first') return [...list].reverse()
  if (sort.value.startsWith('Name')) {
    const s = [...list].sort((a, b) => a.file.localeCompare(b.file))
    return sort.value.includes('Z → A') ? s.reverse() : s
  }
  if (sort.value.startsWith('Generation time'))
    return [...list].sort((a, b) =>
      sort.value.includes('longest') ? b.seconds - a.seconds : a.seconds - b.seconds
    )
  return list
})
const SORTS = computed(() => [
  'Newest first',
  'Oldest first',
  'Name (A → Z)',
  'Name (Z → A)',
  ...(tab.value === 'Generated'
    ? ['Generation time (longest first)', 'Generation time (fastest first)']
    : [])
])
function drag(a: { name: string; src: string }, e: DragEvent): void {
  e.dataTransfer?.setData('text/x-mg-asset', a.src)
  e.dataTransfer?.setData('text/x-mg-name', `${a.name}.jpg`)
}
</script>

<template>
  <RailPanel title="Media Assets" @close="$emit('close')">
    <template #header>
      <div class="rp-tabs" role="tablist">
        <button
          v-for="t in ['Generated', 'Imported'] as const"
          :key="t"
          type="button"
          role="tab"
          class="rp-tab"
          :class="tab === t && 'is-on'"
          :aria-selected="tab === t"
          @click="tab = t"
        >
          {{ t }}
        </button>
      </div>
      <div class="rp-top">
        <label class="rp-search">
          <Search :size="14" />
          <input v-model="query" type="search" placeholder="Search Assets..." />
        </label>
        <span v-if="cloud" class="rp-anchor">
          <button
            type="button"
            class="rp-icon is-filled"
            title="Filter by"
            aria-label="Filter by"
            @click="menu = menu === 'filter' ? '' : 'filter'"
          >
            <ListFilter :size="15" /><i v-if="date !== 'All time'" class="rp-dot" />
          </button>
          <div v-if="menu === 'filter'" class="rp-menu is-end">
            <p class="rp-menu-label">Attribute</p>
            <p class="rp-menu-label ap-sub"><Image :size="12" />Media type</p>
            <button
              v-for="m in ['Image', 'Video', 'Audio', '3D', 'Text']"
              :key="m"
              type="button"
              class="rp-row"
            >
              {{ m }}
            </button>
            <span class="rp-menu-sep" />
            <p class="rp-menu-label ap-sub"><Calendar :size="12" />Date</p>
            <button
              v-for="d in ['All time', 'Today', 'Past 7 days', 'Past 30 days', 'This year']"
              :key="d"
              type="button"
              class="rp-row"
              :class="date === d && 'is-on'"
              @click="((date = d), (menu = ''))"
            >
              {{ d }}
            </button>
          </div>
        </span>
        <span class="rp-anchor">
          <button
            type="button"
            class="rp-icon is-filled"
            title="View settings"
            aria-label="View settings"
            @click="menu = menu === 'view' ? '' : 'view'"
          >
            <Settings2 :size="15" />
          </button>
          <div v-if="menu === 'view'" class="rp-menu is-end">
            <button
              type="button"
              class="rp-row"
              :class="view === 'list' && 'is-on'"
              @click="(setView('list'), (menu = ''))"
            >
              <TableOfContents :size="14" class="rp-row-icon" />List view
            </button>
            <button
              type="button"
              class="rp-row"
              :class="view === 'small' && 'is-on'"
              @click="(setView('small'), (menu = ''))"
            >
              <Grid3x3 :size="14" class="rp-row-icon" />Grid (small)
            </button>
            <button
              type="button"
              class="rp-row"
              :class="view === 'large' && 'is-on'"
              @click="(setView('large'), (menu = ''))"
            >
              <LayoutGrid :size="14" class="rp-row-icon" />Grid (large)
            </button>
            <template v-if="cloud">
              <span class="rp-menu-sep" />
              <button
                v-for="s in SORTS"
                :key="s"
                type="button"
                class="rp-row"
                :class="sort === s && 'is-on'"
                @click="((sort = s), (menu = ''))"
              >
                {{ s }}
              </button>
            </template>
          </div>
        </span>
      </div>
    </template>

    <div v-if="shown.length && view !== 'list'" class="ap-grid" :class="`is-${view}`">
      <figure
        v-for="a in shown"
        :key="a.file"
        class="ap-card"
        draggable="true"
        :title="`Drag ${a.file} onto the canvas`"
        @dragstart="drag(a, $event)"
      >
        <span class="ap-media">
          <img :src="a.src" alt="" />
          <span class="ap-hover">
            <button type="button" class="rp-icon is-filled" aria-label="Download">
              <Download :size="13" />
            </button>
            <button type="button" class="rp-icon is-filled" aria-label="More options">
              <Ellipsis :size="13" />
            </button>
          </span>
        </span>
        <figcaption>
          <span class="ap-text">
            <span class="ap-name">{{ a.file }}</span>
            <small>{{ a.kind === 'Generated' ? `${a.seconds.toFixed(2)}s` : '1.2 MB' }}</small>
          </span>
          <button
            v-if="a.outputs > 1 && tab === 'Generated'"
            type="button"
            class="rp-btn ap-stack"
            title="See more outputs"
          >
            <Layers :size="12" />{{ a.outputs }}
          </button>
        </figcaption>
      </figure>
    </div>
    <div v-else-if="shown.length" class="rp-list">
      <div
        v-for="a in shown"
        :key="a.file"
        class="jp-row"
        draggable="true"
        @dragstart="drag(a, $event)"
      >
        <span class="jp-thumb"><img :src="a.src" alt="" /></span>
        <span class="jp-text">
          <span>{{ a.file }}</span>
          <small>{{ a.kind === 'Generated' ? `${a.seconds.toFixed(2)}s` : '1.2 MB' }}</small>
        </span>
        <button
          v-if="a.outputs > 1 && tab === 'Generated'"
          type="button"
          class="rp-btn ap-stack"
          aria-label="See more outputs"
        >
          <Layers :size="12" />{{ a.outputs }}
        </button>
        <span class="jp-actions">
          <button type="button" class="rp-icon" aria-label="More options">
            <Ellipsis :size="14" />
          </button>
        </span>
      </div>
    </div>
    <div v-else class="rp-empty">
      <Info :size="22" />
      <strong>{{
        tab === 'Generated' ? 'No generated files found' : 'No imported files found'
      }}</strong>
      <span>Upload files or generate content to see them here</span>
    </div>
  </RailPanel>
</template>

<style>
.ap-sub {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ap-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
  gap: 4px;
  padding: 4px 8px 16px;
}
.ap-grid.is-small {
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
}
.ap-card {
  margin: 0;
  padding: 6px;
  border-radius: var(--mar-tab-radius);
  cursor: grab;
}
.ap-card:hover {
  background: var(--mg-hover);
}
.ap-media {
  position: relative;
  display: block;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: var(--mar-tab-item-radius);
}
.ap-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ap-hover {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 2px;
  opacity: 0;
}
.ap-card:hover .ap-hover {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .ap-hover .rp-icon {
  width: 26px;
  height: 26px;
  background: rgb(0 0 0 / 0.55);
  color: #fff;
}
.ap-card figcaption {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 2px 0;
}
.ap-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
.ap-name {
  overflow: hidden;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.ap-text small {
  color: var(--mg-dim);
  font-size: 11px;
}
.ap-grid.is-small .ap-text small,
.ap-grid.is-small .ap-stack {
  display: none;
}
:root .proto-ui.proto-ui.proto-ui .ap-stack {
  height: 24px;
  gap: 4px;
  padding: 0 7px;
  font-size: 11px;
}
</style>
