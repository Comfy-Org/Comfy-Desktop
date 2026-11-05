<script setup lang="ts">
import { computed, reactive, ref, watch, type Component } from 'vue'
import {
  ArrowRightLeft,
  ArrowUpCircle,
  Camera,
  CircleStop,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  EyeOff,
  FolderOpen,
  History,
  Info,
  Loader2,
  OctagonAlert,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  ScrollText,
  Server,
  Settings2,
  Square,
  Trash2
} from 'lucide-vue-next'
import Tooltip from '../../ui/Tooltip.vue'
import Button from '../../ui/Button.vue'
import Select from '../../ui/Select.vue'
import LocationIcon from '../../ui/LocationIcon.vue'
import { hostActions, instances, proto, toast } from '../../useProto'
import { can } from '../../milestones'
import { deploymentsOf, versionsOf } from '../../parts/env/env'
import { TEMPLATES, thumb, type ProtoInstance } from '../../mock'
import { allAssets } from '../../gallery'
import { go } from '../../useProto'
import { leaving } from '../build/buildFacts'
import { openBuild } from '../build/buildTab'
import { clearError, errorOf } from '../build/buildErrors'
import BuildCrashDialog from '../build/BuildCrashDialog.vue'
import {
  M1_BUILDS,
  PROBLEM_ACTION,
  PROBLEM_LABEL,
  extraOf,
  whereOf,
  type BuildWhere
} from '../build/m1Builds'
import { surface } from '../shell/surface'
import MarPage from './MarPage.vue'
import { EMPTY_PICS } from './emptyArt'
import MarItem from './MarItem.vue'
import MarBuildCard from './MarBuildCard.vue'
import { buildCard } from './buildCard'
import MarSplitButton from './MarSplitButton.vue'
import MarSeg from './MarSeg.vue'
import MarSearchField from './MarSearchField.vue'
import MarViewToggle from './MarViewToggle.vue'
import { collection } from './collection'
import { useLibrary } from './library'
import { pageState, shownState, type PageState } from './pageState'
import { notify } from './undo'
import type { MenuLine } from './menu'
import type { ItemStatus } from './MarStatus.vue'

/**
 * Builds (Mar's proposal): where your work runs, each with its own
 * ComfyUI version, custom nodes and models. A card is the build at a
 * glance: the last things made on it, its name and one meta line, then a
 * few spec lines (GPU and uptime or how it wakes, memory and credits an
 * hour or disk, models and node packs). Its button does the one thing
 * the state needs (Open, Start, Update, Try again), bottom-right, with the
 * state's other frequent action beside it as an icon (Stop while it runs,
 * Start without updating). A click anywhere else opens the build's page;
 * the ⋯ menu keeps the rare and destructive actions. List rows do the same.
 *
 * Milestone 1 (Builds, the MVP) is one build to a line instead: where it
 * runs as a small mark, the name with its specs, the state as a badge,
 * then one action that says where it runs; no cards/table switch.
 */
type Build = ProtoInstance & { project?: string; fav?: boolean; error?: string }

// The Builds milestone also lists the states today's Desktop has
// (m1Builds.ts): a remote build, one to migrate, three a problem stopped.
const seed = (): Build[] =>
  [
    ...instances.value,
    ...(proto.milestone < 3 && !proto.oneLocal && !proto.fresh ? M1_BUILDS : [])
  ].map((i) => (errorOf(i.id) ? { ...i, state: 'error' as const, error: errorOf(i.id) } : { ...i }))
const builds = collection<Build>(seed(), 'build')
// The local setup finishes with this page already open behind it.
watch(
  () => [proto.oneLocal, proto.fresh],
  () => builds.items.splice(0, builds.items.length, ...seed())
)
if (leaving.value) {
  builds.remove([leaving.value], true)
  leaving.value = undefined
}

// A first-time user's libraries are empty, but not Builds once they have
// installed one (the local setup lands here in its M1 scope).
const buildsState = computed<PageState | undefined>(() => {
  if (shownState.value === 'live' && builds.items.length === 0) return 'empty'
  if (pageState.id === 'live' && !proto.fresh && builds.items.length) return 'live'
  return undefined
})

type Where = 'all' | BuildWhere
const where = ref<Where>('all')
const sort = ref('used')
const query = ref('')
// One Builds page for both modes. Build looks at what ships (versions,
// deployments), so it opens on the list with those columns.
const building = computed(() => proto.mode === 'build')
const view = ref<'grid' | 'list'>(building.value ? 'list' : 'grid')
// Milestone 1 shows only the one-line rows.
const rowsOnly = computed(() => proto.milestone < 3 && !building.value)

// Cloud and Remote show only when there are builds there (ChooserView).
const countWhere = (w: BuildWhere): number => builds.items.filter((b) => whereOf(b) === w).length
const WHERE = computed(() => [
  { value: 'all' as const, label: 'All', count: builds.items.length },
  { value: 'local' as const, label: 'This computer', count: countWhere('local') },
  ...(countWhere('cloud') || !rowsOnly.value
    ? [{ value: 'cloud' as const, label: 'Cloud', count: countWhere('cloud') }]
    : []),
  ...(countWhere('remote')
    ? [{ value: 'remote' as const, label: 'Remote', count: countWhere('remote') }]
    : [])
])
const SORTS = [
  { value: 'used', label: 'Last used' },
  { value: 'name', label: 'Name' }
]
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = builds.items.filter(
    (b) =>
      (where.value === 'all' || whereOf(b) === where.value) &&
      // The Builds milestone searches names only, as Desktop does.
      (!q ||
        (rowsOnly.value ? b.name : `${b.name} ${b.channel} ${b.gpu}`).toLowerCase().includes(q))
  )
  // The Builds milestone: most recently used first, nothing else.
  if (rowsOnly.value) return [...list].sort((a, b) => a.lastUsedRank - b.lastUsedRank)
  return sort.value === 'name'
    ? [...list].sort((a, b) => a.name.localeCompare(b.name))
    : [...list].sort(
        (a, b) =>
          (a.state === 'running' ? -1 : 0) - (b.state === 'running' ? -1 : 0) ||
          a.lastUsedRank - b.lastUsedRank
      )
})
const filtered = computed(() => where.value !== 'all' || !!query.value)
function clear(): void {
  where.value = 'all'
  query.value = ''
}
const lib = useLibrary(builds, shown, { select: false })

/* ---- The cover: last outputs, and the live panel ---- */
// The last three things made on each build; builds that made fewer get
// template pictures no other card uses, so no two covers repeat.
const outputs = computed(() => {
  const used = new Set<string>()
  const made = new Map<string, string[]>()
  for (const b of builds.items) {
    const own = allAssets.value
      .filter((a) => a.envId === b.id && a.thumbId && !used.has(a.thumbId))
      .sort((x, y) => x.age - y.age)
      .map((a) => a.thumbId!)
      .filter((id, i, all) => all.indexOf(id) === i)
      .slice(0, 3)
    own.forEach((id) => used.add(id))
    made.set(b.id, own)
  }
  const spare = TEMPLATES.map((t) => t.id).filter((id) => !used.has(id))
  for (const b of builds.items) {
    const own = made.get(b.id)!
    while (own.length < 3 && spare.length) own.push(spare.shift()!)
  }
  return made
})

// Live numbers a build would report (mock): memory in use and uptime
// while it runs, disk left on this computer, credits an hour in the cloud.
interface Live {
  mem?: [number, number]
  up?: string
  rate?: number
}
const LIVE: Record<string, Live> = {
  'local-video': { mem: [41, 128], up: '2 h 14 m' },
  'dep-product': { mem: [52, 80], up: '3 h 05 m', rate: 95 },
  'dep-brand': { rate: 60 },
  'dep-upscale': { rate: 48 },
  cloud: { rate: 42 }
}
const DISK_FREE = '412 GB'
const live = (b: Build): Live => LIVE[b.id] ?? {}
const gpuName = (b: Build): string =>
  b.gpu?.split(' · ')[0] ?? (b.kind === 'cloud' ? 'Cloud GPU' : 'This computer')
// Total memory: the GPU's, or this computer's unified memory.
const memTotal = (b: Build): string => b.gpu?.split(' · ')[1] ?? '128 GB'
// How the build is right now, in a few words.
function stateLine(b: Build): string {
  if (b.state === 'running') return `Up ${live(b).up ?? 'just now'}`
  if (b.state === 'launching') return b.kind === 'cloud' ? 'Waking up, ~20 s' : 'Starting…'
  if (b.state === 'error') return 'Didn’t start'
  if (b.kind === 'cloud') return 'Asleep · wakes in ~20 s'
  return b.state === 'update' ? 'Stopped · update ready' : 'Stopped'
}

const STATUS: Record<ProtoInstance['state'], ItemStatus | undefined> = {
  running: 'running',
  stopped: undefined,
  launching: 'launching',
  update: 'update',
  error: 'failed'
}
const statusLabel = (b: Build): string | undefined =>
  b.state === 'update' ? 'Update available' : b.state === 'error' ? 'Failed to start' : undefined

function original(b: Build): ProtoInstance {
  return instances.value.find((i) => i.id === b.id) ?? b
}
function start(b: Build): void {
  b.state = 'launching'
  setTimeout(() => {
    b.state = 'running'
    hostActions.launch(original(b))
  }, 1400)
}
// Builds stopping now: the row dims and waits, with nothing to undo.
const stopping = reactive(new Set<string>())
function stop(b: Build): void {
  if (rowsOnly.value) {
    stopping.add(b.id)
    setTimeout(() => {
      stopping.delete(b.id)
      b.state = 'stopped'
    }, 1400)
    return
  }
  b.state = 'stopped'
  notify(`Stopped ${b.name}`, () => (b.state = 'running'))
}
// Builds updating now: the rows' badge says so while the state stays.
const updating = reactive(new Set<string>())
function update(b: Build): void {
  if (updating.has(b.id)) return
  updating.add(b.id)
  b.state = 'launching'
  setTimeout(() => {
    updating.delete(b.id)
    b.state = 'stopped'
    notify(`${b.name} is up to date`)
  }, 1600)
}
function retry(b: Build): void {
  b.error = undefined
  clearError(b.id)
  start(b)
}
function primary(b: Build): { label: string; icon: unknown; run: () => void } {
  if (b.state === 'running')
    return { label: 'Open', icon: ExternalLink, run: () => hostActions.launch(original(b)) }
  if (b.state === 'error') return { label: 'Try again', icon: RotateCw, run: () => retry(b) }
  return { label: 'Start', icon: Play, run: () => start(b) }
}
// The state's other frequent action, beside the button.
function second(
  b: Build
): { label: string; hint?: string; icon: unknown; run: () => void } | undefined {
  if (b.state === 'running') return { label: 'Stop', icon: Square, run: () => stop(b) }
  // Many keep a build as it is, so Update waits beside Start, never in its place.
  if (b.state === 'update')
    return {
      label: 'Update',
      hint: 'Update, then start',
      icon: ArrowUpCircle,
      run: () => update(b)
    }
  return undefined
}
/* ---- Milestone 1: today's states and menu (ChooserInstallTile) ---- */
// Builds becoming a Build on Comfy Platform (Create Build).
const creating = reactive(new Set<string>())
// The build whose error details are open.
const crashOf = ref<Build>()
const problemOf = (b: Build) => extraOf(b.id).problem
const isRemote = (b: Build): boolean => whereOf(b) === 'remote'
// Busy: nothing to start or change until it settles.
const busy = (b: Build): boolean =>
  stopping.has(b.id) || creating.has(b.id) || updating.has(b.id) || b.state === 'launching'
// Start, or Open where there is nothing to start (running, Cloud, Remote).
function launch(b: Build): { label: string; icon: Component; run: () => void } {
  if (b.state === 'running' || b.state === 'error' || b.kind === 'cloud')
    return {
      label: 'Open',
      icon: ExternalLink,
      run: () => (b.state === 'running' ? hostActions.launch(original(b)) : start(b))
    }
  return { label: 'Start', icon: Play, run: () => start(b) }
}
const launchWhere = (b: Build): string =>
  isRemote(b) ? 'on Remote' : b.kind === 'cloud' ? 'on Cloud' : 'on this computer'
// The state, one word: the chip after the name says what else is going on.
function m1State(b: Build): {
  label: string
  tone: 'ok' | 'warn' | 'bad' | 'idle'
  spin?: boolean
} {
  if (creating.has(b.id)) return { label: 'Creating…', tone: 'idle', spin: true }
  if (updating.has(b.id)) return { label: 'Updating…', tone: 'idle', spin: true }
  if (stopping.has(b.id)) return { label: 'Stopping…', tone: 'idle', spin: true }
  if (b.state === 'launching') return { label: 'Starting…', tone: 'ok', spin: true }
  if (b.state === 'running') return { label: 'Running', tone: 'ok' }
  if (b.kind === 'cloud' && !isRemote(b)) return { label: 'Asleep', tone: 'idle' }
  return { label: 'Stopped', tone: 'idle' }
}
function migrate(b: Build): void {
  toast(`Migrating ${b.name} to Standalone…`)
  updating.add(b.id)
  setTimeout(() => {
    updating.delete(b.id)
    b.channel = 'Standalone'
    extraOf(b.id).migrate = false
    notify(`${b.name} is now a Standalone build`)
  }, 1800)
}
function fixProblem(b: Build): void {
  const p = problemOf(b)!
  if (p === 'delete-interrupted') return void builds.remove([b.id])
  toast(p === 'missing' ? `Choose where ${b.name} is now` : `Installing ${b.name} again…`)
}
function createBuild(b: Build): void {
  const id = `${b.id}-platform`
  builds.items.push({
    ...b,
    id,
    name: `${b.name} Build`,
    kind: 'cloud',
    channel: 'Comfy Platform',
    version: 'Build v1',
    state: 'stopped',
    lastUsedRank: -1
  })
  creating.add(id)
  setTimeout(() => creating.delete(id), 2600)
}
// Desktop's menu, in its order (composables/useInstallContextMenu.ts):
// Manage, then the state's change, then the install's own; snapshots;
// Create Build; Stop and Uninstall last. While it runs, what would change
// it is greyed, and its tooltip says why.
function m1Lines(b: Build): MenuLine[] {
  const local = b.kind === 'local'
  const running = b.state === 'running' || busy(b)
  const gated = {
    disabled: running,
    title: running ? 'Stop the running instance first.' : undefined
  }
  const problem = problemOf(b)
  const top: MenuLine[] = [
    { label: 'Manage', icon: Settings2, run: () => open(b) },
    ...(b.state === 'update'
      ? [{ label: 'Update', icon: ArrowUpCircle, run: () => update(b), ...gated }]
      : []),
    ...(extraOf(b.id).migrate
      ? [{ label: 'Migrate to Standalone', icon: ArrowRightLeft, run: () => migrate(b), ...gated }]
      : []),
    ...(local && !problem
      ? [
          { label: 'Duplicate Instance', icon: Copy, run: () => builds.duplicate(b.id), ...gated },
          { label: 'Show in Finder', icon: FolderOpen, run: () => toast(`Revealed ${b.name}`) }
        ]
      : [])
  ]
  const snaps: MenuLine[] =
    local && !problem
      ? [
          { label: 'Export Snapshot', icon: Download, run: () => toast('Snapshot exported.') },
          {
            label: 'Restore Snapshot',
            icon: History,
            run: () => openBuild(b.id, 'snapshots'),
            ...gated
          },
          ...(proto.signedIn
            ? [{ label: 'Create Build', icon: CloudUpload, run: () => createBuild(b) }]
            : [])
        ]
      : []
  const end: MenuLine[] = [
    ...(local && b.state === 'running'
      ? [{ label: 'Stop', icon: CircleStop, danger: true, run: () => stop(b) }]
      : []),
    ...(local
      ? [
          {
            label: 'Uninstall',
            icon: Trash2,
            danger: true,
            run: () => builds.remove([b.id]),
            ...gated
          }
        ]
      : isRemote(b)
        ? [{ label: 'Forget', icon: EyeOff, run: () => builds.remove([b.id]) }]
        : [])
  ]
  return [
    ...top,
    ...(snaps.length ? ['sep' as const, ...snaps] : []),
    ...(end.length ? ['sep' as const, ...end] : [])
  ]
}
const refreshing = ref(false)
function refresh(): void {
  refreshing.value = true
  setTimeout(() => {
    refreshing.value = false
    toast('Builds updated')
  }, 1100)
}

// A click opens the build's page; Open and Start are the button's.
function open(b: Build): void {
  openBuild(b.id)
}

// The menu keeps what's rare or destructive; the frequent actions sit on
// the card and the row, and the page's tabs are one click away.
function lines(b: Build): MenuLine[] {
  if (rowsOnly.value) return m1Lines(b)
  // A build's own tabs, where its page has them (the Builds milestone).
  const own = b.id !== 'cloud' && !can.value.breadcrumb
  return [
    ...(own
      ? [
          { label: 'Snapshots', icon: Camera, run: () => openBuild(b.id, 'snapshots') },
          ...(b.kind === 'local'
            ? [{ label: 'Settings', icon: Settings2, run: () => openBuild(b.id, 'settings') }]
            : []),
          'sep' as const
        ]
      : []),
    { label: 'Rename', icon: Pencil, run: () => (lib.renaming.value = b.id) },
    ...(b.kind === 'local'
      ? [
          { label: 'Duplicate', icon: Copy, run: () => builds.duplicate(b.id) },
          { label: 'Show in Finder', icon: FolderOpen, run: () => toast(`Revealed ${b.name}`) }
        ]
      : []),
    // Logs come with the Builder.
    ...(can.value.builder ? [{ label: 'Logs', icon: ScrollText, run: () => go('logs') }] : []),
    ...(b.id === 'cloud'
      ? []
      : [
          'sep' as const,
          {
            label: b.kind === 'local' ? 'Remove build' : 'Delete build',
            icon: Trash2,
            danger: true,
            disabled: b.state === 'running',
            run: () => builds.remove([b.id])
          }
        ])
  ]
}

/* ---- The cards with no picture (UI Playground › Build card) ---- */
// The page's own words for where: the filter's.
const whereLabel = (b: Build): string => (b.kind === 'local' ? 'This computer' : 'Cloud')
// Quiet words for the state: beside the chip while running, on their own
// when there is no chip (stopped, asleep).
function note(b: Build): string | undefined {
  if (b.state === 'running') return stateLine(b)
  if (STATUS[b.state]) return undefined
  return b.kind === 'cloud' ? stateLine(b) : `Stopped · ${b.lastUsed}`
}
// Split card: the state as a badge with no fill. Where it runs is the tile
// and the button, so the line keeps the specs (or why it didn't start).
const SPLIT_STATE: Record<ProtoInstance['state'], string> = {
  running: 'Running',
  launching: 'Starting',
  error: 'Failed to start',
  update: 'Update available',
  stopped: 'Stopped'
}
const splitState = (b: Build): string =>
  b.state === 'stopped' && b.kind === 'cloud' ? 'Asleep' : SPLIT_STATE[b.state]
const TONE: Record<ProtoInstance['state'], 'ok' | 'warn' | 'bad' | 'idle'> = {
  running: 'ok',
  launching: 'ok',
  update: 'warn',
  error: 'bad',
  stopped: 'idle'
}
/* ---- Milestone 1: one build to a line ---- */
// The specs, hardware first. Where it runs is the mark and the button.
// Desktop's meta line: where it comes from, then its version (a remote
// build's address without the protocol).
const specs = (b: Build): string =>
  [
    isRemote(b) ? extraOf(b.id).remote!.replace(/^https?:\/\//, '') : b.channel,
    b.kind === 'cloud' && !isRemote(b) ? undefined : b.version
  ]
    .filter(Boolean)
    .join(' · ')
// Open and Start say where; Try again stays short.
const runsOn = (b: Build): string | undefined =>
  b.state === 'error' ? undefined : b.kind === 'cloud' ? 'on Cloud' : 'on this computer'
// The state says only whether it runs: an update is a badge by the version,
// so a build can run and have one.
const rowState = (b: Build): string =>
  updating.has(b.id) || b.state === 'update' ? 'Stopped' : splitState(b)
const rowTone = (b: Build): 'ok' | 'warn' | 'bad' | 'idle' =>
  updating.has(b.id) || b.state === 'update' ? 'idle' : TONE[b.state]
function card(b: Build) {
  // Where is said elsewhere on the card, so no "Cloud build" here.
  const release = [b.deployment ? undefined : b.channel, b.version].filter(Boolean)
  const mem = b.state === 'running' ? live(b).mem : undefined
  // Tile, strip and split lead the specs with the hardware. Grouped leaves the
  // hardware to its heading, unless it's the cloud's own.
  const specs = (
    ['tile', 'strip', 'split'].includes(buildCard.id)
      ? [gpuName(b), ...release]
      : [
          ...release,
          ...(buildCard.id === 'where' || (buildCard.id === 'grouped' && b.kind === 'cloud')
            ? [gpuName(b)]
            : [])
        ]
  ).join(' · ')
  return {
    name: b.name,
    kind: b.kind === 'cloud' ? ('cloud' as const) : ('local' as const),
    where: whereLabel(b),
    meta: specs,
    error: b.state === 'error' ? b.error : undefined,
    status: STATUS[b.state],
    statusLabel: statusLabel(b),
    note: note(b),
    line: { state: splitState(b), rest: b.state === 'error' ? (b.error ?? '') : specs },
    tone: TONE[b.state],
    gear: gpuName(b),
    usage: mem && (mem[0] / mem[1]) * 100,
    usageLabel: mem ? `${mem[0]} / ${mem[1]} GB` : memTotal(b),
    counts: `${b.models ?? 'All'} models · ${b.nodes ?? 'Core'} node packs`,
    cta: primary(b),
    second: second(b),
    busy: b.state === 'launching',
    lines: lines(b),
    renaming: lib.renaming.value === b.id,
    fav: b.fav
  }
}
const cardOn = (b: Build) => ({
  open: () => open(b),
  'start-rename': () => (lib.renaming.value = b.id),
  rename: (name: string) => lib.rename(b.id, name),
  'cancel-rename': () => (lib.renaming.value = ''),
  star: () => builds.star(b.id)
})
const groups = computed(() => {
  const local = shown.value.filter((b) => b.kind === 'local')
  return [
    {
      kind: 'local' as const,
      label: 'This computer',
      hint: local[0] && `${gpuName(local[0])} · ${DISK_FREE} free`,
      items: local
    },
    {
      kind: 'cloud' as const,
      label: 'Cloud',
      hint: 'Credits by the hour, only while it runs',
      items: shown.value.filter((b) => b.kind !== 'local')
    }
  ].filter((g) => g.items.length)
})

const newLabel = computed(() =>
  surface.id === 'desktop' ? 'Install on this computer' : 'Set up a cloud build'
)
</script>

<template>
  <MarPage
    title="Builds"
    :skeleton="view === 'grid' && !rowsOnly ? 'cards' : 'list'"
    :no-results="shown.length === 0 && filtered"
    :state="buildsState"
    :empty="{
      icon: Plus,
      title: 'Set up where your work runs',
      text: 'A build is ComfyUI with its own version, custom nodes and models. Install one on this computer, or run on Comfy Cloud with nothing to install.',
      pics: EMPTY_PICS.builds,
      action: newLabel,
      second: surface.id === 'desktop' && !rowsOnly ? 'Use Comfy Cloud' : undefined
    }"
    :error-text="
      rowsOnly
        ? undefined
        : 'Cloud builds are out of reach right now. The ones on this computer start as usual.'
    "
    @action="hostActions.newInstance()"
    @second="toast('Signing in to Comfy Cloud')"
    @clear="clear"
  >
    <template #actions="{ state }">
      <Button
        v-if="state === 'live' || state === 'loading'"
        variant="primary"
        @click="hostActions.newInstance()"
        ><Plus :size="15" />New Build</Button
      >
    </template>

    <template #toolbar>
      <MarSeg v-model="where" :options="WHERE" label="Where" />
      <div class="ml-auto flex items-center gap-2">
        <Tooltip v-if="rowsOnly && proto.signedIn" content="Refresh workspaces">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh workspaces"
            :disabled="refreshing"
            @click="refresh"
            ><RefreshCw :size="15" :class="refreshing && 'animate-spin'"
          /></Button>
        </Tooltip>
        <Select v-if="!rowsOnly" v-model="sort" :options="SORTS" label="Sort" class="w-38" />
        <MarSearchField v-model="query" placeholder="Search builds" />
        <MarViewToggle v-if="!rowsOnly" v-model="view" />
      </div>
    </template>

    <!-- One build to a line: where as a small mark, the name and its specs,
         the state as a badge, then one action that says where it runs. -->
    <div v-if="rowsOnly" class="mar-bc-rows">
      <MarItem
        v-for="b in shown"
        :key="b.id"
        layout="list"
        :name="b.name"
        :lines="lines(b)"
        :selectable="false"
        context-menu
        class="mar-bc-row"
        :class="stopping.has(b.id) && 'is-stopping'"
        @open="!stopping.has(b.id) && open(b)"
      >
        <template #media>
          <Server v-if="whereOf(b) === 'remote'" :size="16" />
          <LocationIcon v-else :kind="b.kind === 'cloud' ? 'cloud' : 'local'" :size="16" />
        </template>
        <template #meta
          ><span class="mar-bc-specs-text">{{ specs(b) }}</span
          ><!-- One chip after the specs: what needs a look (Desktop's order). -->
          <button
            v-if="b.state === 'error'"
            type="button"
            class="mar-bc-chip is-bad"
            title="View error details"
            @click.stop="crashOf = b"
          >
            <OctagonAlert :size="12" aria-hidden="true" />Error
          </button>
          <button
            v-else-if="problemOf(b)"
            type="button"
            class="mar-bc-chip is-bad"
            @click.stop="fixProblem(b)"
          >
            <OctagonAlert :size="12" aria-hidden="true" />{{ PROBLEM_LABEL[problemOf(b)!] }}
          </button>
          <button
            v-else-if="extraOf(b.id).migrate && !updating.has(b.id)"
            type="button"
            class="mar-bc-update"
            :disabled="busy(b) || b.state === 'running'"
            :title="
              b.state === 'running' ? 'Stop the running instance first.' : 'Migrate to Standalone'
            "
            @click.stop="migrate(b)"
          >
            <ArrowRightLeft :size="12" aria-hidden="true" />Migrate
          </button>
          <button
            v-else-if="b.state === 'update' && !updating.has(b.id)"
            type="button"
            class="mar-bc-update"
            :disabled="busy(b)"
            title="Update to v0.37.6"
            @click.stop="update(b)"
          >
            <ArrowUpCircle :size="12" aria-hidden="true" />Update available
          </button>
          <template v-else-if="b.id === 'cloud' && !proto.signedIn">
            <span class="mar-bc-free">Try free</span>
            <Tooltip
              content="Run on fast cloud GPUs with nothing to install. Your first runs are free."
            >
              <button type="button" class="mar-bc-why" aria-label="Why try Cloud?" @click.stop>
                <Info :size="13" />
              </button>
            </Tooltip> </template
        ></template>
        <template #cols>
          <span class="mar-item-col mar-bc-row-state"
            ><span
              v-if="!problemOf(b)"
              class="mar-bc-badge"
              :class="[`is-${m1State(b).tone}`, m1State(b).spin && 'is-spin']"
              ><Loader2 v-if="m1State(b).spin" :size="12" class="animate-spin" /><i
                v-else
                aria-hidden="true"
              />{{ m1State(b).label }}</span
            ></span
          >
        </template>
        <template #actions>
          <Button
            v-if="problemOf(b)"
            variant="secondary"
            size="md"
            class="mar-bc-main"
            @click.stop="fixProblem(b)"
            >{{ PROBLEM_ACTION[problemOf(b)!] }}</Button
          >
          <MarSplitButton
            v-else-if="!creating.has(b.id) && !stopping.has(b.id)"
            tone="secondary"
            :label="busy(b) ? m1State(b).label : launch(b).label"
            :suffix="busy(b) ? undefined : launchWhere(b)"
            :disabled="busy(b)"
            :lines="
              b.state === 'running' && b.kind === 'local' && !busy(b)
                ? [{ label: 'Stop', icon: CircleStop, run: () => stop(b) }]
                : []
            "
            menu-label="Window options"
            @run="launch(b).run()"
          />
        </template>
      </MarItem>
      <BuildCrashDialog
        :build="crashOf"
        @close="crashOf = undefined"
        @start="crashOf && retry(crashOf)"
      />
    </div>
    <!-- Grouped: the group says where, with the hardware its builds share. -->
    <template v-else-if="view === 'grid' && buildCard.id === 'grouped'">
      <section v-for="g in groups" :key="g.kind" class="mar-bc-group">
        <h2 class="mar-bc-group-head">
          <LocationIcon :kind="g.kind" :size="15" />{{ g.label }}
          <span class="mar-bc-group-hint">{{ g.hint }}</span>
        </h2>
        <div class="mar-grid is-wide">
          <MarBuildCard
            v-for="b in g.items"
            :key="b.id"
            look="grouped"
            v-bind="card(b)"
            v-on="cardOn(b)"
          />
        </div>
      </section>
    </template>
    <div
      v-else-if="view === 'grid' && buildCard.id !== 'photos'"
      class="mar-grid is-wide"
      :class="buildCard.id === 'split' && 'is-two'"
    >
      <MarBuildCard
        v-for="b in shown"
        :key="b.id"
        :look="buildCard.id"
        v-bind="card(b)"
        v-on="cardOn(b)"
      />
    </div>
    <!-- Photos: the last things made on it, then what milestone 1 says and
         no more: name, specs, the state, one action that says where. -->
    <div v-else-if="view === 'grid'" class="mar-grid is-wide">
      <MarItem
        v-for="b in shown"
        :key="b.id"
        :name="b.name"
        :fav="b.fav"
        :lines="lines(b)"
        :selectable="false"
        :renaming="lib.renaming.value === b.id"
        ratio="2 / 1"
        class="mar-build"
        @open="open(b)"
        @start-rename="lib.renaming.value = b.id"
        @rename="lib.rename(b.id, $event)"
        @cancel-rename="lib.renaming.value = ''"
        @star="builds.star(b.id)"
      >
        <template #media>
          <span class="mar-build-made" :class="`is-${b.state}`" aria-hidden="true">
            <img v-for="id in outputs.get(b.id)" :key="id" :src="thumb(id)" alt="" loading="lazy" />
          </span>
        </template>
        <template #meta
          ><span class="mar-bc-specs-text">{{ b.state === 'error' ? b.error : specs(b) }}</span
          ><button
            v-if="b.state === 'update' || updating.has(b.id)"
            type="button"
            class="mar-bc-update"
            :disabled="updating.has(b.id)"
            :title="updating.has(b.id) ? undefined : 'Update this build'"
            @click.stop="update(b)"
          >
            <ArrowUpCircle :size="12" aria-hidden="true" />{{
              updating.has(b.id) ? 'Updating…' : 'Update available'
            }}
          </button></template
        >
        <template #footer>
          <span class="mar-build-foot">
            <span class="mar-bc-badge" :class="`is-${rowTone(b)}`"
              ><i aria-hidden="true" />{{ rowState(b) }}</span
            >
            <MarSplitButton
              tone="secondary"
              :label="
                b.state === 'launching' && !updating.has(b.id) ? 'Starting…' : primary(b).label
              "
              :suffix="b.state === 'launching' ? undefined : runsOn(b)"
              :disabled="b.state === 'launching'"
              :lines="
                second(b)
                  ? [
                      {
                        label: second(b)!.label,
                        icon: second(b)!.icon as Component,
                        run: second(b)!.run
                      }
                    ]
                  : []
              "
              menu-label="More ways to run"
              @run="primary(b).run()"
            />
          </span>
        </template>
      </MarItem>
    </div>
    <div
      v-else
      class="mar-table is-items"
      style="--mar-cols: minmax(0, 220px) 120px; --mar-tools: 248px"
    >
      <div class="mar-table-head">
        <span>Build</span
        ><template v-if="building"><span>Latest snapshot</span><span>Deployments</span></template
        ><template v-else><span>Runs on</span><span>Last used</span></template
        ><span class="is-end">State</span><span />
      </div>
      <MarItem
        v-for="b in shown"
        :key="b.id"
        layout="list"
        :name="b.name"
        :meta="
          b.error ??
          [b.deployment ? 'Cloud build' : b.channel, b.version].filter(Boolean).join(' · ')
        "
        :status="STATUS[b.state]"
        :status-label="statusLabel(b)"
        :fav="b.fav"
        :lines="lines(b)"
        :selectable="false"
        :renaming="lib.renaming.value === b.id"
        @open="open(b)"
        @start-rename="lib.renaming.value = b.id"
        @rename="lib.rename(b.id, $event)"
        @cancel-rename="lib.renaming.value = ''"
        @star="builds.star(b.id)"
      >
        <template #media>
          <span class="mar-build-glyph"
            ><LocationIcon :kind="b.kind === 'cloud' ? 'cloud' : 'local'" :size="20"
          /></span>
        </template>
        <template #actions>
          <Button
            v-if="second(b)"
            variant="ghost"
            size="sm"
            class="mar-bc-second"
            :title="second(b)!.hint"
            @click.stop="second(b)!.run()"
            ><component :is="second(b)!.icon" :size="13" />{{ second(b)!.label }}</Button
          >
          <Button
            variant="secondary"
            size="sm"
            class="mar-bc-main"
            :disabled="b.state === 'launching'"
            @click.stop="primary(b).run()"
            ><component :is="primary(b).icon" :size="13" />{{
              b.state === 'launching' ? 'Starting…' : primary(b).label
            }}</Button
          >
        </template>
        <template v-if="building" #cols>
          <span class="mar-item-col">{{ versionsOf(b)[0]?.label ?? 'Latest' }}</span>
          <span class="mar-item-col">{{ deploymentsOf(b.id).length || '—' }}</span>
        </template>
        <template v-else #cols>
          <!-- Where first, then the hardware it runs on. -->
          <span class="mar-item-col"
            ><span class="mar-build-where">{{ whereLabel(b) }}</span
            ><template v-if="b.gpu"> · {{ gpuName(b) }}</template></span
          >
          <span class="mar-item-col">{{ b.state === 'running' ? 'Now' : b.lastUsed }}</span>
        </template>
      </MarItem>
    </div>
  </MarPage>
</template>

<style>
/* One card: an inset strip of outputs, name and meta, then the specs
   with the button bottom-right. A solid surface and a hairline. */
:root .proto-ui.proto-ui.proto-ui .mar-item.is-grid.mar-build {
  display: grid;
  padding: 6px;
  grid-template-rows: auto auto 1fr;
  background: var(--color-card-background);
  backdrop-filter: none;
  box-shadow:
    0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 11%, transparent),
    0 1px 2px rgb(0 0 0 / 0.04);
}
:root .proto-ui.proto-ui.proto-ui .mar-item.is-grid.mar-build:is(:hover, .is-menu) {
  background: var(--color-card-background-hover);
}
/* Nested radius: the card's corner minus its padding. */
.mar-build > .mar-item-media {
  border-radius: max(calc(var(--radius-card) - 6px), 4px);
}
.mar-build > .mar-item-text {
  padding: 12px 8px 0;
}
:root .proto-ui.proto-ui.proto-ui .mar-build .mar-item-name {
  font-size: 14px;
  font-weight: 600;
}
/* The chip's inset on the strip. */
.mar-build .mar-item-status {
  top: 10px;
  left: 10px;
}
/* The last things made here: the newest large, two more stacked. */
.mar-build-made {
  display: grid;
  width: 100%;
  height: 100%;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 2px;
}
.mar-item-media .mar-build-made img {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  object-fit: cover;
}
.mar-build-made img:first-child {
  grid-row: span 2;
}
.mar-build-made:is(.is-stopped, .is-update) img {
  filter: saturate(0.75) brightness(0.88);
}
.mar-build-made.is-error img {
  filter: grayscale(1) brightness(0.7);
}
/* The specs: three lines on an 8px rhythm, labels muted, values bright. */
.mar-build-spec {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 8px;
  margin: 12px 8px 2px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  color: var(--color-muted-foreground);
  font-size: 12px;
  line-height: 18px;
}
.mar-build-row {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  white-space: nowrap;
}
.mar-build-row.is-last {
  height: 28px;
  margin-bottom: 4px;
}
.mar-build-spec b {
  color: var(--color-base-foreground);
  font-variant-numeric: tabular-nums;
  font-weight: 400;
}
.mar-build-gpu {
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
}
.mar-build-spec .is-error {
  color: var(--color-error-foreground, oklch(0.62 0.19 25));
}
.mar-build-mem {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
.mar-build-bar {
  position: relative;
  width: 56px;
  height: 4px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
}
.mar-build-bar i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: var(--color-base-foreground);
}
/* Runs on: where reads first, the hardware after it, quieter. */
.mar-build-where {
  color: var(--color-base-foreground);
}
.mar-build-glyph {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
}
/* ---- Light: the same card, tuned for a white page. Dark is above. ---- */
/* A soft surface: a faint ring and a low shadow instead of an outline. */
:root[data-ds-theme='light'] .proto-ui.proto-ui.proto-ui .mar-item.is-grid.mar-build {
  box-shadow:
    0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 6%, transparent),
    0 1px 2px color-mix(in oklch, var(--color-base-foreground) 5%, transparent),
    0 8px 24px -12px color-mix(in oklch, var(--color-base-foreground) 16%, transparent);
}
/* The strip's seams take the card's colour, not a dark gap. */
:root[data-ds-theme='light'] .mar-build-made {
  background: var(--color-card-background);
}
:root[data-ds-theme='light'] .mar-build-spec {
  border-top-color: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
/* A light track under a mid-grey fill (the fill is set in light.css). */
:root[data-ds-theme='light'] .mar-build-bar {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
/* Chips on the strip: a frosted white pill, dark words, the dot in colour. */
:root[data-ds-theme='light'] .mar-build .mar-status.on-media {
  background: color-mix(in oklch, var(--color-card-background) 86%, transparent);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
  color: var(--color-base-foreground);
}
:root[data-ds-theme='light'] .mar-build .mar-status.on-media.is-go .mar-status-dot {
  color: var(--color-status-running);
}
:root[data-ds-theme='light'] .mar-build .mar-status.on-media.is-bad svg {
  color: var(--color-status-danger);
}
:root[data-ds-theme='light'] .mar-build .mar-status.on-media.is-warn svg {
  color: oklch(0.62 0.14 70);
}
/* Didn't start: a calm inline banner (light red tint and an icon) in
   place of raw red words; it keeps the line's height. */
:root[data-ds-theme='light'] .mar-build-spec .is-error {
  color: var(--color-status-danger);
}
:root[data-ds-theme='light'] .mar-build-row.is-error {
  justify-content: flex-start;
  gap: 6px;
  margin: -5px 0;
  padding: 5px 8px;
  border-radius: var(--radius-control);
  background: color-mix(in oklch, var(--color-status-danger) 8%, var(--color-card-background));
  color: color-mix(in oklch, var(--color-status-danger) 70%, var(--color-base-foreground));
}
.mar-build-alert {
  display: none;
  flex-shrink: 0;
}
:root[data-ds-theme='light'] .mar-build-alert {
  display: block;
  color: var(--color-status-danger);
}
/* The card's button: the system's light secondary-primary, not a heavy
   black block in every card. */
:root[data-ds-theme='light'] .proto-ui.proto-ui.proto-ui .mar-build-go {
  border: 1px solid color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
  background: var(--color-card-background);
  box-shadow: 0 1px 2px color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-base-foreground);
}
:root[data-ds-theme='light'] .proto-ui.proto-ui.proto-ui .mar-build-go:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 5%, var(--color-card-background));
}
/* One-action cards: two to a row, so the button has room to say where. */
.mar-grid.is-wide.is-two {
  grid-template-columns: repeat(auto-fill, minmax(max(300px, calc(50% - 7px)), 1fr));
}
/* One build to a line, on the card's surface. */
.mar-bc-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
:root .proto-ui.proto-ui.proto-ui .mar-item.is-list.mar-bc-row {
  height: 56px;
  gap: 12px;
  padding: 0 12px 0 16px;
  border-radius: var(--radius-card);
  background: var(--color-card-background);
}
:root .proto-ui.proto-ui.proto-ui .mar-item.is-list.mar-bc-row:is(:hover, .is-menu) {
  background: var(--color-card-background-hover);
}
/* Where: a small mark, no tile. */
.mar-bc-row > .mar-item-media {
  display: flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  overflow: visible;
  background: none;
  color: var(--color-muted-foreground);
}
/* The name and its specs on one line. */
.mar-bc-row > .mar-item-text {
  min-width: 0;
  flex-direction: row;
  align-items: baseline;
  gap: 12px;
}
:root .proto-ui.proto-ui.proto-ui .mar-bc-row .mar-item-name {
  flex-shrink: 0;
  font-size: 14px;
  font-weight: 600;
}
.mar-bc-row .mar-item-meta {
  gap: 10px;
  color: var(--color-muted-foreground);
  font-size: 13px;
}
.mar-bc-specs-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* An update is about the version, not the state: a small badge after it. */
:root .proto-ui.proto-ui.proto-ui .mar-bc-update {
  display: inline-flex;
  border: 0;
  font-family: inherit;
  height: 20px;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  padding: 0 7px 0 5px;
  border-radius: 6px;
  background: color-mix(in oklch, var(--color-status-warning, #f5b14c) 14%, transparent);
  color: var(--color-status-warning, #f5b14c);
  font-size: 12px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .mar-bc-update:not(:disabled) {
  cursor: pointer;
}
:root .proto-ui.proto-ui.proto-ui .mar-bc-update:not(:disabled):hover {
  background: color-mix(in oklch, var(--color-status-warning, #f5b14c) 24%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-bc-update:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 1px;
}
:root .proto-ui.proto-ui.proto-ui .mar-bc-update:disabled {
  opacity: 0.8;
}
/* Stopping: the row waits, dimmed, with nothing to click. */
.mar-bc-row.is-stopping {
  opacity: 0.7;
  pointer-events: none;
}
/* What needs a look, after the specs: an error or a problem, in red. */
:root .proto-ui.proto-ui.proto-ui .mar-bc-chip {
  display: inline-flex;
  height: 20px;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  padding: 0 7px 0 5px;
  border: 0;
  border-radius: 6px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
:root .proto-ui.proto-ui.proto-ui .mar-bc-chip.is-bad {
  background: color-mix(in oklch, var(--color-status-danger) 14%, transparent);
  color: var(--color-status-danger);
}
:root .proto-ui.proto-ui.proto-ui .mar-bc-chip.is-bad:hover {
  background: color-mix(in oklch, var(--color-status-danger) 22%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-bc-chip:focus-visible,
:root .proto-ui.proto-ui.proto-ui .mar-bc-why:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 1px;
}
/* Cloud before it's used: a small pill and why. */
.mar-bc-free {
  display: inline-flex;
  height: 18px;
  flex-shrink: 0;
  align-items: center;
  padding: 0 6px;
  border-radius: 5px;
  background: var(--color-base-foreground);
  color: var(--color-base-background, #000);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
:root .proto-ui.proto-ui.proto-ui .mar-bc-why {
  display: inline-flex;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  margin-left: -4px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-bc-why:hover {
  color: var(--color-base-foreground);
}
.mar-bc-row .mar-bc-badge.is-spin > svg {
  color: var(--color-muted-foreground);
}
/* The state lines up from row to row; the chip column stays empty. */
.mar-bc-row .mar-item-col.is-status {
  display: none;
}
.mar-bc-row-state {
  width: 150px;
  overflow: visible;
  padding-left: 3px;
}
/* The ⋯ stands as tall as the action beside it. */
:root .proto-ui.proto-ui.proto-ui .mar-bc-row .mar-kebab {
  width: 32px;
  height: 32px;
}
.mar-bc-row .mar-item-tools.is-row {
  width: 240px;
  justify-content: flex-end;
}
/* No star on a build: the ⋯ sits right beside the button. */
:root .proto-ui.proto-ui.proto-ui .mar-bc-row .mar-item-tools .mar-star {
  display: none;
}
@container (max-width: 720px) {
  .mar-bc-row .mar-split-suffix {
    display: none;
  }
}
:is(.mar-bc-row, .mar-build) .mar-bc-badge {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 7px;
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
}
:is(.mar-bc-row, .mar-build) .mar-bc-badge.is-ok {
  color: var(--color-status-running);
}
:is(.mar-bc-row, .mar-build) .mar-bc-badge.is-warn {
  color: var(--color-status-warning, #f5b14c);
}
:is(.mar-bc-row, .mar-build) .mar-bc-badge.is-bad {
  color: var(--color-status-danger);
}
:is(.mar-bc-row, .mar-build) .mar-bc-badge {
  gap: 9px;
}
/* The dot in the state's colour, on a soft halo of the same. */
:is(.mar-bc-row, .mar-build) .mar-bc-badge > i {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--color-subtle-foreground);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-subtle-foreground) 18%, transparent);
}
:is(.mar-bc-row, .mar-build) .mar-bc-badge:not(.is-idle) > i {
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in oklch, currentColor 20%, transparent);
}
/* Photos: specs and the update badge on one line, then the state across
   from the one action. */
.mar-build .mar-item-meta {
  height: 20px;
  gap: 8px;
}
.mar-build-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 12px 8px 4px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
}
</style>
