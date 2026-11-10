<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import {
  Check,
  ChevronRight,
  Copy,
  Download,
  FileOutput,
  Grid3x3,
  CloudOff,
  ImageOff,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Minus,
  AppWindow,
  Plus,
  ScanSearch,
  SearchX,
  Settings2,
  Maximize2,
  Tag,
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
import MarSearchField from '../pages/MarSearchField.vue'
import Tooltip from '../../ui/Tooltip.vue'
import MarItem from '../pages/MarItem.vue'
import MarEmpty from '../pages/MarEmpty.vue'
import { pageState } from '../pages/pageState'
import MediaChip from '../MediaChip.vue'
import type { MarAsset } from '../pages/assetsStore'
import type { MenuLine } from '../pages/menu'
import AssetDetail from '../assets/AssetDetail.vue'
import AssetFilterMenu from './AssetFilterMenu.vue'
import AssetLightbox from './AssetLightbox.vue'
import AssetSidePanel from './AssetSidePanel.vue'
import { saveFile } from '../assets/saveFile'
import BulkTagMenu from './BulkTagMenu.vue'
import { assetTab, comfyLook, graphLibrary } from './comfyLook'
import { graphStyle } from './graphStyle'
import { graphOpen } from './graphOpen'
import { RAIL_DEFAULT, railWidth } from './panels/railWidth'
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
 *
 * From the Media Assets designs: Masonry beside the grids; View settings
 * that show preview assets (hidden by default, marked PREV), file names
 * and file details; Show details, which opens the asset's details on the
 * right of the canvas and follows the selection; and the selection bar's
 * Tag, which tags every selected asset at once.
 */
const { cloud } = defineProps<{ cloud: boolean }>()
const emit = defineEmits<{
  close: []
  insert: [asset: { src: string; name: string }]
  /** Proposal: the panel grows into a whole tab. */
  expand: []
}>()

type View = 'list' | 'small' | 'large' | 'masonry'
type Tab = 'Generated' | 'Imported'
const query = ref('')
const menu = ref<'' | 'view'>('')
/** View settings › Sort by: its options open to the right, level with the row,
 *  past the panel's edge. */
const sortOpen = ref(false)
const sortRow = ref<HTMLElement>()
const sortTop = ref(0)
const sortLeft = ref(0)
function openSort(): void {
  // Fixed, in window coordinates: the panel clips what crosses its edge.
  const row = sortRow.value
  const menuBox = row?.closest('.rp-menu')?.getBoundingClientRect()
  if (row && menuBox) {
    sortTop.value = row.getBoundingClientRect().top - 5
    sortLeft.value = menuBox.right + 4
  }
  sortOpen.value = true
}
watch(menu, () => (sortOpen.value = false))
const viewAnchor = ref<HTMLElement>()
onClickOutside(viewAnchor, () => (menu.value = ''))
// Masonry by default; a pick is remembered per viewer.
const VIEW_KEY = 'Comfy.Assets.Sidebar.ViewMode.v2'
const view = ref<View>(
  (() => {
    try {
      return (localStorage.getItem(VIEW_KEY) as View) || 'masonry'
    } catch {
      return 'masonry'
    }
  })()
)
/** Size: how big the cards are, 1 (smallest) to 3. Fewer columns as it
 *  grows; the list has no size. */
const SIZES = 3
const size = ref(2)
const setSize = (n: number): void => {
  size.value = Math.min(SIZES, Math.max(1, n))
}
function setView(v: View): void {
  view.value = v
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {
    // Storage blocked: the pick lasts for this window only.
  }
}
// Masonry first, the default, as in Desktop's view toggle.
const ALL_VIEWS = [
  { value: 'masonry', label: 'Masonry', icon: LayoutDashboard },
  { value: 'large', label: 'Grid', icon: LayoutGrid },
  { value: 'list', label: 'List', icon: TableOfContents }
] as const
/** Production (UI Playground › ComfyUI): ComfyUI as it ships plus Better
 *  Assets Phase 1. Generated and Imported are tabs, the view is Grid or
 *  List, and Inspect asset opens the file in a tab beside the workflows. */
const prod = computed(() => comfyLook.id === 'production')
const tab = ref<Tab>('Generated')
// As today, View settings is ComfyUI's own (MediaAssetSettingsMenu): one
// flat list, List, Grid (small), Grid (large), then the sorts on cloud.
const PROD_VIEWS = [
  { value: 'list', label: 'List view', icon: TableOfContents },
  { value: 'small', label: 'Grid (small)', icon: Grid3x3 },
  { value: 'large', label: 'Grid (large)', icon: LayoutGrid }
] as const
const VIEWS = computed(() => (prod.value ? PROD_VIEWS : ALL_VIEWS))
// What a card shows: preview assets are off by default, so the panel
// lists what was saved.
const showPreviews = ref(false)
const showName = ref(true)
const showDetails = ref(true)
// Under Show: what a card carries, the everyday ones first.
const DISPLAY = [
  { label: 'File name', on: showName },
  { label: 'File details', on: showDetails },
  { label: 'Preview assets', on: showPreviews }
]
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
type PanelAsset = MarAsset & {
  kind: Tab
  seconds: number
  outputs: number
  src: string
  preview?: boolean
}
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
    // A video's name ends in .mp4, a picture's in .png: type and name agree.
    const video = i % 7 === 3
    return {
      id: kind === 'Imported' ? `pic-${i}-in-${i}` : `pic-${i}`,
      name: `${p.name}.${video ? 'mp4' : 'png'}`,
      src: p.src,
      type: video ? ('video' as const) : ('image' as const),
      source: 'local' as const,
      size: `${(0.8 + ((i * 0.37) % 3)).toFixed(1)} MB`,
      sizeMb: 1,
      age,
      when,
      kind,
      seconds: 6 + ((i * 7.3) % 24),
      outputs: i % 4 === 1 ? 4 : 1,
      preview: kind === 'Generated' && i % 5 === 2
    }
  })
])
/** Generated or Imported is a filter (Source), not tabs: All by default,
 *  so one search reaches every file. */
const inSource = (a: PanelAsset): boolean =>
  prod.value
    ? a.kind === tab.value
    : filter.value.source === 'all' ||
      (filter.value.source === 'generated') === (a.kind === 'Generated')
/** Which files the list holds: the tab in Production, Source otherwise. */
const source = computed(() => (prod.value ? tab.value.toLowerCase() : filter.value.source))
watch(
  prod,
  (on) => {
    // The redesign has no small grid: it reads as the large one.
    if (!on) {
      if (view.value === 'small') view.value = 'large'
      return
    }
    filter.value = { ...filter.value, source: 'all' }
    if (view.value === 'masonry') view.value = 'large'
  },
  { immediate: true }
)
const inTab = computed(() => ALL.value.filter((a) => !a.status))
/** Open in tab: the same files, now with room to organize them. */
function expand(): void {
  const keep = ALL.value.filter((a) => !deleted.value.has(a.id))
  graphLibrary.items.splice(0, graphLibrary.items.length, ...keep)
  emit('expand')
}
const TAGS = computed(() => tagsIn(inTab.value))
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = ALL.value.filter(
    (a) =>
      inSource(a) &&
      !deleted.value.has(a.id) &&
      (showPreviews.value || !a.preview) &&
      (!filter.value.types.length || filter.value.types.includes(a.type)) &&
      passes(a, { ...filter.value, source: 'all' }) &&
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
  ...(filter.value.source !== 'imported'
    ? ['Generation time (longest first)', 'Generation time (fastest first)']
    : [])
])
/** Columns follow the panel's width: dragged wider, it shows more
 *  cards rather than bigger ones (two at the default 320). */
const cols = computed(() => {
  const n = Math.max(2, Math.floor(((railWidth['Media Assets'] ?? RAIL_DEFAULT) - 20) / 150))
  if (view.value === 'list') return 1
  if (view.value === 'small') return n + 1
  return prod.value ? n : Math.max(1, n + 2 - size.value)
})
/** The cards in columns: one run for the grids and the list, balanced
 *  columns for Masonry (each card to the shortest one). */
const groups = computed<PanelAsset[][]>(() => {
  if (view.value !== 'masonry') return [shown.value]
  const out: PanelAsset[][] = Array.from({ length: cols.value }, () => [])
  const h = out.map(() => 0)
  for (const a of shown.value) {
    const i = h.indexOf(Math.min(...h))
    out[i]!.push(a)
    h[i]! += 1 / factsFor(a).ratio + 0.25
  }
  return out
})
/** "PNG 512×768": the format and the size, as ComfyUI labels a file. */
function meta(a: PanelAsset): string {
  if (a.status) return a.statusLabel ?? ''
  const f = factsFor(a)
  return [f.format, f.width ? `${f.width}×${f.height}` : f.duration].filter(Boolean).join(' ')
}

// A click selects; several at once, like the product's panel.
const selected = ref(new Set<string>())
/** Download each picked file through the browser, then clear the pick. */
function downloadSelected(): void {
  finished.value.filter((a) => selected.value.has(a.id)).forEach((a) => saveFile(a.src, a.name))
  selected.value = new Set()
}
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
// Show details: the right panel follows the selection, or the asset it
// was opened on when nothing is selected.
const side = ref<PanelAsset | null>(null)
const sideOpen = ref(false)
const sideAssets = computed(() =>
  selected.value.size
    ? ALL.value.filter((a) => selected.value.has(a.id))
    : side.value
      ? [side.value]
      : []
)
function showSide(a: PanelAsset): void {
  side.value = a
  selected.value = new Set([a.id])
  sideOpen.value = true
}
const tagging = ref(false)
const selectedAssets = computed(() => ALL.value.filter((a) => selected.value.has(a.id)))
watch(
  () => selected.value.size,
  (n) => n || (tagging.value = false)
)
const finished = computed(() => shown.value.filter((a) => !a.status))
// Desktop's Assets › Open workflow: this asset leads Generated, selected.
function takeSelect(): void {
  const want = graphOpen.select
  if (!want) return
  graphOpen.select = null
  if (!ALL.value.some((a) => a.id === want.id))
    uploaded.value = [
      {
        id: want.id,
        name: want.name,
        src: want.src ?? '',
        type: want.type as PanelAsset['type'],
        source: 'local',
        size: '2.1 MB',
        sizeMb: 2.1,
        age: 0,
        when: 'Just now',
        kind: 'Generated',
        seconds: 8.5,
        outputs: 1
      },
      ...uploaded.value
    ]
  tab.value = 'Generated'
  selected.value = new Set([want.id])
}
takeSelect()
watch(() => graphOpen.select, takeSelect)
// A share link can open the first asset in Inspect asset (graphOpen.ts).
if (graphOpen.inspect) {
  const first = finished.value[0]
  if (first) openFull(first)
  graphOpen.inspect = false
}

/** Today a click checks and a double-click opens ComfyUI's lightbox. In the
 *  proposal, as in a photo library: a click opens the asset large (our
 *  asset view, framed over the app, with its details); the check on hover
 *  selects, and once something is selected a click selects too.
 *  Inspect asset opens that same view; no second panel. With workflow tabs
 *  (the Current look) it can also open in a tab beside them. */
const lightbox = ref<PanelAsset | null>(null)
function look(a: PanelAsset): void {
  if (prod.value) lightbox.value = a
  else detail.value = a
}
const inspect = (a: PanelAsset): void => (prod.value ? showSide(a) : look(a))
const tabs = computed(() => graphStyle.id === 'current')
const fullLabel = computed(() => (tabs.value ? 'Open in new tab' : 'Open full view'))
function openFull(a: PanelAsset): void {
  if (tabs.value)
    Object.assign(assetTab, { asset: a, list: finished.value, build: a.kind, on: true })
  else detail.value = a
}

// The product's asset menu (MediaAssetContextMenu), Inspect asset first.
function lines(a: PanelAsset): MenuLine[] {
  return [
    { label: 'Inspect asset', icon: ScanSearch, run: () => inspect(a) },
    ...(prod.value || tabs.value
      ? [
          {
            label: fullLabel.value,
            icon: tabs.value ? AppWindow : Maximize2,
            run: () => openFull(a)
          }
        ]
      : []),
    {
      label: 'Insert as node in workflow',
      icon: Plus,
      run: () => emit('insert', { src: a.src, name: a.name })
    },
    { label: 'Download', icon: Download, run: () => saveFile(a.src, a.name) },
    'sep',
    // Only a run that kept its workflow offers it; it opens in a new tab,
    // so the graph you're on is never replaced.
    ...(a.kind === 'Generated' && factsFor(a).workflow === 'available'
      ? ([
          {
            label: 'Open as workflow in new tab',
            icon: Workflow,
            run: () => toast(`Opened ${a.name} as a workflow`)
          },
          { label: 'Export workflow', icon: FileOutput, run: () => toast('Workflow exported') },
          'sep'
        ] as MenuLine[])
      : []),
    ...(a.kind === 'Generated'
      ? ([
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
  if (filter.value.source === 'generated') filter.value = { ...filter.value, source: 'all' }
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
  <RailPanel title="Media Assets" :closable="prod" @close="$emit('close')">
    <template #tools>
      <Tooltip content="Upload files" side="bottom">
        <button type="button" class="rp-icon" aria-label="Upload files" @click="picker?.click()">
          <Upload :size="15" />
        </button>
      </Tooltip>
      <Tooltip v-if="!prod" content="Open in tab" side="bottom">
        <button type="button" class="rp-icon" aria-label="Open in tab" @click="expand">
          <Maximize2 :size="15" />
        </button>
      </Tooltip>
    </template>
    <template #header>
      <div v-if="prod" class="mar-pseg ap-tabs" role="tablist" aria-label="Assets">
        <button
          v-for="t in ['Generated', 'Imported'] as const"
          :key="t"
          type="button"
          role="tab"
          class="mar-pseg-btn"
          :aria-selected="tab === t"
          @click="((tab = t), (selected = new Set()))"
        >
          {{ t }}
        </button>
      </div>
      <div class="rp-top">
        <MarSearchField v-model="query" placeholder="Search Assets..." />
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
        <AssetFilterMenu v-model="filter" :types="MEDIA" :tags="TAGS" :source="!prod" />
        <span ref="viewAnchor" class="rp-anchor">
          <button
            type="button"
            class="rp-icon is-field"
            :class="menu && 'is-on'"
            :title="cloud ? 'Sort and view' : 'View settings'"
            :aria-label="cloud ? 'Sort and view' : 'View settings'"
            :aria-expanded="!!menu"
            @click="menu = menu ? '' : 'view'"
          >
            <!-- As today it's ComfyUI's settings icon; the proposal's is
                 Layout, the same whatever the view. -->
            <Settings2 v-if="prod" :size="15" />
            <LayoutGrid v-else :size="15" />
          </button>
          <div v-if="menu === 'view' && prod" class="rp-menu is-end ap-menu" role="menu">
            <button
              v-for="v in PROD_VIEWS"
              :key="v.value"
              type="button"
              role="menuitemradio"
              class="rp-row ap-check"
              :aria-checked="view === v.value"
              @click="setView(v.value)"
            >
              <component :is="v.icon" :size="14" /><span>{{ v.label }}</span
              ><Check :size="14" :class="view !== v.value && 'opacity-0'" />
            </button>
            <template v-if="cloud">
              <span class="rp-menu-sep" />
              <button
                v-for="o in SORTS"
                :key="o"
                type="button"
                role="menuitemradio"
                class="rp-row ap-check"
                :aria-checked="sort === o"
                @click="sort = o"
              >
                <span>{{ o }}</span
                ><Check :size="14" :class="sort !== o && 'opacity-0'" />
              </button>
            </template>
          </div>
          <div v-else-if="menu === 'view'" class="rp-menu is-end ap-menu" role="menu">
            <div class="ap-layout-head">
              <p class="rp-menu-label">Layout</p>
              <div
                class="mar-pseg ap-views"
                role="radiogroup"
                aria-label="View"
                @mouseenter="sortOpen = false"
              >
                <button
                  v-for="v in VIEWS"
                  :key="v.value"
                  type="button"
                  role="radio"
                  class="mar-pseg-btn ap-view"
                  :aria-checked="view === v.value"
                  :aria-selected="view === v.value"
                  :aria-label="v.label"
                  :title="v.label"
                  @click="setView(v.value)"
                >
                  <component :is="v.icon" :size="15" />
                </button>
              </div>
            </div>
            <div v-if="view !== 'list'" class="ap-size" @mouseenter="sortOpen = false">
              <span class="ap-cap">Size</span>
              <button
                type="button"
                class="ap-size-btn"
                aria-label="Smaller"
                :disabled="size <= 1"
                @click="setSize(size - 1)"
              >
                <Minus :size="13" />
              </button>
              <div class="ap-size-bar" role="group" aria-label="Size">
                <button
                  v-for="n in SIZES"
                  :key="n"
                  type="button"
                  :class="n <= size && 'is-on'"
                  :aria-label="`Size ${n}`"
                  :aria-pressed="n === size"
                  @click="setSize(n)"
                />
              </div>
              <button
                type="button"
                class="ap-size-btn"
                aria-label="Bigger"
                :disabled="size >= SIZES"
                @click="setSize(size + 1)"
              >
                <Plus :size="13" />
              </button>
            </div>
            <button
              ref="sortRow"
              type="button"
              role="menuitem"
              class="rp-row ap-check"
              :class="sortOpen && 'is-open'"
              aria-haspopup="menu"
              :aria-expanded="sortOpen"
              @click="openSort"
              @mouseenter="openSort"
            >
              <span class="ap-cap">Sort by</span><span class="ap-menu-val">{{ sort }}</span
              ><ChevronRight :size="14" />
            </button>
            <span class="rp-menu-sep" />
            <p class="rp-menu-label">Show</p>
            <button
              v-for="d in DISPLAY"
              :key="d.label"
              type="button"
              role="menuitemcheckbox"
              class="rp-row ap-check"
              :aria-checked="d.on.value"
              @click="d.on.value = !d.on.value"
              @mouseenter="sortOpen = false"
            >
              <span>{{ d.label }}</span
              ><Check v-if="d.on.value" :size="14" />
            </button>
          </div>
          <!-- Sort by opens beside the menu, to the right, as a submenu. -->
          <div
            v-if="menu === 'view' && !prod && sortOpen"
            class="rp-menu ap-menu ap-sub"
            role="menu"
            aria-label="Sort by"
            :style="{ top: `${sortTop}px`, left: `${sortLeft}px` }"
          >
            <button
              v-for="o in SORTS"
              :key="o"
              type="button"
              role="menuitemradio"
              class="rp-row ap-check"
              :aria-checked="sort === o"
              @click="((sort = o), (menu = ''))"
            >
              <span>{{ o }}</span
              ><Check v-if="sort === o" :size="14" />
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
      <!-- Page state (UI Playground): reading the assets, or the server
           not answering, with Try again (PRD P1-02). -->
      <div v-if="pageState.id === 'loading'" class="ap-skel" aria-label="Loading assets">
        <i v-for="n in 8" :key="n" />
      </div>
      <MarEmpty
        v-else-if="pageState.id === 'error'"
        compact
        :icon="CloudOff"
        title="Couldn’t load assets"
        text="ComfyUI didn’t answer. Your files are safe."
        action="Try again"
        @action="pageState.id = 'live'"
      />
      <div
        v-else-if="shown.length"
        class="ap-items"
        :class="[`is-${view}`, !showName && 'no-name', !showDetails && 'no-meta']"
        :style="{ '--ap-cols': cols }"
        :aria-label="`${source === 'all' ? 'All' : source === 'generated' ? 'Generated' : 'Imported'} assets`"
        @click.self="selected = new Set()"
      >
        <div v-for="(col, ci) in groups" :key="ci" class="ap-col">
          <div
            v-for="a in col"
            :key="a.id"
            class="ap-drag"
            draggable="true"
            @dragstart="drag(a, $event)"
            @dblclick="prod && !a.status && look(a)"
          >
            <MarItem
              :name="a.name.replace(/\.[^.]+$/, '')"
              :thumb="a.src || undefined"
              :cover="a"
              :meta="view === 'small' ? undefined : meta(a)"
              :layout="view === 'list' ? 'list' : 'grid'"
              :ratio="view === 'masonry' ? String(factsFor(a).ratio) : '1 / 1'"
              :status="a.status"
              :status-label="a.statusLabel"
              :selected="selected.has(a.id)"
              :selecting="selected.size > 0"
              :lines="lines(a)"
              context-menu
              menu-align="start"
              :title="`${a.name} · drag onto the canvas`"
              @open="prod || a.status ? toggle(a) : look(a)"
              @select="toggle(a)"
            >
              <template v-if="(a.outputs > 1 && a.kind === 'Generated') || a.preview" #overlay>
                <span
                  v-if="a.outputs > 1 && a.kind === 'Generated'"
                  class="ap-stack"
                  :aria-label="`${a.outputs} outputs`"
                >
                  <MediaChip :icon="Layers">{{ a.outputs }}</MediaChip>
                </span>
                <span v-if="a.preview" class="ap-prev" title="Preview asset, not saved">Prev</span>
              </template>
              <template v-if="view === 'list' && a.outputs > 1 && a.kind === 'Generated'" #cols>
                <span class="ap-stack-row" :aria-label="`${a.outputs} outputs`"
                  ><Layers :size="12" />{{ a.outputs }}</span
                >
              </template>
            </MarItem>
          </div>
        </div>
      </div>
      <MarEmpty
        v-else-if="query || activeFilters(filter)"
        compact
        :icon="SearchX"
        title="No results"
        :text="
          source === 'all'
            ? 'Nothing matches.'
            : `Nothing in ${source === 'generated' ? 'Generated' : 'Imported'} matches.`
        "
        action="Clear filters"
        @action="((query = ''), (filter = noFilter()))"
      />
      <MarEmpty
        v-else
        compact
        :icon="ImageOff"
        :title="
          source === 'imported'
            ? 'No imported files found'
            : source === 'generated'
              ? 'No generated files found'
              : 'No files yet'
        "
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
        @click="downloadSelected"
      >
        <Download :size="14" />
      </button>
      <button
        type="button"
        class="rp-icon"
        :class="tagging && 'is-on'"
        aria-label="Tag"
        title="Tag"
        :aria-expanded="tagging"
        @click="tagging = !tagging"
      >
        <Tag :size="14" />
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
      <BulkTagMenu
        v-if="tagging"
        :selected="selectedAssets"
        :pool="inTab"
        @close="tagging = false"
      />
    </div>
    <AssetDetail
      v-if="detail"
      :asset="detail"
      :list="finished"
      :build="detail.kind"
      editable
      :on-tab="tabs ? (a: MarAsset) => ((detail = null), openFull(a as PanelAsset)) : undefined"
      @go="detail = $event as PanelAsset"
      @close="detail = null"
    />
    <AssetLightbox
      v-if="lightbox"
      :asset="lightbox"
      :list="finished"
      @go="lightbox = $event as PanelAsset"
      @close="lightbox = null"
    />
  </RailPanel>
  <!-- Show details: on the right of the canvas, outside the panel. -->
  <AssetSidePanel
    v-if="sideOpen"
    :assets="sideAssets"
    :open-label="fullLabel"
    @close="sideOpen = false"
    @inspect="openFull($event as PanelAsset)"
  />
</template>

<style>
/* Production: Generated and Imported as ComfyUI's tabs, above the search. */
.ap-tabs {
  display: flex;
  margin: 0 12px 8px;
}
:root .proto-ui.proto-ui.proto-ui .ap-tabs .mar-pseg-btn {
  flex: 1;
}
.ap-items {
  display: grid;
  grid-template-columns: repeat(var(--ap-cols, 2), minmax(0, 1fr));
  gap: 8px 6px;
  padding: 10px 10px 16px;
}
.ap-items.is-small {
  gap: 6px;
}
.ap-items.is-list {
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  padding: 6px 8px 12px;
}
.ap-col {
  display: contents;
}
.ap-items.is-masonry {
  align-items: start;
}
.ap-items.is-masonry .ap-col {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}
.ap-items.no-name .mar-item-name,
.ap-items.no-meta .mar-item-meta {
  display: none;
}
:root .proto-ui.proto-ui.proto-ui .rp .ap-items.no-name.no-meta .mar-item-text {
  display: none;
}
.ap-prev {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--color-base-foreground);
  color: var(--color-content-background);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  pointer-events: none;
  text-transform: uppercase;
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
  min-width: 240px;
}
.rp-menu.ap-sub {
  position: fixed;
  min-width: 180px;
}
:root .proto-ui.proto-ui.proto-ui .rp-menu .rp-row.ap-check.is-open {
  background: var(--rp-hover);
}
/* View settings: the view named beside its label; each display option
   says its state with a check on the right; Sort by drills into its own
   list beside it, to the right. */
.ap-menu-head {
  display: flex;
  justify-content: space-between;
}
.ap-menu-head span {
  color: var(--rp-text);
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
}
:root .proto-ui.proto-ui.proto-ui .rp-menu .rp-row.ap-check,
:root .proto-ui.proto-ui.proto-ui .rp-menu .rp-row.ap-back {
  display: flex;
  align-items: center;
  gap: 8px;
  background: transparent;
}
:root .proto-ui.proto-ui.proto-ui .rp-menu .rp-row.ap-check:hover,
:root .proto-ui.proto-ui.proto-ui .rp-menu .rp-row.ap-back:hover {
  background: var(--rp-hover);
}
.ap-check > span:first-child,
.ap-check > svg:first-child + span {
  min-width: 0;
  flex: 1;
}
.ap-check > svg,
.ap-back > svg {
  flex: none;
  color: var(--rp-meta);
}
.ap-check > svg:last-child:not(:first-child) {
  color: var(--rp-text);
}
.ap-menu-val {
  overflow: hidden;
  color: var(--rp-meta);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ap-back {
  font-weight: 500;
}
/* LAYOUT, then its views as icon tabs on the same line (the picked one
   with its name). */
.ap-layout-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-right: 4px;
}
.ap-views {
  display: flex;
}
/* The tab group hugs its three icons, inside the menu. */
:root .proto-ui.proto-ui.proto-ui .rp-controls .ap-views {
  flex: none;
  width: auto;
  min-width: 0;
}
/* Icons alone here: the panel is narrow, so names would crowd the row.
 * Each tab hugs its icon (the panel's tabs elsewhere share the width). */
:root .proto-ui.proto-ui.proto-ui .rp-controls .ap-views .ap-view {
  flex: none;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .rp-controls .ap-views .ap-view:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -2px;
}
:root .proto-ui.proto-ui.proto-ui .ap-views .ap-view {
  display: inline-flex;
  min-width: 30px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  font-size: 12px;
}
/* Size and Sort by read as the section labels, like Assets' Layout menu. */
:root .proto-ui.proto-ui.proto-ui .ap-cap {
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
/* Size: − a stepped bar +. */
.ap-size {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 4px;
  font-size: 13px;
}
.ap-size > span {
  flex: 1;
}
:root .proto-ui.proto-ui.proto-ui .ap-size-btn {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .ap-size-btn:hover:not(:disabled) {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .ap-size-btn:disabled {
  opacity: 0.35;
}
.ap-size-bar {
  display: flex;
  width: 96px;
  height: 18px;
  overflow: hidden;
  border-radius: 6px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .ap-size-bar button {
  flex: 1;
  padding: 0;
  border-radius: 0;
  background: transparent;
}
:root .proto-ui.proto-ui.proto-ui .ap-size-bar button + button {
  box-shadow: inset 1px 0 0 color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .ap-size-bar button.is-on {
  background: color-mix(in oklch, var(--color-base-foreground) 38%, transparent);
}
.ap-skel {
  display: grid;
  grid-template-columns: repeat(var(--ap-cols, 2), minmax(0, 1fr));
  gap: 8px;
  padding: 8px;
}
.ap-skel i {
  aspect-ratio: 1;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  animation: ap-skel 1.4s ease-in-out infinite;
}
@keyframes ap-skel {
  50% {
    opacity: 0.5;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ap-skel i {
    animation: none;
  }
}
</style>
