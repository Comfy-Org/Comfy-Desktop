<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Calendar,
  Copy,
  Download,
  FileOutput,
  Grid3x3,
  Image,
  ImageOff,
  Layers,
  LayoutGrid,
  SearchX,
  SlidersHorizontal,
  TableOfContents,
  Trash2,
  Workflow
} from 'lucide-vue-next'
import RailPanel from './panels/RailPanel.vue'
import { PICTURES } from './panels/panelData'
import { savedAssets } from './savedAssets'
import MarSeg from '../pages/MarSeg.vue'
import MarSearchField from '../pages/MarSearchField.vue'
import MarItem from '../pages/MarItem.vue'
import MarEmpty from '../pages/MarEmpty.vue'
import MediaChip from '../MediaChip.vue'
import type { MenuLine } from '../pages/menu'

/**
 * Media Assets (ComfyUI's AssetsSidebarTab) with the DS's parts: the
 * segmented tabs, the search field, library items (MarItem) and the
 * empty state. One button beside the search holds view and, on Comfy
 * Cloud, the filters and sort, with a dot while a filter is on. Names
 * drop the extension (it moves to the meta line), so they truncate
 * later; a stack reads as a chip on its picture. An asset drags onto
 * the canvas as an Image node.
 */
const { cloud } = defineProps<{ cloud: boolean }>()
defineEmits<{ close: [] }>()

type View = 'list' | 'small' | 'large'
type Tab = 'Generated' | 'Imported'
const TABS: { value: Tab; label: string }[] = [
  { value: 'Generated', label: 'Generated' },
  { value: 'Imported', label: 'Imported' }
]
const tab = ref<Tab>('Generated')
const query = ref('')
const menu = ref(false)
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
const VIEWS = [
  { value: 'list', label: 'List view', icon: TableOfContents },
  { value: 'small', label: 'Grid (small)', icon: Grid3x3 },
  { value: 'large', label: 'Grid (large)', icon: LayoutGrid }
] as const
const sort = ref('Newest first')
const date = ref('All time')
const filtered = computed(() => date.value !== 'All time')
const selected = ref<string>('')

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
/** "PNG · 13.3s" for a run's output, "PNG · 1.2 MB" for an import. */
const meta = (a: { file: string; kind: Tab; seconds: number }): string =>
  `${a.file.split('.').pop()!.toUpperCase()} · ${
    a.kind === 'Generated' ? `${a.seconds.toFixed(1)}s` : '1.2 MB'
  }`
// The product's asset menu (MediaAssetContextMenu).
const LINES: MenuLine[] = [
  { label: 'Download', icon: Download },
  { label: 'Open as workflow', icon: Workflow },
  { label: 'Export workflow', icon: FileOutput },
  { label: 'Copy job ID', icon: Copy },
  'sep',
  { label: 'Delete', icon: Trash2, danger: true }
]
function drag(a: { name: string; src: string }, e: DragEvent): void {
  e.dataTransfer?.setData('text/x-mg-asset', a.src)
  e.dataTransfer?.setData('text/x-mg-name', `${a.name}.jpg`)
}
</script>

<template>
  <RailPanel title="Media Assets" @close="$emit('close')">
    <template #header>
      <MarSeg v-model="tab" :options="TABS" label="Assets" />
      <div class="rp-top">
        <MarSearchField v-model="query" placeholder="Search Assets..." />
        <span class="rp-anchor">
          <button
            type="button"
            class="rp-icon is-field"
            :class="menu && 'is-on'"
            :title="cloud ? 'Filter, sort and view' : 'View settings'"
            :aria-label="cloud ? 'Filter, sort and view' : 'View settings'"
            :aria-expanded="menu"
            @click="menu = !menu"
          >
            <SlidersHorizontal :size="15" /><i v-if="filtered" class="rp-dot" />
          </button>
          <div v-if="menu" class="rp-menu is-end ap-menu" role="menu">
            <p class="rp-menu-label">View</p>
            <div class="mar-pseg ap-views" role="radiogroup" aria-label="View">
              <button
                v-for="v in VIEWS"
                :key="v.value"
                type="button"
                role="radio"
                class="mar-pseg-btn is-icon"
                :aria-checked="view === v.value"
                :aria-selected="view === v.value"
                :aria-label="v.label"
                :title="v.label"
                @click="setView(v.value)"
              >
                <component :is="v.icon" :size="14" />
              </button>
            </div>
            <template v-if="cloud">
              <span class="rp-menu-sep" />
              <p class="rp-menu-label"><Image :size="12" />Media type</p>
              <button
                v-for="m in ['Image', 'Video', 'Audio', '3D', 'Text']"
                :key="m"
                type="button"
                role="menuitemcheckbox"
                class="rp-row"
              >
                {{ m }}
              </button>
              <span class="rp-menu-sep" />
              <p class="rp-menu-label"><Calendar :size="12" />Date</p>
              <button
                v-for="d in ['All time', 'Today', 'Past 7 days', 'Past 30 days', 'This year']"
                :key="d"
                type="button"
                role="menuitemradio"
                class="rp-row"
                :data-state="date === d ? 'checked' : 'unchecked'"
                @click="((date = d), (menu = false))"
              >
                {{ d }}
              </button>
              <span class="rp-menu-sep" />
              <p class="rp-menu-label">Sort by</p>
              <button
                v-for="s in SORTS"
                :key="s"
                type="button"
                role="menuitemradio"
                class="rp-row"
                :data-state="sort === s ? 'checked' : 'unchecked'"
                @click="((sort = s), (menu = false))"
              >
                {{ s }}
              </button>
            </template>
          </div>
        </span>
      </div>
    </template>

    <div
      v-if="shown.length"
      class="ap-items"
      :class="`is-${view}`"
      :aria-label="`${tab} assets`"
      @click.self="selected = ''"
    >
      <div
        v-for="a in shown"
        :key="a.file"
        class="ap-drag"
        draggable="true"
        @dragstart="drag(a, $event)"
      >
        <MarItem
          :name="a.name"
          :thumb="a.src"
          :meta="view === 'small' ? undefined : meta(a)"
          :layout="view === 'list' ? 'list' : 'grid'"
          ratio="1 / 1"
          :selected="selected === a.file"
          :lines="LINES"
          :title="`${a.file} · drag onto the canvas`"
          @open="selected = a.file"
          @select="selected = a.file"
        >
          <template v-if="a.outputs > 1 && tab === 'Generated'" #overlay>
            <span class="ap-stack" :aria-label="`${a.outputs} outputs`">
              <MediaChip :icon="Layers">{{ a.outputs }}</MediaChip>
            </span>
          </template>
          <template v-if="view === 'list' && a.outputs > 1 && tab === 'Generated'" #cols>
            <span class="ap-stack-row" :aria-label="`${a.outputs} outputs`"
              ><Layers :size="12" />{{ a.outputs }}</span
            >
          </template>
        </MarItem>
      </div>
    </div>
    <MarEmpty
      v-else-if="query"
      compact
      :icon="SearchX"
      title="No results"
      :text="`Nothing in ${tab} matches “${query}”.`"
      action="Clear search"
      @action="query = ''"
    />
    <MarEmpty
      v-else
      compact
      :icon="ImageOff"
      :title="tab === 'Generated' ? 'No generated files found' : 'No imported files found'"
      text="Upload files or generate content to see them here"
      :pics="PICTURES.slice(0, 3).map((p) => p.src)"
    />
  </RailPanel>
</template>

<style>
.ap-items {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 6px;
  padding: 10px 10px 16px;
}
.ap-items.is-small {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.ap-items.is-list {
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  padding: 6px 8px 12px;
}
.ap-drag {
  min-width: 0;
  cursor: grab;
}
/* In a panel the cards sit on the panel's own surface: no card behind
   them until hover, so the pictures carry the grid. */
:root .proto-ui.proto-ui.proto-ui .rp .mar-item.is-grid {
  padding: 4px 4px 6px;
  border-radius: var(--mar-tab-radius);
  background: transparent;
  backdrop-filter: none;
}
:root .proto-ui.proto-ui.proto-ui .rp .mar-item.is-grid:hover,
:root .proto-ui.proto-ui.proto-ui .rp .mar-item.is-grid.is-menu {
  background: var(--rp-hover);
}
:root .proto-ui.proto-ui.proto-ui .rp .mar-item.is-grid .mar-item-media {
  border-radius: var(--mar-tab-item-radius);
}
.rp .mar-item.is-grid .mar-item-text {
  padding: 8px 4px 0;
}
.rp .mar-item .mar-item-meta {
  color: var(--rp-meta);
  font-variant-numeric: tabular-nums;
}
.rp .ap-items.is-small .mar-item-text {
  padding-top: 6px;
}
:root .proto-ui.proto-ui.proto-ui .rp .ap-items.is-small .mar-item-name {
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .rp .mar-item.is-list {
  height: 52px;
  gap: 10px;
  padding: 0 6px;
  border-radius: var(--mar-tab-radius);
}
.rp .mar-item.is-list .mar-item-media {
  width: 40px;
  height: 40px;
}
/* The selection checkbox is for library pages; a panel selects with a click. */
:root .proto-ui.proto-ui.proto-ui .rp .mar-item-check {
  display: none;
}
.ap-stack {
  position: absolute;
  bottom: 6px;
  left: 6px;
  pointer-events: none;
}
.ap-stack-row {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  color: var(--rp-meta);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.ap-menu {
  min-width: 220px;
}
.ap-views {
  display: flex;
  margin: 2px 4px 4px;
}
:root .proto-ui.proto-ui.proto-ui .ap-views .mar-pseg-btn {
  flex: 1;
}
</style>
