<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ArrowUpDown,
  FolderOpen,
  GripVertical,
  ImageDown,
  Pencil,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { PerformanceTestBenchmark, PerformanceTestResultValue } from '../types/ipc'
import BrandBackground from '../components/BrandBackground.vue'
import BrandedPageHeader from '../components/BrandedPageHeader.vue'
import CollapsibleSectionToggle from '../components/CollapsibleSectionToggle.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import BaseSelect, { type BaseSelectOption } from '../components/ui/BaseSelect.vue'
import {
  createBenchmarkComparisonSvg,
  MAX_BENCHMARK_COMPARISON_EXPORT_RUNS
} from '../lib/benchmarkComparisonSvg'
import { createResultsPng } from '../lib/performanceTestResultsSvg'
import {
  calculateRelativeSpeedFactor,
  getRelativeSpeedKind,
  getRelativeSpeedOffset,
  getRelativeSpeedScale,
  type RelativeSpeedKind
} from '../lib/relativeSpeed'
import { useDialogs } from '../composables/useDialogs'
import DevPlatformAccountChip from './devplatform/DevPlatformAccountChip.vue'

type DurationKey =
  | 'fastestJobDurationSeconds'
  | 'averageJobDurationSeconds'
  | 'medianJobDurationSeconds'
  | 'slowestJobDurationSeconds'
type MetricKey = DurationKey | 'measuredJobCount'
type ComparisonSortMetric = 'manual' | DurationKey
type ComparisonVisualization = 'relative' | 'range'
interface RelativeSpeedResult {
  factor: number | null
  kind: RelativeSpeedKind
}

const { t } = useI18n()
const dialogs = useDialogs()
const benchmarks = ref<PerformanceTestBenchmark[]>([])
const selectedOrderIds = ref<string[]>([])
const selectedIds = computed(() => new Set(selectedOrderIds.value))
const draggedBenchmarkId = ref<string | null>(null)
const dropTargetBenchmarkId = ref<string | null>(null)
const comparisonExpanded = ref(true)
const benchmarksFolderPath = ref('')
const loading = ref(true)
const loadError = ref(false)
const isExportingResults = ref(false)
const exportResultsError = ref<string | null>(null)
const deletingIds = ref<Set<string>>(new Set())
const editingSessionId = ref<string | null>(null)
const renamingSessionId = ref<string | null>(null)
const sessionNameDraft = ref('')
const sessionNameInput = ref<HTMLInputElement | null>(null)
const libraryColumnsPicker = ref<HTMLDetailsElement | null>(null)
const comparisonColumnsPicker = ref<HTMLDetailsElement | null>(null)
const searchQuery = ref('')
const workspaceFilter = ref('')
const instanceFilter = ref('')
const hardwareFilter = ref('')
const workflowFilter = ref('')
const defaultColumnKeys = [
  'workflowName',
  'id',
  'hardware.deviceName',
  'measuredJobCount',
  'createdAt'
]
const defaultComparisonColumnKeys = ['workflowName', 'id', 'hardware.deviceName']
const visibleColumnKeys = ref(new Set(defaultColumnKeys))
const comparisonColumnKeys = ref(new Set(defaultComparisonColumnKeys))
const sortKey = ref('createdAt')
const sortAscending = ref(false)
const comparisonSortMetric = ref<ComparisonSortMetric>('manual')
const comparisonSortAscending = ref(true)
const comparisonMetric = ref<DurationKey>('medianJobDurationSeconds')
const comparisonBaselineId = ref('')
const comparisonVisualization = ref<ComparisonVisualization>('range')
const UNMANAGED_WORKSPACE_FILTER = '__unmanaged__'

const seriesColors = ['#55e0d1', '#a970ff', '#f6f31b', '#ff8a65', '#62a8ff']
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
})

function closeColumnPickersOnOutsideClick(event: PointerEvent): void {
  const target = event.target
  if (!(target instanceof Node)) return
  for (const picker of [libraryColumnsPicker.value, comparisonColumnsPicker.value]) {
    if (picker?.open && !picker.contains(target)) picker.open = false
  }
}

document.addEventListener('pointerdown', closeColumnPickersOnOutsideClick, true)
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeColumnPickersOnOutsideClick, true)
})

function uniqueOptions(allLabel: string, values: Array<string | null>): BaseSelectOption[] {
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
): BaseSelectOption[] {
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
    t('benchmarks.allWorkspaces'),
    benchmarks.value.map((benchmark) => ({
      value: benchmark.workspace.id ?? UNMANAGED_WORKSPACE_FILTER,
      label: workspaceName(benchmark)
    }))
  )
)
const instanceOptions = computed(() =>
  entityOptions(
    t('benchmarks.allInstances'),
    benchmarks.value.map((benchmark) => ({
      value: benchmark.instance.id,
      label: benchmark.instance.name
    }))
  )
)
const hardwareOptions = computed(() =>
  uniqueOptions(
    t('benchmarks.allHardware'),
    benchmarks.value.map((benchmark) => hardwareName(benchmark))
  )
)
const workflowOptions = computed(() =>
  uniqueOptions(
    t('benchmarks.allWorkflows'),
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
          averageJobDurationSeconds: benchmark.averageJobDurationSeconds,
          medianJobDurationSeconds: benchmark.medianJobDurationSeconds
        }
      ])
    )
)

const availableColumnKeys = computed(() => {
  const keys = new Set<string>()
  for (const fields of benchmarkFields.value.values()) {
    for (const key of Object.keys(fields)) keys.add(key)
  }
  const defaults = defaultColumnKeys.filter((key) => keys.delete(key))
  return [...defaults, ...[...keys].sort((a, b) => a.localeCompare(b))]
})

function selectedColumns(selectedKeys: Set<string>, defaultKeys: string[]) {
  const keys = [
    ...defaultKeys.filter((key) => availableColumnKeys.value.includes(key)),
    ...availableColumnKeys.value.filter((key) => !defaultKeys.includes(key))
  ]
  return keys
    .filter((key) => selectedKeys.has(key))
    .map((key) => ({ key, label: columnLabel(key) }))
}

const visibleColumns = computed(() => selectedColumns(visibleColumnKeys.value, defaultColumnKeys))

const comparisonColumns = computed(() =>
  selectedColumns(comparisonColumnKeys.value, defaultComparisonColumnKeys)
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
  if (key === 'workflowName') return
  const next = new Set(visibleColumnKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  visibleColumnKeys.value = next
}

function toggleComparisonColumn(key: string): void {
  if (key === 'workflowName') return
  const next = new Set(comparisonColumnKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  comparisonColumnKeys.value = next
}

const filteredBenchmarks = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  return benchmarks.value
    .filter((benchmark) => {
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
    .sort((a, b) => {
      const aValue = fieldValue(a, sortKey.value)
      const bValue = fieldValue(b, sortKey.value)
      if (aValue === undefined || aValue === null) {
        return bValue === undefined || bValue === null ? 0 : 1
      }
      if (bValue === undefined || bValue === null) return -1
      const order =
        typeof aValue === 'number' && typeof bValue === 'number'
          ? aValue - bValue
          : String(aValue).localeCompare(String(bValue))
      return sortAscending.value ? order : -order
    })
})

const selectedBenchmarks = computed(() => {
  const benchmarksById = new Map(benchmarks.value.map((benchmark) => [benchmark.id, benchmark]))
  const selected = selectedOrderIds.value.flatMap((id) => {
    const benchmark = benchmarksById.get(id)
    return benchmark ? [benchmark] : []
  })
  if (comparisonSortMetric.value === 'manual') return selected

  const key = comparisonSortMetric.value
  return selected.sort((a, b) => {
    const aValue = a[key]
    const bValue = b[key]
    if (aValue === null) return bValue === null ? 0 : 1
    if (bValue === null) return -1
    return comparisonSortAscending.value ? aValue - bValue : bValue - aValue
  })
})
const allFilteredSelected = computed(
  () =>
    filteredBenchmarks.value.length > 0 &&
    filteredBenchmarks.value.every((benchmark) => selectedIds.value.has(benchmark.id))
)
const metricRows = computed<Array<{ key: MetricKey; label: string }>>(() => [
  { key: 'fastestJobDurationSeconds', label: t('benchmarks.fastest') },
  { key: 'averageJobDurationSeconds', label: t('benchmarks.average') },
  { key: 'medianJobDurationSeconds', label: t('benchmarks.median') },
  { key: 'slowestJobDurationSeconds', label: t('benchmarks.slowest') },
  { key: 'measuredJobCount', label: t('benchmarks.measuredRuns') }
])
const comparisonMetricOptions = computed<BaseSelectOption[]>(() =>
  metricRows.value
    .filter(
      (metric): metric is { key: DurationKey; label: string } => metric.key !== 'measuredJobCount'
    )
    .map((metric) => ({ value: metric.key, label: metric.label }))
)
const comparisonSortOptions = computed<BaseSelectOption[]>(() => [
  { value: 'manual', label: t('benchmarks.manualSort') },
  ...comparisonMetricOptions.value
])
const isRelativeView = computed(() => comparisonVisualization.value === 'relative')
// Without an explicit pick, the baseline is the first column as displayed (sorted or manual).
const effectiveComparisonBaselineId = computed(() =>
  selectedIds.value.has(comparisonBaselineId.value)
    ? comparisonBaselineId.value
    : (selectedBenchmarks.value[0]?.id ?? '')
)
const comparisonBaseline = computed(
  () =>
    benchmarks.value.find((benchmark) => benchmark.id === effectiveComparisonBaselineId.value) ??
    null
)
const relativeSpeedResults = computed(() => {
  const baselineDuration = comparisonBaseline.value
    ? metricValue(comparisonBaseline.value, comparisonMetric.value)
    : null
  const results = new Map<string, RelativeSpeedResult>()
  for (const benchmark of selectedBenchmarks.value) {
    const factor = calculateRelativeSpeedFactor(
      baselineDuration,
      metricValue(benchmark, comparisonMetric.value)
    )
    results.set(benchmark.id, {
      factor,
      kind: getRelativeSpeedKind(factor, benchmark.id === effectiveComparisonBaselineId.value)
    })
  }
  return results
})
const relativeSpeedScale = computed(() =>
  getRelativeSpeedScale([...relativeSpeedResults.value.values()].map((result) => result.factor))
)
const chartMaximum = computed(() => {
  const values = selectedBenchmarks.value.flatMap((benchmark) =>
    benchmark.slowestJobDurationSeconds === null ? [] : [benchmark.slowestJobDurationSeconds]
  )
  return Math.max(1, ...values)
})

function setSort(key: string): void {
  if (sortKey.value === key) sortAscending.value = !sortAscending.value
  else {
    sortKey.value = key
    sortAscending.value = false
  }
}

function toggleBenchmark(id: string): void {
  if (selectedIds.value.has(id)) {
    selectedOrderIds.value = selectedOrderIds.value.filter((selectedId) => selectedId !== id)
  } else {
    selectedOrderIds.value = [...selectedOrderIds.value, id]
  }
}

function toggleAllFiltered(): void {
  const filteredIds = new Set(filteredBenchmarks.value.map((benchmark) => benchmark.id))
  if (allFilteredSelected.value) {
    selectedOrderIds.value = selectedOrderIds.value.filter((id) => !filteredIds.has(id))
  } else {
    const nextOrder = [...selectedOrderIds.value]
    for (const benchmark of filteredBenchmarks.value) {
      if (!selectedIds.value.has(benchmark.id)) nextOrder.push(benchmark.id)
    }
    selectedOrderIds.value = nextOrder
  }
}

function selectComparisonBaseline(id: string): void {
  if (isRelativeView.value) comparisonBaselineId.value = id
}

function isBaselineColumn(id: string): boolean {
  return isRelativeView.value && effectiveComparisonBaselineId.value === id
}

function selectBaselineLabel(benchmark: PerformanceTestBenchmark): string {
  return t('benchmarks.selectBaseline', {
    workflow: benchmark.workflowName,
    session: benchmark.id
  })
}

function moveComparisonColumn(id: string, offset: -1 | 1): void {
  useManualComparisonOrder()
  const oldIndex = selectedOrderIds.value.indexOf(id)
  const newIndex = oldIndex + offset
  reorderComparisonColumn(id, newIndex)
}

function reorderComparisonColumn(id: string, newIndex: number): void {
  const oldIndex = selectedOrderIds.value.indexOf(id)
  if (oldIndex < 0 || newIndex < 0 || newIndex >= selectedOrderIds.value.length) return
  const next = [...selectedOrderIds.value]
  next.splice(oldIndex, 1)
  next.splice(newIndex, 0, id)
  selectedOrderIds.value = next
}

function startComparisonColumnDrag(event: DragEvent, id: string): void {
  useManualComparisonOrder()
  draggedBenchmarkId.value = id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }
}

function dragOverComparisonColumn(event: DragEvent, id: string): void {
  if (!draggedBenchmarkId.value || draggedBenchmarkId.value === id) return
  event.preventDefault()
  dropTargetBenchmarkId.value = id
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

function dropComparisonColumn(event: DragEvent, targetId: string): void {
  event.preventDefault()
  const sourceId = draggedBenchmarkId.value ?? event.dataTransfer?.getData('text/plain')
  if (sourceId && sourceId !== targetId) {
    const sourceIndex = selectedOrderIds.value.indexOf(sourceId)
    let newIndex = selectedOrderIds.value.indexOf(targetId)
    if (sourceIndex < newIndex) newIndex -= 1
    reorderComparisonColumn(sourceId, newIndex)
  }
  endComparisonColumnDrag()
}

function endComparisonColumnDrag(): void {
  draggedBenchmarkId.value = null
  dropTargetBenchmarkId.value = null
}

function useManualComparisonOrder(): void {
  if (comparisonSortMetric.value === 'manual') return
  selectedOrderIds.value = selectedBenchmarks.value.map((benchmark) => benchmark.id)
  comparisonSortMetric.value = 'manual'
}

function formatDate(value: string | null): string {
  if (value === null) return '—'
  return dateFormatter.format(new Date(value))
}

function formatDuration(value: number | null): string {
  if (value === null) return '—'
  return `${value.toFixed(2).replace(/\.?0+$/, '')} s`
}

function seriesColor(benchmark: PerformanceTestBenchmark): string {
  const index = benchmarks.value.findIndex((candidate) => candidate.id === benchmark.id)
  return seriesColors[Math.max(0, index) % seriesColors.length]!
}

function metricValue(benchmark: PerformanceTestBenchmark, key: MetricKey): number | null {
  return benchmark[key]
}

function relativeSpeedResult(benchmark: PerformanceTestBenchmark): RelativeSpeedResult {
  return relativeSpeedResults.value.get(benchmark.id) ?? { factor: null, kind: 'missing' }
}

function relativeFactorLabel(factor: number | null): string {
  return factor === null ? '—' : `${factor.toFixed(2)}×`
}

function relativeBarStyle(factor: number | null): Record<string, string> {
  if (factor === null) return { width: '0%' }
  const width = `${Math.abs(getRelativeSpeedOffset(factor, relativeSpeedScale.value)) * 50}%`
  return factor >= 1 ? { left: '50%', width } : { right: '50%', width }
}

function isBest(benchmark: PerformanceTestBenchmark, key: MetricKey): boolean {
  if (key === 'measuredJobCount') return false
  const value = metricValue(benchmark, key)
  if (value === null) return false
  const values = selectedBenchmarks.value.flatMap((candidate) => {
    const candidateValue = metricValue(candidate, key)
    return candidateValue === null ? [] : [candidateValue]
  })
  return values.length > 1 && value === Math.min(...values)
}

function chartPosition(value: number | null): string {
  if (value === null) return '0%'
  return `${chartPositionPercent(value)}%`
}

function chartPositionPercent(value: number): number {
  return Math.min(100, Math.max(0, (value / chartMaximum.value) * 100))
}

function chartWidth(benchmark: PerformanceTestBenchmark): string {
  if (
    benchmark.fastestJobDurationSeconds === null ||
    benchmark.slowestJobDurationSeconds === null
  ) {
    return '0%'
  }
  return `${
    ((benchmark.slowestJobDurationSeconds - benchmark.fastestJobDurationSeconds) /
      chartMaximum.value) *
    100
  }%`
}

async function exportComparisonImage(): Promise<void> {
  if (selectedBenchmarks.value.length === 0) return
  if (selectedBenchmarks.value.length > MAX_BENCHMARK_COMPARISON_EXPORT_RUNS) {
    exportResultsError.value = t('benchmarks.exportImageFailed')
    return
  }
  isExportingResults.value = true
  exportResultsError.value = null
  try {
    const svg = createBenchmarkComparisonSvg({
      title: t('benchmarks.comparisonImageTitle'),
      metricTitle: t('benchmarks.metric'),
      durationRangeTitle: t('benchmarks.durationRange'),
      durationRangeHint: t('benchmarks.durationRangeHint'),
      relativeSpeed: isRelativeView.value
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
      runs: selectedBenchmarks.value.map((benchmark) => {
        const relative = relativeSpeedResult(benchmark)
        return {
          color: seriesColor(benchmark),
          properties: comparisonColumns.value.map((column) => ({
            label: column.label,
            value: formatColumnValue(benchmark, column.key)
          })),
          metrics: metricRows.value.map((metric) => ({
            label: metric.label,
            value:
              metric.key === 'measuredJobCount'
                ? String(metricValue(benchmark, metric.key))
                : formatDuration(metricValue(benchmark, metric.key)),
            highlighted: isBest(benchmark, metric.key)
          })),
          fastestDurationSeconds: benchmark.fastestJobDurationSeconds,
          averageDurationSeconds: benchmark.averageJobDurationSeconds,
          slowestDurationSeconds: benchmark.slowestJobDurationSeconds,
          relativeSpeed: isRelativeView.value
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
    selectedOrderIds.value = benchmarks.value.slice(0, 3).map((benchmark) => benchmark.id)
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function selectBenchmarksFolder(): Promise<void> {
  const folderPath = await window.api.browseFolder(benchmarksFolderPath.value || undefined)
  if (folderPath) await loadBenchmarks(folderPath)
}

function refreshBenchmarks(): void {
  void loadBenchmarks(benchmarksFolderPath.value || undefined)
}

function setSessionNameInput(element: unknown): void {
  sessionNameInput.value = element instanceof HTMLInputElement ? element : null
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
    selectedOrderIds.value = selectedOrderIds.value.map((selectedId) =>
      selectedId === benchmark.id ? renamedId : selectedId
    )
    if (comparisonBaselineId.value === benchmark.id) comparisonBaselineId.value = renamedId
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
</script>

<template>
  <BrandBackground
    class="benchmarks min-w-0 min-h-0 [--benchmark-baseline:#e5e86d] [--benchmark-best:#3ecf8e] [--benchmark-faster:#54d890] [--benchmark-faster-text:#6ed8a0] [--benchmark-slower:#ef6f69] [--benchmark-slower-text:#ef8a85] [&_.brand-outer-frame]:min-w-0 [&_.brand-inner-frame]:min-w-0"
    data-testid="benchmarks"
  >
    <div
      class="benchmarks__layout relative flex h-full min-h-0 w-full flex-col gap-4 overflow-x-hidden overflow-y-auto text-neutral-100"
    >
      <BrandedPageHeader
        :title="t('benchmarks.title')"
        :description="t('benchmarks.description')"
        logo-test-id="benchmarks-logo"
      />

      <div
        class="benchmarks__account absolute top-0 right-0 z-2 flex [@media(max-width:800px)]:hidden"
      >
        <DevPlatformAccountChip />
      </div>

      <section
        class="benchmarks__card min-w-0 rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[color-mix(in_srgb,var(--chooser-surface-bg)_90%,transparent)] p-4 [&_h2]:m-0 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:text-neutral-100 benchmarks__library"
        :aria-label="t('benchmarks.runsLibrary')"
      >
        <div
          class="benchmarks__filters grid grid-cols-[auto_minmax(180px,1.5fr)_repeat(4,minmax(115px,1fr))_auto] gap-2.5 [&>*]:min-w-0 [&_.ui-input]:min-h-9 [&_.ui-select-trigger]:min-h-9 [&_.ui-input-control]:pt-1.5 [@media(max-width:1100px)]:grid-cols-[auto_repeat(4,minmax(0,1fr))] [@media(max-width:800px)]:grid-cols-[auto_minmax(0,1fr)]"
        >
          <div class="benchmarks__folder-controls flex items-center gap-1">
            <button
              class="secondary benchmarks__open-folder rounded-lg border border-solid border-[var(--border)] bg-surface px-4 py-2 text-[14px] text-text cursor-pointer hover:bg-[var(--border)] disabled:cursor-default disabled:opacity-40 inline-flex min-h-9 items-center gap-2 whitespace-nowrap"
              type="button"
              :disabled="loading"
              :title="benchmarksFolderPath"
              @click="selectBenchmarksFolder"
            >
              <FolderOpen :size="16" aria-hidden="true" />
              {{ t('benchmarks.openFolder') }}
            </button>
            <button
              class="benchmarks__refresh inline-flex size-[30px] cursor-pointer items-center justify-center rounded-md border border-solid border-transparent bg-transparent p-0 text-[14px] text-text-muted enabled:hover:border-[var(--chooser-surface-border-hover)] enabled:hover:bg-[var(--chooser-surface-bg-hover)] enabled:hover:text-neutral-100 disabled:cursor-default disabled:opacity-60 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2"
              type="button"
              :disabled="loading"
              :aria-label="t('benchmarks.refresh')"
              :title="t('benchmarks.refresh')"
              data-testid="benchmarks-refresh"
              @click="refreshBenchmarks"
            >
              <RefreshCw
                :size="13"
                :class="{
                  'benchmarks__refresh-icon--busy animate-spin [animation-duration:900ms]': loading
                }"
                aria-hidden="true"
              />
            </button>
          </div>
          <BaseInput
            v-model="searchQuery"
            class="benchmarks__search [@media(max-width:1100px)]:col-[2/-1] [@media(max-width:800px)]:col-2"
            :placeholder="t('benchmarks.searchPlaceholder')"
            :aria-label="t('benchmarks.searchPlaceholder')"
            :spellcheck="false"
          >
            <template #leading><Search :size="16" aria-hidden="true" /></template>
          </BaseInput>
          <BaseSelect
            v-model="workspaceFilter"
            :options="workspaceOptions"
            :aria-label="t('benchmarks.allWorkspaces')"
            compact
          />
          <BaseSelect
            v-model="instanceFilter"
            :options="instanceOptions"
            :aria-label="t('benchmarks.allInstances')"
            compact
          />
          <BaseSelect
            v-model="hardwareFilter"
            :options="hardwareOptions"
            :aria-label="t('benchmarks.allHardware')"
            compact
          />
          <BaseSelect
            v-model="workflowFilter"
            :options="workflowOptions"
            :aria-label="t('benchmarks.allWorkflows')"
            compact
          />
          <details
            ref="libraryColumnsPicker"
            class="benchmarks__columns-picker relative [&_summary]:flex [&_summary]:min-h-9 [&_summary]:cursor-pointer [&_summary]:list-none [&_summary]:items-center [&_summary]:gap-2 [&_summary]:whitespace-nowrap [&_summary::-webkit-details-marker]:hidden"
          >
            <summary class="secondary">
              <SlidersHorizontal :size="16" aria-hidden="true" />
              {{ t('benchmarks.columns') }}
            </summary>
            <div
              class="benchmarks__columns-menu absolute top-[calc(100%+6px)] right-0 z-4 grid max-h-[360px] w-max min-w-60 max-w-90 gap-2 overflow-y-auto rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-neutral-800 p-3 shadow-[0_12px_30px_rgb(0_0_0/35%)] [&>strong]:text-[12px] [&>strong]:text-neutral-100 [&_label]:flex [&_label]:cursor-pointer [&_label]:items-center [&_label]:gap-2 [&_label]:text-[12px] [&_label]:text-neutral-200"
            >
              <strong>{{ t('benchmarks.columnsToDisplay') }}</strong>
              <label v-for="key in availableColumnKeys" :key="key">
                <input
                  type="checkbox"
                  class="relative m-0 h-5 w-9 flex-none cursor-pointer appearance-none rounded-[10px] bg-[var(--border)] transition-[background] duration-200 ease-[ease] after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-[50%] after:bg-text after:content-[''] after:transition-transform after:duration-200 after:ease-[ease] checked:bg-[var(--accent)] checked:after:[transform:translateX(16px)] checked:after:bg-background disabled:cursor-not-allowed disabled:opacity-60"
                  :checked="visibleColumnKeys.has(key)"
                  :disabled="key === 'workflowName'"
                  :data-testid="`benchmark-column-${key}`"
                  @change="toggleColumn(key)"
                />
                <span>{{ columnLabel(key) }}</span>
              </label>
            </div>
          </details>
        </div>

        <div v-if="loading" class="benchmarks__state px-4 py-8 text-center text-text-muted">
          {{ t('common.loading') }}
        </div>
        <div
          v-else-if="loadError"
          class="benchmarks__state px-4 py-8 text-center text-text-muted benchmarks__state--error [&.benchmarks\_\_state--error]:text-danger"
        >
          {{ t('benchmarks.loadError') }}
        </div>
        <div
          v-else-if="benchmarks.length === 0"
          class="benchmarks__state px-4 py-8 text-center text-text-muted"
        >
          {{ t('benchmarks.empty') }}
        </div>
        <template v-else>
          <div
            class="benchmarks__table-scroll mt-3 max-h-[260px] overflow-auto rounded-lg border border-solid border-[var(--chooser-surface-border)]"
          >
            <table
              class="benchmarks__table w-full min-w-[1040px] border-collapse text-left text-[12px] [&_th]:border-b [&_th]:border-solid [&_th]:border-[var(--chooser-surface-border)] [&_th]:px-3 [&_th]:py-[9px] [&_th]:whitespace-nowrap [&_td]:border-b [&_td]:border-solid [&_td]:border-[var(--chooser-surface-border)] [&_td]:px-3 [&_td]:py-[9px] [&_td]:whitespace-nowrap [&_tbody_tr:last-child>*]:border-b-0 [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-1 [&_thead_th]:bg-neutral-800 [&_thead_th]:font-medium [&_thead_th]:text-neutral-200 [&_th_button]:inline-flex [&_th_button]:cursor-pointer [&_th_button]:gap-1 [&_th_button]:border-0 [&_th_button]:rounded-lg [&_th_button]:bg-transparent [&_th_button]:p-0 [&_th_button]:text-inherit [&_th_button]:[font:inherit]"
            >
              <thead>
                <tr>
                  <th class="benchmarks__check-cell w-11 text-center">
                    <label class="benchmarks__checkbox inline-flex items-center justify-center">
                      <input
                        type="checkbox"
                        class="relative m-0 size-4 shrink-0 cursor-pointer appearance-none rounded border border-solid border-[var(--brand-surface-border-hover)] bg-[var(--brand-surface-bg)] transition-[background] duration-200 ease-[ease] after:hidden checked:border-[var(--series-color,var(--accent))] checked:bg-[var(--series-color,var(--accent))] checked:bg-[url(data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2016%2016%27%20fill%3D%27none%27%20stroke%3D%27white%27%20stroke-width%3D%272.5%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%3E%3Cpolyline%20points%3D%273%2C9%207%2C12%2013%2C5%27%2F%3E%3C%2Fsvg%3E)] focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2"
                        :checked="allFilteredSelected"
                        :aria-label="t('benchmarks.selectVisible')"
                        @change="toggleAllFiltered"
                      />
                    </label>
                  </th>
                  <th v-for="column in visibleColumns" :key="column.key">
                    <button type="button" @click="setSort(column.key)">
                      {{ column.label }}
                      <span v-if="sortKey === column.key">{{ sortAscending ? '↑' : '↓' }}</span>
                    </button>
                  </th>
                  <th
                    class="benchmarks__actions-cell w-11 text-center"
                    :aria-label="t('benchmarks.actions')"
                  />
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="benchmark in filteredBenchmarks"
                  :key="benchmark.id"
                  :class="{
                    'benchmarks__row--selected [&>td]:bg-[color-mix(in_srgb,var(--series-color)_10%,transparent)] [&>td:first-child]:[box-shadow:inset_3px_0_var(--series-color)]':
                      selectedIds.has(benchmark.id)
                  }"
                  :style="
                    selectedIds.has(benchmark.id)
                      ? { '--series-color': seriesColor(benchmark) }
                      : undefined
                  "
                  :data-testid="`benchmark-row-${benchmark.id}`"
                >
                  <td class="benchmarks__check-cell w-11 text-center">
                    <label class="benchmarks__checkbox inline-flex items-center justify-center">
                      <input
                        type="checkbox"
                        class="relative m-0 size-4 shrink-0 cursor-pointer appearance-none rounded border border-solid border-[var(--brand-surface-border-hover)] bg-[var(--brand-surface-bg)] transition-[background] duration-200 ease-[ease] after:hidden checked:border-[var(--series-color,var(--accent))] checked:bg-[var(--series-color,var(--accent))] checked:bg-[url(data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2016%2016%27%20fill%3D%27none%27%20stroke%3D%27white%27%20stroke-width%3D%272.5%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%3E%3Cpolyline%20points%3D%273%2C9%207%2C12%2013%2C5%27%2F%3E%3C%2Fsvg%3E)] focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2"
                        :checked="selectedIds.has(benchmark.id)"
                        :aria-label="
                          t('benchmarks.selectRun', { workflow: benchmark.workflowName })
                        "
                        @change="toggleBenchmark(benchmark.id)"
                      />
                    </label>
                  </td>
                  <td
                    v-for="column in visibleColumns"
                    :key="column.key"
                    :class="{
                      'benchmarks__strong font-semibold text-neutral-100':
                        column.key === 'workflowName'
                    }"
                  >
                    <template v-if="column.key === 'id'">
                      <span
                        class="benchmarks__session-name-editor relative inline-block align-middle"
                      >
                        <button
                          class="benchmarks__session-name inline-flex cursor-text items-center gap-[5px] rounded border-0 bg-transparent px-[3px] py-0.5 text-inherit [font:inherit] [&:hover_.benchmarks\_\_session-name-icon]:opacity-100 [&:focus-visible_.benchmarks\_\_session-name-icon]:opacity-100 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-1"
                          :class="{
                            'benchmarks__session-name--editing invisible':
                              editingSessionId === benchmark.id
                          }"
                          type="button"
                          :disabled="editingSessionId === benchmark.id"
                          :aria-label="t('benchmarks.editSessionName', { session: benchmark.id })"
                          :title="t('benchmarks.editSessionName', { session: benchmark.id })"
                          @click="editSessionName(benchmark)"
                        >
                          <span>{{ benchmark.id }}</span>
                          <Pencil
                            class="benchmarks__session-name-icon flex-none text-text-muted opacity-0 transition-opacity duration-[120ms] ease-[ease]"
                            :size="12"
                            aria-hidden="true"
                          />
                        </button>
                        <input
                          v-if="editingSessionId === benchmark.id"
                          :ref="setSessionNameInput"
                          v-model="sessionNameDraft"
                          class="benchmarks__session-name-input absolute inset-0 box-border m-0 size-full min-w-0 rounded-md border border-solid border-[var(--border)] bg-surface px-0.5 py-px text-text [font:inherit] disabled:opacity-40 focus:border-[var(--accent)] focus:outline-none"
                          type="text"
                          :disabled="renamingSessionId === benchmark.id"
                          :aria-label="t('benchmarks.sessionName')"
                          @blur="saveSessionName(benchmark)"
                          @keydown.enter.prevent="saveSessionName(benchmark)"
                          @keydown.escape.prevent="cancelSessionNameEdit"
                        />
                      </span>
                    </template>
                    <template v-else>
                      {{ formatColumnValue(benchmark, column.key) }}
                    </template>
                  </td>
                  <td class="benchmarks__actions-cell w-11 text-center">
                    <button
                      class="benchmarks__delete-record inline-flex size-[26px] cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-[14px] text-text-muted enabled:hover:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] enabled:hover:text-danger disabled:cursor-wait disabled:opacity-50 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2"
                      type="button"
                      :disabled="deletingIds.has(benchmark.id) || editingSessionId === benchmark.id"
                      :aria-label="
                        t('benchmarks.deleteRecord', { workflow: benchmark.workflowName })
                      "
                      :title="t('benchmarks.deleteRecord', { workflow: benchmark.workflowName })"
                      @click="confirmDeleteBenchmark(benchmark)"
                    >
                      <Trash2 :size="14" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div
            v-if="filteredBenchmarks.length === 0"
            class="benchmarks__no-results px-4 py-8 text-center text-text-muted"
          >
            {{ t('benchmarks.noMatches') }}
          </div>
        </template>
      </section>

      <div class="benchmarks__comparison-section flex flex-col gap-4">
        <CollapsibleSectionToggle
          id="comparison-title"
          :expanded="comparisonExpanded"
          :label="t('benchmarks.comparison')"
          @toggle="comparisonExpanded = !comparisonExpanded"
        />

        <section
          v-show="comparisonExpanded"
          class="benchmarks__card min-w-0 rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[color-mix(in_srgb,var(--chooser-surface-bg)_90%,transparent)] p-4 [&_h2]:m-0 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:text-neutral-100 benchmarks__comparison"
          aria-labelledby="comparison-title"
        >
          <span id="benchmark-reorder-instructions" class="benchmarks__visually-hidden sr-only">
            {{ t('benchmarks.reorderComparisonHint') }}
          </span>
          <div
            class="benchmarks__comparison-toolbar mb-3.5 flex flex-wrap items-center justify-end gap-3"
          >
            <div
              class="benchmarks__visualization-tabs mr-auto inline-flex rounded-[7px] border border-solid border-[var(--chooser-surface-border)] bg-neutral-800 p-0.5 [&_button]:cursor-pointer [&_button]:rounded-[5px] [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-2.5 [&_button]:py-[7px] [&_button]:text-[11px] [&_button]:text-text-muted [&_button]:whitespace-nowrap [&_button[aria-pressed=true]]:bg-[var(--chooser-surface-bg-hover)] [&_button[aria-pressed=true]]:text-neutral-100 [&_button[aria-pressed=true]]:shadow-[0_0_0_1px_var(--chooser-surface-border-hover)] [&_button:focus-visible]:outline-2 [&_button:focus-visible]:[outline-style:solid] [&_button:focus-visible]:outline-[var(--focus-ring)] [&_button:focus-visible]:outline-offset-2"
              role="group"
              :aria-label="t('benchmarks.visualization')"
            >
              <button
                type="button"
                :aria-pressed="comparisonVisualization === 'range'"
                @click="comparisonVisualization = 'range'"
              >
                {{ t('benchmarks.duration') }}
              </button>
              <button
                type="button"
                :aria-pressed="isRelativeView"
                @click="comparisonVisualization = 'relative'"
              >
                {{ t('benchmarks.speed') }}
              </button>
            </div>
            <span
              v-if="exportResultsError"
              class="benchmarks__export-error text-[12px] text-danger"
            >
              {{ exportResultsError }}
            </span>
            <div
              class="benchmarks__comparison-metric flex w-[165px] [&_.ui-select-trigger]:min-w-0 [&_.ui-select-trigger]:flex-1"
              :class="{
                'benchmarks__comparison-metric--hidden invisible pointer-events-none':
                  !isRelativeView
              }"
              :aria-hidden="!isRelativeView"
            >
              <BaseSelect
                v-model="comparisonMetric"
                :options="comparisonMetricOptions"
                :aria-label="t('benchmarks.metric')"
                compact
              />
            </div>
            <div class="benchmarks__comparison-sort w-[220px]">
              <BaseSelect
                v-model="comparisonSortMetric"
                :options="comparisonSortOptions"
                :aria-label="t('benchmarks.sortComparison')"
                compact
              />
            </div>
            <button
              class="secondary benchmarks__sort-direction rounded-lg border border-solid border-[var(--border)] bg-surface text-[14px] text-text cursor-pointer hover:bg-[var(--border)] disabled:cursor-default disabled:opacity-40 inline-flex size-9 min-w-9 items-center justify-center p-0"
              type="button"
              :disabled="comparisonSortMetric === 'manual'"
              :aria-label="
                comparisonSortAscending
                  ? t('benchmarks.switchSortDescending')
                  : t('benchmarks.switchSortAscending')
              "
              :title="
                comparisonSortAscending
                  ? t('benchmarks.switchSortDescending')
                  : t('benchmarks.switchSortAscending')
              "
              @click="comparisonSortAscending = !comparisonSortAscending"
            >
              <ArrowUpDown :size="16" aria-hidden="true" />
            </button>
            <button
              class="secondary benchmarks__export-results rounded-lg border border-solid border-[var(--border)] bg-surface px-4 py-2 text-[14px] text-text cursor-pointer hover:bg-[var(--border)] disabled:cursor-default disabled:opacity-40 inline-flex items-center gap-2"
              type="button"
              :disabled="isExportingResults || selectedBenchmarks.length === 0"
              @click="exportComparisonImage"
            >
              <ImageDown :size="16" aria-hidden="true" />
              {{
                isExportingResults
                  ? t('benchmarks.exportingImage')
                  : t('benchmarks.exportResultsImage')
              }}
            </button>
            <details
              ref="comparisonColumnsPicker"
              class="benchmarks__columns-picker relative [&_summary]:flex [&_summary]:min-h-9 [&_summary]:cursor-pointer [&_summary]:list-none [&_summary]:items-center [&_summary]:gap-2 [&_summary]:whitespace-nowrap [&_summary::-webkit-details-marker]:hidden"
            >
              <summary class="secondary">
                <SlidersHorizontal :size="16" aria-hidden="true" />
                {{ t('benchmarks.columns') }}
              </summary>
              <div
                class="benchmarks__columns-menu absolute top-[calc(100%+6px)] right-0 z-4 grid max-h-[360px] w-max min-w-60 max-w-90 gap-2 overflow-y-auto rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-neutral-800 p-3 shadow-[0_12px_30px_rgb(0_0_0/35%)] [&>strong]:text-[12px] [&>strong]:text-neutral-100 [&_label]:flex [&_label]:cursor-pointer [&_label]:items-center [&_label]:gap-2 [&_label]:text-[12px] [&_label]:text-neutral-200"
              >
                <strong>{{ t('benchmarks.columnsToDisplay') }}</strong>
                <label v-for="key in availableColumnKeys" :key="key">
                  <input
                    type="checkbox"
                    class="relative m-0 h-5 w-9 flex-none cursor-pointer appearance-none rounded-[10px] bg-[var(--border)] transition-[background] duration-200 ease-[ease] after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-[50%] after:bg-text after:content-[''] after:transition-transform after:duration-200 after:ease-[ease] checked:bg-[var(--accent)] checked:after:[transform:translateX(16px)] checked:after:bg-background disabled:cursor-not-allowed disabled:opacity-60"
                    :checked="comparisonColumnKeys.has(key)"
                    :disabled="key === 'workflowName'"
                    :data-testid="`benchmark-comparison-column-${key}`"
                    @change="toggleComparisonColumn(key)"
                  />
                  <span>{{ columnLabel(key) }}</span>
                </label>
              </div>
            </details>
          </div>

          <div
            v-if="selectedBenchmarks.length === 0"
            class="benchmarks__state px-4 py-8 text-center text-text-muted"
          >
            {{ t('benchmarks.selectPrompt') }}
          </div>
          <div
            v-else
            class="benchmarks__comparison-grid grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
          >
            <div
              class="benchmarks__matrix-scroll overflow-auto rounded-lg border border-solid border-[var(--chooser-surface-border)]"
            >
              <table
                class="benchmarks__matrix [&_.benchmarks\_\_matrix-column--baseline]:[box-shadow:inset_0_3px_var(--benchmark-baseline)] [&_.benchmarks\_\_matrix-column--baseline_.benchmarks\_\_matrix-title]:pr-[58px] w-full border-collapse text-left text-[12px] [&_th]:border-b [&_th]:border-solid [&_th]:border-[var(--chooser-surface-border)] [&_th]:px-3 [&_th]:py-[9px] [&_th]:whitespace-nowrap [&_td]:border-b [&_td]:border-solid [&_td]:border-[var(--chooser-surface-border)] [&_td]:px-3 [&_td]:py-[9px] [&_td]:whitespace-nowrap [&_tbody_tr:last-child>*]:border-b-0 [&_th:not(:first-child)]:min-w-[190px] [&_th:not(:first-child)]:text-center [&_td]:min-w-[190px] [&_td]:text-center [&_thead_th]:relative [&_thead_th]:bg-neutral-800 [&_thead_th]:align-top [&_thead_th:first-child]:align-bottom [&_tbody_th]:font-medium [&_tbody_th]:text-neutral-200"
                :style="{ minWidth: `max(100%, ${130 + selectedBenchmarks.length * 190}px)` }"
              >
                <thead>
                  <tr>
                    <th>{{ t('benchmarks.metric') }}</th>
                    <th
                      v-for="benchmark in selectedBenchmarks"
                      :key="benchmark.id"
                      :class="{
                        'benchmarks__matrix-column--dragging opacity-55':
                          draggedBenchmarkId === benchmark.id,
                        'benchmarks__matrix-column--drop-target [box-shadow:inset_3px_0_var(--accent)]':
                          dropTargetBenchmarkId === benchmark.id,
                        'benchmarks__matrix-column--baseline': isBaselineColumn(benchmark.id)
                      }"
                      :style="{ '--series-color': seriesColor(benchmark) }"
                      :data-testid="`benchmark-comparison-column-title-${benchmark.id}`"
                      @click="selectComparisonBaseline(benchmark.id)"
                      @dragover="dragOverComparisonColumn($event, benchmark.id)"
                      @drop="dropComparisonColumn($event, benchmark.id)"
                    >
                      <span
                        class="benchmarks__matrix-title flex items-start gap-2 text-left select-none [&>span:not(.benchmarks\_\_series-dot)]:flex [&>span:not(.benchmarks\_\_series-dot)]:min-w-0 [&>span:not(.benchmarks\_\_series-dot)]:flex-col [&_strong]:truncate [&_small]:truncate [&_small]:text-[10px] [&_small]:font-normal [&_small]:text-text-muted focus-visible:rounded focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-[3px]"
                        :class="{
                          'benchmarks__matrix-title--selectable cursor-pointer [&:hover_strong]:text-[var(--accent)]':
                            isRelativeView
                        }"
                        tabindex="0"
                        :role="isRelativeView ? 'button' : undefined"
                        :aria-pressed="isRelativeView ? isBaselineColumn(benchmark.id) : undefined"
                        :aria-label="
                          isRelativeView
                            ? selectBaselineLabel(benchmark)
                            : t('benchmarks.reorderComparisonColumn', {
                                workflow: benchmark.workflowName
                              })
                        "
                        aria-describedby="benchmark-reorder-instructions"
                        :title="
                          isRelativeView
                            ? selectBaselineLabel(benchmark)
                            : t('benchmarks.reorderComparisonHint')
                        "
                        @keydown.enter.prevent="selectComparisonBaseline(benchmark.id)"
                        @keydown.space.prevent="selectComparisonBaseline(benchmark.id)"
                        @keydown.alt.left.prevent="moveComparisonColumn(benchmark.id, -1)"
                        @keydown.alt.right.prevent="moveComparisonColumn(benchmark.id, 1)"
                      >
                        <span
                          class="benchmarks__column-grip -ml-1.5 inline-flex flex-none cursor-grab text-text-muted active:cursor-grabbing"
                          draggable="true"
                          @click.stop
                          @dragstart.stop="startComparisonColumnDrag($event, benchmark.id)"
                          @dragend.stop="endComparisonColumnDrag"
                        >
                          <GripVertical :size="14" aria-hidden="true" />
                        </span>
                        <span
                          class="benchmarks__series-dot size-3 flex-none rounded-[50%] bg-[var(--series-color)]"
                        />
                        <span>
                          <template v-for="column in comparisonColumns" :key="column.key">
                            <strong
                              v-if="column.key === 'workflowName'"
                              :data-testid="`benchmark-comparison-${benchmark.id}-${column.key}`"
                            >
                              {{ formatColumnValue(benchmark, column.key) }}
                            </strong>
                            <small
                              v-else
                              :data-testid="`benchmark-comparison-${benchmark.id}-${column.key}`"
                            >
                              <span>{{ column.label }}:</span>
                              {{ formatColumnValue(benchmark, column.key) }}
                            </small>
                          </template>
                        </span>
                      </span>
                      <small
                        v-if="isBaselineColumn(benchmark.id)"
                        class="benchmarks__baseline-badge absolute top-2 right-2 rounded-[999px] border border-solid border-[color-mix(in_srgb,var(--benchmark-baseline)_55%,transparent)] bg-[color-mix(in_srgb,var(--benchmark-baseline)_12%,transparent)] px-[5px] py-0.5 text-[9px] font-semibold text-[var(--benchmark-baseline)]"
                      >
                        {{ t('benchmarks.baseline') }}
                      </small>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="metric in metricRows" :key="metric.key">
                    <th>{{ metric.label }}</th>
                    <td
                      v-for="benchmark in selectedBenchmarks"
                      :key="benchmark.id"
                      :class="{
                        'benchmarks__best bg-[color-mix(in_srgb,var(--benchmark-best)_18%,transparent)] font-semibold text-[#78e7b6]':
                          isBest(benchmark, metric.key)
                      }"
                    >
                      {{
                        metric.key === 'measuredJobCount'
                          ? metricValue(benchmark, metric.key)
                          : formatDuration(metricValue(benchmark, metric.key))
                      }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div
              class="benchmarks__chart min-w-0 overflow-x-auto rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-neutral-800 p-3.5 [&_h3]:m-0 [&_h3]:text-[16px] [&_h3]:font-semibold [&_h3]:text-neutral-100 [&_p]:mt-1 [&_p]:mr-0 [&_p]:mb-[18px] [&_p]:ml-0 [&_p]:min-h-[2lh] [&_p]:text-[11px] [&_p]:text-text-muted"
            >
              <h3>
                {{
                  isRelativeView
                    ? t('benchmarks.relativePerformance')
                    : t('benchmarks.durationRange')
                }}
              </h3>
              <p>
                {{
                  isRelativeView
                    ? t('benchmarks.relativePerformanceHint')
                    : t('benchmarks.durationRangeHint')
                }}
              </p>
              <!-- Rendered in both views so rows keep their position when toggling. -->
              <div
                class="benchmarks__chart-axis mb-2 grid min-h-3.5 min-w-[760px] grid-cols-[minmax(220px,32%)_90px_minmax(260px,1fr)_105px] items-center gap-3.5 text-[10px] text-text-muted"
                aria-hidden="true"
              >
                <template v-if="isRelativeView">
                  <span
                    class="benchmarks__relative-direction--slower col-3 row-1 justify-self-start text-[var(--benchmark-slower-text)]"
                  >
                    ← {{ t('benchmarks.slower') }}
                  </span>
                  <span
                    class="benchmarks__relative-direction--faster col-3 row-1 justify-self-end text-[var(--benchmark-faster-text)]"
                  >
                    {{ t('benchmarks.faster') }} →
                  </span>
                </template>
              </div>
              <div class="benchmarks__chart-rows grid">
                <div
                  v-for="benchmark in selectedBenchmarks"
                  :key="benchmark.id"
                  class="benchmarks__chart-row box-border grid min-h-20 min-w-[760px] grid-cols-[minmax(220px,32%)_90px_minmax(260px,1fr)_105px] items-center gap-3.5 border-t border-solid border-[var(--chooser-surface-border)] py-2 [&.benchmarks\_\_relative-row--faster_.benchmarks\_\_relative-bar]:bg-[var(--benchmark-faster)] [&.benchmarks\_\_relative-row--slower_.benchmarks\_\_relative-bar]:bg-[var(--benchmark-slower)] [&.benchmarks\_\_relative-row--baseline_.benchmarks\_\_relative-center]:border-l-[3px] [&.benchmarks\_\_relative-row--baseline_.benchmarks\_\_relative-center]:border-solid [&.benchmarks\_\_relative-row--baseline_.benchmarks\_\_relative-center]:border-[var(--benchmark-baseline)] [&.benchmarks\_\_relative-row--faster_.benchmarks\_\_relative-result_strong]:text-[var(--benchmark-faster-text)] [&.benchmarks\_\_relative-row--slower_.benchmarks\_\_relative-result_strong]:text-[var(--benchmark-slower-text)] [&.benchmarks\_\_relative-row--baseline_.benchmarks\_\_relative-result_strong]:text-[var(--benchmark-baseline)]"
                  :class="
                    isRelativeView
                      ? [
                          'benchmarks__relative-row',
                          `benchmarks__relative-row--${relativeSpeedResult(benchmark).kind}`
                        ]
                      : undefined
                  "
                  :style="{ '--series-color': seriesColor(benchmark) }"
                >
                  <div
                    class="benchmarks__chart-label flex min-w-0 items-center gap-2 [&>span:not(.benchmarks\_\_series-dot)]:flex [&>span:not(.benchmarks\_\_series-dot)]:min-w-0 [&>span:not(.benchmarks\_\_series-dot)]:flex-col [&_strong]:truncate [&_small]:truncate [&_small]:text-[10px] [&_small]:font-normal [&_small]:text-text-muted"
                  >
                    <span
                      class="benchmarks__series-dot size-3 flex-none rounded-[50%] bg-[var(--series-color)]"
                    />
                    <span>
                      <template v-for="column in comparisonColumns" :key="column.key">
                        <strong
                          v-if="column.key === 'workflowName'"
                          :data-testid="`benchmark-chart-${benchmark.id}-${column.key}`"
                        >
                          {{ formatColumnValue(benchmark, column.key) }}
                        </strong>
                        <small
                          v-else
                          :data-testid="`benchmark-chart-${benchmark.id}-${column.key}`"
                        >
                          <span>{{ column.label }}:</span>
                          {{ formatColumnValue(benchmark, column.key) }}
                        </small>
                      </template>
                    </span>
                  </div>
                  <template v-if="isRelativeView">
                    <strong
                      class="benchmarks__relative-duration text-right text-[12px] font-medium text-neutral-200"
                    >
                      {{ formatDuration(metricValue(benchmark, comparisonMetric)) }}
                    </strong>
                    <div
                      class="benchmarks__relative-plot relative h-7 rounded bg-[color-mix(in_srgb,var(--chooser-surface-border)_40%,transparent)]"
                    >
                      <span
                        class="benchmarks__relative-center absolute -top-[5px] -bottom-[5px] left-1/2 z-1 border-l border-dashed border-neutral-300"
                      />
                      <span
                        class="benchmarks__relative-bar absolute top-[7px] h-3.5 rounded-[3px]"
                        :style="relativeBarStyle(relativeSpeedResult(benchmark).factor)"
                      />
                    </div>
                    <div
                      class="benchmarks__relative-result flex flex-col [&_strong]:text-[14px] [&_strong]:text-neutral-100 [&_span]:text-[10px] [&_span]:text-text-muted"
                    >
                      <strong>{{
                        relativeFactorLabel(relativeSpeedResult(benchmark).factor)
                      }}</strong>
                      <span>
                        {{ t(`benchmarks.${relativeSpeedResult(benchmark).kind}`) }}
                      </span>
                    </div>
                  </template>
                  <div
                    v-else
                    class="benchmarks__chart-track relative col-[2/-1] h-16 before:absolute before:top-9 before:right-0 before:left-0 before:h-0.5 before:bg-[var(--chooser-surface-border)] before:content-['']"
                  >
                    <div class="benchmarks__chart-plot absolute inset-y-0 inset-x-[52px]">
                      <span
                        class="benchmarks__chart-range absolute top-9 h-0.5 bg-[var(--series-color)] before:absolute before:top-1/2 before:left-0 before:size-[7px] before:[transform:translate(-50%,-50%)] before:rounded-[50%] before:border before:border-solid before:border-neutral-800 before:bg-[var(--series-color)] before:content-[''] after:absolute after:top-1/2 after:left-full after:size-[7px] after:[transform:translate(-50%,-50%)] after:rounded-[50%] after:border after:border-solid after:border-neutral-800 after:bg-[var(--series-color)] after:content-['']"
                        :style="{
                          left: chartPosition(benchmark.fastestJobDurationSeconds),
                          width: chartWidth(benchmark)
                        }"
                      />
                      <span
                        v-if="benchmark.averageJobDurationSeconds !== null"
                        class="benchmarks__chart-average absolute top-[37px] size-[9px] [transform:translate(-50%,-50%)] rounded-[50%] border border-solid border-neutral-800 bg-[var(--series-color)]"
                        :style="{ left: chartPosition(benchmark.averageJobDurationSeconds) }"
                      />
                      <span
                        v-if="benchmark.fastestJobDurationSeconds !== null"
                        :data-testid="`benchmark-chart-${benchmark.id}-fastest-label`"
                        class="benchmarks__chart-point-label absolute z-1 text-[12px] leading-[14px] whitespace-nowrap text-text-muted benchmarks__chart-point-label--endpoint top-[30px] benchmarks__chart-point-label--fastest [transform:translateX(calc(-100%_-_5px))]"
                        :style="{ left: chartPosition(benchmark.fastestJobDurationSeconds) }"
                      >
                        {{ formatDuration(benchmark.fastestJobDurationSeconds) }}
                      </span>
                      <span
                        v-if="benchmark.slowestJobDurationSeconds !== null"
                        :data-testid="`benchmark-chart-${benchmark.id}-slowest-label`"
                        class="benchmarks__chart-point-label absolute z-1 text-[12px] leading-[14px] whitespace-nowrap text-text-muted benchmarks__chart-point-label--endpoint top-[30px] benchmarks__chart-point-label--slowest [transform:translateX(5px)]"
                        :style="{ left: chartPosition(benchmark.slowestJobDurationSeconds) }"
                      >
                        {{ formatDuration(benchmark.slowestJobDurationSeconds) }}
                      </span>
                      <span
                        v-if="benchmark.averageJobDurationSeconds !== null"
                        :data-testid="`benchmark-chart-${benchmark.id}-average-label`"
                        class="benchmarks__chart-point-label absolute z-1 text-[12px] leading-[14px] whitespace-nowrap text-text-muted benchmarks__chart-point-label--below top-12 benchmarks__chart-point-label--center [transform:translateX(-50%)]"
                        :style="{ left: chartPosition(benchmark.averageJobDurationSeconds) }"
                      >
                        {{ formatDuration(benchmark.averageJobDurationSeconds) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </BrandBackground>
</template>
