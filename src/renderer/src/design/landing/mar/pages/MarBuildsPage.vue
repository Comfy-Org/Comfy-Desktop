<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowUpCircle,
  CircleAlert,
  Camera,
  Copy,
  ExternalLink,
  FolderOpen,
  Pencil,
  Play,
  Plus,
  RotateCw,
  ScrollText,
  Settings2,
  Square,
  Trash2
} from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Select from '../../ui/Select.vue'
import LocationIcon from '../../ui/LocationIcon.vue'
import { hostActions, instances, proto, toast } from '../../useProto'
import { can } from '../../milestones'
import { deploymentsOf, versionsOf } from '../../parts/env/env'
import { TEMPLATES, thumb, type ProtoInstance } from '../../mock'
import { allAssets } from '../../gallery'
import { go } from '../../useProto'
import { openBuild } from '../build/buildTab'
import { clearError, errorOf } from '../build/buildErrors'
import { surface } from '../shell/surface'
import MarPage from './MarPage.vue'
import { EMPTY_PICS } from './emptyArt'
import MarItem from './MarItem.vue'
import MarBuildCard from './MarBuildCard.vue'
import { buildCard } from './buildCard'
import MarSeg from './MarSeg.vue'
import MarSearchField from './MarSearchField.vue'
import MarViewToggle from './MarViewToggle.vue'
import MarSelectBar from './MarSelectBar.vue'
import { collection } from './collection'
import { useLibrary } from './library'
import { shownState } from './pageState'
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
 */
type Build = ProtoInstance & { project?: string; fav?: boolean; error?: string }

const builds = collection<Build>(
  instances.value.map((i) =>
    errorOf(i.id) ? { ...i, state: 'error' as const, error: errorOf(i.id) } : { ...i }
  ),
  'build'
)

type Where = 'all' | 'local' | 'cloud'
const where = ref<Where>('all')
const sort = ref('used')
const query = ref('')
// One Builds page for both modes. Build looks at what ships (versions,
// deployments), so it opens on the list with those columns.
const building = computed(() => proto.mode === 'build')
const view = ref<'grid' | 'list'>(building.value ? 'list' : 'grid')

const WHERE = computed(() => [
  { value: 'all' as const, label: 'All', count: builds.items.length },
  {
    value: 'local' as const,
    label: 'This computer',
    count: builds.items.filter((b) => b.kind === 'local').length
  },
  {
    value: 'cloud' as const,
    label: 'Cloud',
    count: builds.items.filter((b) => b.kind === 'cloud').length
  }
])
const SORTS = [
  { value: 'used', label: 'Last used' },
  { value: 'name', label: 'Name' }
]
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = builds.items.filter(
    (b) =>
      (where.value === 'all' || b.kind === where.value) &&
      (!q || `${b.name} ${b.channel} ${b.gpu}`.toLowerCase().includes(q))
  )
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
const lib = useLibrary(builds, shown)

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
const memory = (b: Build): string => (b.gpu?.includes(' GB') ? 'VRAM' : 'Memory')
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
const sub = (b: Build): string =>
  [
    b.deployment ? 'Cloud build' : b.channel,
    b.version,
    b.state === 'running' ? 'Running now' : b.lastUsed
  ]
    .filter(Boolean)
    .join(' · ')

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
function stop(b: Build): void {
  b.state = 'stopped'
  notify(`Stopped ${b.name}`, () => (b.state = 'running'))
}
function update(b: Build): void {
  b.state = 'launching'
  setTimeout(() => {
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
// A click opens the build's page; Open and Start are the button's.
function open(b: Build): void {
  openBuild(b.id)
}

// The menu keeps what's rare or destructive; the frequent actions sit on
// the card and the row, and the page's tabs are one click away.
function lines(b: Build): MenuLine[] {
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
function card(b: Build) {
  // Where is said elsewhere on the card, so no "Cloud build" here.
  const release = [b.deployment ? undefined : b.channel, b.version].filter(Boolean)
  const mem = b.state === 'running' ? live(b).mem : undefined
  return {
    name: b.name,
    kind: b.kind === 'cloud' ? ('cloud' as const) : ('local' as const),
    where: whereLabel(b),
    // Tile and strip lead the specs with the hardware. Grouped leaves the hardware to
    // its heading, unless it's the cloud's own.
    meta: (buildCard.id === 'tile' || buildCard.id === 'strip'
      ? [gpuName(b), ...release]
      : [
          ...release,
          ...(buildCard.id === 'where' || (buildCard.id === 'grouped' && b.kind === 'cloud')
            ? [gpuName(b)]
            : [])
        ]
    ).join(' · '),
    error: b.state === 'error' ? b.error : undefined,
    status: STATUS[b.state],
    statusLabel: statusLabel(b),
    note: note(b),
    gear: gpuName(b),
    usage: mem && (mem[0] / mem[1]) * 100,
    usageLabel: mem ? `${mem[0]} / ${mem[1]} GB` : memTotal(b),
    counts: `${b.models ?? 'All'} models · ${b.nodes ?? 'Core'} node packs`,
    cta: primary(b),
    second: second(b),
    busy: b.state === 'launching',
    lines: lines(b),
    selected: lib.sel.has(b.id),
    selecting: lib.sel.ids.value.size > 0,
    renaming: lib.renaming.value === b.id,
    fav: b.fav
  }
}
const cardOn = (b: Build) => ({
  open: () => open(b),
  select: (range: boolean) => lib.pick(b.id, range),
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
    :skeleton="view === 'grid' ? 'cards' : 'list'"
    :no-results="shown.length === 0 && filtered"
    :state="shownState === 'live' && builds.items.length === 0 ? 'empty' : undefined"
    :empty="{
      icon: Plus,
      title: 'Set up where your work runs',
      text: 'A build is ComfyUI with its own version, custom nodes and models. Install one on this computer, or run on Comfy Cloud with nothing to install.',
      pics: EMPTY_PICS.builds,
      action: newLabel,
      second: surface.id === 'desktop' ? 'Use Comfy Cloud' : undefined
    }"
    error-text="Cloud builds are out of reach right now. The ones on this computer start as usual."
    @action="hostActions.newInstance()"
    @second="toast('Signing in to Comfy Cloud')"
    @clear="clear"
  >
    <template #actions="{ state }">
      <Button
        v-if="state === 'live' || state === 'loading'"
        variant="primary"
        @click="hostActions.newInstance()"
        ><Plus :size="15" />Build</Button
      >
    </template>

    <template #toolbar>
      <MarSeg v-model="where" :options="WHERE" label="Where" />
      <div class="ml-auto flex items-center gap-2">
        <Select v-model="sort" :options="SORTS" label="Sort" class="w-38" />
        <MarSearchField v-model="query" placeholder="Search builds" />
        <MarViewToggle v-model="view" />
      </div>
    </template>

    <!-- Grouped: the group says where, with the hardware its builds share. -->
    <template v-if="view === 'grid' && buildCard.id === 'grouped'">
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
    <div v-else-if="view === 'grid' && buildCard.id !== 'photos'" class="mar-grid is-wide">
      <MarBuildCard
        v-for="b in shown"
        :key="b.id"
        :look="buildCard.id"
        v-bind="card(b)"
        v-on="cardOn(b)"
      />
    </div>
    <div v-else-if="view === 'grid'" class="mar-grid is-wide">
      <MarItem
        v-for="b in shown"
        :key="b.id"
        :name="b.name"
        :meta="sub(b)"
        :status="STATUS[b.state]"
        :status-label="statusLabel(b)"
        :fav="b.fav"
        :lines="lines(b)"
        :selected="lib.sel.has(b.id)"
        :selecting="lib.sel.ids.value.size > 0"
        :renaming="lib.renaming.value === b.id"
        ratio="2 / 1"
        class="mar-build"
        @open="open(b)"
        @select="lib.pick(b.id, $event)"
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
        <template #footer>
          <span class="mar-build-spec">
            <span class="mar-build-row">
              <span class="mar-build-gpu">{{ gpuName(b) }}</span>
              <span :class="b.state === 'error' && 'is-error'">{{ stateLine(b) }}</span>
            </span>
            <span v-if="b.state === 'error'" class="mar-build-row is-error"
              ><CircleAlert :size="14" class="mar-build-alert" />{{ b.error }}</span
            >
            <span v-else class="mar-build-row">
              <span
                v-if="b.state === 'running' && live(b).mem"
                class="mar-build-mem"
                :aria-label="`${memory(b)} ${live(b).mem![0]} of ${live(b).mem![1]} GB in use`"
              >
                <span class="mar-build-bar"
                  ><i :style="{ width: `${(live(b).mem![0] / live(b).mem![1]) * 100}%` }"
                /></span>
                <span
                  ><b>{{ live(b).mem![0] }} / {{ live(b).mem![1] }} GB</b> {{ memory(b) }}</span
                >
              </span>
              <span v-else
                ><b>{{ memTotal(b) }}</b> {{ memory(b) }}</span
              >
              <span v-if="b.kind === 'cloud'"
                ><b>{{ live(b).rate ?? 40 }}</b> credits/h</span
              >
              <span v-else
                >Disk <b>{{ DISK_FREE }}</b> free</span
              >
            </span>
            <span class="mar-build-row is-last">
              <span
                ><b>{{ b.models ?? 'All' }}</b> models · <b>{{ b.nodes ?? 'Core' }}</b> node
                packs</span
              >
              <Button
                v-if="second(b)"
                variant="ghost"
                size="sm"
                class="ml-auto"
                :title="second(b)!.hint"
                @click.stop="second(b)!.run()"
                ><component :is="second(b)!.icon" :size="13" />{{ second(b)!.label }}</Button
              >
              <Button
                variant="primary"
                size="sm"
                class="mar-build-go"
                :disabled="b.state === 'launching'"
                @click.stop="primary(b).run()"
              >
                <component :is="primary(b).icon" :size="13" />{{
                  b.state === 'launching' ? 'Starting…' : primary(b).label
                }}
              </Button>
            </span>
          </span>
        </template>
      </MarItem>
    </div>
    <div
      v-else
      class="mar-table is-items"
      style="--mar-cols: minmax(0, 220px) 120px; --mar-tools: 200px"
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
        :selected="lib.sel.has(b.id)"
        :selecting="lib.sel.ids.value.size > 0"
        :renaming="lib.renaming.value === b.id"
        @open="open(b)"
        @select="lib.pick(b.id, $event)"
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

    <MarSelectBar
      :n="lib.sel.ids.value.size"
      noun="build"
      :actions="[
        {
          label: 'Stop',
          icon: Square,
          run: () => (
            builds.items
              .filter((b) => lib.sel.has(b.id) && b.state === 'running')
              .forEach((b) => (b.state = 'stopped')),
            lib.sel.clear()
          )
        },
        { label: 'Remove', icon: Trash2, danger: true, run: lib.removeSelected }
      ]"
      @clear="lib.sel.clear()"
      @all="lib.sel.all(lib.order.value)"
    />
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
:root .proto-ui.proto-ui.proto-ui .mar-item.is-grid.mar-build.is-selected {
  box-shadow: 0 0 0 2px var(--color-base-foreground);
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
/* The chip and the check share one inset on the strip. */
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
:root[data-ds-theme='light'] .proto-ui.proto-ui.proto-ui .mar-item.is-grid.mar-build.is-selected {
  box-shadow: 0 0 0 2px var(--color-base-foreground);
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
</style>
