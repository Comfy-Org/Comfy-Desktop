<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowUpCircle,
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
import { hostActions, instances, proto, toast, type Page } from '../../useProto'
import { TEMPLATES, thumb, type ProtoInstance } from '../../mock'
import { allAssets } from '../../gallery'
import { go } from '../../useProto'
import { surface } from '../shell/surface'
import MarPage from './MarPage.vue'
import MarItem from './MarItem.vue'
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
 * ComfyUI version, custom nodes and models. A card's cover is the build
 * at a glance: the last things made on it, then a small live panel (what
 * it runs on, memory in use or how it wakes, models, node packs, disk or
 * credits an hour). Its button does the one thing the state needs (Open,
 * Start, Update, Try again), always bottom-right of the panel.
 */
type Build = ProtoInstance & { project?: string; fav?: boolean; error?: string }

const builds = collection<Build>(
  instances.value.map((i) =>
    i.id === 'local-flux'
      ? { ...i, state: 'error' as const, error: 'A custom node didn’t load. See the logs.' }
      : { ...i }
  ),
  'build'
)

type Where = 'all' | 'local' | 'cloud'
const where = ref<Where>('all')
const sort = ref('used')
const query = ref('')
const view = ref<'grid' | 'list'>('grid')

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
const DISK_FREE = '412 GB free'
const live = (b: Build): Live => LIVE[b.id] ?? {}
const memory = (b: Build): string => (b.gpu?.includes(' GB') ? 'VRAM' : 'Memory')
const gpuName = (b: Build): string =>
  b.gpu?.split(' · ')[0] ?? (b.kind === 'cloud' ? 'Cloud GPU' : 'This computer')
function stateLine(b: Build): string {
  if (b.state === 'launching') return b.kind === 'cloud' ? 'Waking up, ~20 s' : 'Starting…'
  if (b.state === 'running')
    return [`Up ${live(b).up ?? 'just now'}`, live(b).rate && `${live(b).rate} credits/h`]
      .filter(Boolean)
      .join(' · ')
  if (b.state === 'error') return 'Didn’t start'
  if (b.kind === 'cloud') return 'Asleep · wakes in ~20 s'
  return b.state === 'update' ? 'Stopped · new version ready' : 'Stopped'
}
const facts = (b: Build): string[] => [
  b.models !== undefined ? `${b.models} models` : 'Every model',
  b.nodes !== undefined ? `${b.nodes} node packs` : 'Core nodes',
  ...(b.kind === 'local' && b.diskSize ? [b.diskSize] : [])
]

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
  start(b)
}
function primary(b: Build): { label: string; icon: unknown; run: () => void } {
  if (b.state === 'running')
    return { label: 'Open', icon: ExternalLink, run: () => hostActions.launch(original(b)) }
  if (b.state === 'update') return { label: 'Update', icon: ArrowUpCircle, run: () => update(b) }
  if (b.state === 'error') return { label: 'Try again', icon: RotateCw, run: () => retry(b) }
  return { label: 'Start', icon: Play, run: () => start(b) }
}
function open(b: Build): void {
  if (b.state === 'running') hostActions.launch(original(b))
  else go(`environment:${b.id}` as Page)
}

function lines(b: Build): MenuLine[] {
  return [
    b.state === 'running'
      ? { label: 'Open', icon: ExternalLink, run: () => hostActions.launch(original(b)) }
      : { label: 'Start', icon: Play, disabled: b.state === 'launching', run: () => start(b) },
    ...(b.state === 'running' ? [{ label: 'Stop', icon: Square, run: () => stop(b) }] : []),
    ...(b.state === 'update'
      ? [{ label: 'Update', icon: ArrowUpCircle, run: () => update(b) }]
      : []),
    { label: 'Details', icon: Settings2, run: () => go(`environment:${b.id}` as Page) },
    'sep',
    { label: 'Rename', icon: Pencil, run: () => (lib.renaming.value = b.id) },
    ...(b.kind === 'local'
      ? [
          { label: 'Duplicate', icon: Copy, run: () => builds.duplicate(b.id) },
          { label: 'Show in Finder', icon: FolderOpen, run: () => toast(`Revealed ${b.name}`) }
        ]
      : []),
    { label: 'Logs', icon: ScrollText, run: () => go('logs') },
    ...(b.id === 'cloud'
      ? []
      : [
          'sep' as const,
          {
            label: b.kind === 'local' ? 'Remove from this computer' : 'Delete build',
            icon: Trash2,
            danger: true,
            disabled: b.state === 'running',
            run: () => builds.remove([b.id])
          }
        ])
  ]
}

const newLabel = computed(() =>
  surface.id === 'desktop' ? 'Install on this computer' : 'Set up a cloud build'
)
</script>

<template>
  <MarPage
    title="Builds"
    :description="
      proto.mode === 'build'
        ? 'A ComfyUI version, custom nodes and models. Save versions, then deploy them.'
        : 'Where your work runs. Each has its own ComfyUI version, custom nodes and models.'
    "
    :skeleton="view === 'grid' ? 'cards' : 'list'"
    :no-results="shown.length === 0 && filtered"
    :state="shownState === 'live' && builds.items.length === 0 ? 'empty' : undefined"
    :empty="{
      icon: Plus,
      title: 'Set up where your work runs',
      text: 'A build is ComfyUI with its own version, custom nodes and models. Install one on this computer, or run on Comfy Cloud with nothing to install.',
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

    <div v-if="view === 'grid'" class="mar-grid is-wide">
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
        ratio="16 / 11"
        class="mar-build"
        @open="open(b)"
        @select="lib.pick(b.id, $event)"
        @start-rename="lib.renaming.value = b.id"
        @rename="lib.rename(b.id, $event)"
        @cancel-rename="lib.renaming.value = ''"
        @star="builds.star(b.id)"
      >
        <template #media>
          <span class="mar-build-face" :class="`is-${b.state}`">
            <span class="mar-build-made" aria-hidden="true">
              <img
                v-for="id in outputs.get(b.id)"
                :key="id"
                :src="thumb(id)"
                alt=""
                loading="lazy"
              />
            </span>
            <span class="mar-build-panel">
              <span class="mar-build-row">
                <span class="mar-build-gpu"
                  ><LocationIcon :kind="b.kind === 'cloud' ? 'cloud' : 'local'" :size="14" />{{
                    gpuName(b)
                  }}</span
                >
                <span class="mar-build-state">{{ stateLine(b) }}</span>
              </span>
              <span v-if="b.state === 'error'" class="mar-build-error">{{ b.error }}</span>
              <span
                v-else-if="b.state === 'running' && live(b).mem"
                class="mar-build-meter"
                :aria-label="`${memory(b)} ${live(b).mem![0]} of ${live(b).mem![1]} GB`"
              >
                <span class="mar-build-bar"
                  ><i :style="{ width: `${(live(b).mem![0] / live(b).mem![1]) * 100}%` }"
                /></span>
                <span class="tabular-nums"
                  >{{ memory(b) }} {{ live(b).mem![0] }} / {{ live(b).mem![1] }} GB</span
                >
              </span>
              <span v-else-if="b.kind === 'local'" class="mar-build-meter is-quiet">
                <span class="mar-build-bar"><i style="width: 38%" /></span>
                <span>Disk {{ DISK_FREE }}</span>
              </span>
              <span v-else class="mar-build-meter is-quiet">
                <span
                  >{{ b.gpu?.split(' · ')[1] ?? '' }} {{ memory(b) }} ·
                  {{ live(b).rate ?? 40 }} credits/h while it runs</span
                >
              </span>
              <span class="mar-build-facts">
                <span v-for="f in facts(b)" :key="f">{{ f }}</span>
              </span>
            </span>
          </span>
        </template>
        <template #overlay>
          <button
            type="button"
            class="mar-build-go"
            :disabled="b.state === 'launching'"
            @click.stop="primary(b).run()"
          >
            <component :is="primary(b).icon" :size="13" />{{
              b.state === 'launching' ? 'Starting…' : primary(b).label
            }}
          </button>
        </template>
      </MarItem>
    </div>
    <div v-else class="mar-list">
      <div class="mar-list-head">
        <span class="flex-1">Build</span><span class="w-56">Runs on</span
        ><span class="w-28">Last used</span><span class="w-[150px] text-right">State</span
        ><span class="w-16" />
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
        <template #cols>
          <span class="mar-item-col w-56">{{ b.gpu }}</span>
          <span class="mar-item-col w-28">{{ b.state === 'running' ? 'Now' : b.lastUsed }}</span>
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
.mar-build-face {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-card-background);
}
/* The last things made here: three tiles across the top. */
.mar-build-made {
  display: grid;
  height: 42%;
  flex-shrink: 0;
  overflow: hidden;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: minmax(0, 1fr);
  gap: 2px;
}
.mar-item-media .mar-build-made img {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  object-fit: cover;
}
.mar-build-face:is(.is-stopped, .is-update) .mar-build-made img {
  filter: saturate(0.75) brightness(0.85);
}
.mar-build-face.is-error .mar-build-made img {
  filter: grayscale(1) brightness(0.6);
}
/* The live panel: what it runs on and how it is right now. */
.mar-build-panel {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
  padding: 12px 14px;
  color: var(--color-base-foreground);
  font-size: 12px;
}
.mar-build-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.mar-build-gpu {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}
.mar-build-gpu svg {
  color: var(--color-muted-foreground);
}
.mar-build-state {
  color: var(--color-muted-foreground);
  white-space: nowrap;
}
.mar-build-meter {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-muted-foreground);
  white-space: nowrap;
}
.mar-build-bar {
  position: relative;
  height: 4px;
  flex: 1;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.mar-build-bar i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: var(--color-base-foreground);
}
.mar-build-meter.is-quiet .mar-build-bar i {
  background: var(--color-muted-foreground);
}
.mar-build-error {
  color: var(--color-error-foreground, oklch(0.72 0.17 25));
  line-height: 1.35;
}
/* Short facts, left of the button. */
.mar-build-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  padding-right: 92px;
  color: var(--color-muted-foreground);
  white-space: nowrap;
}
.mar-build-facts span + span::before {
  margin: 0 8px 0 0;
  color: var(--color-subtle-foreground);
  content: '·';
}
.mar-build-glyph {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
}
:root .proto-ui.proto-ui.proto-ui .mar-build-go {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: inline-flex;
  width: auto;
  height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-radius: var(--radius-control);
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: 12px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .mar-build-go:hover {
  background: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .mar-build-go:disabled {
  opacity: 0.6;
}
</style>
