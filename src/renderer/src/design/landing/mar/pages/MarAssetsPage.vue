<script setup lang="ts">
import { computed, h, ref, watch, type FunctionalComponent } from 'vue'
import { useElementSize, useEventListener } from '@vueuse/core'
import {
  Box,
  Copy,
  Download,
  File as FileIcon,
  FileText,
  Folder,
  FolderInput,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  ImagePlus,
  Pencil,
  Plus,
  Music,
  Minimize2,
  Play,
  Sparkles,
  Tag,
  Library,
  ArrowDownToLine,
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
import { go, hostActions, instances, toast } from '../../useProto'
import { graphOpen } from '../graph/graphOpen'
import { graphLibrary } from '../graph/comfyLook'
import { LABELS, labelColor, labelOf, setLabel, type AssetLabel } from '../assets/assetLabels'
import {
  addFolder,
  folderName,
  folderOf,
  moveToFolder,
  removeFolder,
  renameFolder,
  tree,
  within
} from '../assets/assetFolders'
import { tagsOf } from '../assets/assetTags'
import Tooltip from '../../ui/Tooltip.vue'
import MarItemMenu from './MarItemMenu.vue'
import { saveFile } from '../assets/saveFile'
import AssetBuildPicker from '../assets/AssetBuildPicker.vue'
import AssetDetail from '../assets/AssetDetail.vue'
import AssetFilterMenu from '../graph/AssetFilterMenu.vue'
import { factsFor } from '../assets/assetFacts'
import { noFilter, passes, tagsIn } from '../assets/assetFilters'
import {
  assetBuilds,
  buildStatus,
  defaultBuild,
  rememberBuild,
  startBuild,
  suggestedBuild
} from '../assets/assetBuilds'
import MarPage from './MarPage.vue'
import { EMPTY_PICS } from './emptyArt'
import MarEmpty from './MarEmpty.vue'
import MarItem from './MarItem.vue'
import MarSeg from './MarSeg.vue'
import AssetSearch from '../assets/AssetSearch.vue'
import MarSelectBar from './MarSelectBar.vue'
import AssetLayoutMenu from '../assets/AssetLayoutMenu.vue'
import { assets, type MarAsset } from './assetsStore'
import { useLibrary } from './library'
import { pageState } from './pageState'
import { notify } from './undo'
import type { MenuAction, MenuLine } from './menu'

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
const { project: fixedProject, inGraph = false } = defineProps<{
  project?: string
  /** ComfyUI: Assets expanded into a tab; it can go back to its panel. */
  inGraph?: boolean
}>()
const emit = defineEmits<{ collapse: [] }>()

type Kind = 'all' | MarAsset['type']
const kind = ref<Kind>('all')
const where = ref('all')
const build = ref(defaultBuild())
const filter = ref(noFilter())
const project = ref('all')
const sort = ref('newest')
const query = ref('')
/** ComfyUI's tab: one color label at a time narrows the wall. */
const label = ref<AssetLabel | ''>('')
/** And a folder, with every folder inside it. */
const folder = ref('')
// In ComfyUI the tab browses the panel's own files; Desktop, the builds'.
const store = inGraph ? graphLibrary : assets

// Everywhere reads every running build at once; each card names its own.
const running = computed(() =>
  assetBuilds.value.filter((b) => buildStatus(b) === 'running').map((b) => b.id)
)
const base = computed(() =>
  store.items.filter(
    (a) =>
      inGraph ||
      (fixedProject
        ? a.project === fixedProject
        : build.value === 'all'
          ? running.value.includes(a.envId ?? '')
          : a.envId === build.value)
  )
)
const current = computed(() => assetBuilds.value.find((b) => b.id === build.value))
const buildName = (a: MarAsset): string =>
  assetBuilds.value.find((b) => b.id === a.envId)?.name ?? ''
const status = computed(() => (current.value ? buildStatus(current.value) : 'running'))
const browsable = computed(
  () => inGraph || !!fixedProject || (build.value !== '' && status.value === 'running')
)
const unpicked = computed(() => !inGraph && !fixedProject && build.value === '')
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
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'largest', label: 'Largest first' },
  { value: 'name', label: 'Name (A → Z)' }
]
// Layout (AssetLayoutMenu): how big the cards are, and what they carry.
const size = ref(2)
const showName = ref(true)
const showDetails = ref(true)
/** The narrowest a card gets at each size. */
const CARD = [0, 200, 264, 340]

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
      (!label.value || labelOf(a.id) === label.value) &&
      (!folder.value || within(folder.value).has(folderOf(a.id) ?? '')) &&
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
    !!label.value ||
    !!folder.value ||
    JSON.stringify(filter.value) !== JSON.stringify(noFilter()) ||
    project.value !== 'all' ||
    !!query.value
)
function clear(): void {
  kind.value = 'all'
  where.value = 'all'
  label.value = ''
  folder.value = ''
  filter.value = noFilter()
  project.value = 'all'
  query.value = ''
}

const lib = useLibrary(store, shown)

/** The tab's sidebar (Alex Tov's media-assets proto): where files came
 *  from, then tags and color labels, each with how many it holds. Every
 *  row narrows the same wall the toolbar does. */
const done = computed(() => base.value.filter((a) => !a.status))
const SOURCES = computed(() =>
  (
    [
      ['all', 'All', Library],
      ['generated', 'Generated', Sparkles],
      ['imported', 'Imported', ArrowDownToLine]
    ] as const
  ).map(([value, name, icon]) => ({
    value,
    label: name,
    icon,
    count:
      value === 'all'
        ? done.value.length
        : done.value.filter((a) => factsFor(a).imported === (value === 'imported')).length
  }))
)
const TAG_ROWS = computed(() =>
  TAGS.value.map((t) => ({ tag: t, count: done.value.filter((a) => tagsOf(a).includes(t)).length }))
)
const LABEL_ROWS = computed(() =>
  LABELS.map((l) => ({ ...l, count: done.value.filter((a) => labelOf(a.id) === l.value).length }))
)
/** All is everything: a folder or a label picked, it isn't lit, and a
 *  click on it lets them go. */
const sourceOn = (v: string): boolean =>
  filter.value.source === v && (v !== 'all' || (!folder.value && !label.value))
function pickSource(v: (typeof filter.value)['source']): void {
  filter.value = { ...filter.value, source: v }
  if (v === 'all') {
    folder.value = ''
    label.value = ''
  }
}
function toggleTag(t: string): void {
  const on = filter.value.tags.includes(t)
  filter.value = {
    ...filter.value,
    tags: on ? filter.value.tags.filter((x) => x !== t) : [...filter.value.tags, t]
  }
}
/** A label's color as a menu icon. */
const dotOf =
  (color: string): FunctionalComponent =>
  () =>
    h('i', { class: 'mar-anav-dot', style: { background: color } })
/** Label ›, for one file or the selection. */
function labelLine(ids: () => string[]): MenuAction {
  return {
    label: 'Label',
    icon: Tag,
    sub: LABELS.map((l) => ({
      label: l.label,
      icon: dotOf(l.color),
      checked: ids().length > 0 && ids().every((id) => labelOf(id) === l.value),
      run: () => setLabel(ids(), l.value)
    }))
  }
}
/** Folders beside tags (Better Asset Management): each row counts what
 *  it holds, folders inside it included. */
const FOLDER_ROWS = computed(() =>
  tree().map(({ folder: f, depth }) => {
    const inside = within(f.id)
    return { ...f, depth, count: done.value.filter((a) => inside.has(folderOf(a.id) ?? '')).length }
  })
)
/** A new folder, or a renamed one, is typed in place in the sidebar. */
const naming = ref<{ id?: string; parent?: string; name: string } | null>(null)
const vFocus = {
  mounted: (el: HTMLInputElement) => requestAnimationFrame(() => (el.focus(), el.select()))
}
function startNaming(n: { id?: string; parent?: string; name: string }): void {
  naming.value = n
}
function endNaming(keep: boolean): void {
  const n = naming.value
  naming.value = null
  if (!n || !keep) return
  if (n.id) renameFolder(n.id, n.name)
  else if (n.name.trim()) folder.value = addFolder(n.name, n.parent).id
}
const folderMenu = ref('')
function folderLines(id: string): MenuLine[] {
  return [
    {
      label: 'New subfolder',
      icon: FolderPlus,
      run: () => startNaming({ parent: id, name: 'New folder' })
    },
    {
      label: 'Rename',
      icon: Pencil,
      run: () => startNaming({ id, name: folderName(id) ?? '' })
    },
    'sep',
    {
      label: 'Delete folder',
      icon: Trash2,
      danger: true,
      run: () => {
        if (within(id).has(folder.value)) folder.value = ''
        removeFolder(id)
      }
    }
  ]
}
/** Move to folder ›, for one file or the selection; a new folder takes
 *  them right away. */
function folderLine(ids: () => string[]): MenuAction {
  const into = (f?: string): void => {
    moveToFolder(ids(), f)
    lib.sel.clear()
  }
  return {
    label: 'Move to folder',
    icon: FolderInput,
    sub: [
      ...tree().map(({ folder: f, depth }) => ({
        label: `${'\u00a0\u00a0\u00a0'.repeat(depth)}${f.name}`,
        icon: Folder,
        checked: ids().length > 0 && ids().every((id) => folderOf(id) === f.id),
        run: () => into(f.id)
      })),
      {
        label: 'No folder',
        icon: FolderMinus,
        disabled: ids().every((id) => !folderOf(id)),
        run: () => into()
      },
      {
        label: 'New folder…',
        icon: FolderPlus,
        run: () => {
          const f = addFolder('New folder')
          into(f.id)
          startNaming({ id: f.id, name: f.name })
        }
      }
    ]
  }
}
// Cards drag onto a folder row: the selection when the card is in it.
const dragged = ref<string[]>([])
const dropOn = ref('')
function dragCard(e: DragEvent, a: MarAsset): void {
  dragged.value = lib.sel.has(a.id) ? [...lib.selected.value] : [a.id]
  e.dataTransfer?.setData('text/plain', a.name)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function dropCards(id: string): void {
  dropOn.value = ''
  const n = dragged.value.length
  if (!n) return
  moveToFolder(dragged.value, id)
  dragged.value = []
  lib.sel.clear()
  toast(`Moved ${n === 1 ? '1 file' : `${n} files`} to ${folderName(id)}`)
}

// Its own view: masonry first, remembered per viewer.
type View = 'masonry' | 'grid'
const VIEW_KEY = 'comfy.design.mar.assetsPageView'
const view = ref<View>(
  (() => {
    try {
      // List is gone from the menu: a remembered List opens as masonry.
      const v = localStorage.getItem(VIEW_KEY) as View | null
      return v === 'grid' ? 'grid' : 'masonry'
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
  const n = Math.max(1, Math.floor((wallWidth.value + 14) / (CARD[size.value]! + 14)))
  const cols = Array.from({ length: n }, () => ({ h: 0, items: [] as MarAsset[] }))
  for (const a of shown.value) {
    const col = cols.reduce((low, c) => (c.h < low.h ? c : low))
    col.items.push(a)
    col.h += 1 / factsFor(a).ratio + 0.2
  }
  return cols
})

// Another build is another catalog: nothing of the last one stays, not
// the search or the filters either.
const detail = ref<MarAsset | null>(null)
watch(build, (id) => {
  rememberBuild(id)
  detail.value = null
  filter.value = noFilter()
  query.value = ''
  kind.value = 'all'
  lib.sel.clear()
})
const suggested = computed(() => suggestedBuild())
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
    inGraph ||
    !!fixedProject ||
    (!!current.value && current.value.kind !== 'cloud' && status.value === 'running')
)
const uploadTitle = computed(() =>
  inGraph
    ? 'Upload files'
    : fixedProject || uploadable.value
      ? `Add files to ${fixedProject ?? current.value?.name} inputs`
      : build.value === 'all' || build.value === ''
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
    store.items.unshift(a)
    return a
  })
  setTimeout(() => {
    for (const a of added) {
      const live = store.items.find((x) => x.id === a.id)
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
/** Open workflow: ComfyUI on the build that made it, its workflow loaded,
 *  Media Assets open with this asset selected. */
function openWorkflow(a: MarAsset): void {
  const inst =
    instances.value.find((i) => i.id === a.envId) ??
    instances.value.find((i) => i.kind === 'local') ??
    instances.value[0]
  if (!inst) return
  detail.value = null
  graphOpen.select = { id: a.id, name: a.name, src: picOf(a), type: a.type }
  graphOpen.assets = true
  hostActions.launch(inst, a.name.replace(/_\d+\.[^.]+$/, ''))
}
/** In ComfyUI the workflow opens in a new tab beside this one. */
function workflowOf(a: MarAsset): void {
  if (!inGraph) return openWorkflow(a)
  detail.value = null
  toast(`Opened ${a.name} as a workflow`)
}
function retry(a: MarAsset): void {
  const before = { status: a.status, statusLabel: a.statusLabel }
  a.status = 'queued'
  a.statusLabel = 'Queued · 1st'
  notify(`Queued “${a.name}” again`, () => Object.assign(a, before))
}
function cancel(a: MarAsset): void {
  store.remove([a.id])
}

function lines(a: MarAsset): MenuLine[] {
  if (a.status === 'running' || a.status === 'queued')
    return [
      { label: 'Open workflow', icon: Workflow, run: () => go('workflows') },
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
      { label: 'Open workflow', icon: Workflow, run: () => go('workflows') },
      { label: 'Copy error', icon: Copy, run: () => toast('Error copied') },
      'sep',
      { label: 'Dismiss', icon: Trash2, danger: true, run: () => store.remove([a.id]) }
    ]
  return [
    // A click opens it and Download sits on the card, so neither is here.
    ...(a.source === 'cloud'
      ? []
      : [{ label: 'Show in Finder', icon: FolderOpen, run: () => toast(`Revealed ${a.name}`) }]),
    // Only when the file kept its workflow: an import or a sound has none.
    ...(factsFor(a).workflow === 'available'
      ? [{ label: 'Open workflow', icon: Workflow, run: () => workflowOf(a) }]
      : []),
    ...(inGraph ? [folderLine(() => [a.id]), labelLine(() => [a.id])] : []),
    { label: 'Copy', icon: Copy, hint: '⌘C', run: () => toast('Copied to the clipboard') },
    // Projects are Desktop's; in ComfyUI a file takes a color label.
    ...(inGraph ? [] : [lib.moveLine(() => [a.id], a.project)]),
    'sep',
    { label: 'Delete', icon: Trash2, danger: true, hint: '⌫', run: () => store.remove([a.id]) }
  ]
}

// The sticky toolbar takes a background only once it's stuck at the top,
// so it sits clear at the start of the page and stays readable over the
// grid when you scroll.
function markStuck(): void {
  const bar = document.querySelector<HTMLElement>('.mar-page-bar:has(.mar-asset-tools)')
  const scroller = bar?.closest<HTMLElement>(inGraph ? '.mg-assets-main' : '.proto-main')
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
    skeleton="grid"
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
    <template v-if="inGraph" #meta>
      <span class="mar-anav-total"
        >{{ shown.length }} {{ shown.length === 1 ? 'asset' : 'assets' }}</span
      >
      <button
        v-if="shown.length"
        type="button"
        class="mar-anav-all"
        @click="lib.sel.all(lib.order.value)"
      >
        Select all
      </button>
    </template>
    <template #actions="{ state }">
      <Button
        v-if="state === 'live' || state === 'loading'"
        variant="primary"
        :disabled="!uploadable"
        :title="uploadTitle"
        @click="pick()"
        ><Upload :size="15" />Upload</Button
      >
      <Button
        v-if="inGraph"
        variant="secondary"
        size="icon"
        title="Back to panel"
        aria-label="Back to panel"
        @click="emit('collapse')"
        ><Minimize2 :size="15"
      /></Button>
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
        <AssetBuildPicker v-if="!fixedProject && !inGraph" v-model="build" />
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
            v-if="!fixedProject && !inGraph"
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
          <AssetSearch v-model:query="query" />
          <AssetLayoutMenu
            v-model:view="view"
            v-model:size="size"
            v-model:sort="sort"
            v-model:show-name="showName"
            v-model:show-details="showDetails"
            :sorts="SORTS"
          />
        </div>
      </div>
    </template>

    <!-- No build picked yet: ask, with the most recent running one a click away. -->
    <MarEmpty
      v-if="unpicked"
      :icon="ComfyAssets"
      title="Pick a build to browse"
      text="Assets are read from one build at a time, through its own ComfyUI. Pick one above, or open the one you used last."
      :action="suggested ? `Browse ${suggested.name}` : undefined"
      compact
      @action="suggested && (build = suggested.id)"
    />
    <MarEmpty
      v-else-if="!browsable && current"
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
    <div
      v-else-if="view === 'masonry'"
      ref="wall"
      :class="['mar-masonry', !showName && 'no-name', !showDetails && 'no-details']"
    >
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
          :draggable="inGraph && !a.status"
          @dragstart="dragCard($event, a)"
          @open="open(a)"
          @select="lib.pick(a.id, $event)"
          @start-rename="lib.renaming.value = a.id"
          @rename="lib.rename(a.id, $event)"
          @cancel-rename="lib.renaming.value = ''"
        >
          <template v-if="!a.status" #tools>
            <button
              type="button"
              class="mar-kebab on-media"
              aria-label="Download"
              title="Download"
              @click.stop="saveFile(picOf(a), a.name)"
              @dblclick.stop
            >
              <Download :size="14" />
            </button>
          </template>
          <template #overlay>
            <span v-if="a.status === 'running'" class="mar-asset-progress"
              ><i style="width: 62%"
            /></span>
            <span v-else-if="a.type === 'video' && !a.status" class="mar-asset-len"
              ><Play :size="10" />{{ factsFor(a).duration }}</span
            >
            <i
              v-if="labelOf(a.id)"
              class="mar-asset-label"
              :style="{ background: labelColor(labelOf(a.id)) }"
              :aria-label="`${labelOf(a.id)} label`"
            />
          </template>
        </MarItem>
      </div>
    </div>
    <div
      v-else
      :class="['mar-grid', !showName && 'no-name', !showDetails && 'no-details']"
      :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${CARD[size]! + 36}px, 1fr))` }"
    >
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
        :draggable="inGraph && !a.status"
        @dragstart="dragCard($event, a)"
        @open="open(a)"
        @select="lib.pick(a.id, $event)"
        @start-rename="lib.renaming.value = a.id"
        @rename="lib.rename(a.id, $event)"
        @cancel-rename="lib.renaming.value = ''"
      >
        <template v-if="!a.status" #tools>
          <button
            type="button"
            class="mar-kebab on-media"
            aria-label="Download"
            title="Download"
            @click.stop="saveFile(picOf(a), a.name)"
            @dblclick.stop
          >
            <Download :size="14" />
          </button>
        </template>
        <template v-if="a.status === 'running' || labelOf(a.id)" #overlay>
          <span v-if="a.status === 'running'" class="mar-asset-progress"
            ><i style="width: 62%"
          /></span>
          <i
            v-if="labelOf(a.id)"
            class="mar-asset-label"
            :style="{ background: labelColor(labelOf(a.id)) }"
            :aria-label="`${labelOf(a.id)} label`"
          />
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
          run: () => (
            store.items.filter((x) => lib.sel.has(x.id)).forEach((x) => saveFile(picOf(x), x.name)),
            lib.sel.clear()
          )
        },
        ...(inGraph
          ? [folderLine(() => lib.selected.value), labelLine(() => lib.selected.value)]
          : [lib.moveLine(() => lib.selected.value)]),
        { label: 'Delete', icon: Trash2, danger: true, run: lib.removeSelected }
      ]"
      @clear="lib.sel.clear()"
      @all="lib.sel.all(lib.order.value)"
    />
    <AssetDetail
      v-if="detail"
      :asset="detail"
      :list="finished"
      :build="fixedProject ? fixedProject : inGraph ? 'ComfyUI' : buildName(detail)"
      :editable="inGraph"
      :on-workflow="inGraph ? undefined : openWorkflow"
      @go="detail = $event"
      @close="detail = null"
    />
  </MarPage>
  <!-- ComfyUI's tab: the sidebar, in the tab's own left column. -->
  <Teleport v-if="inGraph" defer to="#mg-assets-nav">
    <nav class="mar-anav" aria-label="Assets">
      <button
        v-for="s in SOURCES"
        :key="s.value"
        type="button"
        class="mar-anav-row"
        :class="sourceOn(s.value) && 'is-on'"
        :aria-pressed="sourceOn(s.value)"
        @click="pickSource(s.value)"
      >
        <component :is="s.icon" :size="15" /><span class="mar-anav-name">{{ s.label }}</span
        ><span class="mar-anav-n">{{ s.count }}</span>
      </button>
      <div class="mar-anav-head">
        <p class="mar-anav-label">Folders</p>
        <Tooltip content="New folder" side="bottom">
          <button
            type="button"
            class="mar-anav-add"
            aria-label="New folder"
            @click="startNaming({ name: 'New folder' })"
          >
            <Plus :size="14" />
          </button>
        </Tooltip>
      </div>
      <template v-for="f in FOLDER_ROWS" :key="f.id">
        <div
          v-if="naming?.id === f.id"
          class="mar-anav-naming"
          :style="{ paddingLeft: `${10 + f.depth * 14}px` }"
        >
          <Folder :size="15" /><input
            v-model="naming.name"
            v-focus
            aria-label="Folder name"
            @keydown.enter="endNaming(true)"
            @keydown.esc="endNaming(false)"
            @blur="endNaming(true)"
          />
        </div>
        <div
          v-else
          class="mar-anav-folder"
          :class="[folder === f.id && 'is-on', dropOn === f.id && 'is-drop']"
          @dragover.prevent="dragged.length && (dropOn = f.id)"
          @dragleave="dropOn === f.id && (dropOn = '')"
          @drop.prevent="dropCards(f.id)"
          @contextmenu.prevent="folderMenu = f.id"
        >
          <button
            type="button"
            class="mar-anav-row is-sub"
            :class="folder === f.id && 'is-on'"
            :style="{ paddingLeft: `${10 + f.depth * 14}px` }"
            :aria-pressed="folder === f.id"
            @click="folder = folder === f.id ? '' : f.id"
            @dblclick="startNaming({ id: f.id, name: f.name })"
          >
            <Folder :size="15" /><span class="mar-anav-name">{{ f.name }}</span
            ><span class="mar-anav-n">{{ f.count }}</span>
          </button>
          <span class="mar-anav-folder-tools">
            <Tooltip content="New subfolder" side="bottom">
              <button
                type="button"
                class="mar-anav-add"
                aria-label="New subfolder"
                @click="startNaming({ parent: f.id, name: 'New folder' })"
              >
                <Plus :size="14" />
              </button>
            </Tooltip>
            <MarItemMenu
              :open="folderMenu === f.id"
              :lines="folderLines(f.id)"
              label="Folder actions"
              @update:open="folderMenu = $event ? f.id : ''"
            />
          </span>
        </div>
        <div
          v-if="naming && !naming.id && naming.parent === f.id"
          class="mar-anav-naming"
          :style="{ paddingLeft: `${24 + f.depth * 14}px` }"
        >
          <Folder :size="15" /><input
            v-model="naming.name"
            v-focus
            aria-label="Folder name"
            @keydown.enter="endNaming(true)"
            @keydown.esc="endNaming(false)"
            @blur="endNaming(true)"
          />
        </div>
      </template>
      <div v-if="naming && !naming.id && !naming.parent" class="mar-anav-naming">
        <Folder :size="15" /><input
          v-model="naming.name"
          v-focus
          aria-label="Folder name"
          @keydown.enter="endNaming(true)"
          @keydown.esc="endNaming(false)"
          @blur="endNaming(true)"
        />
      </div>
      <template v-if="TAG_ROWS.length">
        <p class="mar-anav-label">Tags</p>
        <button
          v-for="t in TAG_ROWS"
          :key="t.tag"
          type="button"
          class="mar-anav-row is-sub"
          :class="filter.tags.includes(t.tag) && 'is-on'"
          :aria-pressed="filter.tags.includes(t.tag)"
          @click="toggleTag(t.tag)"
        >
          <span class="mar-anav-name">{{ t.tag }}</span
          ><span class="mar-anav-n">{{ t.count }}</span>
        </button>
      </template>
      <p class="mar-anav-label">Labels</p>
      <button
        v-for="l in LABEL_ROWS"
        :key="l.value"
        type="button"
        class="mar-anav-row is-sub"
        :class="label === l.value && 'is-on'"
        :aria-pressed="label === l.value"
        @click="label = label === l.value ? '' : l.value"
      >
        <i class="mar-anav-dot" :style="{ background: l.color }" /><span class="mar-anav-name">{{
          l.label
        }}</span
        ><span class="mar-anav-n">{{ l.count }}</span>
      </button>
    </nav>
  </Teleport>
</template>

<style>
/* The toolbar stays in reach while the wall scrolls. */
.mar-page-bar:has(.mar-asset-tools) {
  position: sticky;
  /* The scroller's own top padding (pt-11), so nothing peeks above. */
  top: -44px;
  z-index: 5;
  /* Edge to edge: out over the page's own side padding (px-11). */
  margin-inline: -44px;
  padding: 12px 44px 0;
  /* Its top padding pulled back, so the tools sit where Apps' do. */
  margin-top: -12px;
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
  :root .proto-ui.proto-ui.proto-ui .mar-asset-tools .aff-chev {
    display: none;
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
/* Layout › Show: a card without its name or its details. */
:is(.mar-masonry, .mar-grid).no-name .mar-item-name,
:is(.mar-masonry, .mar-grid).no-details .mar-item-meta {
  display: none;
}
:is(.mar-masonry, .mar-grid).no-name.no-details .mar-item-text {
  display: none;
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
/* A color label (ComfyUI's tab): a dot in the picture's corner. */
.mar-asset-label {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  box-shadow: 0 0 0 2px rgb(0 0 0 / 0.35);
}
/* ComfyUI's Assets tab: its sidebar and the count by the title. */
.mar-anav {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 16px 10px;
}
.mar-anav-label {
  padding: 18px 10px 6px;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
:root .proto-ui.proto-ui.proto-ui .mar-anav-row {
  display: flex;
  height: 32px;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--color-muted-foreground);
  font-size: 13px;
  font-weight: 400;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .mar-anav-row:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-anav-row.is-on {
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-anav-row.is-sub {
  height: 30px;
}
.mar-anav-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mar-anav-n {
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.mar-anav-dot {
  width: 9px;
  height: 9px;
  flex: none;
  border-radius: 999px;
}
/* FOLDERS, with + by its label; a row shows + and ⋯ on hover. */
.mar-anav-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 4px;
}
:root .proto-ui.proto-ui.proto-ui .mar-anav-add {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-anav-add:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
.mar-anav-head .mar-anav-add {
  margin-top: 12px;
}
.mar-anav-folder {
  position: relative;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-control);
}
.mar-anav-folder-tools {
  position: absolute;
  top: 50%;
  right: 4px;
  display: flex;
  gap: 2px;
  opacity: 0;
  translate: 0 -50%;
  transition: opacity 120ms ease;
}
.mar-anav-folder:is(:hover, :focus-within) .mar-anav-folder-tools,
.mar-anav-folder-tools:has([data-state='open']) {
  opacity: 1;
}
.mar-anav-folder:is(:hover, :focus-within) .mar-anav-n {
  visibility: hidden;
}
:root .proto-ui.proto-ui.proto-ui .mar-anav-folder-tools .mar-kebab {
  width: 24px;
  height: 24px;
}
/* A card dragged over a folder: it lights up to take it. */
:root .proto-ui.proto-ui.proto-ui .mar-anav-folder.is-drop .mar-anav-row {
  background: color-mix(in oklch, var(--color-base-foreground) 16%, transparent);
  color: var(--color-base-foreground);
}
.mar-anav-naming {
  display: flex;
  height: 30px;
  align-items: center;
  gap: 10px;
  padding: 0 6px 0 10px;
  color: var(--color-muted-foreground);
}
.mar-anav-naming input {
  min-width: 0;
  flex: 1;
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-control);
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
  font-size: 13px;
  outline: none;
}
.mar-anav-naming input:focus {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
.mar-anav-total {
  color: var(--color-subtle-foreground);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
:root .proto-ui.proto-ui.proto-ui .mar-anav-all {
  height: 26px;
  padding: 0 8px;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--color-muted-foreground);
  font-size: 13px;
}
:root .proto-ui.proto-ui.proto-ui .mar-anav-all:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-base-foreground);
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
