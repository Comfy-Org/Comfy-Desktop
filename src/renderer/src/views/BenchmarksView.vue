<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import { computed, onActivated, onMounted, ref } from 'vue'
import {
  Check,
  ChartColumn,
  ChevronDown,
  FolderOpen,
  ImageDown,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X
} from '@lucide/vue'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItemIndicator,
  DropdownMenuLabel,
  DropdownMenuRadioGroup
} from 'reka-ui'
import { useI18n } from 'vue-i18n'
import type { PerformanceTestBenchmark, PerformanceTestResultValue } from '../types/ipc'
import BrandBackground from '../components/BrandBackground.vue'
import BrandedPageHeader from '../components/BrandedPageHeader.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import BaseMenuRadioItem from '../components/ui/BaseMenuRadioItem.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import {
  createBenchmarkComparisonSvg,
  MAX_BENCHMARK_COMPARISON_EXPORT_RUNS
} from '../lib/benchmarkComparisonSvg'
import {
  buildBenchmarkTable,
  DURATION_KEYS,
  DURATION_LABEL_KEYS,
  formatSeconds,
  isDurationKey,
  machineKey,
  machineLabels,
  type ColumnSort,
  type DurationKey
} from '../lib/benchmarkTable'
import { createResultsPng } from '../lib/performanceTestResultsSvg'
import { useDialogs } from '../composables/useDialogs'
import BenchmarkTable from './benchmarks/BenchmarkTable.vue'
import { SECTION_TITLE_CLASS } from '../lib/sectionTitle'

interface MenuOption {
  value: string
  label: string
}

const SERIES_COLORS = ['#e8e8ee', '#7aa2f7', '#9ece6a', '#bb9af7', '#7dcfff']
const UNMANAGED_WORKSPACE = '__unmanaged__'
const IDENTITY_COLUMN_KEYS = ['workflowName', 'id', 'hardware.deviceName']
const RANGE_COLUMN_KEY = 'range'
const VS_BASELINE_COLUMN_KEY = 'vsBaseline'
const MEASURE_PICKER_ORDER: readonly DurationKey[] = [
  'fastestJobDurationSeconds',
  'slowestJobDurationSeconds',
  'averageJobDurationSeconds',
  'medianJobDurationSeconds'
]
const COLUMN_PICKER_ORDER = [
  'instance.name',
  'workspace.name',
  'createdAt',
  'measuredJobCount',
  ...DURATION_KEYS,
  'hardware.deviceName'
]

const { t } = useI18n()
const dialogs = useDialogs()
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
})

const benchmarks = ref<PerformanceTestBenchmark[]>([])
const benchmarksFolderPath = ref('')
const loading = ref(true)
const loadError = ref(false)
const searchQuery = ref('')
const workspaceFilter = ref('')
const buildFilter = ref('')
const machineFilter = ref('')
const workflowFilter = ref('')
const metric = ref<DurationKey>('medianJobDurationSeconds')
const columnSort = ref<ColumnSort>({ key: 'medianJobDurationSeconds', ascending: true })
const manualOrder = ref<string[] | null>(null)
const baselineId = ref<string | null>(null)
const selectedIds = ref<ReadonlySet<string>>(new Set())
const visibleColumnKeys = ref<ReadonlySet<string>>(
  new Set(['instance.name', 'workflowName', RANGE_COLUMN_KEY])
)
const columnOrder = ref<string[]>([])
const deletingIds = ref<ReadonlySet<string>>(new Set())
const isExporting = ref(false)
const exportError = ref<string | null>(null)

function workspaceName(benchmark: PerformanceTestBenchmark): string {
  return benchmark.workspace.name ?? t('benchmarks.unmanagedWorkspace')
}

const machineNames = computed(() =>
  machineLabels(benchmarks.value, {
    unknownHardware: t('benchmarks.unknownHardware'),
    memory: (gigabytes) => t('benchmarks.memory', { gigabytes })
  })
)

function machineName(benchmark: PerformanceTestBenchmark): string {
  return machineNames.value.get(machineKey(benchmark)) ?? t('benchmarks.unknownHardware')
}

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
    new Map(
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
          'hardware.deviceName': machineName(benchmark),
          fastestJobDurationSeconds: benchmark.fastestJobDurationSeconds,
          averageJobDurationSeconds: benchmark.averageJobDurationSeconds,
          medianJobDurationSeconds: benchmark.medianJobDurationSeconds,
          slowestJobDurationSeconds: benchmark.slowestJobDurationSeconds
        } as Record<string, PerformanceTestResultValue>
      ])
    )
)

function fieldValue(
  benchmark: PerformanceTestBenchmark,
  key: string
): PerformanceTestResultValue | undefined {
  return benchmarkFields.value.get(benchmark.id)?.[key]
}

function columnLabel(key: string): string {
  const labels: Record<string, string> = {
    id: t('benchmarks.session'),
    createdAt: t('benchmarks.dateTime'),
    workflowName: t('benchmarks.workflow'),
    'instance.name': t('benchmarks.instance'),
    'workspace.name': t('benchmarks.workspace'),
    measuredJobCount: t('benchmarks.runs'),
    'hardware.deviceName': t('benchmarks.hardware'),
    [RANGE_COLUMN_KEY]: t('benchmarks.metricAndRange', {
      metric: t(DURATION_LABEL_KEYS[metric.value])
    }),
    [VS_BASELINE_COLUMN_KEY]: t('benchmarks.vsBaseline')
  }
  if (isDurationKey(key)) return t(DURATION_LABEL_KEYS[key])
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

function formatDate(value: string | null): string {
  return value === null ? '—' : dateFormatter.format(new Date(value))
}

function formatColumnValue(benchmark: PerformanceTestBenchmark, key: string): string {
  const value = fieldValue(benchmark, key)
  if (value === undefined || value === null) return '—'
  if (key === 'createdAt' && typeof value === 'string') return formatDate(value)
  if (key.endsWith('DurationSeconds') && typeof value === 'number') return formatSeconds(value)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const availableColumnKeys = computed(() => {
  const keys = new Set<string>()
  for (const fields of benchmarkFields.value.values()) {
    for (const key of Object.keys(fields)) keys.add(key)
  }
  keys.delete('workflowName')
  keys.delete('id')
  const ordered = COLUMN_PICKER_ORDER.filter((key) => keys.delete(key))
  return [...ordered, ...[...keys].sort((a, b) => a.localeCompare(b))]
})
const buildColumnVisible = computed(() => visibleColumnKeys.value.has('instance.name'))
const workflowColumnVisible = computed(() => visibleColumnKeys.value.has('workflowName'))
const rangeColumnVisible = computed(() => visibleColumnKeys.value.has(RANGE_COLUMN_KEY))
const columnPickerRows = computed(() => {
  const optional = availableColumnKeys.value.filter((key) => key !== 'instance.name')
  const keys = [
    'id',
    'workflowName',
    ...(availableColumnKeys.value.includes('instance.name') ? ['instance.name'] : []),
    RANGE_COLUMN_KEY,
    ...optional,
    VS_BASELINE_COLUMN_KEY
  ]
  const alwaysShown = new Set(['id', metric.value, VS_BASELINE_COLUMN_KEY])
  const toRow = (key: string) => ({
    key,
    label: columnLabel(key),
    locked: alwaysShown.has(key),
    visible: alwaysShown.has(key) || visibleColumnKeys.value.has(key)
  })
  return {
    measures: MEASURE_PICKER_ORDER.filter((key) => keys.includes(key)).map(toRow),
    columns: keys
      .filter((key) => !isDurationKey(key))
      .map(toRow)
      .sort((a, b) => a.label.localeCompare(b.label))
  }
})
const extraColumns = computed(() => {
  const position = new Map(columnOrder.value.map((key, index) => [key, index]))
  return availableColumnKeys.value
    .filter(
      (key) => key !== 'instance.name' && key !== metric.value && visibleColumnKeys.value.has(key)
    )
    .sort(
      (a, b) =>
        (position.get(a) ?? Number.MAX_SAFE_INTEGER) - (position.get(b) ?? Number.MAX_SAFE_INTEGER)
    )
    .map((key) => ({ key, label: columnLabel(key) }))
})
const exportColumns = computed(() =>
  [
    ...IDENTITY_COLUMN_KEYS,
    ...availableColumnKeys.value.filter(
      (key) => visibleColumnKeys.value.has(key) && !IDENTITY_COLUMN_KEYS.includes(key)
    )
  ].map((key) => ({ key, label: columnLabel(key) }))
)

function setColumnVisible(key: string, visible: boolean): void {
  const next = new Set(visibleColumnKeys.value)
  if (visible) next.add(key)
  else next.delete(key)
  visibleColumnKeys.value = next
}

function entityOptions(entries: MenuOption[]): MenuOption[] {
  const unique = [...new Map(entries.map((entry) => [entry.value, entry])).values()]
  const labelCounts = new Map<string, number>()
  for (const entry of unique) labelCounts.set(entry.label, (labelCounts.get(entry.label) ?? 0) + 1)
  return [
    { value: '', label: t('benchmarks.filterAll') },
    ...unique
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((entry) => ({
        value: entry.value,
        label: labelCounts.get(entry.label) === 1 ? entry.label : `${entry.label} (${entry.value})`
      }))
  ]
}

const toolbarMenus = computed(() => [
  {
    key: 'workspace',
    label: t('benchmarks.filterWorkspace'),
    value: workspaceFilter.value,
    set: (value: string) => (workspaceFilter.value = value),
    options: entityOptions(
      benchmarks.value.map((benchmark) => ({
        value: benchmark.workspace.id ?? UNMANAGED_WORKSPACE,
        label: workspaceName(benchmark)
      }))
    )
  },
  {
    key: 'build',
    label: t('benchmarks.filterBuild'),
    value: buildFilter.value,
    set: (value: string) => (buildFilter.value = value),
    options: entityOptions(
      benchmarks.value.map(({ instance }) => ({ value: instance.id, label: instance.name }))
    )
  },
  {
    key: 'hardware',
    label: t('benchmarks.filterHardware'),
    value: machineFilter.value,
    set: (value: string) => (machineFilter.value = value),
    options: entityOptions(
      benchmarks.value.map((benchmark) => ({
        value: machineKey(benchmark),
        label: machineName(benchmark)
      }))
    )
  },
  {
    key: 'workflow',
    label: t('benchmarks.filterWorkflow'),
    value: workflowFilter.value,
    set: (value: string) => (workflowFilter.value = value),
    options: entityOptions(
      benchmarks.value.map(({ workflowName }) => ({ value: workflowName, label: workflowName }))
    )
  },
  {
    key: 'compare-by',
    label: t('benchmarks.compareBy'),
    value: metric.value,
    set: setMetric,
    options: DURATION_KEYS.map((key) => ({ value: key, label: t(DURATION_LABEL_KEYS[key]) }))
  }
])

const VIEW_MENU_KEYS = new Set(['compare-by'])

const toolbarMenuGroups = computed(() => [
  {
    key: 'filters',
    class: 'benchmarks__filters @max-[68rem]/toolbar:basis-full',
    menus: toolbarMenus.value.filter((menu) => !VIEW_MENU_KEYS.has(menu.key))
  },
  {
    key: 'view',
    class: 'benchmarks__view-options',
    menus: toolbarMenus.value.filter((menu) => VIEW_MENU_KEYS.has(menu.key))
  }
])

function currentOptionLabel(menu: { value: string; options: MenuOption[] }): string {
  return menu.options.find((option) => option.value === menu.value)?.label ?? ''
}

function isVisible(benchmark: PerformanceTestBenchmark): boolean {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  const matchesSearch =
    !query ||
    [
      benchmark.id,
      benchmark.workflowName,
      benchmark.instance.name,
      workspaceName(benchmark),
      machineName(benchmark)
    ].some((value) => value.toLocaleLowerCase().includes(query))
  return (
    matchesSearch &&
    (!workspaceFilter.value ||
      (benchmark.workspace.id ?? UNMANAGED_WORKSPACE) === workspaceFilter.value) &&
    (!buildFilter.value || benchmark.instance.id === buildFilter.value) &&
    (!machineFilter.value || machineKey(benchmark) === machineFilter.value) &&
    (!workflowFilter.value || benchmark.workflowName === workflowFilter.value)
  )
}

const table = computed(() =>
  buildBenchmarkTable({
    benchmarks: benchmarks.value,
    isVisible,
    metric: metric.value,
    sort: columnSort.value,
    valueOf: fieldValue,
    manualOrder: manualOrder.value,
    baselineId: baselineId.value
  })
)
const selectedRuns = computed(() =>
  (table.value?.rows ?? []).filter(({ id }) => selectedIds.value.has(id))
)
const selectionOverLimit = computed(
  () => selectedRuns.value.length > MAX_BENCHMARK_COMPARISON_EXPORT_RUNS
)

function setMetric(value: string): void {
  if (!isDurationKey(value)) return
  if (columnSort.value.key === metric.value) columnSort.value = { ...columnSort.value, key: value }
  metric.value = value
}

function sortBy(key: string): void {
  const current = columnSort.value
  columnSort.value =
    current.key === key && manualOrder.value === null
      ? { key, ascending: !current.ascending }
      : { key, ascending: isDurationKey(key) }
  manualOrder.value = null
}

function toggleSelected(id: string): void {
  const next = new Set(selectedIds.value)
  if (!next.delete(id)) next.add(id)
  selectedIds.value = next
}

function clearFilters(): void {
  searchQuery.value = ''
  workspaceFilter.value = ''
  buildFilter.value = ''
  machineFilter.value = ''
  workflowFilter.value = ''
}

function clearSelection(): void {
  selectedIds.value = new Set()
  exportError.value = null
}

function isBestAmong(
  runs: PerformanceTestBenchmark[],
  benchmark: PerformanceTestBenchmark,
  key: DurationKey
) {
  const value = benchmark[key]
  const values = runs.flatMap((run) => (run[key] === null ? [] : [run[key]]))
  return value !== null && values.length > 1 && value === Math.min(...values)
}

async function exportRuns(runs: PerformanceTestBenchmark[]): Promise<void> {
  if (runs.length === 0 || runs.length > MAX_BENCHMARK_COMPARISON_EXPORT_RUNS) return
  const relativeTable = table.value?.customBaseline ? table.value : null
  isExporting.value = true
  exportError.value = null
  try {
    const svg = createBenchmarkComparisonSvg({
      title: t('benchmarks.comparisonImageTitle'),
      metricTitle: t('benchmarks.metric'),
      durationRangeTitle: t('benchmarks.durationRange'),
      durationRangeHint: t('benchmarks.durationRangeHint'),
      relativeSpeed: relativeTable
        ? {
            title: t('benchmarks.relativePerformance'),
            hint: t('benchmarks.relativePerformanceHint'),
            slowerLabel: t('benchmarks.slower'),
            fasterLabel: t('benchmarks.faster')
          }
        : undefined,
      exportDateTime: dateFormatter.format(new Date()),
      runs: runs.map((benchmark, index) => {
        const comparison = relativeTable?.comparisons.get(benchmark.id)
        return {
          color: SERIES_COLORS[index % SERIES_COLORS.length]!,
          properties: exportColumns.value.map((column) => ({
            label: column.label,
            value: formatColumnValue(benchmark, column.key)
          })),
          metrics: [
            ...DURATION_KEYS.map((key) => ({
              label: t(DURATION_LABEL_KEYS[key]),
              value: formatSeconds(benchmark[key]),
              highlighted: isBestAmong(runs, benchmark, key)
            })),
            {
              label: t('benchmarks.measuredRuns'),
              value: String(benchmark.measuredJobCount),
              highlighted: false
            }
          ],
          fastestDurationSeconds: benchmark.fastestJobDurationSeconds,
          averageDurationSeconds: benchmark.averageJobDurationSeconds,
          slowestDurationSeconds: benchmark.slowestJobDurationSeconds,
          relativeSpeed: comparison
            ? {
                durationSeconds: benchmark[metric.value],
                factor: comparison.factor,
                kind: comparison.kind,
                status: t(`benchmarks.${comparison.kind}`)
              }
            : undefined
        }
      })
    })
    const exported = await window.api.exportResultsImage(
      await createResultsPng(svg),
      'benchmark-comparison',
      benchmarksFolderPath.value || undefined
    )
    if (!exported.ok && !exported.canceled) {
      exportError.value = exported.message || t('benchmarks.exportImageFailed')
    }
  } catch (error) {
    exportError.value = (error as Error)?.message || t('benchmarks.exportImageFailed')
  } finally {
    isExporting.value = false
  }
}

function applyBenchmarks(list: PerformanceTestBenchmark[]): void {
  benchmarks.value = list
  const ids = new Set(list.map(({ id }) => id))
  selectedIds.value = new Set([...selectedIds.value].filter((id) => ids.has(id)))
}

function resetViewState(): void {
  selectedIds.value = new Set()
  baselineId.value = null
  manualOrder.value = null
}

async function loadBenchmarks(folderPath?: string): Promise<void> {
  loading.value = true
  loadError.value = false
  exportError.value = null
  try {
    const result = await window.api.listPerformanceTestBenchmarks(folderPath)
    if (result.folderPath !== benchmarksFolderPath.value) resetViewState()
    benchmarksFolderPath.value = result.folderPath
    applyBenchmarks(result.benchmarks)
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
    if (benchmarksFolderPath.value === folderPath) applyBenchmarks(result.benchmarks)
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

function replaceSessionId(oldId: string, newId: string): void {
  const swap = (id: string): string => (id === oldId ? newId : id)
  benchmarks.value = benchmarks.value.map((benchmark) =>
    benchmark.id === oldId ? { ...benchmark, id: newId } : benchmark
  )
  selectedIds.value = new Set([...selectedIds.value].map(swap))
  if (baselineId.value !== null) baselineId.value = swap(baselineId.value)
  manualOrder.value = manualOrder.value?.map(swap) ?? null
}

async function showRenameError(message?: string): Promise<void> {
  await dialogs.alert({
    title: t('benchmarks.renameErrorTitle'),
    message: message || t('benchmarks.renameErrorMessage'),
    tone: 'danger'
  })
}

async function renameSession(benchmark: PerformanceTestBenchmark, name: string): Promise<boolean> {
  try {
    const result = await window.api.renamePerformanceTestBenchmark(
      benchmarksFolderPath.value,
      benchmark.id,
      name
    )
    if (!result.ok) {
      await showRenameError(result.message)
      return false
    }
    replaceSessionId(benchmark.id, result.sessionId ?? name)
    return true
  } catch (error) {
    await showRenameError((error as Error)?.message)
    return false
  }
}

async function showDeleteError(message?: string): Promise<void> {
  await dialogs.alert({
    title: t('benchmarks.deleteErrorTitle'),
    message: message || t('benchmarks.deleteErrorMessage'),
    tone: 'danger'
  })
}

async function deleteSession(benchmark: PerformanceTestBenchmark): Promise<void> {
  const confirmed = await dialogs.confirm({
    title: t('benchmarks.deleteConfirmTitle', { workflow: benchmark.workflowName }),
    message: t('benchmarks.deleteConfirmMessage', { session: benchmark.id }),
    confirmLabel: t('benchmarks.deleteFiles'),
    tone: 'danger'
  })
  if (confirmed !== 'primary') return

  deletingIds.value = new Set([...deletingIds.value, benchmark.id])
  try {
    const result = await window.api.deletePerformanceTestBenchmark(
      benchmarksFolderPath.value,
      benchmark.id
    )
    if (!result.ok) {
      await showDeleteError(result.message)
      return
    }
    applyBenchmarks(benchmarks.value.filter(({ id }) => id !== benchmark.id))
  } catch (error) {
    await showDeleteError((error as Error)?.message)
  } finally {
    deletingIds.value = new Set([...deletingIds.value].filter((id) => id !== benchmark.id))
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
    class="benchmarks min-h-0 min-w-0 [&_.brand-inner-frame]:min-w-0 [&_.brand-inner-frame]:p-0 [&_.brand-outer-frame]:min-w-0"
    data-testid="benchmarks"
  >
    <div
      class="benchmarks__layout @container relative flex h-full min-h-0 w-full flex-col overflow-x-hidden overflow-y-auto text-foreground"
    >
      <div class="mx-auto flex w-full max-w-300 flex-col gap-5 px-10 pt-9 pb-8">
        <BrandedPageHeader :title="t('benchmarks.title')" actions-inline>
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

        <div v-if="loading || benchmarks.length > 0" class="benchmarks__toolbar @container/toolbar">
          <div class="flex items-center gap-2 @max-[68rem]/toolbar:flex-wrap">
            <div
              v-for="group in toolbarMenuGroups"
              :key="group.key"
              class="flex min-w-0 items-center gap-2 @max-[36rem]/toolbar:grid @max-[36rem]/toolbar:basis-full @max-[36rem]/toolbar:grid-cols-2"
              :class="group.class"
            >
              <Menu
                v-for="menu in group.menus"
                :key="menu.key"
                :modal="false"
                align="start"
                class="z-20 min-w-[180px]"
              >
                <template #trigger>
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    class="benchmarks__filter max-w-64 min-w-0 gap-1.5 px-3 text-[13px]/5 @max-[36rem]/toolbar:max-w-none"
                    :aria-label="`${menu.label}: ${currentOptionLabel(menu)}`"
                    :data-testid="`benchmarks-filter-${menu.key}`"
                  >
                    <span class="shrink-0 text-subtle-foreground">{{ menu.label }}</span>
                    <span class="truncate">{{ currentOptionLabel(menu) }}</span>
                    <ChevronDown :size="14" class="ml-auto shrink-0" aria-hidden="true" />
                  </Button>
                </template>
                <DropdownMenuRadioGroup :model-value="menu.value">
                  <BaseMenuRadioItem
                    v-for="option in menu.options"
                    :key="option.value"
                    :value="option.value"
                    :data-value="option.value"
                    @select="menu.set(option.value)"
                  >
                    <span class="flex-1 text-left">{{ option.label }}</span>
                  </BaseMenuRadioItem>
                </DropdownMenuRadioGroup>
              </Menu>
            </div>
            <div
              class="benchmarks__tools ml-auto flex shrink-0 items-center gap-2 @max-[36rem]/toolbar:order-first @max-[36rem]/toolbar:basis-full"
            >
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
                  :class="{ 'animate-spin [animation-duration:900ms]': loading }"
                  aria-hidden="true"
                />
              </Button>
              <BaseInput
                v-model="searchQuery"
                class="benchmarks__search h-8 w-40 @max-[36rem]/toolbar:w-auto @max-[36rem]/toolbar:flex-1 [&_input]:text-[13px]"
                :placeholder="t('benchmarks.searchPlaceholder')"
                :aria-label="t('benchmarks.searchPlaceholder')"
                :spellcheck="false"
              >
                <template #leading><Search :size="14" aria-hidden="true" /></template>
              </BaseInput>
              <Menu :modal="false" align="end" class="z-20 max-h-90 min-w-56">
                <template #trigger>
                  <Button
                    variant="muted-textonly"
                    size="icon"
                    type="button"
                    class="benchmarks__columns data-[state=open]:bg-accent data-[state=open]:text-foreground"
                    :aria-label="t('benchmarks.columns')"
                    :title="t('benchmarks.columns')"
                    data-testid="benchmarks-columns"
                  >
                    <SlidersHorizontal :size="15" aria-hidden="true" />
                  </Button>
                </template>
                <template
                  v-for="(section, index) in [
                    {
                      class: 'benchmarks__columns-measures',
                      title: t('benchmarks.measures'),
                      rows: columnPickerRows.measures
                    },
                    {
                      class: 'benchmarks__columns-title',
                      title: t('benchmarks.columnsToDisplay'),
                      rows: columnPickerRows.columns
                    }
                  ]"
                  :key="section.class"
                >
                  <MenuSeparator v-if="index > 0" />
                  <DropdownMenuLabel
                    class="px-3 pt-1.5 pb-1"
                    :class="[section.class, SECTION_TITLE_CLASS]"
                  >
                    {{ section.title }}
                  </DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    v-for="row in section.rows"
                    :key="row.key"
                    :model-value="row.visible"
                    :disabled="row.locked"
                    class="flex min-h-8 cursor-default items-center gap-2 rounded-md px-3 py-1.5 text-sm outline-none data-disabled:text-muted-foreground data-highlighted:bg-accent"
                    :data-testid="`benchmark-column-${row.key}`"
                    @update:model-value="(visible) => setColumnVisible(row.key, visible === true)"
                    @select="(event) => event.preventDefault()"
                  >
                    <span class="flex-1 truncate text-left">{{ row.label }}</span>
                    <DropdownMenuItemIndicator>
                      <Check :size="15" aria-hidden="true" />
                    </DropdownMenuItemIndicator>
                  </DropdownMenuCheckboxItem>
                </template>
              </Menu>
            </div>
          </div>
        </div>

        <span id="benchmark-reorder-instructions" class="sr-only">
          {{ t('benchmarks.reorderComparisonHint') }}
        </span>
        <span id="benchmark-column-reorder-instructions" class="sr-only">
          {{ t('benchmarks.reorderColumnHint') }}
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
        <EmptyState
          v-else-if="benchmarks.length === 0"
          class="benchmarks__state benchmarks__state--empty px-6 py-16"
          :icon="ChartColumn"
          :title="t('benchmarks.emptyTitle')"
          :text="t('benchmarks.emptyHint')"
        >
          <div class="flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              class="benchmarks__empty-refresh gap-1.5 px-4 text-[13px]/5"
              type="button"
              data-testid="benchmarks-empty-refresh"
              @click="refreshBenchmarks"
            >
              <RefreshCw :size="14" aria-hidden="true" />
              {{ t('benchmarks.refresh') }}
            </Button>
            <Button
              variant="inverted"
              size="md"
              class="benchmarks__open-performance-test px-4 text-[13px]/5"
              type="button"
              @click="openPerformanceTest"
            >
              {{ t('benchmarks.openPerformanceTest') }}
            </Button>
          </div>
        </EmptyState>
        <EmptyState
          v-else-if="!table"
          class="benchmarks__no-results px-6 py-16"
          :icon="ChartColumn"
          :title="t('common.nothingMatches')"
          :text="t('common.nothingMatchesHint')"
        >
          <Button
            variant="secondary"
            size="md"
            class="benchmarks__clear-filters px-3 text-[13px]/5"
            type="button"
            data-testid="benchmarks-clear-filters"
            @click="clearFilters"
          >
            {{ t('common.clearFilters') }}
          </Button>
        </EmptyState>
        <BenchmarkTable
          v-else
          :table="table"
          :metric="metric"
          :sort="columnSort"
          :build-column="buildColumnVisible"
          :workflow-column="workflowColumnVisible"
          :range-column="rangeColumnVisible"
          :extra-columns="extraColumns"
          :selected-ids="selectedIds"
          :deleting-ids="deletingIds"
          :format-date="formatDate"
          :format-column-value="formatColumnValue"
          :rename-session="renameSession"
          @sort="sortBy"
          @toggle-selected="toggleSelected"
          @baseline="(id) => (baselineId = id)"
          @reorder="(order) => (manualOrder = order)"
          @reorder-columns="(keys) => (columnOrder = keys)"
          @delete="deleteSession"
        />

        <div
          v-if="selectedRuns.length > 0 || exportError"
          class="benchmarks__selection-bar sticky bottom-6 z-30 flex w-max max-w-full items-center gap-2 self-center rounded-xl bg-neutral-100 py-1.5 pr-1.5 pl-3.5 text-[13px] text-neutral-900 shadow-[var(--shadow-popover)]"
          role="region"
          :aria-label="t('benchmarks.selection')"
        >
          <span v-if="selectedRuns.length > 0" class="benchmarks__selected-count">
            {{ t('benchmarks.selectedCount', { count: selectedRuns.length }) }}
          </span>
          <span v-if="exportError" class="benchmarks__export-error text-xs text-red-600">
            {{ exportError }}
          </span>
          <Tooltip
            :text="t('benchmarks.exportLimit', { max: MAX_BENCHMARK_COMPARISON_EXPORT_RUNS })"
            :disabled="!selectionOverLimit"
          >
            <Button
              variant="secondary"
              size="md"
              class="benchmarks__export-results bg-neutral-900/[0.07] text-[13px] text-neutral-900 hover:bg-neutral-900/[0.12]"
              type="button"
              :disabled="isExporting || selectedRuns.length === 0 || selectionOverLimit"
              @click="exportRuns(selectedRuns)"
            >
              <ImageDown :size="15" aria-hidden="true" />
              {{
                isExporting ? t('benchmarks.exportingImage') : t('benchmarks.exportResultsImage')
              }}
            </Button>
          </Tooltip>
          <Button
            variant="muted-textonly"
            size="icon"
            class="benchmarks__clear-selection size-7 text-neutral-600 hover:bg-neutral-900/[0.07] hover:text-neutral-900"
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
