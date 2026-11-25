<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import {
  ChartColumn,
  Check,
  ChevronRight,
  Flag,
  FolderOpen,
  GripVertical,
  ImageDown,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  X
} from 'lucide-vue-next'
import {
  DialogDescription,
  DialogRoot,
  DialogTitle,
  DropdownMenuCheckboxItem,
  DropdownMenuItemIndicator,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import Button from '../../ui/Button.vue'
import Checkbox from '../../ui/Checkbox.vue'
import DialogContent from '../../ui/DialogContent.vue'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuLabel from '../../ui/DropdownMenuLabel.vue'
import { menuItem } from '../../ui/menu.styles'
import { cn } from '../../ui/cn'
import Tooltip from '../../ui/Tooltip.vue'
import { go, toast } from '../../useProto'
import MarItemMenu from '../pages/MarItemMenu.vue'
import MarPage from '../pages/MarPage.vue'
import MarSearchField from '../pages/MarSearchField.vue'
import BenchFilter from './BenchFilter.vue'
import { BENCH_RUNS, fmtS, statsOf, type BenchRun } from './benchData'
import './bench.css'

/**
 * Benchmarks (Desktop's BenchmarksView after Comfy-Desktop#2015): every
 * run in one table with a bar per session and the fastest marked in its
 * row. Group by Workflow or Hardware gives one table per group; Compare by
 * picks the metric; any run can be the baseline from its row. Workspace,
 * Build, Hardware and Workflow filter; one columns picker; selecting rows
 * opens a floating bar to export them.
 */
const ALL = 'all'
type Metric = 'fastest' | 'average' | 'median' | 'slowest'
const METRICS: { value: Metric; label: string }[] = [
  { value: 'fastest', label: 'Fastest' },
  { value: 'average', label: 'Average' },
  { value: 'median', label: 'Median' },
  { value: 'slowest', label: 'Slowest' }
]
type GroupBy = 'none' | 'workflow' | 'hardware'
const GROUP_BY: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'workflow', label: 'Workflow' },
  { value: 'hardware', label: 'Hardware' }
]

const machineKey = (r: BenchRun) => `${r.hardware}|${r.cpu}|${r.memory}|${r.os}`
/** The GPU, then CPU, memory and OS only when two machines need telling apart. */
const machineNames = computed(() => {
  const machines = new Map<string, BenchRun>()
  for (const r of BENCH_RUNS) machines.set(machineKey(r), r)
  const names = new Map<string, string>()
  for (const [key, r] of machines) {
    const same = [...machines.values()].filter((m) => m.hardware === r.hardware)
    const parts = [r.hardware]
    if (same.length > 1) parts.push(r.cpu)
    if (same.filter((m) => m.cpu === r.cpu).length > 1) parts.push(`${r.memory} GB RAM`)
    if (same.filter((m) => m.cpu === r.cpu && m.memory === r.memory).length > 1) parts.push(r.os)
    names.set(key, parts.join(' · '))
  }
  return names
})
const machineName = (r: BenchRun) => machineNames.value.get(machineKey(r)) ?? 'Unknown hardware'

const options = (values: string[]) => [
  { value: ALL, label: 'All' },
  ...[...new Set(values)].map((v) => ({ value: v, label: v }))
]
const workspace = ref(ALL)
const build = ref(ALL)
const hardware = ref(ALL)
const workflow = ref(ALL)
const groupBy = ref<GroupBy>('none')
const metric = ref<Metric>('median')
const query = ref('')

const FILTERS = computed(() => [
  {
    key: 'workspace',
    label: 'Workspace',
    model: workspace,
    options: options(BENCH_RUNS.map((r) => r.workspace))
  },
  { key: 'build', label: 'Build', model: build, options: options(BENCH_RUNS.map((r) => r.build)) },
  {
    key: 'hardware',
    label: 'Hardware',
    model: hardware,
    options: options(BENCH_RUNS.map(machineName))
  },
  {
    key: 'workflow',
    label: 'Workflow',
    model: workflow,
    options: options(BENCH_RUNS.map((r) => r.workflow))
  }
])

const visible = (r: BenchRun): boolean => {
  const q = query.value.trim().toLowerCase()
  return (
    (workspace.value === ALL || r.workspace === workspace.value) &&
    (build.value === ALL || r.build === build.value) &&
    (hardware.value === ALL || machineName(r) === hardware.value) &&
    (workflow.value === ALL || r.workflow === workflow.value) &&
    (!q ||
      [r.session, r.workflow, r.build, r.workspace, machineName(r)].some((v) =>
        v.toLowerCase().includes(q)
      ))
  )
}
const filtering = computed(
  () => [workspace, build, hardware, workflow].some((f) => f.value !== ALL) || Boolean(query.value)
)
function clear(): void {
  for (const f of [workspace, build, hardware, workflow]) f.value = ALL
  query.value = ''
}
const refreshing = ref(false)
function refresh(): void {
  refreshing.value = true
  setTimeout(() => (refreshing.value = false), 700)
}

// Columns: Session, the Compare by value and Vs baseline are always on.
type Extra = 'workspace' | 'date' | 'runs' | Metric | 'hardware' | 'failed'
const EXTRA: { key: Extra; label: string; width: string }[] = [
  { key: 'workspace', label: 'Workspace', width: 'minmax(96px, 0.7fr)' },
  { key: 'date', label: 'Date / Time', width: '168px' },
  { key: 'runs', label: 'Runs', width: '52px' },
  { key: 'fastest', label: 'Fastest', width: '72px' },
  { key: 'average', label: 'Average', width: '72px' },
  { key: 'median', label: 'Median', width: '72px' },
  { key: 'slowest', label: 'Slowest', width: '72px' },
  { key: 'hardware', label: 'GPU / Hardware', width: 'minmax(120px, 0.9fr)' },
  { key: 'failed', label: 'Failed Run Count', width: '112px' }
]
const shown = reactive(new Set<string>(['workflow', 'build', 'range']))
const metricLabel = computed(() => METRICS.find((m) => m.value === metric.value)!.label)
const pickerRows = computed(() => {
  const keys: { key: string; label: string }[] = [
    { key: 'session', label: 'Session' },
    ...(groupBy.value === 'workflow' ? [] : [{ key: 'workflow', label: 'Workflow' }]),
    { key: 'build', label: 'Build' },
    { key: 'range', label: `${metricLabel.value} and range` },
    ...EXTRA,
    { key: 'vs', label: 'Vs baseline' }
  ]
  const locked = new Set(['session', metric.value, 'vs'])
  return keys.map((k) => ({
    ...k,
    locked: locked.has(k.key),
    on: locked.has(k.key) || shown.has(k.key)
  }))
})
const setShown = (key: string, on: boolean) => (on ? shown.add(key) : shown.delete(key))
const extras = computed(() => EXTRA.filter((c) => c.key !== metric.value && shown.has(c.key)))
const showWorkflow = computed(() => groupBy.value !== 'workflow' && shown.has('workflow'))
const grid = computed(() =>
  [
    '40px',
    'minmax(160px, 1.3fr)',
    showWorkflow.value && 'minmax(120px, 1fr)',
    shown.has('build') && 'minmax(96px, 0.8fr)',
    shown.has('range') && 'minmax(140px, 1.6fr)',
    ...extras.value.map((c) => c.width),
    '76px',
    '148px',
    '32px'
  ]
    .filter(Boolean)
    .join(' ')
)
const extraValue = (r: BenchRun, key: Extra): string => {
  if (key === 'workspace') return r.workspace
  if (key === 'date') return r.date
  if (key === 'runs') return String(r.durations.length)
  if (key === 'hardware') return machineName(r)
  if (key === 'failed') return String(r.failed)
  return fmtS(statsOf(r)[key])
}

// Sorting: a header click sorts every group and drops a manual order.
type SortKey = 'session' | 'workflow' | 'build' | Extra
const sort = ref<{ key: SortKey | 'metric'; asc: boolean }>({ key: 'metric', asc: true })
function sortBy(key: SortKey | 'metric', groupKey?: string): void {
  if (groupKey && manual.has(groupKey)) {
    manual.delete(groupKey)
    sort.value = { key, asc: true }
    return
  }
  sort.value = sort.value.key === key ? { key, asc: !sort.value.asc } : { key, asc: true }
}
const arrow = (key: SortKey | 'metric') =>
  sort.value.key === key ? (sort.value.asc ? '↑' : '↓') : ''
const sortValue = (r: BenchRun, key: SortKey | 'metric'): string | number => {
  if (key === 'metric') return statsOf(r)[metric.value]
  if (key === 'session') return r.session
  if (key === 'workflow') return r.workflow
  if (key === 'build') return r.build
  if (key === 'fastest' || key === 'average' || key === 'median' || key === 'slowest')
    return statsOf(r)[key]
  if (key === 'runs') return r.durations.length
  if (key === 'failed') return r.failed
  return extraValue(r, key)
}
const manual = reactive(new Map<string, string[]>())
const baselines = reactive(new Map<string, string>())
const collapsed = reactive(new Set<string>())

interface Row {
  run: BenchRun
  value: number
  bar: string
  range: { left: string; width: string }
  pill: string
  vs: string
  faster: boolean
}
interface Group {
  key: string
  label: string
  named: boolean
  rows: Row[]
  all: BenchRun[]
  referenceId: string
  custom: boolean
  referenceHidden: boolean
  builds: number
  best: Partial<Record<Metric, number>>
}
const groups = computed<Group[]>(() => {
  const by = new Map<string, BenchRun[]>()
  for (const r of BENCH_RUNS) {
    const key =
      groupBy.value === 'workflow'
        ? r.workflow
        : groupBy.value === 'hardware'
          ? machineKey(r)
          : 'all'
    by.set(key, [...(by.get(key) ?? []), r])
  }
  const out: Group[] = []
  for (const [key, all] of by) {
    const shownRuns = all.filter(visible)
    if (!shownRuns.length) continue
    const value = (r: BenchRun) => statsOf(r)[metric.value]
    const fastest = [...all].sort((a, b) => value(a) - value(b))[0]!
    const custom = baselines.get(key)
    const reference = all.find((r) => r.id === custom) ?? fastest
    const max = Math.max(...all.map((r) => statsOf(r).slowest))
    const pct = (v: number) => `${(v / max) * 100}%`
    const order = manual.get(key)
    const sorted = order
      ? [...shownRuns].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
      : [...shownRuns].sort((a, b) => {
          const x = sortValue(a, sort.value.key)
          const y = sortValue(b, sort.value.key)
          const c = typeof x === 'number' ? x - (y as number) : x.localeCompare(String(y))
          return sort.value.asc ? c : -c
        })
    const best: Partial<Record<Metric, number>> = {}
    if (all.length > 1)
      for (const m of METRICS) best[m.value] = Math.min(...all.map((r) => statsOf(r)[m.value]))
    out.push({
      key,
      label:
        groupBy.value === 'workflow'
          ? key
          : groupBy.value === 'hardware'
            ? machineName(all[0]!)
            : 'All runs',
      named: groupBy.value !== 'none',
      all,
      referenceId: reference.id,
      custom: Boolean(custom && reference.id === custom),
      referenceHidden: !shownRuns.includes(reference),
      builds: new Set(all.map((r) => r.build)).size,
      best,
      rows: sorted.map((r) => {
        const s = statsOf(r)
        const ratio = value(r) / value(reference)
        return {
          run: r,
          value: value(r),
          bar: pct(value(r)),
          range: { left: pct(s.fastest), width: pct(s.slowest - s.fastest) },
          pill: r.id === reference.id ? (custom ? 'Baseline' : 'Fastest') : '',
          vs:
            Math.abs(ratio - 1) < 0.005
              ? 'Same speed'
              : ratio > 1
                ? `${ratio.toFixed(2)}× slower`
                : `${(1 / ratio).toFixed(2)}× faster`,
          faster: ratio < 0.995
        }
      })
    })
  }
  return out
})
const runCount = (runs: BenchRun[]) => runs.reduce((n, r) => n + r.durations.length, 0)
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
const groupMeta = (g: Group) =>
  `${plural(g.rows.length, 'session')} · ${plural(runCount(g.rows.map((r) => r.run)), 'run')}`
const barSummary = (r: BenchRun) => {
  const s = statsOf(r)
  return `${r.session} · ${r.build} · ${r.date}. Fastest ${fmtS(s.fastest)}, Average ${fmtS(s.average)}, Median ${fmtS(s.median)}, Slowest ${fmtS(s.slowest)}`
}
function toggleBaseline(g: Group, id: string): void {
  if (baselines.get(g.key) === id) baselines.delete(g.key)
  else baselines.set(g.key, id)
}

// Manual order: drag the grip, or Alt+Up/Down on it.
const dragging = ref('')
const dropAt = ref('')
function dropOn(g: Group, id: string): void {
  const from = dragging.value
  dragging.value = dropAt.value = ''
  if (!from || from === id) return
  const ids = g.rows.map((r) => r.run.id).filter((x) => x !== from)
  ids.splice(ids.indexOf(id), 0, from)
  manual.set(g.key, ids)
}
function move(g: Group, id: string, by: number): void {
  const ids = g.rows.map((r) => r.run.id)
  const i = ids.indexOf(id)
  const j = i + by
  if (j < 0 || j >= ids.length) return
  ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
  manual.set(g.key, ids)
}

// Selection, for export only.
const picked = reactive(new Set<string>())
const pick = (id: string) => (picked.has(id) ? picked.delete(id) : picked.add(id))
const pickedShown = computed(() => BENCH_RUNS.filter((r) => picked.has(r.id) && visible(r)))
const MAX_EXPORT = 20
function exportRuns(runs: BenchRun[]): void {
  toast(`Exported ${plural(runs.length, 'run')} as an image`)
}

const renaming = ref('')
const draft = ref('')
const field = ref<HTMLInputElement[]>()
async function rename(r: BenchRun): Promise<void> {
  renaming.value = r.id
  draft.value = r.session
  await nextTick()
  field.value?.[0]?.select()
}
function saveName(r: BenchRun): void {
  if (renaming.value !== r.id) return
  const v = draft.value.trim()
  if (v) r.session = v
  renaming.value = ''
}
const deleting = ref<BenchRun | null>(null)
function confirmDelete(): void {
  const r = deleting.value!
  BENCH_RUNS.splice(BENCH_RUNS.indexOf(r), 1)
  picked.delete(r.id)
  toast(`Deleted ${r.workflow}, session ${r.session}`)
  deleting.value = null
}
</script>

<template>
  <MarPage
    title="Benchmarks"
    skeleton="list"
    :no-results="groups.length === 0 && filtering"
    :state="BENCH_RUNS.length ? undefined : 'empty'"
    :empty="{
      icon: ChartColumn,
      title: 'No performance test results yet',
      text: 'Complete a Performance Test to add a run.',
      action: 'Open Performance Test'
    }"
    error-title="Could not load performance test results"
    error-text="Check the folder and try again."
    @action="go('tool:performance')"
    @clear="clear"
  >
    <template #actions>
      <Button variant="secondary" @click="toast('Pick a results folder')"
        ><FolderOpen :size="15" />Select folder</Button
      >
    </template>

    <template #toolbar>
      <div class="bench-toolbar">
        <div class="bench-bar">
          <div class="bench-menus bench-filters">
            <BenchFilter
              v-for="f in FILTERS"
              :key="f.key"
              v-model="f.model.value"
              :label="f.label"
              :options="f.options"
            />
          </div>
          <div class="bench-menus bench-view">
            <BenchFilter v-model="groupBy" label="Group by" :options="GROUP_BY" />
            <BenchFilter v-model="metric" label="Compare by" :options="METRICS" />
          </div>
          <div class="bench-tools">
            <Tooltip content="Refresh sessions">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Refresh sessions"
                :disabled="refreshing"
                @click="refresh"
                ><RefreshCw :size="15" :class="refreshing && 'animate-spin'"
              /></Button>
            </Tooltip>
            <MarSearchField v-model="query" class="bench-search" placeholder="Search runs..." />
            <DropdownMenuRoot :modal="false">
              <DropdownMenuTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Columns"
                  title="Columns"
                  class="data-[state=open]:bg-secondary-background"
                  ><SlidersHorizontal :size="15"
                /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                class="flex max-h-90 min-w-56 flex-col gap-0.5 overflow-y-auto"
              >
                <DropdownMenuLabel class="bench-menu-title">Columns to display</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  v-for="c in pickerRows"
                  :key="c.key"
                  :model-value="c.on"
                  :disabled="c.locked"
                  :class="
                    cn(menuItem, 'data-disabled:pointer-events-none data-disabled:opacity-60')
                  "
                  @update:model-value="
                    (v: boolean | 'indeterminate') => setShown(c.key, v === true)
                  "
                  @select="(e: Event) => e.preventDefault()"
                >
                  <span class="min-w-0 flex-1 truncate">{{ c.label }}</span>
                  <DropdownMenuItemIndicator><Check :size="14" /></DropdownMenuItemIndicator>
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenuRoot>
          </div>
        </div>
      </div>
    </template>

    <div class="bench-groups">
      <section
        v-for="g in groups"
        :key="g.key"
        class="bench-group"
        :class="collapsed.has(g.key) && 'is-collapsed'"
        :aria-label="g.label"
      >
        <div class="bench-group-head">
          <button
            type="button"
            class="bench-group-toggle"
            :class="g.named ? 'is-named' : 'is-label'"
            :title="g.label"
            :aria-expanded="!collapsed.has(g.key)"
            @click="collapsed.has(g.key) ? collapsed.delete(g.key) : collapsed.add(g.key)"
          >
            <ChevronRight :size="14" class="bench-chevron" />
            <span class="truncate">{{ g.label }}</span>
          </button>
          <span class="bench-group-meta">{{ groupMeta(g) }}</span>
          <span class="ml-auto" />
          <MarItemMenu
            :label="`More actions for ${g.label}`"
            :lines="[
              {
                label: 'Select all runs',
                run: () => g.rows.forEach((r) => picked.add(r.run.id))
              },
              {
                label: 'Export this group',
                icon: ImageDown,
                disabled: g.rows.length > MAX_EXPORT,
                run: () => exportRuns(g.rows.map((r) => r.run))
              }
            ]"
          />
        </div>

        <template v-if="!collapsed.has(g.key)">
          <p v-if="groupBy === 'workflow' && g.builds === 1" class="bench-note">
            Only one build ran this workflow here. Run it on another build to compare.
          </p>
          <div class="bench-scroll">
            <div class="mar-table bench-table" role="table" :style="{ '--mar-grid': grid }">
              <div class="mar-table-head" role="row">
                <span />
                <button type="button" class="bench-sort" @click="sortBy('session', g.key)">
                  Session {{ arrow('session') }}
                </button>
                <button
                  v-if="showWorkflow"
                  type="button"
                  class="bench-sort"
                  @click="sortBy('workflow', g.key)"
                >
                  Workflow {{ arrow('workflow') }}
                </button>
                <button
                  v-if="shown.has('build')"
                  type="button"
                  class="bench-sort"
                  @click="sortBy('build', g.key)"
                >
                  Build {{ arrow('build') }}
                </button>
                <span v-if="shown.has('range')">{{ metricLabel }} and range</span>
                <button
                  v-for="c in extras"
                  :key="c.key"
                  type="button"
                  class="bench-sort is-num"
                  @click="sortBy(c.key, g.key)"
                >
                  {{ c.label }} {{ arrow(c.key) }}
                </button>
                <button
                  type="button"
                  class="bench-sort is-num is-metric"
                  @click="sortBy('metric', g.key)"
                >
                  {{ metricLabel }} {{ arrow('metric') }}
                </button>
                <span class="is-num bench-vs-head">Vs baseline</span>
                <span />
              </div>

              <div
                v-for="row in g.rows"
                :key="row.run.id"
                role="row"
                class="mar-table-row bench-row"
                :class="[
                  picked.has(row.run.id) && 'is-selected',
                  dragging === row.run.id && 'is-dragging',
                  dropAt === row.run.id && 'is-drop'
                ]"
                @dragover.prevent="dragging && (dropAt = row.run.id)"
                @drop.prevent="dropOn(g, row.run.id)"
              >
                <span class="bench-lead" @click.stop>
                  <span
                    class="bench-grip"
                    :class="manual.has(g.key) && 'is-on'"
                    draggable="true"
                    tabindex="0"
                    role="button"
                    :aria-label="`Reorder session ${row.run.session}`"
                    title="Drag to reorder. You can also press Alt+Up or Alt+Down."
                    @dragstart="dragging = row.run.id"
                    @dragend="dragging = dropAt = ''"
                    @keydown.alt.up.prevent="move(g, row.run.id, -1)"
                    @keydown.alt.down.prevent="move(g, row.run.id, 1)"
                    ><GripVertical :size="14"
                  /></span>
                  <Checkbox
                    class="bench-check"
                    :class="picked.has(row.run.id) && 'is-on'"
                    :model-value="picked.has(row.run.id)"
                    :aria-label="`Select session ${row.run.session}`"
                    @update:model-value="pick(row.run.id)"
                  />
                </span>
                <span class="mar-table-name" role="cell">
                  <input
                    v-if="renaming === row.run.id"
                    ref="field"
                    v-model="draft"
                    class="bench-name-input"
                    aria-label="Session name"
                    @keydown.enter="saveName(row.run)"
                    @keydown.esc="renaming = ''"
                    @blur="saveName(row.run)"
                  />
                  <button
                    v-else
                    type="button"
                    class="bench-name"
                    :title="`Edit session ${row.run.session}`"
                    @click="rename(row.run)"
                  >
                    <span class="truncate">{{ row.run.session }}</span
                    ><Pencil :size="12" class="bench-name-pen" />
                  </button>
                  <span class="mar-table-sub"
                    >{{ row.run.date }} · {{ plural(row.run.durations.length, 'run') }}</span
                  >
                </span>
                <span
                  v-if="showWorkflow"
                  class="mar-table-cell bench-text"
                  role="cell"
                  :title="row.run.workflow"
                  >{{ row.run.workflow }}</span
                >
                <span v-if="shown.has('build')" class="mar-table-cell bench-text" role="cell">{{
                  row.run.build
                }}</span>
                <span v-if="shown.has('range')" role="cell" class="bench-bar-cell">
                  <Tooltip :content="barSummary(row.run)">
                    <span
                      class="bench-track"
                      role="img"
                      tabindex="0"
                      :aria-label="barSummary(row.run)"
                    >
                      <span
                        class="bench-fill"
                        :class="g.all.length > 1 && row.pill === 'Fastest' && 'is-best'"
                        :style="{ width: row.bar }"
                      /><span class="bench-range" :style="row.range" />
                    </span>
                  </Tooltip>
                </span>
                <span
                  v-for="c in extras"
                  :key="c.key"
                  class="mar-table-cell is-num"
                  :class="
                    (c.key === 'fastest' ||
                      c.key === 'average' ||
                      c.key === 'median' ||
                      c.key === 'slowest') &&
                    g.best[c.key] === statsOf(row.run)[c.key] &&
                    'bench-best'
                  "
                  role="cell"
                  >{{ extraValue(row.run, c.key) }}</span
                >
                <span class="mar-table-cell is-num bench-value" role="cell">{{
                  fmtS(row.value)
                }}</span>
                <span class="bench-vs" role="cell">
                  <span v-if="row.pill" class="bench-pill" :class="g.custom && 'is-baseline'">{{
                    row.pill
                  }}</span>
                  <span v-else :class="row.faster && 'bench-faster'">{{ row.vs }}</span>
                  <button
                    v-if="!row.pill || g.custom"
                    type="button"
                    class="bench-flag"
                    :class="g.custom && g.referenceId === row.run.id && 'is-on'"
                    :aria-pressed="g.custom && g.referenceId === row.run.id"
                    :title="
                      g.custom && g.referenceId === row.run.id
                        ? 'Reset baseline'
                        : 'Set as baseline'
                    "
                    :aria-label="
                      g.custom && g.referenceId === row.run.id
                        ? 'Reset baseline'
                        : 'Set as baseline'
                    "
                    @click="toggleBaseline(g, row.run.id)"
                  >
                    <Flag
                      :size="14"
                      :fill="g.custom && g.referenceId === row.run.id ? 'currentColor' : 'none'"
                    />
                  </button>
                  <span v-else class="bench-flag-gap" />
                </span>
                <span class="is-center flex justify-end">
                  <MarItemMenu
                    :label="`More actions for session ${row.run.session}`"
                    :lines="[
                      {
                        label: 'Set as baseline',
                        icon: Flag,
                        disabled: g.referenceId === row.run.id,
                        run: () => baselines.set(g.key, row.run.id)
                      },
                      { label: 'Rename session', icon: Pencil, run: () => rename(row.run) },
                      {
                        label: 'Delete files',
                        icon: Trash2,
                        danger: true,
                        run: () => (deleting = row.run)
                      }
                    ]"
                  />
                </span>
              </div>
            </div>
          </div>

          <div v-if="g.custom || g.referenceHidden" class="bench-foot">
            <span v-if="g.referenceHidden"
              >Compared with session {{ g.all.find((r) => r.id === g.referenceId)?.session }}, which
              the filters hide.</span
            >
            <span v-if="g.custom">Speed = baseline time ÷ run time</span>
            <Button
              v-if="g.custom"
              variant="secondary"
              size="sm"
              class="ml-auto"
              @click="baselines.delete(g.key)"
              >Reset baseline</Button
            >
          </div>
        </template>
      </section>
    </div>

    <Transition name="bench-sel">
      <div
        v-if="pickedShown.length"
        class="bench-selection"
        role="region"
        aria-label="Selected runs"
      >
        <span>{{ pickedShown.length }} selected</span>
        <Tooltip :content="`Up to ${MAX_EXPORT} runs`" :disabled="pickedShown.length <= MAX_EXPORT">
          <button
            type="button"
            class="bench-selection-btn"
            :disabled="pickedShown.length > MAX_EXPORT"
            @click="exportRuns(pickedShown)"
          >
            <ImageDown :size="15" />Export results
          </button>
        </Tooltip>
        <button
          type="button"
          class="bench-selection-x"
          aria-label="Clear selection"
          title="Clear selection"
          @click="picked.clear()"
        >
          <X :size="15" />
        </button>
      </div>
    </Transition>

    <DialogRoot :open="Boolean(deleting)" @update:open="(v: boolean) => !v && (deleting = null)">
      <DialogContent size="md" class="px-6 pt-6 pb-5">
        <DialogTitle class="pr-8 text-heading font-semibold"
          >Delete {{ deleting?.workflow }}?</DialogTitle
        >
        <DialogDescription class="mt-2 text-ui leading-relaxed text-muted-foreground">
          This will permanently delete all files for session {{ deleting?.session }}. This cannot be
          undone.
        </DialogDescription>
        <div class="mt-5 flex justify-end gap-2">
          <Button variant="ghost" @click="deleting = null">Cancel</Button>
          <Button variant="destructive" @click="confirmDelete">Delete files</Button>
        </div>
      </DialogContent>
    </DialogRoot>
  </MarPage>
</template>
