<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChartColumn,
  FolderOpen,
  GripVertical,
  ImageDown,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
  Trash2
} from 'lucide-vue-next'
import {
  DialogDescription,
  DialogRoot,
  DialogTitle,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import Checkbox from '../../ui/Checkbox.vue'
import DialogContent from '../../ui/DialogContent.vue'
import DropdownMenuCheckboxItem from '../../ui/DropdownMenuCheckboxItem.vue'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuLabel from '../../ui/DropdownMenuLabel.vue'
import Select from '../../ui/Select.vue'
import Tooltip from '../../ui/Tooltip.vue'
import { toast } from '../../useProto'
import MarItemMenu from '../pages/MarItemMenu.vue'
import MarPage from '../pages/MarPage.vue'
import MarSearchField from '../pages/MarSearchField.vue'
import MarSeg from '../pages/MarSeg.vue'
import { BENCH_RUNS, fmtSec, statsOf, type BenchRun } from './benchData'
import './tools.css'

/**
 * Benchmarks (Desktop's BenchmarksView), drawn as Mar's pages: the runs
 * library in the one table, its filters in the toolbar, then Comparison
 * for the runs you tick. Everything Desktop does is here: Select folder,
 * Refresh, search, the four filters, Properties (which columns show, in
 * the library and in the comparison), select all visible, rename a
 * session, delete a run's files, Duration or Speed against a baseline,
 * sort or drag the order, Export results.
 */
const ALL = 'all'
const opts = (key: keyof BenchRun, all: string) => [
  { value: ALL, label: all },
  ...[...new Set(BENCH_RUNS.map((r) => String(r[key])))].map((v) => ({ value: v, label: v }))
]
const workspace = ref(ALL)
const build = ref(ALL)
const hardware = ref(ALL)
const workflow = ref(ALL)
const query = ref('')

const filtered = computed(() =>
  BENCH_RUNS.filter(
    (r) =>
      (workspace.value === ALL || r.workspace === workspace.value) &&
      (build.value === ALL || r.build === build.value) &&
      (hardware.value === ALL || r.hardware === hardware.value) &&
      (workflow.value === ALL || r.workflow === workflow.value) &&
      `${r.session} ${r.workflow} ${r.build} ${r.hardware}`
        .toLowerCase()
        .includes(query.value.trim().toLowerCase())
  )
)
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

type Col =
  | 'workflow'
  | 'build'
  | 'workspace'
  | 'hardware'
  | 'runs'
  | 'fastest'
  | 'average'
  | 'median'
  | 'slowest'
const COLS: { key: Col; label: string; num?: boolean; width: string }[] = [
  { key: 'workflow', label: 'Workflow', width: 'minmax(0, 1.2fr)' },
  { key: 'build', label: 'Build', width: 'minmax(0, 0.8fr)' },
  { key: 'workspace', label: 'Workspace', width: 'minmax(0, 0.7fr)' },
  { key: 'hardware', label: 'GPU / Hardware', width: 'minmax(0, 0.9fr)' },
  { key: 'runs', label: 'Runs', num: true, width: '48px' },
  { key: 'fastest', label: 'Fastest', num: true, width: '76px' },
  { key: 'average', label: 'Average', num: true, width: '76px' },
  { key: 'median', label: 'Median', num: true, width: '76px' },
  { key: 'slowest', label: 'Slowest', num: true, width: '76px' }
]
const shownCols = ref<Set<Col>>(
  new Set(['workflow', 'build', 'hardware', 'runs', 'average', 'median'])
)
const cmpCols = ref<Set<Col>>(new Set(['build', 'hardware']))
const toggle = (set: Set<Col>, key: Col, on: boolean) => (on ? set.add(key) : set.delete(key))
const cols = computed(() => COLS.filter((c) => shownCols.value.has(c.key)))
const grid = computed(
  () => `--mar-grid: 20px minmax(0, 1.1fr) ${cols.value.map((c) => c.width).join(' ')} 32px`
)
const cell = (r: BenchRun, key: Col): string => {
  if (key === 'runs') return r.failed ? `${r.runs - r.failed}/${r.runs}` : String(r.runs)
  if (key === 'fastest' || key === 'average' || key === 'median' || key === 'slowest')
    return fmtSec(statsOf(r)[key])
  return r[key]
}

const picked = ref<string[]>([])
const isPicked = (id: string) => picked.value.includes(id)
function pick(id: string, on: boolean): void {
  picked.value = on ? [...new Set([...picked.value, id])] : picked.value.filter((x) => x !== id)
}
const allVisible = computed({
  get: () => filtered.value.length > 0 && filtered.value.every((r) => isPicked(r.id)),
  set: (on: boolean) => {
    for (const r of filtered.value) pick(r.id, on)
  }
})

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
  const v = draft.value.trim()
  if (!v) return toast('Enter a session name.')
  r.session = v
  renaming.value = ''
}
const deleting = ref<BenchRun | null>(null)
function confirmDelete(): void {
  const r = deleting.value!
  BENCH_RUNS.splice(BENCH_RUNS.indexOf(r), 1)
  pick(r.id, false)
  toast(`Deleted ${r.workflow}, session ${r.session}`)
  deleting.value = null
}

// Comparison: the ticked runs, in the order you sort or drag them.
const view = ref<'duration' | 'speed'>('duration')
const SORTS = [
  { value: 'manual', label: 'Manual sort' },
  { value: 'average', label: 'Average' },
  { value: 'median', label: 'Median' },
  { value: 'fastest', label: 'Fastest' },
  { value: 'slowest', label: 'Slowest' }
]
const sort = ref<'manual' | 'average' | 'median' | 'fastest' | 'slowest'>('manual')
const asc = ref(true)
const order = ref<string[]>([])
const compared = computed(() => {
  const list = BENCH_RUNS.filter((r) => isPicked(r.id))
  const at = (id: string) => {
    const i = order.value.indexOf(id)
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }
  if (sort.value === 'manual')
    return [...list].sort(
      (a, b) => at(a.id) - at(b.id) || picked.value.indexOf(a.id) - picked.value.indexOf(b.id)
    )
  const k = sort.value
  return [...list].sort((a, b) => (statsOf(a)[k] - statsOf(b)[k]) * (asc.value ? 1 : -1))
})
function move(id: string, by: number): void {
  const ids = compared.value.map((r) => r.id)
  const i = ids.indexOf(id)
  const j = i + by
  if (i < 0 || j < 0 || j >= ids.length) return
  ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
  order.value = ids
  sort.value = 'manual'
}
const dragging = ref('')
function dropOn(id: string): void {
  if (!dragging.value || dragging.value === id) return
  const ids = compared.value.map((r) => r.id).filter((x) => x !== dragging.value)
  ids.splice(ids.indexOf(id), 0, dragging.value)
  order.value = ids
  sort.value = 'manual'
  dragging.value = ''
}

const SERIES = ['#e8e8ee', '#7aa2f7', '#e0af68', '#9ece6a', '#bb9af7', '#7dcfff']
const seriesOf = (r: BenchRun) => SERIES[picked.value.indexOf(r.id) % SERIES.length]
const baseline = ref('')
const base = computed(
  () => compared.value.find((r) => r.id === baseline.value) ?? compared.value[0]
)
const maxSlowest = computed(
  () => Math.max(1, ...compared.value.map((r) => statsOf(r).slowest)) * 1.1
)
const pct = (v: number) => `${(v / maxSlowest.value) * 100}%`
const factor = (r: BenchRun) => (base.value ? statsOf(base.value).average / statsOf(r).average : 1)
const maxFactor = computed(() => Math.max(2, ...compared.value.map(factor)) * 1.05)
const fpct = (f: number) => `${(f / maxFactor.value) * 100}%`
const speedText = (r: BenchRun): string => {
  if (r.id === base.value?.id) return 'Baseline'
  const f = factor(r)
  if (Math.abs(f - 1) < 0.005) return 'Same speed'
  return f > 1 ? `${f.toFixed(2)}× faster` : `${(1 / f).toFixed(2)}× slower`
}
const METRICS = ['fastest', 'average', 'median', 'slowest'] as const
</script>

<template>
  <MarPage
    title="Benchmarks"
    skeleton="list"
    :no-results="filtered.length === 0 && filtering"
    :state="BENCH_RUNS.length ? undefined : 'empty'"
    :empty="{
      icon: ChartColumn,
      title: 'No performance test results yet',
      text: 'Complete a Performance Test to add a run.',
      action: 'Select folder'
    }"
    @action="toast('Pick a results folder')"
    @clear="clear"
  >
    <template #actions>
      <Button variant="secondary" @click="toast('Pick a results folder')"
        ><FolderOpen :size="15" />Select folder</Button
      >
    </template>

    <template #toolbar>
      <Select
        v-model="workspace"
        :options="opts('workspace', 'All')"
        label="Workspace"
        class="w-auto"
      />
      <Select v-model="build" :options="opts('build', 'All')" label="Build" class="w-auto" />
      <Select
        v-model="hardware"
        :options="opts('hardware', 'All')"
        label="Hardware"
        class="w-auto"
      />
      <Select
        v-model="workflow"
        :options="opts('workflow', 'All')"
        label="Workflow"
        class="w-auto"
      />
      <div class="ml-auto flex items-center gap-2">
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
        <MarSearchField v-model="query" placeholder="Search runs" />
        <DropdownMenuRoot :modal="false">
          <Tooltip content="Properties">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon" aria-label="Properties"
                ><SlidersHorizontal :size="15"
              /></Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end" :side-offset="6" class="min-w-52">
            <DropdownMenuLabel>Columns to display</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              v-for="c in COLS"
              :key="c.key"
              :model-value="shownCols.has(c.key)"
              @update:model-value="(v: boolean) => toggle(shownCols, c.key, v)"
              >{{ c.label }}</DropdownMenuCheckboxItem
            >
          </DropdownMenuContent>
        </DropdownMenuRoot>
      </div>
    </template>

    <div class="mar-tl">
      <div class="mar-table" role="table" aria-label="Runs library" :style="grid">
        <div class="mar-table-head" role="row">
          <span class="is-center flex"
            ><Checkbox v-model="allVisible" aria-label="Select all visible runs"
          /></span>
          <span role="columnheader">Session</span>
          <span v-for="c in cols" :key="c.key" role="columnheader" :class="c.num && 'is-num'">{{
            c.label
          }}</span>
          <span />
        </div>
        <div
          v-for="r in filtered"
          :key="r.id"
          role="row"
          class="mar-table-row"
          :class="isPicked(r.id) && 'is-selected'"
          @click="renaming !== r.id && pick(r.id, !isPicked(r.id))"
        >
          <span class="is-center flex" @click.stop
            ><Checkbox
              :model-value="isPicked(r.id)"
              :aria-label="`Select ${r.workflow}`"
              @update:model-value="(v: boolean) => pick(r.id, v)"
          /></span>
          <span class="mar-table-name" role="cell">
            <input
              v-if="renaming === r.id"
              ref="field"
              v-model="draft"
              class="mar-tl-name-input"
              aria-label="Session name"
              @click.stop
              @keydown.enter="saveName(r)"
              @keydown.esc="renaming = ''"
              @blur="saveName(r)"
            />
            <template v-else>
              <span class="mar-table-title">{{ r.session }}</span>
              <span class="mar-table-sub">{{ r.date }}</span>
            </template>
          </span>
          <span
            v-for="c in cols"
            :key="c.key"
            class="mar-table-cell"
            :class="c.num && 'is-num'"
            role="cell"
            >{{ cell(r, c.key) }}</span
          >
          <span class="is-center flex justify-end" @click.stop>
            <MarItemMenu
              :lines="[
                { label: 'Rename session', icon: Pencil, run: () => rename(r) },
                'sep',
                { label: 'Delete files', icon: Trash2, danger: true, run: () => (deleting = r) }
              ]"
            />
          </span>
        </div>
      </div>

      <Card class="mar-tl-box mt-4">
        <p class="mar-tl-title">
          Comparison
          <span class="mar-tl-tools">
            <MarSeg
              v-model="view"
              :options="[
                { value: 'duration', label: 'Duration' },
                { value: 'speed', label: 'Speed' }
              ]"
              label="Comparison visualization"
            />
            <Select v-model="sort" :options="SORTS" label="Sort" class="w-36" />
            <Tooltip :content="asc ? 'Switch to descending sort' : 'Switch to ascending sort'">
              <Button
                variant="ghost"
                size="icon"
                :aria-label="asc ? 'Switch to descending sort' : 'Switch to ascending sort'"
                :disabled="sort === 'manual'"
                @click="asc = !asc"
                ><ArrowUpNarrowWide v-if="asc" :size="15" /><ArrowDownWideNarrow v-else :size="15"
              /></Button>
            </Tooltip>
            <DropdownMenuRoot :modal="false">
              <Tooltip content="Properties">
                <DropdownMenuTrigger as-child>
                  <Button variant="ghost" size="icon" aria-label="Comparison properties"
                    ><SlidersHorizontal :size="15"
                  /></Button>
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent align="end" :side-offset="6" class="min-w-52">
                <DropdownMenuLabel>Columns to display</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  v-for="c in COLS.slice(1, 4)"
                  :key="c.key"
                  :model-value="cmpCols.has(c.key)"
                  @update:model-value="(v: boolean) => toggle(cmpCols, c.key, v)"
                  >{{ c.label }}</DropdownMenuCheckboxItem
                >
              </DropdownMenuContent>
            </DropdownMenuRoot>
            <Button
              variant="ghost"
              size="sm"
              :disabled="!compared.length"
              @click="toast('Exported the comparison image')"
              ><ImageDown :size="14" />Export results</Button
            >
          </span>
        </p>

        <p v-if="!compared.length" class="mar-tl-hint mb-1">
          Select runs from the library to compare them.
        </p>
        <template v-else>
          <p class="mar-tl-hint mb-2">
            {{
              view === 'duration'
                ? 'Each line shows the fastest and slowest run, with the average marked.'
                : 'Choose a baseline. Relative speed = baseline duration / run duration.'
            }}
          </p>
          <div class="mar-tl-chart">
            <div
              v-for="r in compared"
              :key="r.id"
              class="mar-tl-series"
              :class="dragging === r.id && 'is-dragging'"
              :style="{ '--series': seriesOf(r) }"
              tabindex="0"
              :title="
                view === 'speed'
                  ? 'Use as the baseline'
                  : 'Drag to reorder. You can also press Alt+Left or Alt+Right.'
              "
              @dragover.prevent
              @drop="dropOn(r.id)"
              @click="view === 'speed' && (baseline = r.id)"
              @keydown.alt.left.prevent="move(r.id, -1)"
              @keydown.alt.right.prevent="move(r.id, 1)"
              @keydown.alt.up.prevent="move(r.id, -1)"
              @keydown.alt.down.prevent="move(r.id, 1)"
            >
              <i
                v-if="view === 'speed'"
                class="mar-tl-radio"
                :class="r.id === base?.id && 'is-on'"
                role="radio"
                :aria-checked="r.id === base?.id"
              />
              <span
                v-else
                class="mar-tl-grip"
                draggable="true"
                @dragstart="dragging = r.id"
                @dragend="dragging = ''"
                ><GripVertical :size="14"
              /></span>
              <span class="mar-tl-series-name">
                <i class="mar-tl-dot" />
                <span class="mar-table-name">
                  <span class="mar-table-title">{{ r.workflow }}</span>
                  <span class="mar-table-sub"
                    >{{ r.session
                    }}<template v-for="c in COLS.slice(1, 4)" :key="c.key"
                      ><template v-if="cmpCols.has(c.key)">
                        · {{ cell(r, c.key) }}</template
                      ></template
                    ></span
                  >
                </span>
              </span>
              <span class="mar-tl-track">
                <template v-if="view === 'duration'">
                  <i
                    class="mar-tl-range"
                    :style="{
                      left: pct(statsOf(r).fastest),
                      width: `calc(${pct(statsOf(r).slowest)} - ${pct(statsOf(r).fastest)})`
                    }"
                  /><i class="mar-tl-avg" :style="{ left: pct(statsOf(r).average) }" />
                </template>
                <template v-else>
                  <i class="mar-tl-range" :style="{ left: 0, width: fpct(factor(r)) }" /><i
                    class="mar-tl-one"
                    :style="{ left: fpct(1) }"
                  />
                </template>
              </span>
              <span
                class="mar-tl-value"
                :class="
                  view === 'speed' &&
                  r.id !== base?.id &&
                  (factor(r) > 1.005 ? 'is-faster' : factor(r) < 0.995 ? 'is-slower' : '')
                "
                >{{
                  view === 'duration'
                    ? `${fmtSec(statsOf(r).fastest)} – ${fmtSec(statsOf(r).slowest)}`
                    : speedText(r)
                }}</span
              >
            </div>
          </div>

          <div
            class="mar-table mt-4"
            role="table"
            aria-label="Comparison"
            :style="{ '--mar-grid': `120px repeat(${compared.length}, minmax(0, 1fr))` }"
          >
            <div class="mar-table-head" role="row">
              <span role="columnheader">Metric</span>
              <span
                v-for="r in compared"
                :key="r.id"
                role="columnheader"
                class="is-num flex items-center justify-end gap-1.5"
                :style="{ '--series': seriesOf(r) }"
                ><i class="mar-tl-dot" /><span class="truncate">{{ r.session }}</span></span
              >
            </div>
            <div v-for="m in METRICS" :key="m" role="row" class="mar-table-row">
              <span class="mar-table-cell capitalize" role="cell">{{ m }}</span>
              <span v-for="r in compared" :key="r.id" class="mar-table-cell is-num" role="cell">{{
                view === 'duration'
                  ? fmtSec(statsOf(r)[m])
                  : base
                    ? `${(statsOf(base)[m] / statsOf(r)[m]).toFixed(2)}×`
                    : '—'
              }}</span>
            </div>
            <div role="row" class="mar-table-row">
              <span class="mar-table-cell" role="cell">Measured runs</span>
              <span v-for="r in compared" :key="r.id" class="mar-table-cell is-num" role="cell">{{
                r.runs - r.failed
              }}</span>
            </div>
          </div>
        </template>
      </Card>
    </div>

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
