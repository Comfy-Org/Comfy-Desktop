<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useElementSize, useEventListener } from '@vueuse/core'
import {
  Box,
  Copy,
  Download,
  File as FileIcon,
  FileText,
  ExternalLink,
  FolderOpen,
  ImagePlus,
  Music,
  Play,
  RefreshCw,
  RotateCw,
  Trash2,
  Upload,
  Workflow,
  X
} from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Select from '../../ui/Select.vue'
import { ComfyAssets } from '../icons/comfyIcons'
import { thumb } from '../../mock'
import { go, toast } from '../../useProto'
import AssetBuildPicker from '../assets/AssetBuildPicker.vue'
import AssetDetail from '../assets/AssetDetail.vue'
import AssetFilterMenu from '../graph/AssetFilterMenu.vue'
import { factsFor } from '../assets/assetFacts'
import { noFilter, passes, tagsIn } from '../assets/assetFilters'
import { assetBuilds, buildStatus, defaultBuild, startBuild } from '../assets/assetBuilds'
import MarPage from './MarPage.vue'
import { EMPTY_PICS } from './emptyArt'
import MarEmpty from './MarEmpty.vue'
import MarItem from './MarItem.vue'
import MarSeg from './MarSeg.vue'
import AssetSearch from '../assets/AssetSearch.vue'
import MarSelectBar from './MarSelectBar.vue'
import MarViewToggle from './MarViewToggle.vue'
import { assets, type MarAsset } from './assetsStore'
import { useLibrary } from './library'
import { pageState } from './pageState'
import { notify } from './undo'
import type { MenuLine } from './menu'

/**
 * Assets (Mar's proposal): everything your runs made and everything you
 * brought in. One build at a time (Better Asset Management PRD, Phase 2):
 * the picker says whose catalog this is and whether that build is
 * running; a stopped build offers to start, nothing starts on its own.
 * Runs still going sit first (generating, queued), a failed one says so
 * and offers a retry. Masonry by default, each picture in its shape;
 * grid or list like the other library pages. A picture opens its
 * details (AssetDetail), tags read-only. Inside a project the page keeps
 * the project's own scope.
 */
const { project: fixedProject } = defineProps<{ project?: string }>()

type Kind = 'all' | MarAsset['type']
const kind = ref<Kind>('all')
const where = ref('all')
const build = ref(defaultBuild())
const filter = ref(noFilter())
const project = ref('all')
const sort = ref('newest')
const query = ref('')

// Everywhere reads every running build at once; each card names its own.
const running = computed(() =>
  assetBuilds.value.filter((b) => buildStatus(b) === 'running').map((b) => b.id)
)
const base = computed(() =>
  assets.items.filter((a) =>
    fixedProject
      ? a.project === fixedProject
      : build.value === 'all'
        ? running.value.includes(a.envId ?? '')
        : a.envId === build.value
  )
)
const current = computed(() => assetBuilds.value.find((b) => b.id === build.value))
const buildName = (a: MarAsset): string =>
  assetBuilds.value.find((b) => b.id === a.envId)?.name ?? ''
const status = computed(() => (current.value ? buildStatus(current.value) : 'running'))
const browsable = computed(() => !!fixedProject || status.value === 'running')
const count = (k: Kind): number => base.value.filter((a) => k === 'all' || a.type === k).length
const KINDS = computed(() =>
  (
    [
      ['all', 'All'],
      ['image', 'Images'],
      ['video', 'Videos'],
      ['3d', '3D'],
      ['audio', 'Audio']
    ] as const
  ).map(([value, label]) => ({ value: value as Kind, label, count: count(value) }))
)
const WHERE = [
  { value: 'all', label: 'Everywhere' },
  { value: 'local', label: 'This computer' },
  { value: 'cloud', label: 'Cloud' }
]
const TAGS = computed(() => tagsIn(base.value))
/** Type's tabs cover the main kinds; Filters adds the rest. */
const MORE_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'other', label: 'Other' }
] as const
const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'largest', label: 'Largest' },
  { value: 'name', label: 'Name' }
]

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = base.value.filter(
    (a) =>
      // The type tabs and More types add up: either may match.
      ((kind.value === 'all' && !filter.value.types.length) ||
        a.type === kind.value ||
        filter.value.types.includes(a.type)) &&
      (!fixedProject || where.value === 'all' || a.source === where.value) &&
      passes(a, filter.value) &&
      (fixedProject ||
        project.value === 'all' ||
        (project.value === 'none' ? !a.project : a.project === project.value)) &&
      (!q || a.name.toLowerCase().includes(q))
  )
  const by: Record<string, (a: MarAsset, b: MarAsset) => number> = {
    newest: (a, b) => a.age - b.age,
    oldest: (a, b) => b.age - a.age,
    largest: (a, b) => b.sizeMb - a.sizeMb,
    name: (a, b) => a.name.localeCompare(b.name)
  }
  return [...list].sort(by[sort.value])
})
const filtered = computed(
  () =>
    kind.value !== 'all' ||
    where.value !== 'all' ||
    JSON.stringify(filter.value) !== JSON.stringify(noFilter()) ||
    project.value !== 'all' ||
    !!query.value
)
function clear(): void {
  kind.value = 'all'
  where.value = 'all'
  filter.value = noFilter()
  project.value = 'all'
  query.value = ''
}

const lib = useLibrary(assets, shown)
// Its own view: masonry first, remembered per viewer.
type View = 'masonry' | 'grid' | 'list'
const VIEW_KEY = 'comfy.design.mar.assetsPageView'
const view = ref<View>(
  (() => {
    try {
      return (localStorage.getItem(VIEW_KEY) as View | null) ?? 'masonry'
    } catch {
      return 'masonry'
    }
  })()
)
watch(view, (v) => {
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {
    // Storage blocked: the pick lasts for this window only.
  }
})

/** Masonry: as many columns as fit, each picture to the shortest one, so
 *  reading order stays left to right, top to bottom. */
const wall = ref<HTMLElement>()
const { width: wallWidth } = useElementSize(wall)
const columns = computed(() => {
  const n = Math.max(1, Math.floor((wallWidth.value + 14) / (264 + 14)))
  const cols = Array.from({ length: n }, () => ({ h: 0, items: [] as MarAsset[] }))
  for (const a of shown.value) {
    const col = cols.reduce((low, c) => (c.h < low.h ? c : low))
    col.items.push(a)
    col.h += 1 / factsFor(a).ratio + 0.2
  }
  return cols
})

// Another build is another catalog: nothing of the last one stays.
const detail = ref<MarAsset | null>(null)
watch(build, () => {
  detail.value = null
  filter.value = { ...filter.value, tags: [] }
  lib.sel.clear()
})
const finished = computed(() => shown.value.filter((a) => !a.status))

const meta = (a: MarAsset): string =>
  a.status && a.status !== 'failed'
    ? [a.source === 'cloud' ? 'Cloud' : 'This computer', !fixedProject && a.project]
        .filter(Boolean)
        .join(' · ')
    : [a.when, a.size, build.value === 'all' ? buildName(a) : !fixedProject && a.project]
        .filter((x) => x && x !== '—')
        .join(' · ')
const iconOf = (a: MarAsset) =>
  ({ audio: Music, '3d': Box, text: FileText, other: FileIcon })[a.type as string] ?? ImagePlus
const picOf = (a: MarAsset): string | undefined =>
  a.src ?? (a.thumbId ? thumb(a.thumbId) : undefined)

// Refresh re-reads the build: a beat of the spinner, nothing else moves.
const refreshing = ref(false)
function refresh(): void {
  refreshing.value = true
  setTimeout(() => (refreshing.value = false), 700)
}

/** Upload: into the picked build's inputs, through that build. Only a
 *  local build that's running takes files; nothing starts on its own. */
const uploadable = computed(
  () =>
    !!fixedProject ||
    (!!current.value && current.value.kind !== 'cloud' && status.value === 'running')
)
const uploadTitle = computed(() =>
  fixedProject || uploadable.value
    ? `Add files to ${fixedProject ?? current.value?.name} inputs`
    : build.value === 'all'
      ? 'Pick a build to add files to'
      : current.value?.kind === 'cloud'
        ? 'Upload to Comfy Cloud from Comfy Cloud'
        : `Start ${current.value?.name} to add files`
)
const picker = ref<HTMLInputElement>()
const dropping = ref(false)
let uploads = 0
function upload(files: FileList | null | undefined): void {
  dropping.value = false
  if (!files?.length || !uploadable.value) return
  const added = [...files].map((file) => {
    const n = ++uploads
    const type: MarAsset['type'] = file.type.startsWith('image')
      ? 'image'
      : file.type.startsWith('video')
        ? 'video'
        : file.type.startsWith('audio')
          ? 'audio'
          : /\.(md|txt|json|csv)$/i.test(file.name)
            ? 'text'
            : 'other'
    const a: MarAsset = {
      id: `up-${n}-in-${n}`,
      name: file.name,
      type,
      source: 'local',
      src: type === 'image' ? URL.createObjectURL(file) : undefined,
      envId: current.value?.id,
      project: fixedProject,
      size:
        file.size > 1e6 ? `${(file.size / 1e6).toFixed(1)} MB` : `${Math.ceil(file.size / 1e3)} KB`,
      sizeMb: file.size / 1e6,
      age: -5,
      when: 'Just now',
      status: 'running',
      statusLabel: 'Uploading'
    }
    assets.items.unshift(a)
    return a
  })
  setTimeout(() => {
    for (const a of added) {
      const live = assets.items.find((x) => x.id === a.id)
      if (live) Object.assign(live, { status: undefined, statusLabel: undefined, age: 0 })
    }
    const hidden = added.filter((a) => !shown.value.some((s) => s.id === a.id)).length
    const n = added.length
    toast(`${n} file${n === 1 ? '' : 's'} added${hidden ? `, ${hidden} hidden by filters` : ''}`)
  }, 1200)
}
useEventListener(window, 'dragenter', (e: DragEvent) => {
  if (e.dataTransfer?.types.includes('Files')) dropping.value = true
})
useEventListener(window, 'dragend', () => (dropping.value = false))
function pick(): void {
  if (uploadable.value) picker.value?.click()
}

function open(a: MarAsset): void {
  if (a.status === 'running' || a.status === 'queued')
    toast(`${a.name} is still ${a.status === 'running' ? 'generating' : 'in the queue'}`)
  else if (a.status === 'failed') retry(a)
  else detail.value = a
}
function retry(a: MarAsset): void {
  const before = { status: a.status, statusLabel: a.statusLabel }
  a.status = 'queued'
  a.statusLabel = 'Queued · 1st'
  notify(`Queued “${a.name}” again`, () => Object.assign(a, before))
}
function cancel(a: MarAsset): void {
  assets.remove([a.id])
}

function lines(a: MarAsset): MenuLine[] {
  if (a.status === 'running' || a.status === 'queued')
    return [
      { label: 'Open its workflow', icon: Workflow, run: () => go('workflows') },
      'sep',
      {
        label: a.status === 'running' ? 'Stop' : 'Remove from queue',
        icon: X,
        danger: true,
        run: () => cancel(a)
      }
    ]
  if (a.status === 'failed')
    return [
      { label: 'Run again', icon: RotateCw, run: () => retry(a) },
      { label: 'Open its workflow', icon: Workflow, run: () => go('workflows') },
      { label: 'Copy error', icon: Copy, run: () => toast('Error copied') },
      'sep',
      { label: 'Dismiss', icon: Trash2, danger: true, run: () => assets.remove([a.id]) }
    ]
  return [
    { label: 'Open', icon: ExternalLink, run: () => open(a) },
    a.source === 'cloud'
      ? { label: 'Download', icon: Download, run: () => toast(`Downloading ${a.name}`) }
      : { label: 'Show in Finder', icon: FolderOpen, run: () => toast(`Revealed ${a.name}`) },
    { label: 'Open its workflow', icon: Workflow, run: () => go('workflows') },
    { label: 'Copy', icon: Copy, hint: '⌘C', run: () => toast('Copied to the clipboard') },
    lib.moveLine(() => [a.id], a.project),
    'sep',
    { label: 'Delete', icon: Trash2, danger: true, hint: '⌫', run: () => assets.remove([a.id]) }
  ]
}

// The sticky toolbar takes a background only once it's stuck at the top,
// so it sits clear at the start of the page and stays readable over the
// grid when you scroll.
function markStuck(): void {
  const bar = document.querySelector<HTMLElement>('.mar-page-bar:has(.mar-asset-tools)')
  const scroller = bar?.closest<HTMLElement>('.proto-main')
  if (!bar || !scroller) return
  const stuck =
    scroller.scrollTop > 0 &&
    bar.getBoundingClientRect().top <= scroller.getBoundingClientRect().top + 1
  bar.classList.toggle('is-stuck', stuck)
}
useEventListener(window, 'scroll', markStuck, { capture: true, passive: true })
</script>

<template>
  <MarPage
    title="Assets"
    :skeleton="view === 'list' ? 'list' : 'grid'"
    :no-results="browsable && shown.length === 0 && filtered"
    :embedded="!!fixedProject"
    :toolbar-to="fixedProject ? '#mar-proj-tools' : undefined"
    :state="pageState.id === 'live' ? (!browsable || base.length ? 'live' : 'empty') : undefined"
    :empty="{
      icon: ComfyAssets,
      title: fixedProject
        ? 'No assets in this project yet'
        : `Nothing made on ${current?.name ?? 'your running builds'} yet`,
      text: fixedProject
        ? 'What this project’s workflows make lands here. Run one, or upload references to work from.'
        : 'Every image, video and sound your runs make lands here, with the workflow that made it. Run a template to see your first one.',
      pics: EMPTY_PICS.assets,
      action: fixedProject ? 'Upload files' : 'Run a template',
      second: fixedProject ? undefined : 'Upload files'
    }"
    :error-text="
      fixedProject
        ? 'Cloud assets are out of reach. The ones on this computer are all here.'
        : `${current?.name ?? 'This build'} stopped answering. Start it again, or pick another build.`
    "
    @action="fixedProject ? pick() : go('explore')"
    @second="pick()"
    @clear="clear"
  >
    <template #actions="{ state }">
      <Button
        v-if="state === 'live' || state === 'loading'"
        variant="primary"
        :disabled="!uploadable"
        :title="uploadTitle"
        @click="pick()"
        ><Upload :size="15" />Upload</Button
      >
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
    </template>

    <template #toolbar>
      <div class="mar-asset-tools">
        <AssetBuildPicker v-if="!fixedProject" v-model="build" />
        <MarSeg
          v-if="!fixedProject && browsable"
          v-model="kind"
          class="mar-asset-seg"
          :options="KINDS"
          label="Type"
        />
        <div v-if="browsable" class="mar-asset-tools-end">
          <Select
            v-model="kind"
            :class="['w-32', !fixedProject && 'mar-asset-kind']"
            :options="
              KINDS.map((k) => ({
                value: k.value,
                label: k.value === 'all' ? 'All types' : k.label
              }))
            "
          />
          <Select v-if="fixedProject" v-model="where" :options="WHERE" class="w-36" />
          <button
            v-if="!fixedProject"
            type="button"
            class="mar-asset-refresh"
            aria-label="Refresh"
            title="Refresh"
            @click="refresh"
          >
            <RefreshCw :size="14" :class="refreshing && 'animate-spin'" />
          </button>
          <AssetFilterMenu
            v-model="filter"
            field
            source
            range
            types-label="More types"
            :types="MORE_TYPES"
            :tags="TAGS"
          />
          <Select v-model="sort" :options="SORTS" label="Sort" class="mar-asset-sort w-34" />
          <AssetSearch v-model:query="query" v-model:filter="filter" :tags="TAGS" />
          <MarViewToggle v-model="view" masonry />
        </div>
      </div>
    </template>

    <MarEmpty
      v-if="!browsable && current"
      :icon="ComfyAssets"
      :title="
        status === 'launching' ? `Starting ${current.name}…` : `${current.name} isn’t running`
      "
      text="Assets are read from the build itself. Start it to browse what it made, or pick another build."
      :action="status === 'launching' ? undefined : `Start ${current.name}`"
      compact
      @action="startBuild(current.id)"
    />
    <div
      v-else-if="dropping"
      class="mar-asset-drop"
      @dragleave.self="dropping = false"
      @dragover.prevent
      @drop.prevent="upload($event.dataTransfer?.files)"
    >
      <Upload :size="20" />{{
        uploadable ? `Add to ${current?.name ?? fixedProject} inputs` : uploadTitle
      }}
    </div>
    <div v-else-if="view === 'masonry'" ref="wall" class="mar-masonry">
      <div v-for="(col, i) in columns" :key="i" class="mar-masonry-col">
        <MarItem
          v-for="a in col.items"
          :key="a.id"
          :name="a.name"
          :thumb="picOf(a)"
          :icon="iconOf(a)"
          :cover="a"
          :ratio="String(factsFor(a).ratio)"
          :meta="meta(a)"
          :status="a.status"
          :status-label="a.statusLabel"
          :fav-id="a.status ? undefined : a.id"
          fav-kind="asset"
          :lines="lines(a)"
          :selected="lib.sel.has(a.id)"
          :selecting="lib.sel.ids.value.size > 0"
          :renaming="lib.renaming.value === a.id"
          :class="a.status === 'running' && 'mar-asset-running'"
          @open="open(a)"
          @select="lib.pick(a.id, $event)"
          @start-rename="lib.renaming.value = a.id"
          @rename="lib.rename(a.id, $event)"
          @cancel-rename="lib.renaming.value = ''"
        >
          <template #overlay>
            <span v-if="a.status === 'running'" class="mar-asset-progress"
              ><i style="width: 62%"
            /></span>
            <span v-else-if="a.type === 'video' && !a.status" class="mar-asset-len"
              ><Play :size="10" />{{ factsFor(a).duration }}</span
            >
          </template>
        </MarItem>
      </div>
    </div>
    <div v-else-if="view === 'grid'" class="mar-grid is-wide">
      <MarItem
        v-for="a in shown"
        :key="a.id"
        :name="a.name"
        :thumb="picOf(a)"
        :icon="iconOf(a)"
        :cover="a"
        ratio="4 / 3"
        :meta="meta(a)"
        :status="a.status"
        :status-label="a.statusLabel"
        :fav-id="a.status ? undefined : a.id"
        fav-kind="asset"
        :lines="lines(a)"
        :selected="lib.sel.has(a.id)"
        :selecting="lib.sel.ids.value.size > 0"
        :renaming="lib.renaming.value === a.id"
        :class="a.status === 'running' && 'mar-asset-running'"
        @open="open(a)"
        @select="lib.pick(a.id, $event)"
        @start-rename="lib.renaming.value = a.id"
        @rename="lib.rename(a.id, $event)"
        @cancel-rename="lib.renaming.value = ''"
      >
        <template v-if="a.status === 'running'" #overlay>
          <span class="mar-asset-progress"><i style="width: 62%" /></span>
        </template>
      </MarItem>
    </div>
    <div v-else class="mar-table is-items" style="--mar-cols: minmax(0, 200px) 88px 120px">
      <div class="mar-table-head">
        <span>Name</span><span>Project</span><span class="is-num">Size</span><span>Made</span
        ><span class="is-end">State</span><span />
      </div>
      <MarItem
        v-for="a in shown"
        :key="a.id"
        layout="list"
        :name="a.name"
        :thumb="picOf(a)"
        :icon="iconOf(a)"
        :cover="a"
        :meta="a.source === 'cloud' ? 'Cloud' : 'This computer'"
        :status="a.status"
        :status-label="a.statusLabel"
        :fav-id="a.status ? undefined : a.id"
        fav-kind="asset"
        :lines="lines(a)"
        :selected="lib.sel.has(a.id)"
        :selecting="lib.sel.ids.value.size > 0"
        :renaming="lib.renaming.value === a.id"
        @open="open(a)"
        @select="lib.pick(a.id, $event)"
        @start-rename="lib.renaming.value = a.id"
        @rename="lib.rename(a.id, $event)"
        @cancel-rename="lib.renaming.value = ''"
      >
        <template #cols>
          <span class="mar-item-col">{{ a.project ?? '—' }}</span>
          <span class="mar-item-col is-num">{{ a.size }}</span>
          <span class="mar-item-col">{{ a.when }}</span>
        </template>
      </MarItem>
    </div>

    <MarSelectBar
      :n="lib.sel.ids.value.size"
      noun="asset"
      :actions="[
        {
          label: 'Download',
          icon: Download,
          run: () => (toast(`Downloading ${lib.selected.value.length} assets`), lib.sel.clear())
        },
        lib.moveLine(() => lib.selected.value),
        { label: 'Delete', icon: Trash2, danger: true, run: lib.removeSelected }
      ]"
      @clear="lib.sel.clear()"
      @all="lib.sel.all(lib.order.value)"
    />
    <AssetDetail
      v-if="detail"
      :asset="detail"
      :list="finished"
      :build="fixedProject ? fixedProject : buildName(detail)"
      @go="detail = $event"
      @close="detail = null"
    />
  </MarPage>
</template>

<style>
/* The toolbar stays in reach while the wall scrolls. */
.mar-page-bar:has(.mar-asset-tools) {
  position: sticky;
  /* The scroller's own top padding (pt-11), so nothing peeks above. */
  top: -44px;
  z-index: 5;
  margin-inline: -16px;
  padding: 12px 16px;
  border-radius: 0 0 14px 14px;
  transition:
    background-color 160ms ease,
    backdrop-filter 160ms ease;
}
.mar-page-bar.is-stuck:has(.mar-asset-tools) {
  background-color: color-mix(in oklch, var(--color-content-background) 82%, transparent);
  backdrop-filter: blur(16px) saturate(1.2);
}
.mar-asset-tools {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 8px;
  container-type: inline-size;
}
.mar-asset-tools-end {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
:root .proto-ui.proto-ui.proto-ui .mar-asset-kind {
  display: none;
}
/* Narrower windows: the toolbar sheds words, never controls. */
@container (max-width: 1000px) {
  :root .proto-ui.proto-ui.proto-ui .mar-asset-tools .mar-pfind {
    width: 150px;
    flex: 0 1 150px;
    min-width: 96px;
  }
}
@container (max-width: 860px) {
  :root .proto-ui.proto-ui.proto-ui .mar-asset-tools .aff-label,
  :root .proto-ui.proto-ui.proto-ui .mar-asset-tools .aff-chev,
  :root .proto-ui.proto-ui.proto-ui .mar-asset-sort > span:not([aria-hidden]),
  :root .proto-ui.proto-ui.proto-ui .mar-asset-sort > svg:last-child {
    display: none;
  }
  :root .proto-ui.proto-ui.proto-ui .mar-asset-sort {
    width: auto;
    padding-right: 10px;
  }
}
@container (max-width: 720px) {
  :root .proto-ui.proto-ui.proto-ui .mar-asset-seg {
    display: none;
  }
  :root .proto-ui.proto-ui.proto-ui .mar-asset-kind {
    display: flex;
  }
}
.mar-asset-drop {
  display: flex;
  min-height: 320px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1.5px dashed color-mix(in oklch, var(--color-base-foreground) 24%, transparent);
  border-radius: 14px;
  color: var(--color-muted-foreground);
  font-size: 14px;
}
:root .proto-ui.proto-ui.proto-ui .mar-asset-refresh {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: transparent;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-asset-refresh:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
.mar-masonry {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
/* The shape is the asset's, not the picture file's: fill it. */
.mar-masonry .mar-item-media img {
  position: absolute;
  inset: 0;
}
.mar-masonry-col {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 14px;
}
.mar-asset-len {
  position: absolute;
  bottom: 8px;
  left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.55);
  color: #fff;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.mar-asset-running img {
  filter: blur(14px) saturate(0.8);
  transform: scale(1.1);
}
/* A run in flight: the progress is the cover's bottom edge, clipped by
   the picture's own corners, so it reads as the picture filling in. */
.mar-asset-progress {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 3px;
  overflow: hidden;
  background: rgb(255 255 255 / 0.18);
}
.mar-asset-progress i {
  display: block;
  height: 100%;
  background: rgb(255 255 255 / 0.9);
  transition: width 400ms cubic-bezier(0.16, 1, 0.3, 1);
}
</style>
