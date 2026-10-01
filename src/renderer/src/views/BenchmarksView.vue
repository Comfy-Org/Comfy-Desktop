<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ArrowRight,
  Download,
  Flag,
  FolderOpen,
  MoreHorizontal,
  RefreshCw,
  Search,
  SlidersHorizontal
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type {
  CoreBenchmarkSummary,
  PerformanceTestBenchmark,
  PerformanceTestResultValue
} from '../types/ipc'
import BrandBackground from '../components/BrandBackground.vue'
import BrandedPageHeader from '../components/BrandedPageHeader.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import BaseSelect, { type BaseSelectOption } from '../components/ui/BaseSelect.vue'
import { buildBenchmarkCsv, buildBenchmarkJson } from '../lib/benchmarkExport'
import { secPerImageOf } from '../lib/benchmarkMetrics'
import { exportBaseName, seriesColors } from '../lib/benchmarkShared'
import { useBenchmarkNavStore } from '../stores/benchmarkNavStore'
import { useDialogs } from '../composables/useDialogs'
import DevPlatformAccountChip from './devplatform/DevPlatformAccountChip.vue'

/** Factual abnormal-state flags (design §3.1 hard rule). The ONLY non-neutral marks in History. */
type FlagKind = 'offloaded' | 'throttled'

/** A rendered metric cell: a value + an optional muted qualifier sub-line, and an
 *  optional factual flag. `muted` renders the whole cell as not-measured (`—`). */
interface MetricCell {
  text: string
  qualifier?: string | null
  flag?: FlagKind | null
  muted?: boolean
  tooltip?: string | null
}

/** Which metric a sortable header toggles. */
type SortCol = 'spi' | 'its' | 'vram' | 'energy' | 'date' | 'wf'

/** The sort ids exposed in the Sort menu (design §3.3). Header clicks only ever
 *  cycle within the directions a column exposes here, so the Sort select stays in sync. */
type SortId =
  | 'date-desc'
  | 'date-asc'
  | 'spi-asc'
  | 'spi-desc'
  | 'its-desc'
  | 'vram-asc'
  | 'vram-desc'
  | 'energy-asc'
  | 'wf-asc'

interface HistoryColumn {
  id: string
  labelKey: string
  /** Always visible, cannot be toggled off (workflow is special-cased; date lives here). */
  always?: boolean
  defaultVisible: boolean
  /** The metric a header click sorts by + the directions it cycles through. */
  sortCol?: SortCol
  cell: (run: PerformanceTestBenchmark) => MetricCell
}

const { t } = useI18n()
const dialogs = useDialogs()
const benchmarkNav = useBenchmarkNavStore()

const benchmarks = ref<PerformanceTestBenchmark[]>([])
const selectedOrderIds = ref<string[]>([])
const selectedIds = computed(() => new Set(selectedOrderIds.value))
const benchmarksFolderPath = ref('')
const loading = ref(true)
const loadError = ref(false)
const deletingIds = ref<Set<string>>(new Set())
const editingSessionId = ref<string | null>(null)
const renamingSessionId = ref<string | null>(null)
const sessionNameDraft = ref('')
const sessionNameInput = ref<HTMLInputElement | null>(null)
const exportError = ref<string | null>(null)

const searchQuery = ref('')
const workspaceFilter = ref('')
const instanceFilter = ref('')
const hardwareFilter = ref('')
const workflowFilter = ref('')
const sortId = ref<SortId>('date-desc')

const UNMANAGED_WORKSPACE_FILTER = '__unmanaged__'
const COMPARE_CAP = 5

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

// --- outside-click: close any open <details> menu (columns, export, row ⋯) ---
function closeMenusOnOutsideClick(event: PointerEvent): void {
  const target = event.target
  if (!(target instanceof Node)) return
  for (const element of document.querySelectorAll<HTMLDetailsElement>(
    'details.benchmarks__menu[open]'
  )) {
    if (!element.contains(target)) element.open = false
  }
}
document.addEventListener('pointerdown', closeMenusOnOutsideClick, true)
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeMenusOnOutsideClick, true))

function closeAllMenus(): void {
  for (const element of document.querySelectorAll<HTMLDetailsElement>(
    'details.benchmarks__menu[open]'
  )) {
    element.open = false
  }
}

// --- defensive numeric reads off the raw result payload ---
function resultNumber(
  result: Record<string, PerformanceTestResultValue>,
  key: string
): number | null {
  const value = result[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// --- metric accessors (all read the typed coreBenchmark; null => not measured) ---
function core(run: PerformanceTestBenchmark): CoreBenchmarkSummary | null {
  return run.coreBenchmark ?? null
}

function needsCapture(run: PerformanceTestBenchmark): boolean {
  return core(run) == null
}

function itPerS(run: PerformanceTestBenchmark): number | null {
  return isFiniteNumber(run.steadyStateItPerS) ? run.steadyStateItPerS : null
}

function vramPeakMb(run: PerformanceTestBenchmark): number | null {
  const value = core(run)?.resources?.peak?.vramUsedMb
  return isFiniteNumber(value) ? value : null
}

function vramTotalMb(run: PerformanceTestBenchmark): number | null {
  const value = core(run)?.device?.totalVramMb
  return isFiniteNumber(value) ? value : null
}

function energyPerImage(run: PerformanceTestBenchmark): number | null {
  const value = core(run)?.summary?.energyWhPerImage
  return isFiniteNumber(value) ? value : null
}

function isOffloaded(run: PerformanceTestBenchmark): boolean {
  return core(run)?.device?.offloaded === true
}

function isThrottled(run: PerformanceTestBenchmark): boolean {
  const peak = core(run)?.resources?.peak?.throttled
  const summary = core(run)?.summary?.throttled
  return peak === true || summary === true
}

function gpuModel(run: PerformanceTestBenchmark): string {
  return core(run)?.device?.gpuModel ?? run.hardwareName ?? t('benchmarks.unknownHardware')
}

function gpuCapacity(run: PerformanceTestBenchmark): string | null {
  const total = vramTotalMb(run)
  if (total != null) return `${Math.round(total / 1024)} GB`
  return null
}

function createdAtMs(run: PerformanceTestBenchmark): number | null {
  if (!run.createdAt) return null
  const ms = Date.parse(run.createdAt)
  return Number.isFinite(ms) ? ms : null
}

// --- formatting ---
function fmt(value: number, decimals: number): string {
  return value.toFixed(decimals)
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? dateFormatter.format(new Date(ms)) : '—'
}

const notMeasuredCell: MetricCell = { text: '—', muted: true }

function metricOrDash(
  run: PerformanceTestBenchmark,
  value: number | null,
  render: (value: number) => MetricCell
): MetricCell {
  if (value == null) {
    return { text: '—', muted: true, tooltip: needsCapture(run) ? needsCaptureTooltip.value : null }
  }
  return render(value)
}

const needsCaptureTooltip = computed(() => t('benchmarks.needsCaptureTooltip'))

// --- workspace / hardware helpers (unchanged plumbing) ---
function workspaceName(benchmark: PerformanceTestBenchmark): string {
  return benchmark.workspace.name ?? t('benchmarks.unmanagedWorkspace')
}

function uniqueOptions(allLabel: string, values: Array<string | null>): BaseSelectOption[] {
  return [
    { value: '', label: allLabel },
    ...[...new Set(values.filter((value): value is string => Boolean(value)))]
      .sort()
      .map((value) => ({ value, label: value }))
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
    benchmarks.value.map((benchmark) => gpuModel(benchmark))
  )
)
const workflowOptions = computed(() =>
  uniqueOptions(
    t('benchmarks.allWorkflows'),
    benchmarks.value.map((benchmark) => benchmark.workflowName)
  )
)

// --- curated columns (design §3.2) ---
const columns: HistoryColumn[] = [
  {
    id: 'secPerImage',
    labelKey: 'benchmarks.colSecPerImage',
    defaultVisible: true,
    sortCol: 'spi',
    cell: (run) =>
      metricOrDash(run, secPerImageOf(run), (value) => ({ text: `${fmt(value, 2)} s` }))
  },
  {
    id: 'itPerS',
    labelKey: 'benchmarks.colItPerS',
    defaultVisible: true,
    sortCol: 'its',
    cell: (run) =>
      metricOrDash(run, itPerS(run), (value) => ({
        text: fmt(value, value < 10 ? 2 : 1),
        flag: isThrottled(run) ? 'throttled' : null
      }))
  },
  {
    id: 'vramPeak',
    labelKey: 'benchmarks.colVramPeak',
    defaultVisible: true,
    sortCol: 'vram',
    cell: (run) =>
      metricOrDash(run, vramPeakMb(run), (value) => {
        const gb = value / 1024
        const total = vramTotalMb(run)
        const qualifier =
          total != null
            ? t('benchmarks.capacity', {
                percent: Math.round((value / total) * 100),
                total: `${Math.round(total / 1024)} GB`
              })
            : (gpuCapacity(run) ?? null)
        return { text: `${fmt(gb, 1)} GB`, qualifier, flag: isOffloaded(run) ? 'offloaded' : null }
      })
  },
  {
    id: 'energy',
    labelKey: 'benchmarks.colEnergy',
    defaultVisible: true,
    sortCol: 'energy',
    cell: (run) =>
      metricOrDash(run, energyPerImage(run), (value) => ({
        text: `${fmt(value, 2)} Wh`,
        qualifier: t('benchmarks.perImage')
      }))
  },
  {
    id: 'gpu',
    labelKey: 'benchmarks.colGpu',
    defaultVisible: true,
    cell: (run) => ({ text: gpuModel(run), qualifier: gpuCapacity(run) })
  },
  {
    id: 'date',
    labelKey: 'benchmarks.colDate',
    always: true,
    defaultVisible: true,
    sortCol: 'date',
    cell: (run) => ({ text: formatDate(run.createdAt), muted: true })
  },
  // --- toggle-on extras (design §3.2) ---
  {
    id: 'peakPower',
    labelKey: 'benchmarks.colPeakPower',
    defaultVisible: false,
    cell: (run) => {
      const value = core(run)?.resources?.peak?.powerW
      return metricOrDash(run, isFiniteNumber(value) ? value : null, (watts) => ({
        text: `${fmt(watts, 0)} W`
      }))
    }
  },
  {
    id: 'peakTemp',
    labelKey: 'benchmarks.colPeakTemp',
    defaultVisible: false,
    cell: (run) => {
      const value = core(run)?.resources?.peak?.temperatureC
      return metricOrDash(run, isFiniteNumber(value) ? value : null, (temp) => ({
        text: `${fmt(temp, 0)} °C`
      }))
    }
  },
  {
    id: 'gpuUtil',
    labelKey: 'benchmarks.colGpuUtil',
    defaultVisible: false,
    cell: (run) => {
      const value = core(run)?.resources?.peak?.vramUtilPercent
      return metricOrDash(run, isFiniteNumber(value) ? value : null, (util) => ({
        text: `${fmt(util, 0)} %`
      }))
    }
  },
  {
    id: 'steps',
    labelKey: 'benchmarks.colSteps',
    defaultVisible: false,
    cell: (run) => {
      const value = core(run)?.workflow?.steps
      return metricOrDash(run, isFiniteNumber(value) ? value : null, (steps) => ({
        text: String(steps)
      }))
    }
  },
  {
    id: 'weightDtype',
    labelKey: 'benchmarks.colWeightDtype',
    defaultVisible: false,
    cell: (run) => textCell(core(run)?.device?.weightDtype)
  },
  {
    id: 'attention',
    labelKey: 'benchmarks.colAttention',
    defaultVisible: false,
    cell: (run) => textCell(core(run)?.device?.attentionImpl)
  },
  {
    id: 'cuda',
    labelKey: 'benchmarks.colCuda',
    defaultVisible: false,
    cell: (run) => textCell(core(run)?.device?.cudaVersion)
  },
  {
    id: 'runs',
    labelKey: 'benchmarks.colRuns',
    defaultVisible: false,
    cell: (run) => ({
      text: `${run.measuredJobCount} / ${resultNumber(run.result, 'failedRunCount') ?? 0}`
    })
  },
  {
    id: 'instance',
    labelKey: 'benchmarks.instance',
    defaultVisible: false,
    cell: (run) => ({ text: run.instance.name })
  },
  {
    id: 'workspace',
    labelKey: 'benchmarks.workspace',
    defaultVisible: false,
    cell: (run) => ({ text: workspaceName(run) })
  },
  {
    id: 'sessionId',
    labelKey: 'benchmarks.colSessionId',
    defaultVisible: false,
    cell: (run) => ({ text: run.id, muted: true })
  }
]

function textCell(value: string | null | undefined): MetricCell {
  return value ? { text: value } : { ...notMeasuredCell }
}

const visibleColumnIds = ref(
  new Set(columns.filter((column) => column.defaultVisible).map((column) => column.id))
)
const visibleColumns = computed(() =>
  columns.filter((column) => column.always || visibleColumnIds.value.has(column.id))
)

function toggleColumn(id: string): void {
  const column = columns.find((candidate) => candidate.id === id)
  if (!column || column.always) return
  const next = new Set(visibleColumnIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  visibleColumnIds.value = next
}

// --- sorting (design §3.3, nulls always last) ---
const SORT_DIRECTIONS: Record<SortCol, SortId[]> = {
  spi: ['spi-asc', 'spi-desc'],
  its: ['its-desc'],
  vram: ['vram-asc', 'vram-desc'],
  energy: ['energy-asc'],
  date: ['date-desc', 'date-asc'],
  wf: ['wf-asc']
}

const sortOptions = computed<BaseSelectOption[]>(() => [
  { value: 'date-desc', label: t('benchmarks.sortDateNewest') },
  { value: 'date-asc', label: t('benchmarks.sortDateOldest') },
  { value: 'spi-asc', label: t('benchmarks.sortFastest') },
  { value: 'spi-desc', label: t('benchmarks.sortSlowest') },
  { value: 'its-desc', label: t('benchmarks.sortHighestItPerS') },
  { value: 'vram-asc', label: t('benchmarks.sortLowestVram') },
  { value: 'vram-desc', label: t('benchmarks.sortHighestVram') },
  { value: 'energy-asc', label: t('benchmarks.sortLowestEnergy') },
  { value: 'wf-asc', label: t('benchmarks.sortWorkflowAz') }
])

function setSort(value: string): void {
  sortId.value = value as SortId
}

function headerSort(column: HistoryColumn): void {
  const col = column.sortCol
  if (!col) return
  const directions = SORT_DIRECTIONS[col]
  const index = directions.indexOf(sortId.value)
  sortId.value = index >= 0 ? directions[(index + 1) % directions.length]! : directions[0]!
}

function headerIndicator(column: HistoryColumn): '' | '↑' | '↓' {
  const col = column.sortCol
  if (!col || !SORT_DIRECTIONS[col].includes(sortId.value)) return ''
  return sortId.value.endsWith('-asc') ? '↑' : '↓'
}

function numericComparator(
  accessor: (run: PerformanceTestBenchmark) => number | null,
  direction: 1 | -1
): (a: PerformanceTestBenchmark, b: PerformanceTestBenchmark) => number {
  return (a, b) => {
    const aValue = accessor(a)
    const bValue = accessor(b)
    if (aValue == null && bValue == null) return 0
    if (aValue == null) return 1
    if (bValue == null) return -1
    return direction * (aValue - bValue)
  }
}

const comparators: Record<
  SortId,
  (a: PerformanceTestBenchmark, b: PerformanceTestBenchmark) => number
> = {
  'date-desc': numericComparator(createdAtMs, -1),
  'date-asc': numericComparator(createdAtMs, 1),
  'spi-asc': numericComparator(secPerImageOf, 1),
  'spi-desc': numericComparator(secPerImageOf, -1),
  'its-desc': numericComparator(itPerS, -1),
  'vram-asc': numericComparator(vramPeakMb, 1),
  'vram-desc': numericComparator(vramPeakMb, -1),
  'energy-asc': numericComparator(energyPerImage, 1),
  'wf-asc': (a, b) =>
    a.workflowName.localeCompare(b.workflowName) ||
    (numericComparator(createdAtMs, -1)(a, b) as number)
}

const filteredBenchmarks = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  return benchmarks.value
    .filter((benchmark) => {
      const workspace = workspaceName(benchmark)
      const gpu = gpuModel(benchmark)
      const matchesSearch =
        !query ||
        [benchmark.id, benchmark.workflowName, benchmark.instance.name, workspace, gpu].some(
          (value) => value.toLocaleLowerCase().includes(query)
        )
      return (
        matchesSearch &&
        (!workspaceFilter.value ||
          (benchmark.workspace.id ?? UNMANAGED_WORKSPACE_FILTER) === workspaceFilter.value) &&
        (!instanceFilter.value || benchmark.instance.id === instanceFilter.value) &&
        (!hardwareFilter.value || gpu === hardwareFilter.value) &&
        (!workflowFilter.value || benchmark.workflowName === workflowFilter.value)
      )
    })
    .sort(comparators[sortId.value])
})

function clearFilters(): void {
  searchQuery.value = ''
  workspaceFilter.value = ''
  instanceFilter.value = ''
  hardwareFilter.value = ''
  workflowFilter.value = ''
}

// --- selection ---
const selectedBenchmarks = computed(() => {
  const byId = new Map(benchmarks.value.map((benchmark) => [benchmark.id, benchmark]))
  return selectedOrderIds.value.flatMap((id) => {
    const benchmark = byId.get(id)
    return benchmark ? [benchmark] : []
  })
})

const selectionCount = computed(() => selectedOrderIds.value.length)
const canCompare = computed(() => selectionCount.value >= 2)
const overCompareCap = computed(() => selectionCount.value > COMPARE_CAP)

function seriesColorForSelected(id: string): string {
  const index = selectedOrderIds.value.indexOf(id)
  if (index < 0) return ''
  return seriesColors[index % seriesColors.length]!
}

function toggleBenchmark(id: string): void {
  if (selectedIds.value.has(id)) {
    selectedOrderIds.value = selectedOrderIds.value.filter((selectedId) => selectedId !== id)
  } else {
    selectedOrderIds.value = [...selectedOrderIds.value, id]
  }
}

function openCompareView(): void {
  if (!canCompare.value) return
  // Pass OLDEST-FIRST run objects so the store's default baseline (first run) is the
  // oldest run (design §2) and Compare reads real benchmarks without re-listing from disk.
  const oldestFirst = [...selectedBenchmarks.value].sort((a, b) => {
    const aMs = createdAtMs(a)
    const bMs = createdAtMs(b)
    if (aMs == null && bMs == null) return 0
    if (aMs == null) return 1
    if (bMs == null) return -1
    return aMs - bMs
  })
  benchmarkNav.openCompare(oldestFirst)
}

// --- export (design §5.3) ---
async function exportData(format: 'csv' | 'json'): Promise<void> {
  closeAllMenus()
  const runs = selectedBenchmarks.value
  if (runs.length === 0) return
  exportError.value = null
  const contents = format === 'csv' ? buildBenchmarkCsv(runs) : buildBenchmarkJson(runs)
  try {
    const result = await window.api.exportBenchmarkData(
      contents,
      exportBaseName(runs.length, format),
      benchmarksFolderPath.value || undefined
    )
    if (!result.ok && !result.canceled) {
      exportError.value = result.message || t('benchmarks.exportDataFailed')
    }
  } catch (error) {
    exportError.value = (error as Error)?.message || t('benchmarks.exportDataFailed')
  }
}

// --- row actions (design §3.1 ⋯ menu) ---
function openRun(run: PerformanceTestBenchmark): void {
  closeAllMenus()
  // TODO(benchmarks): open this run's read-only single-run dashboard once a shared
  // historical-dashboard component exists. The foundation does not yet expose one
  // (PerformanceTestView takes no props and there is no store channel to load a saved
  // result into it), so "Open" is deferred. Selecting the row (row click) remains the
  // interactive path into the headline Compare flow. See report / design §7 P1.
  void run
}

function runAgain(run: PerformanceTestBenchmark): void {
  closeAllMenus()
  // TODO(benchmarks): prefill Run with this run's exact workflow + config. The
  // foundation has no prefill channel (open question §8.6), so we navigate to Run; the
  // user re-selects the workflow there. Switching panels is wired via the nav store.
  void run
  benchmarkNav.goToRun()
}

async function revealInFolder(run: PerformanceTestBenchmark): Promise<void> {
  closeAllMenus()
  const base = benchmarksFolderPath.value
  if (!base) return
  const separator = base.includes('\\') ? '\\' : '/'
  const sessionPath = `${base}${base.endsWith(separator) ? '' : separator}${run.id}`
  try {
    await window.api.openPath(sessionPath)
  } catch {
    // Best-effort: fall back to the benchmarks folder root if the session folder path is wrong.
    await window.api.openPath(base).catch(() => {})
  }
}

// --- rename (keep today's editor; relocated under ⋯ + workflow double-click) ---
function setSessionNameInput(element: unknown): void {
  sessionNameInput.value = element instanceof HTMLInputElement ? element : null
}

function startRename(benchmark: PerformanceTestBenchmark): void {
  closeAllMenus()
  if (renamingSessionId.value) return
  editingSessionId.value = benchmark.id
  sessionNameDraft.value = benchmark.id
  void nextTick(() => {
    sessionNameInput.value?.focus()
    sessionNameInput.value?.select()
  })
}

function cancelRename(): void {
  if (renamingSessionId.value) return
  editingSessionId.value = null
  sessionNameDraft.value = ''
}

async function showRenameError(message?: string): Promise<void> {
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
    cancelRename()
    return
  }
  if (!newSessionId) {
    await showRenameError(t('benchmarks.sessionNameRequired'))
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
      await showRenameError(result.message)
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
    await showRenameError((error as Error)?.message)
  } finally {
    renamingSessionId.value = null
    if (editingSessionId.value === benchmark.id) {
      await nextTick(() => sessionNameInput.value?.focus())
    }
  }
}

async function confirmDeleteBenchmark(benchmark: PerformanceTestBenchmark): Promise<void> {
  closeAllMenus()
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

// --- loading ---
async function loadBenchmarks(folderPath?: string): Promise<void> {
  loading.value = true
  loadError.value = false
  try {
    const result = await window.api.listPerformanceTestBenchmarks(folderPath)
    benchmarksFolderPath.value = result.folderPath
    benchmarks.value = result.benchmarks
    selectedOrderIds.value = selectedOrderIds.value.filter((id) =>
      result.benchmarks.some((benchmark) => benchmark.id === id)
    )
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

function goToRun(): void {
  benchmarkNav.goToRun()
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
        :description="t('benchmarks.subtitle')"
        logo-test-id="benchmarks-logo"
      />

      <div class="benchmarks__header-actions">
        <div class="benchmarks__seg" role="tablist" :aria-label="t('benchmarks.title')">
          <button
            type="button"
            role="tab"
            class="benchmarks__seg-btn"
            data-testid="benchmarks-tab-run"
            @click="goToRun"
          >
            {{ t('benchmarks.tabRun') }}
          </button>
          <button
            type="button"
            role="tab"
            class="benchmarks__seg-btn benchmarks__seg-btn--on"
            aria-selected="true"
            data-testid="benchmarks-tab-history"
          >
            {{ t('benchmarks.tabHistory') }}
          </button>
        </div>
        <DevPlatformAccountChip class="benchmarks__account" />
      </div>

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
            v-model="workflowFilter"
            :options="workflowOptions"
            :aria-label="t('benchmarks.allWorkflows')"
            compact
          />
          <BaseSelect
            v-model="hardwareFilter"
            :options="hardwareOptions"
            :aria-label="t('benchmarks.allHardware')"
            compact
          />
          <BaseSelect
            v-model="instanceFilter"
            :options="instanceOptions"
            :aria-label="t('benchmarks.allInstances')"
            compact
          />
          <BaseSelect
            v-model="workspaceFilter"
            :options="workspaceOptions"
            :aria-label="t('benchmarks.allWorkspaces')"
            compact
          />
          <BaseSelect
            :model-value="sortId"
            :options="sortOptions"
            :aria-label="t('benchmarks.sortLabel')"
            compact
            @update:model-value="setSort"
          />
          <details class="benchmarks__menu benchmarks__columns-picker">
            <summary class="secondary">
              <SlidersHorizontal :size="16" aria-hidden="true" />
              {{ t('benchmarks.columns') }}
            </summary>
            <div class="benchmarks__columns-menu">
              <strong>{{ t('benchmarks.columnsToDisplay') }}</strong>
              <label>
                <input type="checkbox" checked disabled />
                <span>{{ t('benchmarks.workflow') }}</span>
              </label>
              <label v-for="column in columns" :key="column.id">
                <input
                  type="checkbox"
                  :checked="column.always || visibleColumnIds.has(column.id)"
                  :disabled="column.always"
                  :data-testid="`benchmark-column-${column.id}`"
                  @change="toggleColumn(column.id)"
                />
                <span>{{ t(column.labelKey) }}</span>
              </label>
            </div>
          </details>
        </div>

        <div v-if="loading" class="benchmarks__state">{{ t('common.loading') }}</div>

        <div v-else-if="loadError" class="benchmarks__state benchmarks__state--error">
          <p class="benchmarks__state-title">{{ t('benchmarks.loadErrorTitle') }}</p>
          <div class="benchmarks__state-actions">
            <button class="secondary" type="button" @click="refreshBenchmarks">
              {{ t('benchmarks.loadErrorRetry') }}
            </button>
            <button class="secondary" type="button" @click="selectBenchmarksFolder">
              {{ t('benchmarks.loadErrorOpenFolder') }}
            </button>
          </div>
        </div>

        <div v-else-if="benchmarks.length === 0" class="benchmarks__state benchmarks__empty">
          <p class="benchmarks__state-title">{{ t('benchmarks.emptyTitle') }}</p>
          <p class="benchmarks__state-body">{{ t('benchmarks.emptyBody') }}</p>
          <button class="benchmarks__primary" type="button" @click="goToRun">
            {{ t('benchmarks.emptyAction') }}
          </button>
        </div>

        <div
          v-else-if="filteredBenchmarks.length === 0"
          class="benchmarks__state benchmarks__no-results"
        >
          <p class="benchmarks__state-title">{{ t('benchmarks.noMatches') }}</p>
          <button class="secondary" type="button" @click="clearFilters">
            {{ t('benchmarks.noMatchesAction') }}
          </button>
        </div>

        <div v-else class="benchmarks__table-scroll">
          <table class="benchmarks__table">
            <thead>
              <tr>
                <th class="benchmarks__check-cell">
                  <span class="benchmarks__visually-hidden">{{
                    t('benchmarks.selectVisible')
                  }}</span>
                </th>
                <th class="benchmarks__wf-head">
                  <button
                    type="button"
                    @click="sortId = sortId === 'wf-asc' ? 'date-desc' : 'wf-asc'"
                  >
                    {{ t('benchmarks.workflow') }}
                    <span v-if="sortId === 'wf-asc'" class="benchmarks__sort-caret">↑</span>
                  </button>
                </th>
                <th v-for="column in visibleColumns" :key="column.id">
                  <button
                    v-if="column.sortCol"
                    type="button"
                    class="benchmarks__sortable"
                    @click="headerSort(column)"
                  >
                    {{ t(column.labelKey) }}
                    <span v-if="headerIndicator(column)" class="benchmarks__sort-caret">
                      {{ headerIndicator(column) }}
                    </span>
                  </button>
                  <span v-else>{{ t(column.labelKey) }}</span>
                </th>
                <th class="benchmarks__actions-cell" :aria-label="t('benchmarks.actions')" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="benchmark in filteredBenchmarks"
                :key="benchmark.id"
                class="benchmarks__row"
                :class="{ 'benchmarks__row--selected': selectedIds.has(benchmark.id) }"
                :style="
                  selectedIds.has(benchmark.id)
                    ? { '--series-color': seriesColorForSelected(benchmark.id) }
                    : undefined
                "
                :data-testid="`benchmark-row-${benchmark.id}`"
                @click="toggleBenchmark(benchmark.id)"
              >
                <td class="benchmarks__check-cell">
                  <input
                    class="benchmarks__checkbox"
                    type="checkbox"
                    :checked="selectedIds.has(benchmark.id)"
                    :style="
                      selectedIds.has(benchmark.id)
                        ? { '--series-color': seriesColorForSelected(benchmark.id) }
                        : undefined
                    "
                    :aria-label="t('benchmarks.selectRun', { workflow: benchmark.workflowName })"
                    @click.stop
                    @change="toggleBenchmark(benchmark.id)"
                  />
                </td>

                <td class="benchmarks__wf-cell" @dblclick.stop="startRename(benchmark)">
                  <template v-if="editingSessionId === benchmark.id">
                    <input
                      :ref="setSessionNameInput"
                      v-model="sessionNameDraft"
                      class="benchmarks__rename-input"
                      type="text"
                      :disabled="renamingSessionId === benchmark.id"
                      :aria-label="t('benchmarks.sessionName')"
                      @click.stop
                      @blur="saveSessionName(benchmark)"
                      @keydown.enter.prevent="saveSessionName(benchmark)"
                      @keydown.escape.prevent="cancelRename"
                    />
                  </template>
                  <span v-else class="benchmarks__wf">
                    <span class="benchmarks__wf-name">{{ benchmark.workflowName }}</span>
                    <span v-if="gpuCapacity(benchmark)" class="benchmarks__wf-task">
                      {{ gpuModel(benchmark) }}
                    </span>
                  </span>
                </td>

                <td
                  v-for="column in visibleColumns"
                  :key="column.id"
                  class="benchmarks__metric-cell"
                >
                  <template v-for="(cell, index) in [column.cell(benchmark)]" :key="index">
                    <span
                      class="benchmarks__metric"
                      :class="{ 'benchmarks__metric--muted': cell.muted }"
                      :title="cell.tooltip || undefined"
                    >
                      <span class="benchmarks__metric-value benchmarks__num">
                        {{ cell.text }}
                        <Flag
                          v-if="cell.flag"
                          class="benchmarks__flag"
                          :size="12"
                          :aria-label="
                            cell.flag === 'offloaded'
                              ? t('benchmarks.flagOffloaded')
                              : t('benchmarks.flagThrottled')
                          "
                          :title="
                            cell.flag === 'offloaded'
                              ? t('benchmarks.flagOffloaded')
                              : t('benchmarks.flagThrottled')
                          "
                        />
                      </span>
                      <span v-if="cell.qualifier" class="benchmarks__metric-qualifier">
                        {{ cell.qualifier }}
                      </span>
                    </span>
                  </template>
                </td>

                <td class="benchmarks__actions-cell" @click.stop>
                  <details class="benchmarks__menu benchmarks__row-menu">
                    <summary
                      class="benchmarks__row-menu-trigger"
                      :data-testid="`benchmark-menu-${benchmark.id}`"
                      :aria-label="t('benchmarks.actions')"
                      :title="t('benchmarks.actions')"
                    >
                      <MoreHorizontal :size="16" aria-hidden="true" />
                    </summary>
                    <div class="benchmarks__row-menu-pop">
                      <button
                        type="button"
                        :data-testid="`benchmark-open-${benchmark.id}`"
                        @click="openRun(benchmark)"
                      >
                        {{ t('benchmarks.menuOpen') }}
                      </button>
                      <button
                        type="button"
                        :data-testid="`benchmark-runagain-${benchmark.id}`"
                        @click="runAgain(benchmark)"
                      >
                        {{ t('benchmarks.menuRunAgain') }}
                      </button>
                      <button
                        type="button"
                        :data-testid="`benchmark-rename-${benchmark.id}`"
                        @click="startRename(benchmark)"
                      >
                        {{ t('benchmarks.menuRename') }}
                      </button>
                      <button
                        type="button"
                        :data-testid="`benchmark-reveal-${benchmark.id}`"
                        @click="revealInFolder(benchmark)"
                      >
                        {{ t('benchmarks.menuReveal') }}
                      </button>
                      <button
                        type="button"
                        class="benchmarks__row-menu-danger"
                        :disabled="deletingIds.has(benchmark.id)"
                        :data-testid="`benchmark-delete-${benchmark.id}`"
                        @click="confirmDeleteBenchmark(benchmark)"
                      >
                        {{ t('benchmarks.menuDelete') }}
                      </button>
                    </div>
                  </details>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <!-- selection action bar (design §3.1) -->
    <div
      v-if="selectionCount > 0"
      class="benchmarks__action-bar"
      data-testid="benchmarks-action-bar"
    >
      <span class="benchmarks__action-count">
        {{ t('benchmarks.selectionCount', { selected: selectionCount, total: benchmarks.length }) }}
      </span>
      <span v-if="overCompareCap" class="benchmarks__action-note">
        {{ t('benchmarks.compareCapNote') }}
      </span>
      <span v-if="exportError" class="benchmarks__action-error">{{ exportError }}</span>
      <details class="benchmarks__menu benchmarks__export-menu">
        <summary class="secondary benchmarks__export-trigger" data-testid="benchmarks-export">
          <Download :size="16" aria-hidden="true" />
          {{ t('benchmarks.exportMenu') }}
        </summary>
        <div class="benchmarks__export-pop">
          <button type="button" data-testid="benchmarks-export-csv" @click="exportData('csv')">
            {{ t('benchmarks.exportCsv') }}
          </button>
          <button type="button" data-testid="benchmarks-export-json" @click="exportData('json')">
            {{ t('benchmarks.exportJson') }}
          </button>
        </div>
      </details>
      <button
        type="button"
        class="benchmarks__primary benchmarks__compare"
        :disabled="!canCompare"
        data-testid="benchmarks-compare"
        @click="openCompareView"
      >
        {{ t('benchmarks.compareButton', { count: selectionCount }) }}
        <ArrowRight :size="16" aria-hidden="true" />
      </button>
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

.benchmarks__header-actions {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 12px;
}

.benchmarks__seg {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: var(--neutral-900, var(--neutral-800));
}

.benchmarks__seg-btn {
  padding: 6px 16px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.benchmarks__seg-btn:hover {
  color: var(--neutral-100);
}

.benchmarks__seg-btn--on {
  background: var(--neutral-700);
  color: var(--neutral-100);
}

.benchmarks__seg-btn:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.benchmarks__card {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--chooser-surface-bg) 90%, transparent);
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
  grid-template-columns: auto minmax(170px, 1.4fr) repeat(5, minmax(110px, 1fr)) auto;
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

.benchmarks__menu {
  position: relative;
}

.benchmarks__columns-picker > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  list-style: none;
  white-space: nowrap;
  cursor: pointer;
}

.benchmarks__menu > summary::-webkit-details-marker {
  display: none;
}

.benchmarks__menu > summary {
  list-style: none;
}

.benchmarks__columns-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 4;
  display: grid;
  gap: 8px;
  width: max-content;
  min-width: 220px;
  max-width: 320px;
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

.benchmarks__table-scroll {
  margin-top: 12px;
  overflow: auto;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
}

.benchmarks__table {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
  font-size: 13px;
  text-align: left;
}

.benchmarks__table th,
.benchmarks__table td {
  padding: 11px 14px;
  border-bottom: 1px solid var(--chooser-surface-border);
  white-space: nowrap;
}

.benchmarks__table tbody tr:last-child td {
  border-bottom: 0;
}

.benchmarks__table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--neutral-800);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.benchmarks__table thead th button {
  display: inline-flex;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
}

.benchmarks__sort-caret {
  color: var(--comfy-yellow);
}

.benchmarks__num {
  font-variant-numeric: tabular-nums lining-nums;
  font-feature-settings: 'tnum' 1;
}

.benchmarks__row {
  cursor: pointer;
  transition: background 120ms ease;
}

.benchmarks__row:hover {
  background: var(--chooser-surface-bg-hover);
}

.benchmarks__row--selected td {
  background: color-mix(in srgb, var(--series-color) 11%, transparent);
}

.benchmarks__row--selected td:first-child {
  box-shadow: inset 3px 0 var(--series-color);
}

.benchmarks__wf-cell {
  min-width: 180px;
}

.benchmarks__wf {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.benchmarks__wf-name {
  color: var(--neutral-100);
  font-weight: 600;
}

.benchmarks__wf-task {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 11.5px;
}

.benchmarks__rename-input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--accent, var(--comfy-yellow));
  border-radius: 6px;
  background: var(--surface, var(--neutral-900));
  color: var(--text, var(--neutral-100));
  font: inherit;
}

.benchmarks__rename-input:focus {
  outline: none;
}

.benchmarks__metric {
  display: inline-flex;
  flex-direction: column;
}

.benchmarks__metric-value {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--neutral-100);
  font-weight: 600;
}

.benchmarks__metric--muted .benchmarks__metric-value {
  color: var(--text-faint);
  font-weight: 400;
}

.benchmarks__metric-qualifier {
  margin-top: 2px;
  color: var(--text-faint);
  font-size: 11px;
}

.benchmarks__flag {
  color: var(--comfy-yellow);
  cursor: help;
}

.benchmarks__check-cell,
.benchmarks__actions-cell {
  width: 44px;
  text-align: center;
}

.benchmarks__checkbox {
  appearance: none;
  width: 16px;
  height: 16px;
  margin: 0;
  border: 1px solid var(--brand-surface-border-hover);
  border-radius: 4px;
  background: var(--brand-surface-bg);
  cursor: pointer;
  vertical-align: middle;
}

.benchmarks__checkbox:checked {
  border-color: var(--series-color, var(--comfy-yellow));
  background-color: var(--series-color, var(--comfy-yellow));
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='3,9 7,12 13,5'/></svg>");
  background-repeat: no-repeat;
  background-position: center;
}

.benchmarks__checkbox:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.benchmarks__row-menu-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--text-muted);
  list-style: none;
  cursor: pointer;
}

.benchmarks__row-menu-trigger::-webkit-details-marker {
  display: none;
}

.benchmarks__row-menu-trigger:hover {
  background: var(--neutral-700);
  color: var(--neutral-100);
}

.benchmarks__row-menu-pop {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  min-width: 170px;
  padding: 6px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: var(--neutral-800);
  box-shadow: 0 12px 30px rgb(0 0 0 / 45%);
}

.benchmarks__row-menu-pop button,
.benchmarks__export-pop button {
  display: flex;
  width: 100%;
  align-items: center;
  padding: 9px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--neutral-100);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.benchmarks__row-menu-pop button:hover,
.benchmarks__export-pop button:hover {
  background: var(--neutral-700);
}

.benchmarks__row-menu-danger {
  color: var(--danger);
}

.benchmarks__row-menu-danger:disabled {
  cursor: wait;
  opacity: 0.5;
}

.benchmarks__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 16px;
  color: var(--text-muted);
  text-align: center;
}

.benchmarks__state--error .benchmarks__state-title {
  color: var(--danger);
}

.benchmarks__state-title {
  margin: 0;
  color: var(--neutral-100);
  font-size: 15px;
  font-weight: 600;
}

.benchmarks__state-body {
  margin: 0;
  color: var(--text-muted);
}

.benchmarks__state-actions {
  display: flex;
  gap: 10px;
}

.benchmarks__primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 16px;
  border: 1px solid var(--comfy-yellow);
  border-radius: 8px;
  background: var(--comfy-yellow);
  color: #1a1a00;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.benchmarks__primary:hover:not(:disabled) {
  filter: brightness(1.05);
}

.benchmarks__primary:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.benchmarks__primary:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.benchmarks__action-bar {
  position: absolute;
  bottom: 24px;
  left: 50%;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px 12px 20px;
  border: 1px solid var(--chooser-surface-border-hover);
  border-radius: 12px;
  background: var(--neutral-800);
  box-shadow: 0 16px 40px rgb(0 0 0 / 50%);
  transform: translateX(-50%);
}

.benchmarks__action-count {
  color: var(--text-muted);
  font-size: 13px;
}

.benchmarks__action-note {
  color: var(--text-muted);
  font-size: 12px;
}

.benchmarks__action-error {
  color: var(--danger);
  font-size: 12px;
}

.benchmarks__export-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  list-style: none;
  cursor: pointer;
}

.benchmarks__export-trigger::-webkit-details-marker {
  display: none;
}

.benchmarks__export-pop {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  min-width: 150px;
  padding: 6px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: var(--neutral-800);
  box-shadow: 0 12px 30px rgb(0 0 0 / 45%);
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

@media (max-width: 1100px) {
  .benchmarks__filters {
    grid-template-columns: auto repeat(3, minmax(0, 1fr));
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
