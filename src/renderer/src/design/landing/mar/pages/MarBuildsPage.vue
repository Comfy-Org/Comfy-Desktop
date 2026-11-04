<script setup lang="ts">
import { computed, reactive, ref, type Component } from 'vue'
import {
  ArrowUpCircle,
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
import type { ProtoInstance } from '../../mock'
import { go } from '../../useProto'
import { openBuild } from '../build/buildTab'
import { clearError, errorOf } from '../build/buildErrors'
import { surface } from '../shell/surface'
import MarPage from './MarPage.vue'
import { EMPTY_PICS } from './emptyArt'
import MarItem from './MarItem.vue'
import MarSplitButton from './MarSplitButton.vue'
import MarSeg from './MarSeg.vue'
import MarSearchField from './MarSearchField.vue'
import MarSelectBar from './MarSelectBar.vue'
import { collection } from './collection'
import { useLibrary } from './library'
import { shownState } from './pageState'
import { notify } from './undo'
import type { MenuLine } from './menu'
import type { ItemStatus } from './MarStatus.vue'

/**
 * Builds (Mar's proposal): where your work runs, each with its own
 * ComfyUI version, custom nodes and models. One build to a line: where it
 * runs as a small mark, the name with its specs, the state as a badge with
 * no fill, then one action that says where it runs (Open, Start, Try
 * again), the state's other frequent action (Stop, Update) in its chevron.
 * A click anywhere else opens the build's page; the ⋯ menu keeps the rare
 * and destructive actions. Build mode keeps the table with what ships.
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
// deployments), so it keeps the table with those columns.
const building = computed(() => proto.mode === 'build')

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

const gpuName = (b: Build): string =>
  b.gpu?.split(' · ')[0] ?? (b.kind === 'cloud' ? 'Cloud GPU' : 'This computer')
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
function stop(b: Build): void {
  b.state = 'stopped'
  notify(`Stopped ${b.name}`, () => (b.state = 'running'))
}
// Builds updating now: the badge says so while the state stays as it was.
const updating = reactive(new Set<string>())
function update(b: Build): void {
  if (updating.has(b.id)) return
  updating.add(b.id)
  setTimeout(() => {
    updating.delete(b.id)
    if (b.state === 'update') b.state = 'stopped'
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

/* ---- One build to a line ---- */
// The page's own words for where: the filter's.
const whereLabel = (b: Build): string => (b.kind === 'local' ? 'This computer' : 'Cloud')
// The specs, hardware first. Where it runs is the mark and the button.
const specs = (b: Build): string =>
  [gpuName(b), b.deployment ? undefined : b.channel, b.version].filter(Boolean).join(' · ')
// Open and Start say where; Try again stays short.
const runsOn = (b: Build): string | undefined =>
  b.state === 'error' ? undefined : b.kind === 'cloud' ? 'on Cloud' : 'on this computer'
// The state as a badge with no fill.
const SPLIT_STATE: Record<ProtoInstance['state'], string> = {
  running: 'Running',
  launching: 'Starting',
  error: 'Failed to start',
  update: 'Stopped',
  stopped: 'Stopped'
}
const splitState = (b: Build): string =>
  b.state === 'stopped' && b.kind === 'cloud' ? 'Asleep' : SPLIT_STATE[b.state]
const TONE: Record<ProtoInstance['state'], 'ok' | 'warn' | 'bad' | 'idle'> = {
  running: 'ok',
  launching: 'ok',
  update: 'idle',
  error: 'bad',
  stopped: 'idle'
}
const newLabel = computed(() =>
  surface.id === 'desktop' ? 'Install on this computer' : 'Set up a cloud build'
)
</script>

<template>
  <MarPage
    title="Builds"
    skeleton="list"
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
      </div>
    </template>

    <!-- One build to a line: where as a small mark, the name and its specs,
         the state as a badge, then one action that says where it runs. -->
    <div v-if="!building" class="mar-bc-rows">
      <MarItem
        v-for="b in shown"
        :key="b.id"
        layout="list"
        :name="b.name"
        :lines="lines(b)"
        :selected="lib.sel.has(b.id)"
        :selecting="lib.sel.ids.value.size > 0"
        :renaming="lib.renaming.value === b.id"
        class="mar-bc-row"
        @open="open(b)"
        @select="lib.pick(b.id, $event)"
        @start-rename="lib.renaming.value = b.id"
        @rename="lib.rename(b.id, $event)"
        @cancel-rename="lib.renaming.value = ''"
      >
        <template #media>
          <LocationIcon :kind="b.kind === 'cloud' ? 'cloud' : 'local'" :size="16" />
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
        <template #cols>
          <span class="mar-item-col mar-bc-row-state"
            ><span class="mar-bc-badge" :class="`is-${TONE[b.state]}`"
              ><i aria-hidden="true" />{{ splitState(b) }}</span
            ></span
          >
        </template>
        <template #actions>
          <MarSplitButton
            tone="secondary"
            :label="b.state === 'launching' ? 'Starting…' : primary(b).label"
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
:root .proto-ui.proto-ui.proto-ui .mar-item.is-list.mar-bc-row.is-selected {
  box-shadow: 0 0 0 2px var(--color-base-foreground);
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
/* The state lines up from row to row; the chip column stays empty. */
.mar-bc-row .mar-item-col.is-status {
  display: none;
}
.mar-bc-row-state {
  width: 150px;
  overflow: visible;
  padding-left: 3px;
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
.mar-bc-badge {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 7px;
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
}
.mar-bc-badge.is-ok {
  color: var(--color-status-running);
}
.mar-bc-badge.is-warn {
  color: var(--color-status-warning, #f5b14c);
}
.mar-bc-badge.is-bad {
  color: var(--color-status-danger);
}
.mar-bc-badge {
  gap: 9px;
}
/* The dot in the state's colour, on a soft halo of the same. */
.mar-bc-badge > i {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--color-subtle-foreground);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-subtle-foreground) 18%, transparent);
}
.mar-bc-badge:not(.is-idle) > i {
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in oklch, currentColor 20%, transparent);
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
</style>
