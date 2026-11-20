<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import Checkbox from '@comfyorg/design-system/checkbox/Checkbox'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import { computed, nextTick, ref } from 'vue'
import { Ellipsis, Flag, GripVertical, Pencil, Trash2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { PerformanceTestBenchmark } from '../../types/ipc'
import Tooltip from '../../components/ui/Tooltip.vue'
import {
  DURATION_KEYS,
  DURATION_LABEL_KEYS,
  formatSeconds,
  isDurationKey,
  moveRunInOrder,
  type BenchmarkTableModel,
  type ColumnSort,
  type DurationKey,
  type RunComparison
} from '../../lib/benchmarkTable'
import BenchmarkSessionName from './BenchmarkSessionName.vue'
import { SECTION_TITLE_CLASS } from '../../lib/sectionTitle'

const props = defineProps<{
  table: BenchmarkTableModel
  metric: DurationKey
  sort: ColumnSort
  buildColumn: boolean
  workflowColumn: boolean
  rangeColumn: boolean
  extraColumns: Array<{ key: string; label: string }>
  selectedIds: ReadonlySet<string>
  deletingIds: ReadonlySet<string>
  formatDate: (value: string | null) => string
  formatColumnValue: (benchmark: PerformanceTestBenchmark, key: string) => string
  renameSession: (benchmark: PerformanceTestBenchmark, name: string) => Promise<boolean>
}>()

const emit = defineEmits<{
  sort: [key: string]
  toggleSelected: [id: string]
  baseline: [id: string | null]
  reorder: [order: string[]]
  reorderColumns: [keys: string[]]
  delete: [benchmark: PerformanceTestBenchmark]
}>()

const { t } = useI18n()
const TIP_DURATION_KEYS: readonly DurationKey[] = [
  'fastestJobDurationSeconds',
  'slowestJobDurationSeconds',
  'averageJobDurationSeconds',
  'medianJobDurationSeconds'
]
const RUN_DRAG_TYPE = 'application/x-comfy-benchmark-run'
const COLUMN_DRAG_TYPE = 'application/x-comfy-benchmark-column'
const draggedId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)
const draggedColumnKey = ref<string | null>(null)
const dropTargetColumnKey = ref<string | null>(null)
const pendingRenameId = ref<string | null>(null)
const sessionNames = new Map<string, InstanceType<typeof BenchmarkSessionName>>()
const grips = new Map<string, HTMLElement>()
const columnHeads = new Map<string, HTMLElement>()

const metricLabel = computed(() => t(DURATION_LABEL_KEYS[props.metric]))
const memberIds = computed(() => props.table.members.map(({ id }) => id))
const referenceHidden = computed(
  () =>
    props.table.measuredCount > 1 &&
    props.table.referenceId !== null &&
    !props.table.rows.some(({ id }) => id === props.table.referenceId)
)
const bestValues = computed(
  () =>
    new Map(
      props.extraColumns.flatMap(({ key }) => {
        if (!isDurationKey(key)) return []
        const values = props.table.members.flatMap((benchmark) =>
          benchmark[key] === null ? [] : [benchmark[key]]
        )
        return values.length > 1 ? [[key, Math.min(...values)] as const] : []
      })
    )
)
const rows = computed(() =>
  props.table.rows.map((benchmark) => {
    const value = benchmark[props.metric]
    const comparison = props.table.comparisons.get(benchmark.id) ?? {
      factor: null,
      kind: 'missing' as const
    }
    return {
      benchmark,
      value,
      comparison,
      pill: pillLabel(comparison),
      vs: vsLabel(comparison),
      selected: props.selectedIds.has(benchmark.id),
      barWidth: `${barPercent(value)}%`,
      range: rangeStyle(benchmark),
      summary: DURATION_KEYS.map(
        (key) => `${t(DURATION_LABEL_KEYS[key])} ${formatSeconds(benchmark[key])}`
      ).join(', ')
    }
  })
)

function barPercent(value: number | null): number {
  if (value === null) return 0
  return Math.min(100, Math.max(0, (value / props.table.scaleMaximum) * 100))
}

function sessionMeta(benchmark: PerformanceTestBenchmark): string {
  return `${props.formatDate(benchmark.createdAt)} · ${t('benchmarks.runCount', benchmark.measuredJobCount)}`
}

function rangeStyle(benchmark: PerformanceTestBenchmark): Record<string, string> | null {
  const fastest = benchmark.fastestJobDurationSeconds
  const slowest = benchmark.slowestJobDurationSeconds
  if (fastest === null || slowest === null) return null
  const left = barPercent(fastest)
  return { left: `${left}%`, width: `${Math.max(0, barPercent(slowest) - left)}%` }
}

function pillLabel(comparison: RunComparison): string | null {
  if (comparison.kind !== 'baseline' || props.table.measuredCount < 2) return null
  return props.table.customBaseline ? t('benchmarks.baseline') : t('benchmarks.fastest')
}

function vsLabel(comparison: RunComparison): string {
  if (comparison.kind === 'baseline') return ''
  if (comparison.kind === 'faster' && comparison.factor !== null) {
    return t('benchmarks.timesFaster', { factor: comparison.factor.toFixed(2) })
  }
  if (comparison.kind === 'slower' && comparison.factor) {
    return t('benchmarks.timesSlower', { factor: (1 / comparison.factor).toFixed(2) })
  }
  return t(`benchmarks.${comparison.kind}`)
}

function sortIndicator(key: string): string {
  if (props.table.manual || props.sort.key !== key) return ''
  return props.sort.ascending ? '↑' : '↓'
}

function ariaSort(key: string): 'ascending' | 'descending' | 'none' {
  if (!sortIndicator(key)) return 'none'
  return props.sort.ascending ? 'ascending' : 'descending'
}

function isBest(benchmark: PerformanceTestBenchmark, key: string): boolean {
  if (!isDurationKey(key)) return false
  const best = bestValues.value.get(key)
  return best !== undefined && benchmark[key] === best
}

function rememberSessionName(id: string, component: unknown): void {
  if (component) sessionNames.set(id, component as InstanceType<typeof BenchmarkSessionName>)
  else sessionNames.delete(id)
}

function rememberGrip(id: string, element: unknown): void {
  if (element instanceof HTMLElement) grips.set(id, element)
  else grips.delete(id)
}

function rememberColumnHead(key: string, element: unknown): void {
  if (element instanceof HTMLElement) columnHeads.set(key, element)
  else columnHeads.delete(key)
}

function focusPendingRename(event: Event): void {
  const id = pendingRenameId.value
  if (!id) return
  event.preventDefault()
  pendingRenameId.value = null
  sessionNames.get(id)?.focus()
}

function reorder(id: string, targetId: string): void {
  const order = moveRunInOrder(memberIds.value, id, targetId)
  if (order.join('\n') !== memberIds.value.join('\n')) emit('reorder', order)
}

async function moveWithKeyboard(id: string, offset: -1 | 1): Promise<void> {
  const index = props.table.rows.findIndex((benchmark) => benchmark.id === id)
  const neighbor = props.table.rows[index + offset]
  if (index < 0 || !neighbor) return
  reorder(id, neighbor.id)
  await nextTick()
  grips.get(id)?.focus()
}

function startDrag(event: DragEvent, id: string): void {
  draggedId.value = id
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(RUN_DRAG_TYPE, id)
}

function dragOver(event: DragEvent, id: string): void {
  if (!draggedId.value || draggedId.value === id) {
    dropTargetId.value = null
    return
  }
  event.preventDefault()
  dropTargetId.value = id
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

function dragLeave(event: DragEvent): void {
  const next = event.relatedTarget
  if (!(next instanceof Node) || !(event.currentTarget as Node).contains(next)) {
    dropTargetId.value = null
  }
}

function drop(event: DragEvent, targetId: string): void {
  event.preventDefault()
  if (draggedId.value && draggedId.value !== targetId) reorder(draggedId.value, targetId)
  endDrag()
}

function endDrag(): void {
  draggedId.value = null
  dropTargetId.value = null
}

function moveColumn(key: string, targetKey: string): void {
  const keys = props.extraColumns.map((column) => column.key)
  const from = keys.indexOf(key)
  const to = keys.indexOf(targetKey)
  if (from < 0 || to < 0 || from === to) return
  keys.splice(from, 1)
  keys.splice(to, 0, key)
  emit('reorderColumns', keys)
}

async function moveColumnWithKeyboard(key: string, offset: -1 | 1): Promise<void> {
  const keys = props.extraColumns.map((column) => column.key)
  const neighbor = keys[keys.indexOf(key) + offset]
  if (!neighbor) return
  moveColumn(key, neighbor)
  await nextTick()
  columnHeads.get(key)?.querySelector('button')?.focus()
}

function startColumnDrag(event: DragEvent, key: string): void {
  draggedColumnKey.value = key
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(COLUMN_DRAG_TYPE, key)
}

function dragOverColumn(event: DragEvent, key: string): void {
  if (!draggedColumnKey.value || draggedColumnKey.value === key) {
    dropTargetColumnKey.value = null
    return
  }
  event.preventDefault()
  dropTargetColumnKey.value = key
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

function dropColumn(event: DragEvent, targetKey: string): void {
  event.preventDefault()
  if (draggedColumnKey.value) moveColumn(draggedColumnKey.value, targetKey)
  endColumnDrag()
}

function endColumnDrag(): void {
  draggedColumnKey.value = null
  dropTargetColumnKey.value = null
}

function isChosenBaseline(id: string): boolean {
  return props.table.customBaseline && props.table.referenceId === id
}

function canFlag(row: { value: number | null; benchmark: PerformanceTestBenchmark }): boolean {
  return (
    props.table.measuredCount > 1 &&
    row.value !== null &&
    (props.table.customBaseline || props.table.referenceId !== row.benchmark.id)
  )
}

function toggleBaseline(id: string): void {
  emit('baseline', isChosenBaseline(id) ? null : id)
}
</script>

<template>
  <section
    class="benchmarks__runs min-w-0"
    data-testid="benchmark-runs"
    :aria-label="t('benchmarks.allRuns')"
  >
    <div class="benchmarks__runs-head mb-1.5 flex min-h-8 items-center gap-2 pr-2.5 pl-[18px]">
      <h2 class="benchmarks__runs-title m-0 min-w-0 shrink truncate" :class="SECTION_TITLE_CLASS">
        {{ t('benchmarks.allRuns') }}
      </h2>
      <span
        class="benchmarks__runs-meta min-w-0 shrink-0 truncate text-xs text-subtle-foreground tabular-nums"
      >
        {{
          t('benchmarks.groupMeta', {
            sessions: t('benchmarks.sessionCount', table.rows.length),
            runs: t(
              'benchmarks.runCount',
              table.rows.reduce((total, benchmark) => total + benchmark.measuredJobCount, 0)
            )
          })
        }}
      </span>
    </div>

    <div class="benchmarks__runs-box rounded-[14px] bg-card pt-3 pb-2">
      <div class="benchmarks__table-scroll scroll-visible overflow-x-auto ![scrollbar-gutter:auto]">
        <table
          class="benchmarks__table w-full border-separate border-spacing-0 [--bench-line:color-mix(in_oklch,var(--color-foreground)_8%,transparent)] text-left text-[13px] [&_td]:px-2 [&_td]:py-2 [&_td]:whitespace-nowrap [&_th]:h-9 [&_th]:px-2 [&_th]:text-[12px] [&_th]:font-medium [&_th]:tracking-[0.01em] [&_th]:whitespace-nowrap [&_th]:text-subtle-foreground [&_th]:shadow-[inset_0_-1px_0_var(--bench-line)] [&_td]:bg-card [&_th]:bg-card [&_tbody_tr+tr>td]:shadow-[inset_0_1px_0_var(--bench-line)] [&_tbody_tr:hover>td]:bg-[color-mix(in_oklch,var(--color-foreground)_3.5%,var(--color-card))] [&_tbody_tr:hover>td]:shadow-none [&_tbody_tr:hover+tr>td]:shadow-none [&_tbody_tr.benchmarks__row--selected>td]:shadow-none [&_tbody_tr.benchmarks__row--selected+tr>td]:shadow-none"
        >
          <thead>
            <tr>
              <th class="sticky left-0 z-[1] !pl-[70px]" :aria-sort="ariaSort('id')">
                <Button
                  variant="textonly"
                  size="unset"
                  class="benchmarks__sort gap-1 bg-transparent text-[12px] font-medium tracking-[0.01em] text-subtle-foreground hover:bg-transparent hover:text-foreground"
                  type="button"
                  @click="emit('sort', 'id')"
                >
                  {{ t('benchmarks.session') }} {{ sortIndicator('id') }}
                </Button>
              </th>
              <th v-if="workflowColumn" :aria-sort="ariaSort('workflowName')">
                <Button
                  variant="textonly"
                  size="unset"
                  class="benchmarks__sort gap-1 bg-transparent text-[12px] font-medium tracking-[0.01em] text-subtle-foreground hover:bg-transparent hover:text-foreground"
                  type="button"
                  @click="emit('sort', 'workflowName')"
                >
                  {{ t('benchmarks.workflow') }} {{ sortIndicator('workflowName') }}
                </Button>
              </th>
              <th v-if="buildColumn" :aria-sort="ariaSort('instance.name')">
                <Button
                  variant="textonly"
                  size="unset"
                  class="benchmarks__sort gap-1 bg-transparent text-[12px] font-medium tracking-[0.01em] text-subtle-foreground hover:bg-transparent hover:text-foreground"
                  type="button"
                  @click="emit('sort', 'instance.name')"
                >
                  {{ t('benchmarks.instance') }} {{ sortIndicator('instance.name') }}
                </Button>
              </th>
              <th
                v-if="rangeColumn"
                class="benchmarks__bar-head w-[32%] min-w-36 @max-[900px]:w-auto @max-[900px]:min-w-30"
              >
                {{ t('benchmarks.metricAndRange', { metric: metricLabel }) }}
              </th>
              <th
                v-for="column in extraColumns"
                :key="column.key"
                :ref="(element) => rememberColumnHead(column.key, element)"
                class="benchmarks__column-head cursor-grab text-right active:cursor-grabbing"
                :class="{
                  'benchmarks__column-head--dragging opacity-55': draggedColumnKey === column.key,
                  'benchmarks__column-head--drop-target !bg-[color-mix(in_oklch,var(--color-foreground)_10%,var(--color-card))] !text-foreground':
                    dropTargetColumnKey === column.key
                }"
                draggable="true"
                :title="t('benchmarks.reorderColumnHint')"
                :aria-sort="ariaSort(column.key)"
                :data-testid="`benchmark-column-head-${column.key}`"
                @dragstart="startColumnDrag($event, column.key)"
                @dragover="dragOverColumn($event, column.key)"
                @drop="dropColumn($event, column.key)"
                @dragend="endColumnDrag"
              >
                <Button
                  variant="textonly"
                  size="unset"
                  class="benchmarks__sort gap-1 bg-transparent text-[12px] font-medium tracking-[0.01em] text-subtle-foreground hover:bg-transparent hover:text-foreground"
                  type="button"
                  aria-describedby="benchmark-column-reorder-instructions"
                  @click="emit('sort', column.key)"
                  @keydown.alt.left.prevent="moveColumnWithKeyboard(column.key, -1)"
                  @keydown.alt.right.prevent="moveColumnWithKeyboard(column.key, 1)"
                >
                  {{ column.label }} {{ sortIndicator(column.key) }}
                </Button>
              </th>
              <th class="sticky right-[234px] z-[1] text-right" :aria-sort="ariaSort(metric)">
                <Button
                  variant="textonly"
                  size="unset"
                  class="benchmarks__sort benchmarks__metric-sort gap-1 bg-transparent text-[12px] font-medium tracking-[0.01em] text-muted-foreground hover:bg-transparent hover:text-foreground"
                  type="button"
                  @click="emit('sort', metric)"
                >
                  {{ metricLabel }} {{ sortIndicator(metric) }}
                </Button>
              </th>
              <th
                class="benchmarks__vs-head sticky right-[42px] z-[1] w-48 min-w-48 !pr-9 text-right"
              >
                {{ t('benchmarks.vsBaseline') }}
              </th>
              <th
                class="sticky right-0 z-[1] w-[42px] min-w-[42px] !pr-2.5 !pl-0"
                :aria-label="t('benchmarks.actions')"
              />
            </tr>
          </thead>
          <tbody @dragleave="dragLeave">
            <tr
              v-for="row in rows"
              :key="row.benchmark.id"
              class="benchmarks__row group/row [&>td]:transition-colors"
              :class="{
                'benchmarks__row--selected [&>td]:bg-[color-mix(in_oklch,var(--color-foreground)_7%,var(--color-card))]':
                  row.selected,
                'benchmarks__row--dragging opacity-55': draggedId === row.benchmark.id,
                'benchmarks__row--drop-target [&>td]:bg-[color-mix(in_oklch,var(--color-foreground)_10%,var(--color-card))]':
                  dropTargetId === row.benchmark.id
              }"
              :data-testid="`benchmark-row-${row.benchmark.id}`"
              @dragover="dragOver($event, row.benchmark.id)"
              @drop="drop($event, row.benchmark.id)"
            >
              <td class="benchmarks__session sticky left-0 z-[1] max-w-[258px] min-w-40 !pl-[18px]">
                <div class="flex min-w-0 items-center gap-2">
                  <div class="benchmarks__select flex w-11 flex-none items-center gap-1">
                    <span
                      :ref="(element) => rememberGrip(row.benchmark.id, element)"
                      class="benchmarks__grip inline-flex h-7 w-5 flex-none cursor-grab items-center justify-center rounded text-subtle-foreground focus-visible:opacity-100 focus-visible:outline-1 focus-visible:outline-[var(--focus-ring)] active:cursor-grabbing"
                      :class="
                        table.manual ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'
                      "
                      draggable="true"
                      tabindex="0"
                      role="button"
                      :aria-label="t('benchmarks.reorderRun', { session: row.benchmark.id })"
                      aria-describedby="benchmark-reorder-instructions"
                      :title="t('benchmarks.reorderComparisonHint')"
                      @dragstart="startDrag($event, row.benchmark.id)"
                      @dragend="endDrag"
                      @keydown.alt.up.prevent="moveWithKeyboard(row.benchmark.id, -1)"
                      @keydown.alt.left.prevent="moveWithKeyboard(row.benchmark.id, -1)"
                      @keydown.alt.down.prevent="moveWithKeyboard(row.benchmark.id, 1)"
                      @keydown.alt.right.prevent="moveWithKeyboard(row.benchmark.id, 1)"
                    >
                      <GripVertical :size="14" aria-hidden="true" />
                    </span>
                    <Checkbox
                      class="benchmarks__check data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background"
                      :class="{
                        'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100':
                          !row.selected
                      }"
                      :model-value="row.selected"
                      :aria-label="t('benchmarks.selectRun', { session: row.benchmark.id })"
                      @update:model-value="emit('toggleSelected', row.benchmark.id)"
                    />
                  </div>
                  <div class="benchmarks__session-body max-w-[180px] min-w-0">
                    <BenchmarkSessionName
                      :ref="(component) => rememberSessionName(row.benchmark.id, component)"
                      :name="row.benchmark.id"
                      :label="t('benchmarks.editSessionName', { session: row.benchmark.id })"
                      :rename="(name) => renameSession(row.benchmark, name)"
                    />
                    <span
                      class="benchmarks__session-meta block truncate text-xs text-muted-foreground"
                      :title="sessionMeta(row.benchmark)"
                    >
                      {{ sessionMeta(row.benchmark) }}
                    </span>
                  </div>
                </div>
              </td>
              <td
                v-if="workflowColumn"
                class="benchmarks__workflow max-w-44 truncate"
                :title="row.benchmark.workflowName"
              >
                {{ row.benchmark.workflowName }}
              </td>
              <td v-if="buildColumn" class="benchmarks__build max-w-50 truncate">
                {{ row.benchmark.instance.name }}
              </td>
              <td v-if="rangeColumn" class="benchmarks__bar-cell">
                <span
                  v-if="row.value === null"
                  class="benchmarks__no-data text-xs text-subtle-foreground"
                >
                  {{ t('benchmarks.noMeasuredRuns') }}
                </span>
                <Tooltip v-else class="w-full">
                  <span
                    class="benchmarks__bar relative block h-2 w-full rounded bg-foreground/6 outline-none focus-visible:shadow-[0_0_0_2px_var(--focus-ring)]"
                    role="img"
                    tabindex="0"
                    :aria-label="row.summary"
                    :data-testid="`benchmark-bar-${row.benchmark.id}`"
                  >
                    <span
                      class="benchmarks__bar-fill absolute inset-y-0 left-0 rounded"
                      :class="
                        table.measuredCount > 1 && table.fastestId === row.benchmark.id
                          ? 'benchmarks__bar-fill--best bg-foreground/65'
                          : 'bg-foreground/20'
                      "
                      :style="{ width: row.barWidth }"
                    />
                    <span
                      v-if="row.range"
                      class="benchmarks__range absolute top-[3px] h-0.5 bg-foreground/35 before:absolute before:-top-[3px] before:left-0 before:h-2 before:w-0.5 before:bg-foreground/35 before:content-[''] after:absolute after:-top-[3px] after:right-0 after:h-2 after:w-0.5 after:bg-foreground/35 after:content-['']"
                      :style="row.range"
                    />
                  </span>
                  <template #content>
                    <span class="benchmarks__bar-tip flex w-60 flex-col gap-0.5 py-1">
                      <strong class="font-semibold">{{ row.benchmark.id }}</strong>
                      <span class="font-normal text-muted-foreground">
                        {{ row.benchmark.instance.name }} ·
                        {{ formatDate(row.benchmark.createdAt) }} ·
                        {{ t('benchmarks.runCount', row.benchmark.measuredJobCount) }}
                      </span>
                      <span
                        class="mt-1.5 grid grid-flow-col grid-cols-2 grid-rows-2 gap-x-5 gap-y-0.5"
                      >
                        <span
                          v-for="key in TIP_DURATION_KEYS"
                          :key="key"
                          class="flex justify-between gap-3"
                        >
                          <span class="font-normal text-muted-foreground">
                            {{ t(DURATION_LABEL_KEYS[key]) }}
                          </span>
                          <span class="tabular-nums">{{ formatSeconds(row.benchmark[key]) }}</span>
                        </span>
                      </span>
                    </span>
                  </template>
                </Tooltip>
              </td>
              <td
                v-for="column in extraColumns"
                :key="column.key"
                class="text-right tabular-nums"
                :class="{
                  'benchmarks__best font-semibold text-success': isBest(row.benchmark, column.key)
                }"
                :data-testid="`benchmark-cell-${row.benchmark.id}-${column.key}`"
              >
                {{ formatColumnValue(row.benchmark, column.key) }}
              </td>
              <td
                class="benchmarks__value sticky right-[234px] z-[1] text-right font-semibold tabular-nums"
              >
                <span v-if="row.value === null" class="font-normal text-subtle-foreground">—</span>
                <template v-else>{{ formatSeconds(row.value) }}</template>
              </td>
              <td
                class="benchmarks__vs sticky right-[42px] z-[1] w-48 min-w-48 text-right text-xs text-muted-foreground"
              >
                <span class="flex items-center justify-end gap-1">
                  <span
                    v-if="row.pill"
                    class="benchmarks__pill inline-flex h-5 items-center rounded-md px-2 text-[11px] font-semibold"
                    :class="
                      table.customBaseline
                        ? 'benchmarks__pill--baseline bg-foreground/10 text-foreground'
                        : 'benchmarks__pill--fastest bg-success/14 text-success'
                    "
                  >
                    {{ row.pill }}
                  </span>
                  <span
                    v-else
                    :class="{
                      'text-success': row.comparison.kind === 'faster',
                      'text-subtle-foreground': row.comparison.kind === 'missing'
                    }"
                  >
                    {{ row.vs }}
                  </span>

                  <Button
                    v-if="canFlag(row)"
                    variant="muted-textonly"
                    size="unset"
                    class="benchmarks__baseline-toggle size-6 shrink-0 rounded-lg"
                    :class="
                      isChosenBaseline(row.benchmark.id)
                        ? 'benchmarks__baseline-toggle--on text-foreground'
                        : 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100'
                    "
                    type="button"
                    :aria-pressed="isChosenBaseline(row.benchmark.id)"
                    :aria-label="
                      isChosenBaseline(row.benchmark.id)
                        ? t('benchmarks.resetBaseline')
                        : t('benchmarks.setBaseline')
                    "
                    :title="
                      isChosenBaseline(row.benchmark.id)
                        ? t('benchmarks.resetBaseline')
                        : t('benchmarks.setBaseline')
                    "
                    :data-testid="`benchmark-baseline-${row.benchmark.id}`"
                    @click="toggleBaseline(row.benchmark.id)"
                  >
                    <Flag
                      :size="14"
                      :fill="isChosenBaseline(row.benchmark.id) ? 'currentColor' : 'none'"
                      aria-hidden="true"
                    />
                  </Button>
                  <span v-else class="size-6 shrink-0" aria-hidden="true" />
                </span>
              </td>
              <td
                class="benchmarks__row-tools sticky right-0 z-[1] w-[42px] min-w-[42px] !pr-2.5 !pl-0 text-right"
              >
                <Menu
                  :modal="false"
                  align="end"
                  :side-offset="4"
                  class="z-[9999] min-w-48"
                  @close-auto-focus="focusPendingRename"
                >
                  <template #trigger>
                    <Button
                      variant="muted-textonly"
                      size="icon"
                      class="benchmarks__row-menu opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:bg-accent data-[state=open]:text-foreground data-[state=open]:opacity-100"
                      type="button"
                      :disabled="deletingIds.has(row.benchmark.id)"
                      :aria-label="t('benchmarks.moreActions', { session: row.benchmark.id })"
                    >
                      <Ellipsis :size="16" aria-hidden="true" />
                    </Button>
                  </template>
                  <MenuItem
                    class="benchmarks__set-baseline"
                    :disabled="row.value === null || table.referenceId === row.benchmark.id"
                    @select="emit('baseline', row.benchmark.id)"
                  >
                    <Flag :size="14" class="text-muted-foreground" aria-hidden="true" />
                    {{ t('benchmarks.setBaseline') }}
                  </MenuItem>
                  <MenuItem
                    class="benchmarks__rename-session"
                    @select="pendingRenameId = row.benchmark.id"
                  >
                    <Pencil :size="14" class="text-muted-foreground" aria-hidden="true" />
                    {{ t('benchmarks.renameSession') }}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    class="benchmarks__delete-record text-destructive data-highlighted:bg-destructive/12 data-highlighted:text-destructive"
                    :aria-label="
                      t('benchmarks.deleteRecord', { workflow: row.benchmark.workflowName })
                    "
                    @select="emit('delete', row.benchmark)"
                  >
                    <Trash2 :size="14" aria-hidden="true" />
                    {{ t('benchmarks.deleteFiles') }}
                  </MenuItem>
                </Menu>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-if="referenceHidden"
        class="benchmarks__runs-foot mt-1.5 flex min-h-8 items-center gap-3 text-xs text-subtle-foreground"
      >
        <span class="benchmarks__reference-hidden">
          {{ t('benchmarks.referenceHidden', { session: table.referenceId }) }}
        </span>
      </div>
    </div>
  </section>
</template>
