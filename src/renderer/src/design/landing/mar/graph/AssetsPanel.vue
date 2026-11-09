<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Copy,
  Download,
  FileOutput,
  Grid3x3,
  ImageOff,
  Layers,
  LayoutGrid,
  Plus,
  ScanSearch,
  SearchX,
  SlidersHorizontal,
  TableOfContents,
  Trash2,
  Upload,
  Workflow,
  X
} from 'lucide-vue-next'
import { toast } from '../../useProto'
import RailPanel from './panels/RailPanel.vue'
import { PICTURES } from './panels/panelData'
import { savedAssets } from './savedAssets'
import MarSeg from '../pages/MarSeg.vue'
import MarSearchField from '../pages/MarSearchField.vue'
import MarItem from '../pages/MarItem.vue'
import MarEmpty from '../pages/MarEmpty.vue'
import MediaChip from '../MediaChip.vue'
import type { MarAsset } from '../pages/assetsStore'
import type { MenuLine } from '../pages/menu'
import AssetDetail from '../assets/AssetDetail.vue'
import AssetFilterMenu from './AssetFilterMenu.vue'
import { factsFor } from '../assets/assetFacts'
import { activeFilters, noFilter, passes, tagsIn } from '../assets/assetFilters'

/**
 * Media Assets (ComfyUI's AssetsSidebarTab), Better Asset Management
 * Phase 1: the segmented tabs, the search, a filter button (media type,
 * dates, tags: the same fields as Desktop's Filters) beside the view and
 * sort one, with a dot while something's on. A click selects, several
 * at once; Inspect asset (right-click) opens the asset full screen with
 * its details on the right and tags you can edit, the same view Desktop
 * shows read-only. Imported takes uploads, from the button or a drop on
 * the panel. An asset drags onto the canvas as an Image node.
 */
const { cloud } = defineProps<{ cloud: boolean }>()
const emit = defineEmits<{ close: []; insert: [asset: { src: string; name: string }] }>()

type View = 'list' | 'small' | 'large'
type Tab = 'Generated' | 'Imported'
const TABS: { value: Tab; label: string }[] = [
  { value: 'Generated', label: 'Generated' },
  { value: 'Imported', label: 'Imported' }
]
const tab = ref<Tab>('Generated')
const query = ref('')
const menu = ref<'' | 'view'>('')
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
const filter = ref(noFilter())
const MEDIA = [
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: '3d', label: '3D' },
  { value: 'text', label: 'Text' }
] as const

/** The panel's pictures as assets, so the details and filters read them
 *  the way Desktop does. Imported ones carry the "-in-" id. */
type PanelAsset = MarAsset & { kind: Tab; seconds: number; outputs: number; src: string }
const WHEN: [string, number][] = [
  ['12 min ago', 12],
  ['1 hour ago', 60],
  ['Yesterday', 1500],
  ['3 days ago', 4320],
  ['Last week', 9000]
]
const uploaded = ref<PanelAsset[]>([])
const ALL = computed<PanelAsset[]>(() => [
  ...uploaded.value,
  ...savedAssets.map((a, i) => ({
    id: `saved-${i}`,
    name: `${a.name}.png`,
    src: a.src,
    type: 'image' as const,
    source: 'local' as const,
    size: '1.4 MB',
    sizeMb: 1.4,
    age: 0,
    when: 'Just now',
    kind: 'Generated' as const,
    seconds: 12.4,
    outputs: 1
  })),
  ...PICTURES.map((p, i) => {
    const kind = i % 3 === 0 ? ('Imported' as const) : ('Generated' as const)
    const [when, age] = WHEN[i % WHEN.length]!
    return {
      id: kind === 'Imported' ? `pic-${i}-in-${i}` : `pic-${i}`,
      name: `${p.name}.png`,
      src: p.src,
      type: i % 7 === 3 ? ('video' as const) : ('image' as const),
      source: 'local' as const,
      size: `${(0.8 + ((i * 0.37) % 3)).toFixed(1)} MB`,
      sizeMb: 1,
      age,
      when,
      kind,
      seconds: 6 + ((i * 7.3) % 24),
      outputs: i % 4 === 1 ? 4 : 1
    }
  })
])
const inTab = computed(() => ALL.value.filter((a) => a.kind === tab.value && !a.status))
const TAGS = computed(() => tagsIn(inTab.value))
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = ALL.value.filter(
    (a) =>
      a.kind === tab.value &&
      !deleted.value.has(a.id) &&
      (!filter.value.types.length || filter.value.types.includes(a.type)) &&
      passes(a, filter.value) &&
      (!q || a.name.toLowerCase().includes(q))
  )
  if (sort.value === 'Oldest first') return [...list].reverse()
  if (sort.value.startsWith('Name')) {
    const s = [...list].sort((a, b) => a.name.localeCompare(b.name))
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
/** "PNG 512×768": the format and the size, as ComfyUI labels a file. */
function meta(a: PanelAsset): string {
  if (a.status) return a.statusLabel ?? ''
  const f = factsFor(a)
  return [f.format, f.width ? `${f.width}×${f.height}` : f.duration].filter(Boolean).join(' ')
}

// A click selects; several at once, like the product's panel.
const selected = ref(new Set<string>())
function toggle(a: PanelAsset): void {
  const next = new Set(selected.value)
  if (next.has(a.id)) next.delete(a.id)
  else next.add(a.id)
  selected.value = next
}
const deleted = ref(new Set<string>())
function remove(ids: string[]): void {
  deleted.value = new Set([...deleted.value, ...ids])
  toast(`${ids.length} asset${ids.length === 1 ? '' : 's'} deleted`)
  selected.value = new Set()
}

const detail = ref<PanelAsset | null>(null)
const finished = computed(() => shown.value.filter((a) => !a.status))

// The product's asset menu (MediaAssetContextMenu), Inspect asset first.
function lines(a: PanelAsset): MenuLine[] {
  return [
    { label: 'Inspect asset', icon: ScanSearch, run: () => (detail.value = a) },
    {
      label: 'Insert as node in workflow',
      icon: Plus,
      run: () => emit('insert', { src: a.src, name: a.name })
    },
    { label: 'Download', icon: Download, run: () => toast(`Downloading ${a.name}`) },
    'sep',
    ...(a.kind === 'Generated'
      ? ([
          {
            label: 'Open as workflow in new tab',
            icon: Workflow,
            run: () => toast(`Opened ${a.name} as a workflow`)
          },
          { label: 'Export workflow', icon: FileOutput, run: () => toast('Workflow exported') },
          'sep',
          { label: 'Copy job ID', icon: Copy, run: () => toast('Job ID copied') },
          'sep'
        ] as MenuLine[])
      : []),
    { label: 'Delete', icon: Trash2, danger: true, run: () => remove([a.id]) }
  ]
}
function drag(a: { name: string; src: string }, e: DragEvent): void {
  e.dataTransfer?.setData('text/x-mg-asset', a.src)
  e.dataTransfer?.setData('text/x-mg-name', a.name)
}

/** Upload: into this build's inputs, so it lands in Imported. Each file
 *  shows its tile while it goes up; one toast says how many came in. */
const picker = ref<HTMLInputElement>()
const dropping = ref(false)
let uploads = 0
function upload(files: FileList | null | undefined): void {
  dropping.value = false
  const list = [...(files ?? [])]
  if (!list.length) return
  tab.value = 'Imported'
  const added = list.map((file) => {
    const n = ++uploads
    return {
      id: `upload-${n}-in-${n}`,
      name: file.name,
      src: file.type.startsWith('image') ? URL.createObjectURL(file) : '',
      type: file.type.startsWith('video')
        ? ('video' as const)
        : file.type.startsWith('audio')
          ? ('audio' as const)
          : ('image' as const),
      source: 'local' as const,
      size: `${Math.max(1, Math.round(file.size / 1e3))} KB`,
      sizeMb: file.size / 1e6,
      age: 0,
      when: 'Just now',
      kind: 'Imported' as const,
      seconds: 0,
      outputs: 1,
      status: 'running' as const,
      statusLabel: 'Uploading…'
    }
  })
  uploaded.value = [...added, ...uploaded.value]
  setTimeout(() => {
    uploaded.value = uploaded.value.map((a) =>
      added.some((x) => x.id === a.id) ? { ...a, status: undefined, statusLabel: undefined } : a
    )
    toast(`${added.length} file${added.length === 1 ? '' : 's'} added`)
  }, 1200)
}
</script>

<template>
  <RailPanel title="Media Assets" @close="$emit('close')">
    <template #header>
      <MarSeg v-model="tab" :options="TABS" label="Assets" />
      <div class="rp-top">
        <MarSearchField v-model="query" placeholder="Search Assets..." />
        <button
          v-if="tab === 'Imported'"
          type="button"
          class="rp-icon is-field"
          title="Upload files"
          aria-label="Upload files"
          @click="picker?.click()"
        >
          <Upload :size="15" />
        </button>
        <input
          ref="picker"
          type="file"
          multiple
          hidden
          @change="
            (upload(($event.target as HTMLInputElement).files),
            (($event.target as HTMLInputElement).value = ''))
          "
        />
        <AssetFilterMenu v-model="filter" :types="MEDIA" :tags="TAGS" />
        <span class="rp-anchor">
          <button
            type="button"
            class="rp-icon is-field"
            :class="menu === 'view' && 'is-on'"
            :title="cloud ? 'Sort and view' : 'View settings'"
            :aria-label="cloud ? 'Sort and view' : 'View settings'"
            :aria-expanded="menu === 'view'"
            @click="menu = menu === 'view' ? '' : 'view'"
          >
            <SlidersHorizontal :size="15" />
          </button>
          <div v-if="menu === 'view'" class="rp-menu is-end ap-menu" role="menu">
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
            <span class="rp-menu-sep" />
            <p class="rp-menu-label">Sort by</p>
            <button
              v-for="s in SORTS"
              :key="s"
              type="button"
              role="menuitemradio"
              class="rp-row"
              :data-state="sort === s ? 'checked' : 'unchecked'"
              @click="((sort = s), (menu = ''))"
            >
              {{ s }}
            </button>
          </div>
        </span>
      </div>
    </template>

    <div
      class="ap-body"
      :class="dropping && 'is-dropping'"
      @dragenter="$event.dataTransfer?.types.includes('Files') && (dropping = true)"
      @dragover.prevent
      @dragleave.self="dropping = false"
      @drop.prevent="upload($event.dataTransfer?.files)"
    >
      <div v-if="dropping" class="ap-drop"><Upload :size="18" />Drop to add to Imported</div>
      <div
        v-if="shown.length"
        class="ap-items"
        :class="`is-${view}`"
        :aria-label="`${tab} assets`"
        @click.self="selected = new Set()"
      >
        <div
          v-for="a in shown"
          :key="a.id"
          class="ap-drag"
          draggable="true"
          @dragstart="drag(a, $event)"
        >
          <MarItem
            :name="a.name.replace(/\.[^.]+$/, '')"
            :thumb="a.src || undefined"
            :cover="a"
            :meta="view === 'small' ? undefined : meta(a)"
            :layout="view === 'list' ? 'list' : 'grid'"
            ratio="1 / 1"
            :status="a.status"
            :status-label="a.statusLabel"
            :selected="selected.has(a.id)"
            :selecting="selected.size > 0"
            :lines="lines(a)"
            context-menu
            menu-align="start"
            :title="`${a.name} · drag onto the canvas`"
            @open="toggle(a)"
            @select="toggle(a)"
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
        v-else-if="query || activeFilters(filter)"
        compact
        :icon="SearchX"
        title="No results"
        :text="`Nothing in ${tab} matches.`"
        action="Clear filters"
        @action="((query = ''), (filter = noFilter()))"
      />
      <MarEmpty
        v-else
        compact
        :icon="ImageOff"
        :title="tab === 'Generated' ? 'No generated files found' : 'No imported files found'"
        text="Upload files or generate content to see them here"
        :pics="PICTURES.slice(0, 3).map((p) => p.src)"
      />
    </div>
    <div v-if="selected.size" class="ap-selbar" role="toolbar" aria-label="Selection">
      <button
        type="button"
        class="rp-icon"
        aria-label="Clear selection"
        @click="selected = new Set()"
      >
        <X :size="14" />
      </button>
      <span>{{ selected.size }} selected</span>
      <button
        type="button"
        class="rp-icon"
        aria-label="Download"
        title="Download"
        @click="(toast(`Downloading ${selected.size} assets`), (selected = new Set()))"
      >
        <Download :size="14" />
      </button>
      <button
        type="button"
        class="rp-icon"
        aria-label="Delete"
        title="Delete"
        @click="remove([...selected])"
      >
        <Trash2 :size="14" />
      </button>
    </div>
    <AssetDetail
      v-if="detail"
      :asset="detail"
      :list="finished"
      :build="tab"
      editable
      @go="detail = $event as PanelAsset"
      @close="detail = null"
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
/* The check sits centred on the picture: a panel row is tighter than a page's. */
:root .proto-ui.proto-ui.proto-ui .rp .mar-item.is-list .mar-item-check {
  top: 16px !important;
  left: 16px !important;
}
:root .proto-ui.proto-ui.proto-ui .rp .mar-item.is-grid .mar-item-check {
  top: 10px;
  left: 10px;
}
/* A list row keeps its name: no empty State column eating the width. */
:root .proto-ui.proto-ui.proto-ui .rp .mar-item.is-list .mar-item-col.is-status:empty {
  display: none;
}
/* A list row keeps its name: the meta yields first. */
.rp .mar-item.is-list .mar-item-text {
  min-width: 0;
  flex: 1;
}
.ap-body {
  position: relative;
  min-height: 100%;
}
.ap-drop {
  position: absolute;
  inset: 8px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1.5px dashed color-mix(in oklch, var(--color-base-foreground) 28%, transparent);
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-content-background) 88%, transparent);
  color: var(--color-muted-foreground);
  font-size: 13px;
  pointer-events: none;
}
.ap-selbar {
  position: sticky;
  bottom: 12px;
  z-index: 3;
  display: flex;
  width: max-content;
  align-items: center;
  gap: 6px;
  margin: 0 auto;
  padding: 4px 6px 4px 4px;
  border-radius: 10px;
  background: var(--color-base-foreground);
  color: var(--color-content-background);
  font-size: 13px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.3);
}
.ap-selbar span {
  margin-right: 8px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .ap-selbar .rp-icon {
  color: var(--color-content-background);
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
