<script setup lang="ts">
import Checkbox from '@comfyorg/design-system/checkbox/Checkbox'
import Input from '@comfyorg/design-system/input/Input'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuRadioItem from '@comfyorg/design-system/menu/MenuRadioItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Flag,
  FolderOpen,
  GripVertical,
  ImageDown,
  Pencil,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X
} from 'lucide-vue-next'
import { DropdownMenuRadioGroup } from 'reka-ui'
import { useI18n } from 'vue-i18n'
import type { PerformanceTestBenchmark, PerformanceTestResultValue } from '../types/ipc'
import BrandBackground from '../components/BrandBackground.vue'
import BrandedPageHeader from '../components/BrandedPageHeader.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import {
  createBenchmarkComparisonSvg,
  MAX_BENCHMARK_COMPARISON_EXPORT_RUNS
} from '../lib/benchmarkComparisonSvg'
import { createResultsPng } from '../lib/performanceTestResultsSvg'
import {
  calculateRelativeSpeedFactor,
  getRelativeSpeedKind,
  type RelativeSpeedKind
} from '../lib/relativeSpeed'
import { useDialogs } from '../composables/useDialogs'

type DurationKey =
  | 'fastestJobDurationSeconds'
  | 'averageJobDurationSeconds'
  | 'medianJobDurationSeconds'
  | 'slowestJobDurationSeconds'
type MetricKey = DurationKey | 'measuredJobCount'
interface RelativeSpeedResult {
  factor: number | null
  kind: RelativeSpeedKind
}
interface BenchmarkGroup {
  key: string
  workflowName: string
  hardware: string
  rows: PerformanceTestBenchmark[]
  runCount: number
  scaleMaximum: number
  measuredCount: number
  fastestId: string | null
  baselineId: string | null
  customBaseline: boolean
  results: Map<string, RelativeSpeedResult>
}

const { t } = useI18n()
const dialogs = useDialogs()
const benchmarks = ref<PerformanceTestBenchmark[]>([])
const selectedOrderIds = ref<string[]>([])
const selectedIds = computed(() => new Set(selectedOrderIds.value))
const manualOrderIds = ref<string[]>([])
const manualOrder = ref(false)
const draggedBenchmarkId = ref<string | null>(null)
const dropTargetBenchmarkId = ref<string | null>(null)
const collapsedGroupKeys = ref<Set<string>>(new Set())
const baselineIds = ref<Record<string, string>>({})
const benchmarksFolderPath = ref('')
const loading = ref(true)
const loadError = ref(false)
const isExportingResults = ref(false)
const exportResultsError = ref<string | null>(null)
const deletingIds = ref<Set<string>>(new Set())
const editingSessionId = ref<string | null>(null)
const renamingSessionId = ref<string | null>(null)
const sessionNameDraft = ref('')
const sessionNameInput = ref<Pick<HTMLInputElement, 'focus' | 'select'> | null>(null)
const columnsPicker = ref<HTMLDetailsElement | null>(null)
const searchQuery = ref('')
const workspaceFilter = ref('')
const instanceFilter = ref('')
const hardwareFilter = ref('')
const workflowFilter = ref('')
const durationKeys: DurationKey[] = [
  'fastestJobDurationSeconds',
  'averageJobDurationSeconds',
  'medianJobDurationSeconds',
  'slowestJobDurationSeconds'
]
const fixedColumnKeys = ['workflowName', 'id']
const exportIdentityColumnKeys = ['workflowName', 'id', 'hardware.deviceName']
const pickerOrder = [
  'instance.name',
  'workspace.name',
  'createdAt',
  'measuredJobCount',
  ...durationKeys,
  'hardware.deviceName'
]
const visibleColumnKeys = ref(new Set(['instance.name']))
const comparisonMetric = ref<DurationKey>('medianJobDurationSeconds')
const sortKey = ref<string>('medianJobDurationSeconds')
const sortAscending = ref(true)
const UNMANAGED_WORKSPACE_FILTER = '__unmanaged__'
const MANUAL_ORDER = 'manual'

const seriesColors = ['#e8e8ee', '#7aa2f7', '#9ece6a', '#bb9af7', '#7dcfff']
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
})

function closeColumnsPickerOnOutsideClick(event: PointerEvent): void {
  const target = event.target
  if (!(target instanceof Node)) return
  const picker = columnsPicker.value
  if (picker?.open && !picker.contains(target)) picker.open = false
}

document.addEventListener('pointerdown', closeColumnsPickerOnOutsideClick, true)
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeColumnsPickerOnOutsideClick, true)
})

interface FilterOption {
  value: string
  label: string
}

function uniqueOptions(allLabel: string, values: Array<string | null>): FilterOption[] {
  return [
    { value: '', label: allLabel },
    ...[...new Set(values.filter((value): value is string => Boolean(value)))]
      .sort()
      .map((value) => ({
        value,
        label: value
      }))
  ]
}

function entityOptions(
  allLabel: string,
  entries: Array<{ value: string; label: string }>
): FilterOption[] {
  const uniqueEntries = [...new Map(entries.map((entry) => [entry.value, entry])).values()]
  const labelCounts = new Map<string, number>()
  for (const entry of uniqueEntries) {
    labelCounts.set(entry.label, (labelCounts.get(entry.label) ?? 0) + 1)
  }
  return [
    { value: '', label: allLabel },
    ...uniqueEntries
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((entry) => ({
        value: entry.value,
        label: labelCounts.get(entry.label) === 1 ? entry.label : `${entry.label} (${entry.value})`
      }))
  ]
}

function workspaceName(benchmark: PerformanceTestBenchmark): string {
  return benchmark.workspace.name ?? t('benchmarks.unmanagedWorkspace')
}

function hardwareName(benchmark: PerformanceTestBenchmark): string {
  return benchmark.hardwareName ?? t('benchmarks.unknownHardware')
}

const workspaceOptions = computed(() =>
  entityOptions(
    t('benchmarks.filterAll'),
    benchmarks.value.map((benchmark) => ({
      value: benchmark.workspace.id ?? UNMANAGED_WORKSPACE_FILTER,
      label: workspaceName(benchmark)
    }))
  )
)
const instanceOptions = computed(() =>
  entityOptions(
    t('benchmarks.filterAll'),
    benchmarks.value.map((benchmark) => ({
      value: benchmark.instance.id,
      label: benchmark.instance.name
    }))
  )
)
const hardwareOptions = computed(() =>
  uniqueOptions(
    t('benchmarks.filterAll'),
    benchmarks.value.map((benchmark) => hardwareName(benchmark))
  )
)
const workflowOptions = computed(() =>
  uniqueOptions(
    t('benchmarks.filterAll'),
    benchmarks.value.map((benchmark) => benchmark.workflowName)
  )
)

function flattenResult(
  value: Record<string, PerformanceTestResultValue>,
  prefix = '',
  flattened: Record<string, PerformanceTestResultValue> = {}
): Record<string, PerformanceTestResultValue> {
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      flattenResult(entry, path, flattened)
    } else {
      flattened[path] = entry
    }
  }
  return flattened
}

const benchmarkFields = computed(
  () =>
    new Map<string, Record<string, PerformanceTestResultValue>>(
      benchmarks.value.map((benchmark) => [
        benchmark.id,
        {
          ...flattenResult(benchmark.result),
          id: benchmark.id,
          createdAt: benchmark.createdAt,
          workflowName: benchmark.workflowName,
          'instance.name': benchmark.instance.name,
          'workspace.name': workspaceName(benchmark),
          measuredJobCount: benchmark.measuredJobCount,
          'hardware.deviceName': hardwareName(benchmark),
          fastestJobDurationSeconds: benchmark.fastestJobDurationSeconds,
          averageJobDurationSeconds: benchmark.averageJobDurationSeconds,
          medianJobDurationSeconds: benchmark.medianJobDurationSeconds,
          slowestJobDurationSeconds: benchmark.slowestJobDurationSeconds
        }
      ])
    )
)

const availableColumnKeys = computed(() => {
  const keys = new Set<string>()
  for (const fields of benchmarkFields.value.values()) {
    for (const key of Object.keys(fields)) keys.add(key)
  }
  for (const key of fixedColumnKeys) keys.delete(key)
  const ordered = pickerOrder.filter((key) => keys.delete(key))
  return [...ordered, ...[...keys].sort((a, b) => a.localeCompare(b))]
})

const showBuildColumn = computed(
  () =>
    visibleColumnKeys.value.has('instance.name') &&
    availableColumnKeys.value.includes('instance.name')
)
const extraColumns = computed(() =>
  availableColumnKeys.value
    .filter((key) => key !== 'instance.name' && visibleColumnKeys.value.has(key))
    .map((key) => ({ key, label: columnLabel(key) }))
)
const exportColumns = computed(() =>
  [
    ...exportIdentityColumnKeys,
    ...availableColumnKeys.value.filter(
      (key) => visibleColumnKeys.value.has(key) && !exportIdentityColumnKeys.includes(key)
    )
  ].map((key) => ({ key, label: columnLabel(key) }))
)

function columnLabel(key: string): string {
  const labels: Record<string, string> = {
    id: t('benchmarks.session'),
    createdAt: t('benchmarks.dateTime'),
    workflowName: t('benchmarks.workflow'),
    'instance.name': t('benchmarks.instance'),
    'workspace.name': t('benchmarks.workspace'),
    measuredJobCount: t('benchmarks.runs'),
    'hardware.deviceName': t('benchmarks.hardware'),
    fastestJobDurationSeconds: t('benchmarks.fastest'),
    averageJobDurationSeconds: t('benchmarks.average'),
    medianJobDurationSeconds: t('benchmarks.median'),
    slowestJobDurationSeconds: t('benchmarks.slowest')
  }
  return (
    labels[key] ??
    key
      .split('.')
      .map((part) =>
        part
          .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
          .replaceAll('_', ' ')
          .replace(/^./, (character) => character.toUpperCase())
      )
      .join(' · ')
  )
}

function fieldValue(
  benchmark: PerformanceTestBenchmark,
  key: string
): PerformanceTestResultValue | undefined {
  return benchmarkFields.value.get(benchmark.id)?.[key]
}

function formatColumnValue(benchmark: PerformanceTestBenchmark, key: string): string {
  const value = fieldValue(benchmark, key)
  if (value === undefined || value === null) return '—'
  if (key === 'createdAt' && typeof value === 'string') return formatDate(value)
  if (key.endsWith('DurationSeconds') && typeof value === 'number') return formatDuration(value)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function toggleColumn(key: string): void {
  const next = new Set(visibleColumnKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  visibleColumnKeys.value = next
}

const filteredBenchmarks = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  return benchmarks.value.filter((benchmark) => {
    const workspace = workspaceName(benchmark)
    const hardware = hardwareName(benchmark)
    const matchesSearch =
      !query ||
      [benchmark.id, benchmark.workflowName, benchmark.instance.name, workspace, hardware].some(
        (value) => value.toLocaleLowerCase().includes(query)
      )
    return (
      matchesSearch &&
      (!workspaceFilter.value ||
        (benchmark.workspace.id ?? UNMANAGED_WORKSPACE_FILTER) === workspaceFilter.value) &&
      (!instanceFilter.value || benchmark.instance.id === instanceFilter.value) &&
      (!hardwareFilter.value || hardware === hardwareFilter.value) &&
      (!workflowFilter.value || benchmark.workflowName === workflowFilter.value)
    )
  })
})

function compareFieldValues(
  aValue: PerformanceTestResultValue | undefined,
  bValue: PerformanceTestResultValue | undefined,
  ascending: boolean
): number {
  if (aValue === undefined || aValue === null) {
    return bValue === undefined || bValue === null ? 0 : 1
  }
  if (bValue === undefined || bValue === null) return -1
  const order =
    typeof aValue === 'number' && typeof bValue === 'number'
      ? aValue - bValue
      : String(aValue).localeCompare(String(bValue))
  return ascending ? order : -order
}

function sortRows(rows: PerformanceTestBenchmark[]): PerformanceTestBenchmark[] {
  const sorted = [...rows].sort((a, b) =>
    compareFieldValues(
      fieldValue(a, sortKey.value),
      fieldValue(b, sortKey.value),
      sortAscending.value
    )
  )
  if (!manualOrder.value) return sorted
  const manualIndex = new Map(manualOrderIds.value.map((id, index) => [id, index]))
  return sorted.sort(
    (a, b) =>
      (manualIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (manualIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  )
}

function groupKey(benchmark: PerformanceTestBenchmark): string {
  return JSON.stringify([benchmark.workflowName, hardwareName(benchmark)])
}

function buildGroup(key: string, members: PerformanceTestBenchmark[]): BenchmarkGroup {
  const metric = comparisonMetric.value
  const rows = sortRows(members)
  const measured = members
    .filter((benchmark) => benchmark[metric] !== null)
    .sort((a, b) => (a[metric] ?? 0) - (b[metric] ?? 0))
  const fastest = measured[0] ?? null
  const storedBaseline = measured.find((benchmark) => benchmark.id === baselineIds.value[key])
  const customBaseline = Boolean(storedBaseline && fastest && storedBaseline.id !== fastest.id)
  const baseline = customBaseline ? storedBaseline! : fastest
  const results = new Map<string, RelativeSpeedResult>()
  for (const benchmark of members) {
    const factor = calculateRelativeSpeedFactor(baseline?.[metric] ?? null, benchmark[metric])
    results.set(benchmark.id, {
      factor,
      kind: getRelativeSpeedKind(factor, benchmark.id === baseline?.id)
    })
  }
  const scaleValues = members.flatMap((benchmark) =>
    [benchmark.slowestJobDurationSeconds, benchmark[metric]].filter(
      (value): value is number => value !== null && value > 0
    )
  )
  return {
    key,
    workflowName: members[0]!.workflowName,
    hardware: hardwareName(members[0]!),
    rows,
    runCount: members.reduce((total, benchmark) => total + benchmark.measuredJobCount, 0),
    scaleMaximum: scaleValues.length > 0 ? Math.max(...scaleValues) : 1,
    measuredCount: measured.length,
    fastestId: fastest?.id ?? null,
    baselineId: baseline?.id ?? null,
    customBaseline,
    results
  }
}

const groups = computed<BenchmarkGroup[]>(() => {
  const members = new Map<string, PerformanceTestBenchmark[]>()
  for (const benchmark of filteredBenchmarks.value) {
    const key = groupKey(benchmark)
    members.set(key, [...(members.get(key) ?? []), benchmark])
  }
  const newest = (rows: PerformanceTestBenchmark[]): string =>
    rows.reduce((latest, row) => {
      const createdAt = row.createdAt ?? ''
      return createdAt > latest ? createdAt : latest
    }, '')
  return [...members.entries()]
    .sort(([, a], [, b]) => newest(b).localeCompare(newest(a)))
    .map(([key, rows]) => buildGroup(key, rows))
})

const displayedIds = computed(() => groups.value.flatMap((group) => group.rows.map(({ id }) => id)))
const selectedBenchmarks = computed(() => {
  const benchmarksById = new Map(benchmarks.value.map((benchmark) => [benchmark.id, benchmark]))
  const displayIndex = new Map(displayedIds.value.map((id, index) => [id, index]))
  return [...selectedOrderIds.value]
    .sort(
      (a, b) =>
        (displayIndex.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (displayIndex.get(b) ?? Number.MAX_SAFE_INTEGER)
    )
    .flatMap((id) => {
      const benchmark = benchmarksById.get(id)
      return benchmark ? [benchmark] : []
    })
})
const selectionOverLimit = computed(
  () => selectedBenchmarks.value.length > MAX_BENCHMARK_COMPARISON_EXPORT_RUNS
)
const metricRows = computed<Array<{ key: MetricKey; label: string }>>(() => [
  { key: 'fastestJobDurationSeconds', label: t('benchmarks.fastest') },
  { key: 'averageJobDurationSeconds', label: t('benchmarks.average') },
  { key: 'medianJobDurationSeconds', label: t('benchmarks.median') },
  { key: 'slowestJobDurationSeconds', label: t('benchmarks.slowest') },
  { key: 'measuredJobCount', label: t('benchmarks.measuredRuns') }
])
const metricLabel = computed(() => columnLabel(comparisonMetric.value))
const compareByOptions = computed<FilterOption[]>(() => [
  ...(manualOrder.value ? [{ value: MANUAL_ORDER, label: t('benchmarks.manualSort') }] : []),
  ...durationKeys.map((key) => ({ value: key, label: columnLabel(key) }))
])
const compareByValue = computed(() => (manualOrder.value ? MANUAL_ORDER : comparisonMetric.value))

function setCompareBy(value: string): void {
  const metric = durationKeys.find((key) => key === value)
  if (!metric) return
  comparisonMetric.value = metric
  manualOrder.value = false
  sortKey.value = metric
  sortAscending.value = true
}

const toolbarMenus = computed(() =>
  [
    {
      key: 'workspace',
      label: t('benchmarks.filterWorkspace'),
      options: workspaceOptions.value,
      model: workspaceFilter
    },
    {
      key: 'build',
      label: t('benchmarks.filterBuild'),
      options: instanceOptions.value,
      model: instanceFilter
    },
    {
      key: 'hardware',
      label: t('benchmarks.filterHardware'),
      options: hardwareOptions.value,
      model: hardwareFilter
    },
    {
      key: 'workflow',
      label: t('benchmarks.filterWorkflow'),
      options: workflowOptions.value,
      model: workflowFilter
    }
  ]
    .map(({ model, ...menu }) => ({
      ...menu,
      value: model.value,
      set: (value: string): void => {
        model.value = value
      }
    }))
    .concat({
      key: 'compare-by',
      label: t('benchmarks.compareBy'),
      options: compareByOptions.value,
      value: compareByValue.value,
      set: setCompareBy
    })
    .map((menu) => ({
      ...menu,
      current: menu.options.find((option) => option.value === menu.value)?.label ?? ''
    }))
)

function setSort(key: string): void {
  if (!manualOrder.value && sortKey.value === key) sortAscending.value = !sortAscending.value
  else {
    sortKey.value = key
    sortAscending.value = durationKeys.some((durationKey) => durationKey === key)
  }
  manualOrder.value = false
}

function sortIndicator(key: string): string {
  if (manualOrder.value || sortKey.value !== key) return ''
  return sortAscending.value ? '↑' : '↓'
}

function sortState(key: string): 'ascending' | 'descending' | 'none' {
  if (!sortIndicator(key)) return 'none'
  return sortAscending.value ? 'ascending' : 'descending'
}

function toggleGroup(key: string): void {
  const next = new Set(collapsedGroupKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsedGroupKeys.value = next
}

function toggleBenchmark(id: string): void {
  if (selectedIds.value.has(id)) {
    selectedOrderIds.value = selectedOrderIds.value.filter((selectedId) => selectedId !== id)
  } else {
    selectedOrderIds.value = [...selectedOrderIds.value, id]
  }
}

function selectGroup(group: BenchmarkGroup): void {
  const nextOrder = [...selectedOrderIds.value]
  for (const benchmark of group.rows) {
    if (!selectedIds.value.has(benchmark.id)) nextOrder.push(benchmark.id)
  }
  selectedOrderIds.value = nextOrder
}

function clearSelection(): void {
  selectedOrderIds.value = []
  exportResultsError.value = null
}

function setBaseline(group: BenchmarkGroup, id: string): void {
  baselineIds.value = { ...baselineIds.value, [group.key]: id }
}

function resetBaseline(group: BenchmarkGroup): void {
  const next = { ...baselineIds.value }
  delete next[group.key]
  baselineIds.value = next
}

function useManualOrder(): void {
  if (manualOrder.value) return
  manualOrderIds.value = [...displayedIds.value]
  manualOrder.value = true
}

function reorderRun(id: string, newIndex: number): void {
  const oldIndex = manualOrderIds.value.indexOf(id)
  if (oldIndex < 0 || newIndex < 0 || newIndex >= manualOrderIds.value.length) return
  const next = [...manualOrderIds.value]
  next.splice(oldIndex, 1)
  next.splice(newIndex, 0, id)
  manualOrderIds.value = next
}

function moveRun(group: BenchmarkGroup, id: string, offset: -1 | 1): void {
  useManualOrder()
  const rowIndex = group.rows.findIndex((benchmark) => benchmark.id === id)
  const neighbor = group.rows[rowIndex + offset]
  if (rowIndex < 0 || !neighbor) return
  reorderRun(id, manualOrderIds.value.indexOf(neighbor.id))
}

function startRunDrag(event: DragEvent, id: string): void {
  useManualOrder()
  draggedBenchmarkId.value = id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }
}

function sameGroup(sourceId: string, targetId: string): boolean {
  const source = benchmarks.value.find((benchmark) => benchmark.id === sourceId)
  const target = benchmarks.value.find((benchmark) => benchmark.id === targetId)
  return Boolean(source && target && groupKey(source) === groupKey(target))
}

function dragOverRun(event: DragEvent, id: string): void {
  const sourceId = draggedBenchmarkId.value
  if (!sourceId || sourceId === id || !sameGroup(sourceId, id)) return
  event.preventDefault()
  dropTargetBenchmarkId.value = id
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

function dropRun(event: DragEvent, targetId: string): void {
  event.preventDefault()
  const sourceId = draggedBenchmarkId.value ?? event.dataTransfer?.getData('text/plain')
  if (sourceId && sourceId !== targetId && sameGroup(sourceId, targetId)) {
    const sourceIndex = manualOrderIds.value.indexOf(sourceId)
    let newIndex = manualOrderIds.value.indexOf(targetId)
    if (sourceIndex < newIndex) newIndex -= 1
    reorderRun(sourceId, newIndex)
  }
  endRunDrag()
}

function endRunDrag(): void {
  draggedBenchmarkId.value = null
  dropTargetBenchmarkId.value = null
}

function formatDate(value: string | null): string {
  if (value === null) return '—'
  return dateFormatter.format(new Date(value))
}

function formatDuration(value: number | null): string {
  if (value === null) return '—'
  return `${value.toFixed(2).replace(/\.?0+$/, '')} s`
}

function formatFactor(factor: number | null): string {
  return factor === null ? '—' : factor.toFixed(2)
}

function seriesColor(benchmark: PerformanceTestBenchmark): string {
  const index = benchmarks.value.findIndex((candidate) => candidate.id === benchmark.id)
  return seriesColors[Math.max(0, index) % seriesColors.length]!
}

function metricValue(benchmark: PerformanceTestBenchmark, key: MetricKey): number | null {
  return benchmark[key]
}

function relativeSpeedResult(
  group: BenchmarkGroup,
  benchmark: PerformanceTestBenchmark
): RelativeSpeedResult {
  return group.results.get(benchmark.id) ?? { factor: null, kind: 'missing' }
}

function vsLabel(result: RelativeSpeedResult): string {
  if (result.kind === 'faster') {
    return t('benchmarks.timesFaster', { factor: formatFactor(result.factor) })
  }
  if (result.kind === 'slower' && result.factor) {
    return t('benchmarks.timesSlower', { factor: formatFactor(1 / result.factor) })
  }
  return t(`benchmarks.${result.kind}`)
}

function barScale(group: BenchmarkGroup, value: number | null): number {
  if (value === null) return 0
  return Math.min(100, Math.max(0, (value / group.scaleMaximum) * 100))
}

function rangeStyle(group: BenchmarkGroup, benchmark: PerformanceTestBenchmark) {
  const fastest = benchmark.fastestJobDurationSeconds
  const slowest = benchmark.slowestJobDurationSeconds
  if (fastest === null || slowest === null) return null
  const left = barScale(group, fastest)
  return { left: `${left}%`, width: `${Math.max(0, barScale(group, slowest) - left)}%` }
}

function isBestInGroup(group: BenchmarkGroup, benchmark: PerformanceTestBenchmark, key: string) {
  if (!durationKeys.some((durationKey) => durationKey === key)) return false
  return isBestAmong(group.rows, benchmark, key as DurationKey)
}

function isBestAmong(
  runs: PerformanceTestBenchmark[],
  benchmark: PerformanceTestBenchmark,
  key: MetricKey
): boolean {
  if (key === 'measuredJobCount') return false
  const value = metricValue(benchmark, key)
  if (value === null) return false
  const values = runs.flatMap((candidate) => {
    const candidateValue = metricValue(candidate, key)
    return candidateValue === null ? [] : [candidateValue]
  })
  return values.length > 1 && value === Math.min(...values)
}

function groupOf(benchmark: PerformanceTestBenchmark): BenchmarkGroup | undefined {
  const key = groupKey(benchmark)
  return groups.value.find((group) => group.key === key)
}

async function exportComparisonImage(runs: PerformanceTestBenchmark[]): Promise<void> {
  if (runs.length === 0) return
  if (runs.length > MAX_BENCHMARK_COMPARISON_EXPORT_RUNS) {
    exportResultsError.value = t('benchmarks.exportImageFailed')
    return
  }
  const runGroups = runs.map((benchmark) => groupOf(benchmark))
  const relativeView = runGroups.some((group) => group?.customBaseline)
  isExportingResults.value = true
  exportResultsError.value = null
  try {
    const svg = createBenchmarkComparisonSvg({
      title: t('benchmarks.comparisonImageTitle'),
      metricTitle: t('benchmarks.metric'),
      durationRangeTitle: t('benchmarks.durationRange'),
      durationRangeHint: t('benchmarks.durationRangeHint'),
      relativeSpeed: relativeView
        ? {
            title: t('benchmarks.relativePerformance'),
            hint: t('benchmarks.relativePerformanceHint'),
            slowerLabel: t('benchmarks.slower'),
            fasterLabel: t('benchmarks.faster')
          }
        : undefined,
      exportDateTime: new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date()),
      runs: runs.map((benchmark, index) => {
        const group = runGroups[index]
        const relative = group
          ? relativeSpeedResult(group, benchmark)
          : { factor: null, kind: 'missing' as const }
        return {
          color: seriesColor(benchmark),
          properties: exportColumns.value.map((column) => ({
            label: column.label,
            value: formatColumnValue(benchmark, column.key)
          })),
          metrics: metricRows.value.map((metric) => ({
            label: metric.label,
            value:
              metric.key === 'measuredJobCount'
                ? String(metricValue(benchmark, metric.key))
                : formatDuration(metricValue(benchmark, metric.key)),
            highlighted: isBestAmong(runs, benchmark, metric.key)
          })),
          fastestDurationSeconds: benchmark.fastestJobDurationSeconds,
          averageDurationSeconds: benchmark.averageJobDurationSeconds,
          slowestDurationSeconds: benchmark.slowestJobDurationSeconds,
          relativeSpeed: relativeView
            ? {
                durationSeconds: metricValue(benchmark, comparisonMetric.value),
                factor: relative.factor,
                kind: relative.kind,
                status: t(`benchmarks.${relative.kind}`)
              }
            : undefined
        }
      })
    })
    const png = await createResultsPng(svg)
    const exported = await window.api.exportResultsImage(
      png,
      'benchmark-comparison',
      benchmarksFolderPath.value || undefined
    )
    if (!exported.ok && !exported.canceled) {
      exportResultsError.value = exported.message || t('benchmarks.exportImageFailed')
    }
  } catch (error) {
    exportResultsError.value = (error as Error)?.message || t('benchmarks.exportImageFailed')
  } finally {
    isExportingResults.value = false
  }
}

async function loadBenchmarks(folderPath?: string): Promise<void> {
  loading.value = true
  loadError.value = false
  try {
    const result = await window.api.listPerformanceTestBenchmarks(folderPath)
    benchmarksFolderPath.value = result.folderPath
    benchmarks.value = result.benchmarks
    selectedOrderIds.value = []
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function syncBenchmarksOnReturn(): Promise<void> {
  if (loading.value) return
  const folderPath = benchmarksFolderPath.value
  if (loadError.value || !folderPath) {
    await loadBenchmarks(folderPath || undefined)
    return
  }
  try {
    const result = await window.api.listPerformanceTestBenchmarks(folderPath)
    if (benchmarksFolderPath.value !== folderPath) return
    benchmarks.value = result.benchmarks
    const remainingIds = new Set(result.benchmarks.map(({ id }) => id))
    selectedOrderIds.value = selectedOrderIds.value.filter((id) => remainingIds.has(id))
  } catch {}
}

async function selectBenchmarksFolder(): Promise<void> {
  const folderPath = await window.api.browseFolder(benchmarksFolderPath.value || undefined)
  if (folderPath) await loadBenchmarks(folderPath)
}

function refreshBenchmarks(): void {
  void loadBenchmarks(benchmarksFolderPath.value || undefined)
}

function openPerformanceTest(): void {
  window.api.navigatePanel('performance-test')
}

function setSessionNameInput(element: unknown): void {
  sessionNameInput.value =
    element && typeof element === 'object' && 'focus' in element && 'select' in element
      ? (element as Pick<HTMLInputElement, 'focus' | 'select'>)
      : null
}

function editSessionName(benchmark: PerformanceTestBenchmark): void {
  if (renamingSessionId.value) return
  editingSessionId.value = benchmark.id
  sessionNameDraft.value = benchmark.id
  void nextTick(() => {
    sessionNameInput.value?.focus()
    sessionNameInput.value?.select()
  })
}

function keepRenameFocus(event: Event): void {
  if (editingSessionId.value) event.preventDefault()
}

function cancelSessionNameEdit(): void {
  if (renamingSessionId.value) return
  editingSessionId.value = null
  sessionNameDraft.value = ''
}

async function showSessionRenameError(message?: string): Promise<void> {
  await dialogs.alert({
    title: t('benchmarks.renameErrorTitle'),
    message: message || t('benchmarks.renameErrorMessage'),
    tone: 'danger'
  })
}

function replaceId(ids: string[], oldId: string, newId: string): string[] {
  return ids.map((id) => (id === oldId ? newId : id))
}

async function saveSessionName(benchmark: PerformanceTestBenchmark): Promise<void> {
  if (editingSessionId.value !== benchmark.id || renamingSessionId.value) return
  const newSessionId = sessionNameDraft.value.trim()
  if (newSessionId === benchmark.id) {
    cancelSessionNameEdit()
    return
  }
  if (!newSessionId) {
    await showSessionRenameError(t('benchmarks.sessionNameRequired'))
    await nextTick(() => sessionNameInput.value?.focus())
    return
  }

  renamingSessionId.value = benchmark.id
  try {
    const result = await window.api.renamePerformanceTestBenchmark(
      benchmarksFolderPath.value,
      benchmark.id,
      newSessionId
    )
    if (!result.ok) {
      await showSessionRenameError(result.message)
      return
    }

    const renamedId = result.sessionId ?? newSessionId
    benchmarks.value = benchmarks.value.map((candidate) =>
      candidate.id === benchmark.id ? { ...candidate, id: renamedId } : candidate
    )
    selectedOrderIds.value = replaceId(selectedOrderIds.value, benchmark.id, renamedId)
    manualOrderIds.value = replaceId(manualOrderIds.value, benchmark.id, renamedId)
    baselineIds.value = Object.fromEntries(
      Object.entries(baselineIds.value).map(([key, id]) => [
        key,
        id === benchmark.id ? renamedId : id
      ])
    )
    editingSessionId.value = null
    sessionNameDraft.value = ''
  } catch (error) {
    await showSessionRenameError((error as Error)?.message)
  } finally {
    renamingSessionId.value = null
    if (editingSessionId.value === benchmark.id) {
      await nextTick(() => sessionNameInput.value?.focus())
    }
  }
}

async function confirmDeleteBenchmark(benchmark: PerformanceTestBenchmark): Promise<void> {
  const confirmed = await dialogs.confirm({
    title: t('benchmarks.deleteConfirmTitle', { workflow: benchmark.workflowName }),
    message: t('benchmarks.deleteConfirmMessage', { session: benchmark.id }),
    confirmLabel: t('benchmarks.deleteFiles'),
    tone: 'danger'
  })
  if (confirmed !== 'primary') return

  deletingIds.value = new Set(deletingIds.value).add(benchmark.id)
  try {
    const result = await window.api.deletePerformanceTestBenchmark(
      benchmarksFolderPath.value,
      benchmark.id
    )
    if (!result.ok) {
      await dialogs.alert({
        title: t('benchmarks.deleteErrorTitle'),
        message: result.message || t('benchmarks.deleteErrorMessage'),
        tone: 'danger'
      })
      return
    }
    benchmarks.value = benchmarks.value.filter((candidate) => candidate.id !== benchmark.id)
    selectedOrderIds.value = selectedOrderIds.value.filter(
      (selectedId) => selectedId !== benchmark.id
    )
  } catch (error) {
    await dialogs.alert({
      title: t('benchmarks.deleteErrorTitle'),
      message: (error as Error)?.message || t('benchmarks.deleteErrorMessage'),
      tone: 'danger'
    })
  } finally {
    const next = new Set(deletingIds.value)
    next.delete(benchmark.id)
    deletingIds.value = next
  }
}

onMounted(() => {
  void loadBenchmarks()
})
onActivated(() => {
  void syncBenchmarksOnReturn()
})
</script>

<template>
  <BrandBackground
    class="benchmarks min-w-0 min-h-0 [&_.brand-outer-frame]:min-w-0 [&_.brand-inner-frame]:min-w-0 [&_.brand-inner-frame]:p-0"
    data-testid="benchmarks"
  >
    <div
      class="benchmarks__layout @container relative flex h-full min-h-0 w-full flex-col overflow-x-hidden overflow-y-auto text-foreground"
    >
      <div class="mx-auto flex w-full max-w-300 flex-col gap-5 px-10 pt-9 pb-8">
        <BrandedPageHeader :title="t('benchmarks.title')">
          <template #actions>
            <Button
              variant="secondary"
              size="md"
              class="benchmarks__open-folder"
              type="button"
              :disabled="loading"
              :title="benchmarksFolderPath"
              @click="selectBenchmarksFolder"
            >
              <FolderOpen :size="16" aria-hidden="true" />
              {{ t('benchmarks.openFolder') }}
            </Button>
          </template>
        </BrandedPageHeader>

        <div class="benchmarks__toolbar flex flex-wrap items-center gap-2">
          <Menu
            v-for="filter in toolbarMenus"
            :key="filter.key"
            :modal="false"
            align="start"
            class="z-20 min-w-[180px]"
            :aria-label="filter.label"
          >
            <template #trigger>
              <Button
                type="button"
                variant="secondary"
                size="md"
                class="benchmarks__filter max-w-64 gap-1.5 px-3 text-[13px]/5"
                :aria-label="filter.label"
                :data-testid="`benchmarks-filter-${filter.key}`"
              >
                <span class="shrink-0 text-subtle-foreground">{{ filter.label }}</span>
                <span class="truncate">{{ filter.current }}</span>
                <ChevronDown :size="14" class="shrink-0" aria-hidden="true" />
              </Button>
            </template>
            <DropdownMenuRadioGroup :model-value="filter.value">
              <MenuRadioItem
                v-for="option in filter.options"
                :key="option.value"
                as="button"
                type="button"
                :value="option.value"
                class="w-full"
                :data-value="option.value"
                @select="filter.set(option.value)"
              >
                <span class="flex-1 text-left">{{ option.label }}</span>
                <Check v-if="filter.value === option.value" :size="15" aria-hidden="true" />
              </MenuRadioItem>
            </DropdownMenuRadioGroup>
          </Menu>
          <div class="benchmarks__compare ml-auto flex items-center gap-2">
            <Button
              variant="muted-textonly"
              size="icon"
              class="benchmarks__refresh"
              type="button"
              :disabled="loading"
              :aria-label="t('benchmarks.refresh')"
              :title="t('benchmarks.refresh')"
              data-testid="benchmarks-refresh"
              @click="refreshBenchmarks"
            >
              <RefreshCw
                :size="15"
                :class="{
                  'benchmarks__refresh-icon--busy animate-spin [animation-duration:900ms]': loading
                }"
                aria-hidden="true"
              />
            </Button>
            <BaseInput
              v-model="searchQuery"
              class="benchmarks__search h-8 w-40 [&_input]:text-[13px]"
              :placeholder="t('benchmarks.searchPlaceholder')"
              :aria-label="t('benchmarks.searchPlaceholder')"
              :spellcheck="false"
            >
              <template #leading><Search :size="14" aria-hidden="true" /></template>
            </BaseInput>
            <details
              ref="columnsPicker"
              class="benchmarks__columns-picker relative [&_summary]:list-none [&_summary::-webkit-details-marker]:hidden"
            >
              <Button as-child variant="muted-textonly" size="icon">
                <summary class="cursor-pointer" :title="t('benchmarks.columns')">
                  <SlidersHorizontal :size="15" aria-hidden="true" />
                  <span class="sr-only">{{ t('benchmarks.columns') }}</span>
                </summary>
              </Button>
              <div
                class="benchmarks__columns-menu absolute top-[calc(100%+6px)] right-0 z-40 flex max-h-[360px] w-max min-w-56 max-w-80 flex-col overflow-y-auto rounded-[14px] bg-popover p-1.5 shadow-[var(--shadow-popover)]"
              >
                <strong
                  class="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.06em] text-subtle-foreground uppercase"
                  >{{ t('benchmarks.columnsToDisplay') }}</strong
                >
                <label
                  v-for="key in availableColumnKeys"
                  :key="key"
                  class="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-foreground transition-colors hover:bg-foreground/6"
                >
                  <Checkbox
                    class="border-foreground/30"
                    :model-value="visibleColumnKeys.has(key)"
                    :data-testid="`benchmark-column-${key}`"
                    @update:model-value="toggleColumn(key)"
                  />
                  <span class="truncate">{{ columnLabel(key) }}</span>
                </label>
              </div>
            </details>
          </div>
        </div>

        <span id="benchmark-reorder-instructions" class="sr-only">
          {{ t('benchmarks.reorderComparisonHint') }}
        </span>

        <div
          v-if="loading"
          class="benchmarks__state benchmarks__state--loading flex flex-col gap-4 rounded-[14px] bg-card px-5 py-5"
          :aria-label="t('common.loading')"
          aria-busy="true"
        >
          <Skeleton class="h-2.5 w-2/5 rounded-md" />
          <div v-for="line in 3" :key="line" class="flex items-center gap-4">
            <Skeleton class="h-2.5 w-1/5 rounded-md" />
            <Skeleton class="h-2.5 w-1/8 rounded-md" />
            <Skeleton class="h-2 flex-1 rounded-md" />
            <Skeleton class="h-2.5 w-1/12 rounded-md" />
          </div>
        </div>
        <div
          v-else-if="loadError"
          class="benchmarks__state benchmarks__state--error flex flex-col items-center gap-1.5 px-6 py-16 text-center"
        >
          <h2 class="m-0 text-heading font-semibold text-foreground">
            {{ t('benchmarks.loadError') }}
          </h2>
          <p class="m-0 text-ui text-muted-foreground">{{ t('benchmarks.loadErrorHint') }}</p>
          <Button
            variant="secondary"
            size="md"
            class="benchmarks__retry mt-6 px-4 text-[13px]/5"
            type="button"
            @click="refreshBenchmarks"
          >
            <RefreshCw :size="14" aria-hidden="true" />
            {{ t('benchmarks.refreshButton') }}
          </Button>
        </div>
        <div
          v-else-if="benchmarks.length === 0"
          class="benchmarks__state benchmarks__state--empty flex flex-col items-center gap-1.5 px-6 py-16 text-center"
        >
          <h2 class="m-0 text-heading font-semibold text-foreground">
            {{ t('benchmarks.emptyTitle') }}
          </h2>
          <p class="m-0 text-ui text-muted-foreground">{{ t('benchmarks.emptyHint') }}</p>
          <Button
            variant="inverted"
            size="md"
            class="benchmarks__open-performance-test mt-6 px-4 text-[13px]/5"
            type="button"
            @click="openPerformanceTest"
          >
            {{ t('benchmarks.openPerformanceTest') }}
          </Button>
        </div>
        <div
          v-else-if="groups.length === 0"
          class="benchmarks__no-results flex flex-col items-center gap-1.5 px-6 py-16 text-center"
        >
          <h2 class="m-0 text-heading font-semibold text-foreground">
            {{ t('benchmarks.noMatches') }}
          </h2>
          <p class="m-0 text-ui text-muted-foreground">{{ t('benchmarks.noMatchesHint') }}</p>
        </div>
        <div v-else class="benchmarks__groups flex flex-col gap-2">
          <section
            v-for="group in groups"
            :key="group.key"
            class="benchmarks__group min-w-0"
            :class="
              collapsedGroupKeys.has(group.key)
                ? 'benchmarks__group--collapsed rounded-[14px] bg-card pr-2 pl-4'
                : 'not-first:mt-4'
            "
            :data-testid="`benchmark-group-${group.workflowName}-${group.hardware}`"
            :aria-label="group.workflowName"
          >
            <div
              class="benchmarks__group-head flex items-center gap-2"
              :class="collapsedGroupKeys.has(group.key) ? 'min-h-12' : 'mb-1.5 min-h-8 pr-2 pl-4'"
            >
              <Button
                variant="textonly"
                size="unset"
                class="benchmarks__group-toggle -ml-1 gap-1.5 rounded-lg px-1 py-1 text-[14px] font-semibold text-foreground hover:bg-transparent"
                type="button"
                :aria-expanded="!collapsedGroupKeys.has(group.key)"
                @click="toggleGroup(group.key)"
              >
                <ChevronRight
                  :size="14"
                  class="text-muted-foreground transition-transform duration-150"
                  :class="{ 'rotate-90': !collapsedGroupKeys.has(group.key) }"
                  aria-hidden="true"
                />
                {{ group.workflowName }}
              </Button>
              <span class="benchmarks__group-meta min-w-0 truncate text-xs text-subtle-foreground">
                {{
                  t('benchmarks.groupMeta', {
                    hardware: group.hardware,
                    sessions: t('benchmarks.sessionCount', group.rows.length),
                    runs: t('benchmarks.runCount', group.runCount)
                  })
                }}
              </span>
              <div class="ml-auto flex">
                <Menu
                  :modal="false"
                  align="end"
                  :side-offset="4"
                  class="benchmarks__menu-list z-[9999] min-w-48 rounded-[14px] border-0 bg-popover p-1.5 shadow-[var(--shadow-popover)] [&_[role=menuitem]]:min-h-8 [&_[role=menuitem]]:gap-2.5 [&_[role=menuitem]]:rounded-lg [&_[role=menuitem]]:px-2.5 [&_[role=menuitem]]:text-[13px]"
                >
                  <template #trigger>
                    <Button
                      variant="muted-textonly"
                      size="icon"
                      class="benchmarks__group-menu data-[state=open]:bg-accent data-[state=open]:text-foreground"
                      type="button"
                      :aria-label="t('benchmarks.groupActions', { workflow: group.workflowName })"
                    >
                      <Ellipsis :size="16" aria-hidden="true" />
                    </Button>
                  </template>
                  <MenuItem class="benchmarks__select-group" @select="selectGroup(group)">
                    {{ t('benchmarks.selectGroup') }}
                  </MenuItem>
                  <MenuItem
                    class="benchmarks__export-group"
                    :disabled="
                      isExportingResults || group.rows.length > MAX_BENCHMARK_COMPARISON_EXPORT_RUNS
                    "
                    @select="exportComparisonImage(group.rows)"
                  >
                    <ImageDown :size="14" class="text-muted-foreground" aria-hidden="true" />
                    {{ t('benchmarks.exportGroup') }}
                  </MenuItem>
                </Menu>
              </div>
            </div>

            <template v-if="!collapsedGroupKeys.has(group.key)">
              <p
                v-if="group.rows.length === 1"
                class="benchmarks__single-note m-0 mb-2 text-[13px] text-muted-foreground"
              >
                {{ t('benchmarks.singleRun') }}
              </p>

              <div class="benchmarks__group-box rounded-[14px] bg-card pt-3 pr-4 pb-2 pl-14">
                <div class="benchmarks__table-scroll -mr-2 -ml-12 overflow-x-auto">
                  <table
                    class="benchmarks__table w-full border-separate border-spacing-0 [--bench-line:color-mix(in_oklch,var(--color-foreground)_8%,transparent)] text-left text-[13px] [&_td]:px-2 [&_td]:py-2 [&_td]:whitespace-nowrap [&_th]:px-2 [&_th]:h-9 [&_th]:text-[12px] [&_th]:font-medium [&_th]:tracking-[0.01em] [&_th]:shadow-[inset_0_-1px_0_var(--bench-line)] [&_th]:whitespace-nowrap [&_th]:text-subtle-foreground [&_tfoot_td]:py-1 [&_td:first-child]:rounded-l-lg [&_td:last-child]:rounded-r-lg [&_tbody_tr+tr>td]:shadow-[inset_0_1px_0_var(--bench-line)] [&_tbody_tr:hover>td]:shadow-none [&_tbody_tr:hover+tr>td]:shadow-none [&_tbody_tr.benchmarks__row--selected>td]:shadow-none [&_tbody_tr.benchmarks__row--selected+tr>td]:shadow-none [&_tbody_tr:hover>td]:bg-foreground/[0.035]"
                  >
                    <thead>
                      <tr>
                        <th class="w-10 !px-0" :aria-label="t('benchmarks.selection')" />
                        <th :aria-sort="sortState('id')">
                          <Button
                            variant="textonly"
                            size="unset"
                            class="benchmarks__sort gap-1 bg-transparent text-subtle-foreground text-[12px] font-medium tracking-[0.01em] hover:bg-transparent hover:text-foreground"
                            type="button"
                            @click="setSort('id')"
                          >
                            {{ t('benchmarks.session') }} {{ sortIndicator('id') }}
                          </Button>
                        </th>
                        <th v-if="showBuildColumn" :aria-sort="sortState('instance.name')">
                          <Button
                            variant="textonly"
                            size="unset"
                            class="benchmarks__sort gap-1 bg-transparent text-subtle-foreground text-[12px] font-medium tracking-[0.01em] hover:bg-transparent hover:text-foreground"
                            type="button"
                            @click="setSort('instance.name')"
                          >
                            {{ t('benchmarks.instance') }} {{ sortIndicator('instance.name') }}
                          </Button>
                        </th>
                        <th class="benchmarks__bar-head w-[32%] min-w-36">
                          {{ t('benchmarks.metricAndRange', { metric: metricLabel }) }}
                        </th>
                        <th
                          v-for="column in extraColumns"
                          :key="column.key"
                          class="text-right"
                          :aria-sort="sortState(column.key)"
                        >
                          <Button
                            variant="textonly"
                            size="unset"
                            class="benchmarks__sort gap-1 bg-transparent text-subtle-foreground text-[12px] font-medium tracking-[0.01em] hover:bg-transparent hover:text-foreground"
                            type="button"
                            @click="setSort(column.key)"
                          >
                            {{ column.label }} {{ sortIndicator(column.key) }}
                          </Button>
                        </th>
                        <th class="text-right" :aria-sort="sortState(comparisonMetric)">
                          <Button
                            variant="textonly"
                            size="unset"
                            class="benchmarks__sort benchmarks__metric-sort gap-1 bg-transparent text-[12px] font-medium tracking-[0.01em] text-muted-foreground hover:bg-transparent hover:text-foreground"
                            type="button"
                            @click="setSort(comparisonMetric)"
                          >
                            {{ metricLabel }} {{ sortIndicator(comparisonMetric) }}
                          </Button>
                        </th>
                        <th class="benchmarks__vs-head w-28 text-right">
                          {{
                            group.customBaseline
                              ? t('benchmarks.vsBaseline')
                              : t('benchmarks.vsFastest')
                          }}
                        </th>
                        <th class="w-10" :aria-label="t('benchmarks.actions')" />
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="benchmark in group.rows"
                        :key="benchmark.id"
                        class="benchmarks__row group/row [&>td]:transition-colors"
                        :class="{
                          'benchmarks__row--selected [&>td]:bg-foreground/[0.07]': selectedIds.has(
                            benchmark.id
                          ),
                          'benchmarks__row--dragging opacity-55':
                            draggedBenchmarkId === benchmark.id,
                          'benchmarks__row--drop-target [&>td]:bg-foreground/10':
                            dropTargetBenchmarkId === benchmark.id
                        }"
                        :data-testid="`benchmark-row-${benchmark.id}`"
                        @dragover="dragOverRun($event, benchmark.id)"
                        @drop="dropRun($event, benchmark.id)"
                      >
                        <td class="w-10 !pr-0 !pl-1.5">
                          <div class="flex items-center gap-1">
                            <span
                              class="benchmarks__grip inline-flex flex-none cursor-grab rounded text-subtle-foreground focus-visible:opacity-100 focus-visible:outline-1 focus-visible:outline-[var(--focus-ring)] active:cursor-grabbing"
                              :class="
                                manualOrder
                                  ? 'opacity-100'
                                  : 'opacity-0 group-hover/row:opacity-100'
                              "
                              draggable="true"
                              tabindex="0"
                              role="button"
                              :aria-label="t('benchmarks.reorderRun', { session: benchmark.id })"
                              aria-describedby="benchmark-reorder-instructions"
                              :title="t('benchmarks.reorderComparisonHint')"
                              @dragstart="startRunDrag($event, benchmark.id)"
                              @dragend="endRunDrag"
                              @keydown.alt.left.prevent="moveRun(group, benchmark.id, -1)"
                              @keydown.alt.right.prevent="moveRun(group, benchmark.id, 1)"
                            >
                              <GripVertical :size="14" aria-hidden="true" />
                            </span>
                            <Checkbox
                              class="benchmarks__check data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background"
                              :class="{
                                'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100':
                                  !selectedIds.has(benchmark.id)
                              }"
                              :model-value="selectedIds.has(benchmark.id)"
                              :aria-label="t('benchmarks.selectRun', { session: benchmark.id })"
                              @update:model-value="toggleBenchmark(benchmark.id)"
                            />
                          </div>
                        </td>
                        <td class="benchmarks__session max-w-65">
                          <span class="relative block max-w-full">
                            <Button
                              variant="textonly"
                              size="unset"
                              class="benchmarks__session-name group/session-name -mx-1 max-w-full justify-start gap-1.5 rounded-md bg-transparent px-1 text-[13px] font-medium text-foreground hover:bg-transparent"
                              :class="{
                                'benchmarks__session-name--editing invisible':
                                  editingSessionId === benchmark.id
                              }"
                              type="button"
                              :disabled="editingSessionId === benchmark.id"
                              :aria-label="
                                t('benchmarks.editSessionName', { session: benchmark.id })
                              "
                              :title="t('benchmarks.editSessionName', { session: benchmark.id })"
                              @click="editSessionName(benchmark)"
                            >
                              <span class="truncate">{{ benchmark.id }}</span>
                              <Pencil
                                class="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/session-name:opacity-100 group-focus-visible/session-name:opacity-100"
                                :size="12"
                                aria-hidden="true"
                              />
                            </Button>
                            <Input
                              v-if="editingSessionId === benchmark.id"
                              :ref="setSessionNameInput"
                              v-model="sessionNameDraft"
                              class="benchmarks__session-name-input absolute inset-0 box-border m-0 size-full min-w-0 px-1 py-px [font:inherit]"
                              type="text"
                              :disabled="renamingSessionId === benchmark.id"
                              :aria-label="t('benchmarks.sessionName')"
                              @blur="saveSessionName(benchmark)"
                              @keydown.enter.prevent="saveSessionName(benchmark)"
                              @keydown.escape.prevent="cancelSessionNameEdit"
                            />
                          </span>
                          <span
                            class="benchmarks__session-meta block text-xs text-muted-foreground"
                          >
                            {{ formatDate(benchmark.createdAt) }} ·
                            {{ t('benchmarks.runCount', benchmark.measuredJobCount) }}
                          </span>
                        </td>
                        <td v-if="showBuildColumn" class="benchmarks__build max-w-50 truncate">
                          {{ formatColumnValue(benchmark, 'instance.name') }}
                        </td>
                        <td class="benchmarks__bar-cell">
                          <span
                            v-if="metricValue(benchmark, comparisonMetric) === null"
                            class="benchmarks__no-data text-xs text-subtle-foreground"
                          >
                            {{ t('benchmarks.noMeasuredRuns') }}
                          </span>
                          <Tooltip v-else class="flex w-full">
                            <span
                              class="benchmarks__bar relative block h-2 w-full rounded bg-foreground/6"
                              :data-testid="`benchmark-bar-${benchmark.id}`"
                            >
                              <span
                                class="benchmarks__bar-fill absolute inset-y-0 left-0 rounded"
                                :class="
                                  group.measuredCount > 1 && group.fastestId === benchmark.id
                                    ? 'benchmarks__bar-fill--best bg-foreground/65'
                                    : 'bg-foreground/20'
                                "
                                :style="{
                                  width: `${barScale(group, metricValue(benchmark, comparisonMetric))}%`
                                }"
                              />
                              <span
                                v-if="rangeStyle(group, benchmark)"
                                class="benchmarks__range absolute top-[3px] h-0.5 bg-foreground/35 before:absolute before:-top-[3px] before:left-0 before:h-2 before:w-0.5 before:bg-foreground/35 before:content-[''] after:absolute after:-top-[3px] after:right-0 after:h-2 after:w-0.5 after:bg-foreground/35 after:content-['']"
                                :style="rangeStyle(group, benchmark)!"
                              />
                            </span>
                            <template #content>
                              <span class="benchmarks__bar-tip flex w-60 flex-col gap-0.5 py-1">
                                <strong class="font-semibold">{{ benchmark.id }}</strong>
                                <span class="font-normal text-muted-foreground">
                                  {{ benchmark.instance.name }} ·
                                  {{ formatDate(benchmark.createdAt) }} ·
                                  {{ t('benchmarks.runCount', benchmark.measuredJobCount) }}
                                </span>
                                <span class="mt-1.5 grid grid-cols-2 gap-x-5 gap-y-0.5">
                                  <span
                                    v-for="key in durationKeys"
                                    :key="key"
                                    class="flex justify-between gap-3"
                                  >
                                    <span class="font-normal text-muted-foreground">{{
                                      columnLabel(key)
                                    }}</span>
                                    <span class="tabular-nums">{{
                                      formatDuration(benchmark[key])
                                    }}</span>
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
                            'benchmarks__best font-semibold text-success': isBestInGroup(
                              group,
                              benchmark,
                              column.key
                            )
                          }"
                          :data-testid="`benchmark-cell-${benchmark.id}-${column.key}`"
                        >
                          {{ formatColumnValue(benchmark, column.key) }}
                        </td>
                        <td class="benchmarks__value text-right font-semibold tabular-nums">
                          <span
                            v-if="metricValue(benchmark, comparisonMetric) === null"
                            class="font-normal text-subtle-foreground"
                            >—</span
                          >
                          <template v-else>{{
                            formatDuration(metricValue(benchmark, comparisonMetric))
                          }}</template>
                        </td>
                        <td class="benchmarks__vs text-right text-xs text-muted-foreground">
                          <template
                            v-if="relativeSpeedResult(group, benchmark).kind === 'baseline'"
                          >
                            <template v-if="group.measuredCount > 1">
                              <span
                                class="benchmarks__pill inline-flex h-5 items-center rounded-md px-2 text-[11px] font-semibold"
                                :class="
                                  group.customBaseline
                                    ? 'benchmarks__pill--baseline bg-foreground/10 text-foreground'
                                    : 'benchmarks__pill--fastest bg-success/14 text-success'
                                "
                              >
                                {{
                                  group.customBaseline
                                    ? t('benchmarks.baseline')
                                    : t('benchmarks.fastest')
                                }}
                              </span>
                            </template>
                          </template>
                          <span
                            v-else
                            :class="{
                              'text-success':
                                relativeSpeedResult(group, benchmark).kind === 'faster',
                              'text-subtle-foreground':
                                relativeSpeedResult(group, benchmark).kind === 'missing'
                            }"
                          >
                            {{ vsLabel(relativeSpeedResult(group, benchmark)) }}
                          </span>
                        </td>
                        <td class="w-10 text-right">
                          <Menu
                            :modal="false"
                            align="end"
                            :side-offset="4"
                            class="benchmarks__menu-list z-[9999] min-w-48 rounded-[14px] border-0 bg-popover p-1.5 shadow-[var(--shadow-popover)] [&_[role=menuitem]]:min-h-8 [&_[role=menuitem]]:gap-2.5 [&_[role=menuitem]]:rounded-lg [&_[role=menuitem]]:px-2.5 [&_[role=menuitem]]:text-[13px] [&_[role=separator]]:mx-1 [&_[role=separator]]:bg-foreground/8"
                            @close-auto-focus="keepRenameFocus"
                          >
                            <template #trigger>
                              <Button
                                variant="muted-textonly"
                                size="icon"
                                class="benchmarks__row-menu opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:bg-accent data-[state=open]:text-foreground data-[state=open]:opacity-100"
                                type="button"
                                :disabled="
                                  deletingIds.has(benchmark.id) || editingSessionId === benchmark.id
                                "
                                :aria-label="t('benchmarks.moreActions', { session: benchmark.id })"
                              >
                                <Ellipsis :size="16" aria-hidden="true" />
                              </Button>
                            </template>
                            <MenuItem
                              class="benchmarks__set-baseline"
                              :disabled="
                                metricValue(benchmark, comparisonMetric) === null ||
                                group.baselineId === benchmark.id
                              "
                              @select="setBaseline(group, benchmark.id)"
                            >
                              <Flag :size="14" class="text-muted-foreground" aria-hidden="true" />
                              {{ t('benchmarks.setBaseline') }}
                            </MenuItem>
                            <MenuItem
                              class="benchmarks__rename-session"
                              :disabled="Boolean(renamingSessionId)"
                              @select="editSessionName(benchmark)"
                            >
                              <Pencil :size="14" class="text-muted-foreground" aria-hidden="true" />
                              {{ t('benchmarks.renameSession') }}
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem
                              class="benchmarks__delete-record text-destructive data-highlighted:bg-destructive/12 data-highlighted:text-destructive"
                              :aria-label="
                                t('benchmarks.deleteRecord', { workflow: benchmark.workflowName })
                              "
                              @select="confirmDeleteBenchmark(benchmark)"
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
                  v-if="group.customBaseline"
                  class="benchmarks__baseline-foot mt-1.5 flex items-center gap-3 text-xs text-subtle-foreground"
                >
                  <span>{{ t('benchmarks.speedFormula') }}</span>
                  <Button
                    variant="secondary"
                    size="md"
                    class="benchmarks__reset-baseline ml-auto text-xs"
                    type="button"
                    @click="resetBaseline(group)"
                  >
                    {{ t('benchmarks.resetBaseline') }}
                  </Button>
                </div>
              </div>
            </template>
          </section>
        </div>

        <div
          v-if="selectedBenchmarks.length > 0 || exportResultsError"
          class="benchmarks__selection-bar sticky bottom-6 z-30 flex w-max max-w-full items-center gap-2 self-center rounded-xl bg-popover py-1.5 pr-1.5 pl-3.5 text-[13px] shadow-[var(--shadow-popover)]"
          role="region"
          :aria-label="t('benchmarks.selection')"
        >
          <span v-if="selectedBenchmarks.length > 0" class="benchmarks__selected-count">
            {{ t('benchmarks.selectedCount', { count: selectedBenchmarks.length }) }}
          </span>
          <span v-if="exportResultsError" class="benchmarks__export-error text-xs text-destructive">
            {{ exportResultsError }}
          </span>
          <Tooltip
            :text="t('benchmarks.exportLimit', { max: MAX_BENCHMARK_COMPARISON_EXPORT_RUNS })"
            :disabled="!selectionOverLimit"
          >
            <Button
              variant="secondary"
              size="md"
              class="benchmarks__export-results text-[13px]"
              type="button"
              :disabled="
                isExportingResults || selectedBenchmarks.length === 0 || selectionOverLimit
              "
              @click="exportComparisonImage(selectedBenchmarks)"
            >
              <ImageDown :size="15" aria-hidden="true" />
              {{
                isExportingResults
                  ? t('benchmarks.exportingImage')
                  : t('benchmarks.exportResultsImage')
              }}
            </Button>
          </Tooltip>
          <Button
            variant="muted-textonly"
            size="icon"
            class="benchmarks__clear-selection size-7"
            type="button"
            :aria-label="t('benchmarks.clearSelection')"
            :title="t('benchmarks.clearSelection')"
            @click="clearSelection"
          >
            <X :size="15" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  </BrandBackground>
</template>
