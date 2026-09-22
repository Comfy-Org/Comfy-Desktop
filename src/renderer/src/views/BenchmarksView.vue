<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
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
import { useDialogs } from '../composables/useDialogs'
import DevPlatformAccountChip from './devplatform/DevPlatformAccountChip.vue'

type DurationKey =
  | 'fastestJobDurationSeconds'
  | 'averageJobDurationSeconds'
  | 'medianJobDurationSeconds'
  | 'slowestJobDurationSeconds'
type MetricKey = DurationKey | 'measuredJobCount'
type ComparisonSortMetric = 'manual' | DurationKey

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
const UNMANAGED_WORKSPACE_FILTER = '__unmanaged__'

const seriesColors = ['#55e0d1', '#a970ff', '#f6f31b', '#ff8a65', '#62a8ff']
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
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
const comparisonSortOptions = computed<BaseSelectOption[]>(() => [
  { value: 'manual', label: t('benchmarks.manualSort') },
  ...metricRows.value
    .filter(
      (metric): metric is { key: DurationKey; label: string } => metric.key !== 'measuredJobCount'
    )
    .map((metric) => ({ value: metric.key, label: metric.label }))
])
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
      exportDateTime: new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date()),
      runs: selectedBenchmarks.value.map((benchmark) => ({
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
        slowestDurationSeconds: benchmark.slowestJobDurationSeconds
      }))
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
  <BrandBackground class="benchmarks" data-testid="benchmarks">
    <div class="benchmarks__layout">
      <BrandedPageHeader
        :title="t('benchmarks.title')"
        :description="t('benchmarks.description')"
        logo-test-id="benchmarks-logo"
      />

      <DevPlatformAccountChip class="benchmarks__account" />

      <section
        class="benchmarks__card benchmarks__library"
        :aria-label="t('benchmarks.runsLibrary')"
      >
        <div class="benchmarks__filters">
          <div class="benchmarks__folder-controls">
            <button
              class="secondary benchmarks__open-folder"
              type="button"
              :disabled="loading"
              :title="benchmarksFolderPath"
              @click="selectBenchmarksFolder"
            >
              <FolderOpen :size="16" aria-hidden="true" />
              {{ t('benchmarks.openFolder') }}
            </button>
            <button
              class="benchmarks__refresh"
              type="button"
              :disabled="loading"
              :aria-label="t('benchmarks.refresh')"
              :title="t('benchmarks.refresh')"
              data-testid="benchmarks-refresh"
              @click="refreshBenchmarks"
            >
              <RefreshCw
                :size="13"
                :class="{ 'benchmarks__refresh-icon--busy': loading }"
                aria-hidden="true"
              />
            </button>
          </div>
          <BaseInput
            v-model="searchQuery"
            class="benchmarks__search"
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
          <details class="benchmarks__columns-picker">
            <summary class="secondary">
              <SlidersHorizontal :size="16" aria-hidden="true" />
              {{ t('benchmarks.columns') }}
            </summary>
            <div class="benchmarks__columns-menu">
              <strong>{{ t('benchmarks.columnsToDisplay') }}</strong>
              <label v-for="key in availableColumnKeys" :key="key">
                <input
                  type="checkbox"
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

        <div v-if="loading" class="benchmarks__state">{{ t('common.loading') }}</div>
        <div v-else-if="loadError" class="benchmarks__state benchmarks__state--error">
          {{ t('benchmarks.loadError') }}
        </div>
        <div v-else-if="benchmarks.length === 0" class="benchmarks__state">
          {{ t('benchmarks.empty') }}
        </div>
        <template v-else>
          <div class="benchmarks__table-scroll">
            <table class="benchmarks__table">
              <thead>
                <tr>
                  <th class="benchmarks__check-cell">
                    <label class="benchmarks__checkbox">
                      <input
                        type="checkbox"
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
                  <th class="benchmarks__actions-cell" :aria-label="t('benchmarks.actions')" />
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="benchmark in filteredBenchmarks"
                  :key="benchmark.id"
                  :class="{ 'benchmarks__row--selected': selectedIds.has(benchmark.id) }"
                  :style="
                    selectedIds.has(benchmark.id)
                      ? { '--series-color': seriesColor(benchmark) }
                      : undefined
                  "
                  :data-testid="`benchmark-row-${benchmark.id}`"
                >
                  <td class="benchmarks__check-cell">
                    <label class="benchmarks__checkbox">
                      <input
                        type="checkbox"
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
                    :class="{ benchmarks__strong: column.key === 'workflowName' }"
                  >
                    <template v-if="column.key === 'id'">
                      <span class="benchmarks__session-name-editor">
                        <button
                          class="benchmarks__session-name"
                          :class="{
                            'benchmarks__session-name--editing': editingSessionId === benchmark.id
                          }"
                          type="button"
                          :disabled="editingSessionId === benchmark.id"
                          :aria-label="t('benchmarks.editSessionName', { session: benchmark.id })"
                          :title="t('benchmarks.editSessionName', { session: benchmark.id })"
                          @click="editSessionName(benchmark)"
                        >
                          <span>{{ benchmark.id }}</span>
                          <Pencil
                            class="benchmarks__session-name-icon"
                            :size="12"
                            aria-hidden="true"
                          />
                        </button>
                        <input
                          v-if="editingSessionId === benchmark.id"
                          :ref="setSessionNameInput"
                          v-model="sessionNameDraft"
                          class="benchmarks__session-name-input"
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
                  <td class="benchmarks__actions-cell">
                    <button
                      class="benchmarks__delete-record"
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

          <div v-if="filteredBenchmarks.length === 0" class="benchmarks__no-results">
            {{ t('benchmarks.noMatches') }}
          </div>
        </template>
      </section>

      <div class="benchmarks__comparison-section">
        <CollapsibleSectionToggle
          id="comparison-title"
          :expanded="comparisonExpanded"
          :label="t('benchmarks.comparison')"
          @toggle="comparisonExpanded = !comparisonExpanded"
        />

        <section
          v-show="comparisonExpanded"
          class="benchmarks__card benchmarks__comparison"
          aria-labelledby="comparison-title"
        >
          <span id="benchmark-reorder-instructions" class="benchmarks__visually-hidden">
            {{ t('benchmarks.reorderComparisonHint') }}
          </span>
          <div class="benchmarks__comparison-toolbar">
            <span v-if="exportResultsError" class="benchmarks__export-error">
              {{ exportResultsError }}
            </span>
            <div class="benchmarks__comparison-sort">
              <BaseSelect
                v-model="comparisonSortMetric"
                :options="comparisonSortOptions"
                :aria-label="t('benchmarks.sortComparison')"
                compact
              />
            </div>
            <button
              class="secondary benchmarks__sort-direction"
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
              class="secondary benchmarks__export-results"
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
            <details class="benchmarks__columns-picker">
              <summary class="secondary">
                <SlidersHorizontal :size="16" aria-hidden="true" />
                {{ t('benchmarks.columns') }}
              </summary>
              <div class="benchmarks__columns-menu">
                <strong>{{ t('benchmarks.columnsToDisplay') }}</strong>
                <label v-for="key in availableColumnKeys" :key="key">
                  <input
                    type="checkbox"
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

          <div v-if="selectedBenchmarks.length === 0" class="benchmarks__state">
            {{ t('benchmarks.selectPrompt') }}
          </div>
          <div v-else class="benchmarks__comparison-grid">
            <div class="benchmarks__matrix-scroll">
              <table
                class="benchmarks__matrix"
                :style="{ minWidth: `max(100%, ${130 + selectedBenchmarks.length * 190}px)` }"
              >
                <thead>
                  <tr>
                    <th>{{ t('benchmarks.metric') }}</th>
                    <th
                      v-for="benchmark in selectedBenchmarks"
                      :key="benchmark.id"
                      :class="{
                        'benchmarks__matrix-column--dragging': draggedBenchmarkId === benchmark.id,
                        'benchmarks__matrix-column--drop-target':
                          dropTargetBenchmarkId === benchmark.id
                      }"
                      :style="{ '--series-color': seriesColor(benchmark) }"
                      :data-testid="`benchmark-comparison-column-title-${benchmark.id}`"
                      @dragover="dragOverComparisonColumn($event, benchmark.id)"
                      @drop="dropComparisonColumn($event, benchmark.id)"
                    >
                      <span
                        class="benchmarks__matrix-title benchmarks__matrix-title--draggable"
                        draggable="true"
                        tabindex="0"
                        :aria-label="
                          t('benchmarks.reorderComparisonColumn', {
                            workflow: benchmark.workflowName
                          })
                        "
                        aria-describedby="benchmark-reorder-instructions"
                        :title="t('benchmarks.reorderComparisonHint')"
                        @dragstart="startComparisonColumnDrag($event, benchmark.id)"
                        @dragend="endComparisonColumnDrag"
                        @keydown.alt.left.prevent="moveComparisonColumn(benchmark.id, -1)"
                        @keydown.alt.right.prevent="moveComparisonColumn(benchmark.id, 1)"
                      >
                        <GripVertical
                          class="benchmarks__column-grip"
                          :size="14"
                          aria-hidden="true"
                        />
                        <span class="benchmarks__series-dot" />
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
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="metric in metricRows" :key="metric.key">
                    <th>{{ metric.label }}</th>
                    <td
                      v-for="benchmark in selectedBenchmarks"
                      :key="benchmark.id"
                      :class="{ benchmarks__best: isBest(benchmark, metric.key) }"
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

            <div class="benchmarks__chart">
              <h3>{{ t('benchmarks.durationRange') }}</h3>
              <p>{{ t('benchmarks.durationRangeHint') }}</p>
              <div class="benchmarks__chart-rows">
                <div
                  v-for="benchmark in selectedBenchmarks"
                  :key="benchmark.id"
                  class="benchmarks__chart-row"
                  :style="{ '--series-color': seriesColor(benchmark) }"
                >
                  <div class="benchmarks__chart-label">
                    <span class="benchmarks__series-dot" />
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
                  <div class="benchmarks__chart-track">
                    <div class="benchmarks__chart-plot">
                      <span
                        class="benchmarks__chart-range"
                        :style="{
                          left: chartPosition(benchmark.fastestJobDurationSeconds),
                          width: chartWidth(benchmark)
                        }"
                      />
                      <span
                        v-if="benchmark.averageJobDurationSeconds !== null"
                        class="benchmarks__chart-average"
                        :style="{ left: chartPosition(benchmark.averageJobDurationSeconds) }"
                      />
                      <span
                        v-if="benchmark.fastestJobDurationSeconds !== null"
                        :data-testid="`benchmark-chart-${benchmark.id}-fastest-label`"
                        class="benchmarks__chart-point-label benchmarks__chart-point-label--endpoint benchmarks__chart-point-label--fastest"
                        :style="{ left: chartPosition(benchmark.fastestJobDurationSeconds) }"
                      >
                        {{ formatDuration(benchmark.fastestJobDurationSeconds) }}
                      </span>
                      <span
                        v-if="benchmark.slowestJobDurationSeconds !== null"
                        :data-testid="`benchmark-chart-${benchmark.id}-slowest-label`"
                        class="benchmarks__chart-point-label benchmarks__chart-point-label--endpoint benchmarks__chart-point-label--slowest"
                        :style="{ left: chartPosition(benchmark.slowestJobDurationSeconds) }"
                      >
                        {{ formatDuration(benchmark.slowestJobDurationSeconds) }}
                      </span>
                      <span
                        v-if="benchmark.averageJobDurationSeconds !== null"
                        :data-testid="`benchmark-chart-${benchmark.id}-average-label`"
                        class="benchmarks__chart-point-label benchmarks__chart-point-label--below benchmarks__chart-point-label--center"
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

<style scoped>
.benchmarks {
  min-width: 0;
  min-height: 0;
}

.benchmarks :deep(.brand-outer-frame),
.benchmarks :deep(.brand-inner-frame) {
  min-width: 0;
}

.benchmarks__layout {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  gap: 16px;
  overflow-x: hidden;
  overflow-y: auto;
  color: var(--neutral-100);
}

.benchmarks__account {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 2;
}

.benchmarks__card {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--chooser-surface-bg) 90%, transparent);
}

.benchmarks__card h2,
.benchmarks__chart h3 {
  margin: 0;
  color: var(--neutral-100);
  font-size: 16px;
  font-weight: 600;
}

.benchmarks__open-folder {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  white-space: nowrap;
}

.benchmarks__folder-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}

.benchmarks__refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.benchmarks__refresh:hover:not(:disabled) {
  border-color: var(--chooser-surface-border-hover);
  background: var(--chooser-surface-bg-hover);
  color: var(--neutral-100);
}

.benchmarks__refresh:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.benchmarks__refresh:disabled {
  cursor: default;
  opacity: 0.6;
}

.benchmarks__refresh-icon--busy {
  animation: benchmarks-refresh-spin 900ms linear infinite;
}

@keyframes benchmarks-refresh-spin {
  to {
    transform: rotate(360deg);
  }
}

.benchmarks__filters {
  display: grid;
  grid-template-columns: auto minmax(180px, 1.5fr) repeat(4, minmax(115px, 1fr)) auto;
  gap: 10px;
}

.benchmarks__filters > * {
  min-width: 0;
}

.benchmarks__filters :deep(.ui-input),
.benchmarks__filters :deep(.ui-select-trigger) {
  min-height: 36px;
}

.benchmarks__filters :deep(.ui-input-control) {
  padding-top: 6px;
}

.benchmarks__columns-picker {
  position: relative;
}

.benchmarks__columns-picker summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  list-style: none;
  white-space: nowrap;
  cursor: pointer;
}

.benchmarks__columns-picker summary::-webkit-details-marker {
  display: none;
}

.benchmarks__columns-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 4;
  display: grid;
  gap: 8px;
  width: max-content;
  min-width: 240px;
  max-width: 360px;
  max-height: 360px;
  padding: 12px;
  overflow-y: auto;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: var(--neutral-800);
  box-shadow: 0 12px 30px rgb(0 0 0 / 35%);
}

.benchmarks__columns-menu > strong {
  color: var(--neutral-100);
  font-size: 12px;
}

.benchmarks__columns-menu label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--neutral-200);
  font-size: 12px;
  cursor: pointer;
}

.benchmarks__columns-menu input {
  flex: 0 0 auto;
  margin: 0;
}

.benchmarks__columns-menu input:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.benchmarks__table-scroll,
.benchmarks__matrix-scroll {
  overflow: auto;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
}

.benchmarks__table-scroll {
  max-height: 260px;
  margin-top: 12px;
}

.benchmarks__table,
.benchmarks__matrix {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  text-align: left;
}

.benchmarks__table {
  min-width: 1040px;
}

.benchmarks__table th,
.benchmarks__table td,
.benchmarks__matrix th,
.benchmarks__matrix td {
  padding: 9px 12px;
  border-bottom: 1px solid var(--chooser-surface-border);
  white-space: nowrap;
}

.benchmarks__table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--neutral-800);
  color: var(--neutral-200);
  font-weight: 500;
}

.benchmarks__table th button {
  display: inline-flex;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
}

.benchmarks__table tbody tr:last-child td,
.benchmarks__matrix tbody tr:last-child > * {
  border-bottom: 0;
}

.benchmarks__row--selected td {
  background: color-mix(in srgb, var(--series-color) 10%, transparent);
}

.benchmarks__row--selected td:first-child {
  box-shadow: inset 3px 0 var(--series-color);
}

.benchmarks__strong {
  color: var(--neutral-100);
  font-weight: 600;
}

.benchmarks__session-name-editor {
  position: relative;
  display: inline-block;
  vertical-align: middle;
}

.benchmarks__session-name {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 3px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: text;
}

.benchmarks__session-name--editing {
  visibility: hidden;
}

.benchmarks__session-name-icon {
  flex: 0 0 auto;
  color: var(--text-muted);
  opacity: 0;
  transition: opacity 120ms ease;
}

.benchmarks__session-name:hover .benchmarks__session-name-icon,
.benchmarks__session-name:focus-visible .benchmarks__session-name-icon {
  opacity: 1;
}

.benchmarks__session-name:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.benchmarks__session-name-input {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  margin: 0;
  padding: 1px 2px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
}

.benchmarks__session-name-input:focus {
  border-color: var(--accent);
  outline: none;
}

.benchmarks__check-cell {
  width: 44px;
  text-align: center;
}

.benchmarks__actions-cell {
  width: 44px;
  text-align: center;
}

.benchmarks__delete-record {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.benchmarks__delete-record:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}

.benchmarks__delete-record:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.benchmarks__delete-record:disabled {
  cursor: wait;
  opacity: 0.5;
}

.benchmarks__checkbox {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.benchmarks__checkbox input {
  appearance: none;
  width: 16px;
  height: 16px;
  margin: 0;
  border: 1px solid var(--brand-surface-border-hover);
  border-radius: 4px;
  background: var(--brand-surface-bg);
  cursor: pointer;
}

.benchmarks__checkbox input:checked {
  border-color: var(--series-color, var(--accent));
  background-color: var(--series-color, var(--accent));
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='3,9 7,12 13,5'/></svg>");
}

.benchmarks__checkbox input::after {
  display: none;
}

.benchmarks__checkbox input:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.benchmarks__state,
.benchmarks__no-results {
  padding: 32px 16px;
  color: var(--text-muted);
  text-align: center;
}

.benchmarks__state--error {
  color: var(--danger);
}

.benchmarks__chart-label > span:not(.benchmarks__series-dot),
.benchmarks__matrix-title > span:not(.benchmarks__series-dot) {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.benchmarks__chart-label strong,
.benchmarks__chart-label small,
.benchmarks__matrix-title strong,
.benchmarks__matrix-title small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.benchmarks__chart-label small,
.benchmarks__matrix-title small {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 400;
}

.benchmarks__series-dot {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--series-color);
}

.benchmarks__comparison-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.benchmarks__comparison-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-bottom: 14px;
}

.benchmarks__comparison-sort {
  width: 220px;
}

.benchmarks__sort-direction {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  min-width: 36px;
  height: 36px;
  padding: 0;
}

.benchmarks__export-results {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.benchmarks__export-error {
  color: var(--danger);
  font-size: 12px;
}

.benchmarks__visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.benchmarks__chart p {
  margin: 0 0 14px;
  color: var(--text-muted);
  font-size: 11px;
}

.benchmarks__comparison-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  min-width: 0;
}

.benchmarks__matrix th:not(:first-child),
.benchmarks__matrix td {
  min-width: 190px;
  text-align: center;
}

.benchmarks__matrix thead th {
  vertical-align: top;
  background: var(--neutral-800);
}

.benchmarks__matrix thead th:first-child {
  vertical-align: bottom;
}

.benchmarks__matrix tbody th {
  color: var(--neutral-200);
  font-weight: 500;
}

.benchmarks__matrix-title {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  text-align: left;
}

.benchmarks__matrix-title--draggable {
  cursor: grab;
  user-select: none;
}

.benchmarks__matrix-title--draggable:active {
  cursor: grabbing;
}

.benchmarks__matrix-title--draggable:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--focus-ring);
  outline-offset: 3px;
}

.benchmarks__column-grip {
  flex: 0 0 auto;
  margin-left: -6px;
  color: var(--text-muted);
}

.benchmarks__matrix-column--dragging {
  opacity: 0.55;
}

.benchmarks__matrix-column--drop-target {
  box-shadow: inset 3px 0 var(--accent);
}

.benchmarks__best {
  background: color-mix(in srgb, #3ecf8e 18%, transparent);
  color: #78e7b6;
  font-weight: 600;
}

.benchmarks__chart {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: var(--neutral-800);
}

.benchmarks__chart p {
  margin: 4px 0 18px;
}

.benchmarks__chart-rows {
  display: grid;
  grid-template-columns: fit-content(40%) minmax(0, 1fr);
  column-gap: 10px;
}

.benchmarks__chart-row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  align-items: center;
  margin: 18px 0;
}

.benchmarks__chart-label {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.benchmarks__chart-track {
  position: relative;
  height: 64px;
}

.benchmarks__chart-track::before {
  content: '';
  position: absolute;
  top: 36px;
  right: 0;
  left: 0;
  height: 2px;
  background: var(--chooser-surface-border);
}

.benchmarks__chart-plot {
  position: absolute;
  inset: 0 52px;
}

.benchmarks__chart-range {
  position: absolute;
  top: 36px;
  height: 2px;
  background: var(--series-color);
}

.benchmarks__chart-range::before,
.benchmarks__chart-range::after,
.benchmarks__chart-average {
  content: '';
  position: absolute;
  top: 50%;
  width: 7px;
  height: 7px;
  border: 1px solid var(--neutral-800);
  border-radius: 50%;
  background: var(--series-color);
  transform: translate(-50%, -50%);
}

.benchmarks__chart-range::before {
  left: 0;
}

.benchmarks__chart-range::after {
  left: 100%;
}

.benchmarks__chart-average {
  top: 37px;
  width: 9px;
  height: 9px;
  background: var(--series-color);
}

.benchmarks__chart-point-label {
  position: absolute;
  z-index: 1;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 14px;
  white-space: nowrap;
}

.benchmarks__chart-point-label--below {
  top: 48px;
}

.benchmarks__chart-point-label--endpoint {
  top: 30px;
}

.benchmarks__chart-point-label--fastest {
  transform: translateX(calc(-100% - 5px));
}

.benchmarks__chart-point-label--slowest {
  transform: translateX(5px);
}

.benchmarks__chart-point-label--center {
  transform: translateX(-50%);
}

@media (max-width: 1100px) {
  .benchmarks__filters {
    grid-template-columns: auto repeat(4, minmax(0, 1fr));
  }

  .benchmarks__search {
    grid-column: 2 / -1;
  }
}

@media (max-width: 800px) {
  .benchmarks__account {
    display: none;
  }

  .benchmarks__filters {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .benchmarks__search {
    grid-column: 2;
  }
}
</style>
