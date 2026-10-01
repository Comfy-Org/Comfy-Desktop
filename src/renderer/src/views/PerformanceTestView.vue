<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpen, ImageDown, Trash2 } from 'lucide-vue-next'
import BrandBackground from '../components/BrandBackground.vue'
import BrandedPageHeader from '../components/BrandedPageHeader.vue'
import BenchmarkResultDashboard, {
  type BenchmarkCompareView
} from '../components/BenchmarkResultDashboard.vue'
import CollapsibleSectionToggle from '../components/CollapsibleSectionToggle.vue'
import TemplatePickerStep from '../components/TemplatePickerStep.vue'
import BaseModal from '../components/ui/BaseModal.vue'
import BaseSelect, { type BaseSelectOption } from '../components/ui/BaseSelect.vue'
import { useWorkspaceInstallScope } from '../composables/useWorkspaceInstallScope'
import { useAuthStore } from '../stores/authStore'
import { useBenchmarkNavStore } from '../stores/benchmarkNavStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type {
  ActionResult,
  FieldOption,
  PerformanceTestBenchmark,
  RunPerformanceTestWorkflowResult
} from '../types/ipc'
import { buildPerformanceTestResultsSvg, createResultsPng } from '../lib/performanceTestResultsSvg'
import { compareToPrevious, perImageSeconds, type CompareResult } from '../lib/benchmarkMetrics'
import { emitTelemetryAction } from '../lib/telemetry'
import DevPlatformAccountChip from './devplatform/DevPlatformAccountChip.vue'
import DevPlatformWorkspaceSelector from './devplatform/DevPlatformWorkspaceSelector.vue'

type BenchmarkModality = 'image' | 'video' | 'audio'

interface PerformanceTestRunTelemetry {
  readonly installationId: string
  readonly warmupRuns: number
  readonly measuredRuns: number
  readonly startedAtMs: number
}

const { t } = useI18n()
const authStore = useAuthStore()
const benchmarkNav = useBenchmarkNavStore()
const installationStore = useInstallationStore()
const sessionStore = useSessionStore()
const { selectedWorkspaceId, scopedInstallations } = useWorkspaceInstallScope(
  toRef(installationStore, 'installations')
)
const performanceTestInstallations = computed(() =>
  scopedInstallations.value.filter(
    (installation) =>
      installation.sourceCategory !== 'cloud' &&
      (authStore.isSignedIn || installation.status === 'installed')
  )
)
const instanceOptions = computed<BaseSelectOption[]>(() =>
  performanceTestInstallations.value.map((installation) => ({
    value: installation.id,
    label: installation.name,
    description: [installation.sourceLabel, installation.version].filter(Boolean).join(' · ')
  }))
)
const selectedInstallationId = ref<string | null>(null)
const workflowFilePath = ref<string | null>(null)
const workflowDisplayName = ref<string | null>(null)
const pendingStarterWorkflowLabel = ref<string | null>(null)
const starterWorkflowInstallationId = ref<string | null>(null)
const workflowImportError = ref<string | null>(null)
const starterWorkflowOptions = ref<FieldOption[]>([])
const selectedStarterWorkflowId = ref<string | null>(null)
const isStarterPickerOpen = ref(false)
const isStarterPickerLoading = ref(false)
/** Workflow name forwarded by a History "Run again" — used to preselect a matching
 *  starter-workflow option (by label) when the picker is next opened. */
const pendingRunAgainWorkflowName = ref<string | null>(null)
const isWorkflowDragging = ref(false)
const isWorkflowImporting = ref(false)
const isWorkflowDeleting = ref(false)
const isLaunching = ref(false)
const isStopping = ref(false)
const isWorkflowLocked = computed(() => isLaunching.value || isStopping.value)
const isExportingResults = ref(false)
const exportResultsError = ref<string | null>(null)
const logsExpanded = ref(true)
const resultsExpanded = ref(true)
/** Modality of the currently-selected workflow (from the catalog option). */
const workflowModality = ref<BenchmarkModality | null>(null)
/** Modality that produced the current result — drives the modality-aware hero. */
const resultModality = ref<BenchmarkModality | null>(null)
/** Prior runs (newest-first) for the inline compare delta. */
const priorBenchmarks = ref<PerformanceTestBenchmark[]>([])
const warmupRuns = ref('1')
const measuredRuns = ref('5')
const logInstallationId = ref<string | null>(null)
const performanceTestInstallationId = ref<string | null>(null)
const logsElement = ref<HTMLElement | null>(null)
const performanceTestResult = ref<RunPerformanceTestWorkflowResult | null>(null)
const progressSessionId = ref<string | null>(null)
const completedProgressRuns = ref(0)
const totalProgressRuns = ref(0)
const progressPercent = computed(() =>
  totalProgressRuns.value > 0
    ? Math.round((completedProgressRuns.value / totalProgressRuns.value) * 100)
    : 0
)
const performanceTestLogs = computed(() => {
  if (!logInstallationId.value) return ''
  return sessionStore.getSession(logInstallationId.value)?.output ?? ''
})
const resultsFolderPath = computed(() => {
  const resultPath =
    performanceTestResult.value?.resultsSummaryPath ?? performanceTestResult.value?.resultPath
  if (!resultPath) return null
  const separatorIndex = Math.max(resultPath.lastIndexOf('/'), resultPath.lastIndexOf('\\'))
  return separatorIndex > 0 ? resultPath.slice(0, separatorIndex) : null
})
// --- Results view (design §3–§7) -------------------------------------------
// Desktop relies solely on the ComfyUI-core capture. When `coreBenchmark` is
// present we render the full results dashboard; when a run completed but core
// wrote no capture we show a calm "needs capture" state (see the template) — we
// no longer fall back to the old duration / `/system_stats` rendering. Within the
// rich view, an individual null leaf still degrades to a muted "— not measured".
const coreBenchmark = computed(() => performanceTestResult.value?.coreBenchmark ?? null)
const resultsSummary = computed(() => performanceTestResult.value?.resultsSummary ?? null)
/** A run finished (a summary exists); the dashboard then decides rich-vs-needs-capture. */
const hasResult = computed(() => resultsSummary.value !== null)

const medianSeconds = computed<number | null>(() => {
  const stats = performanceTestResult.value?.statistics
  if (stats?.medianDurationSeconds != null) return stats.medianDurationSeconds
  return resultsSummary.value?.medianJobDurationSeconds ?? null
})
const heroImageCount = computed<number | null>(() => coreBenchmark.value?.run.imageCount ?? null)

/** Steady-state it/s the dashboard headlines (recomputed, warm-up step excluded). */
const dashboardSteadyStateItPerS = computed<number | null>(
  () => coreBenchmark.value?.sampling.steadyStateItPerS ?? null
)

const compareResult = computed<CompareResult | null>(() => {
  const summary = resultsSummary.value
  if (!summary) return null
  const count = heroImageCount.value ?? 0
  const imagesPerRun = count > 0 ? count : 1
  // Key on the SAME field priors are stored under (see `toPerformanceTestBenchmark`
  // in performanceTestWorkflows.ts) so both sides of the match come from one
  // producer — otherwise rich runs compare gpuModel vs deviceName and falsely
  // report `differentGpu` for the same GPU (esp. AMD/DirectML/multi-GPU).
  const hardwareName = summary.hardware?.deviceName ?? summary.hardware?.deviceType ?? null
  return compareToPrevious({
    currentPerImageSeconds: perImageSeconds(medianSeconds.value, imagesPerRun),
    imagesPerRun,
    workflowName: summary.workflowName,
    hardwareName,
    priorBenchmarks: priorBenchmarks.value
  })
})
const compareView = computed<BenchmarkCompareView | null>(() => {
  const compare = compareResult.value
  if (!compare) return null
  switch (compare.kind) {
    case 'faster':
      return {
        key: 'performanceTest.compareFaster',
        params: { pct: compare.pct, prev: formatHeroSeconds(compare.prevSeconds) },
        tone: compare.tone,
        dir: 'up' as const
      }
    case 'slower':
      return {
        key: 'performanceTest.compareSlower',
        params: { pct: compare.pct, prev: formatHeroSeconds(compare.prevSeconds) },
        tone: compare.tone,
        dir: 'down' as const
      }
    case 'same':
      return {
        key: 'performanceTest.compareSame',
        params: { prev: formatHeroSeconds(compare.prevSeconds) },
        tone: 'neutral' as const,
        dir: 'flat' as const
      }
    case 'differentGpu':
      return {
        key: 'performanceTest.compareDifferentGpu',
        params: {},
        tone: 'neutral' as const,
        dir: 'flat' as const
      }
    case 'first':
    default:
      return {
        key: 'performanceTest.compareFirst',
        params: {},
        tone: 'neutral' as const,
        dir: 'flat' as const
      }
  }
})

function toModality(value: unknown): BenchmarkModality | null {
  return value === 'image' || value === 'video' || value === 'audio' ? value : null
}
/** Hero seconds: 2 decimals below 10 s, 1 decimal at/above (matches the spec). */
function formatHeroSeconds(seconds: number): string {
  return seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)
}

const workflowFileName = computed(
  () =>
    pendingStarterWorkflowLabel.value ??
    workflowDisplayName.value ??
    workflowFilePath.value?.split(/[\\/]/).pop() ??
    ''
)
const performanceTestSessionId = (installationId: string): string =>
  `performance-test:${installationId}`
const canRun = computed(() => {
  const installationId = selectedInstallationId.value
  const sessionId = installationId ? performanceTestSessionId(installationId) : ''
  return Boolean(
    installationId &&
    workflowFilePath.value &&
    !isLaunching.value &&
    !isStopping.value &&
    !isWorkflowImporting.value &&
    !isWorkflowDeleting.value &&
    !sessionStore.isLaunching(sessionId)
  )
})
const canStop = computed(() => {
  return Boolean(performanceTestInstallationId.value && !isStopping.value)
})
let activeLaunchPromise: Promise<ActionResult> | null = null
let activeRunTelemetry: PerformanceTestRunTelemetry | null = null
let runToken = 0
const unsubscribePerformanceTestProgress = window.api.onPerformanceTestProgress((progress) => {
  if (progress.sessionId !== progressSessionId.value) return
  completedProgressRuns.value = progress.completedRuns
  totalProgressRuns.value = progress.totalRuns
})
onUnmounted(unsubscribePerformanceTestProgress)

watch(selectedWorkspaceId, () => {
  selectedInstallationId.value = null
})

watch(selectedInstallationId, (installationId) => {
  if (
    starterWorkflowInstallationId.value &&
    starterWorkflowInstallationId.value !== installationId &&
    workflowFilePath.value
  ) {
    void deleteWorkflow()
  }
})

/**
 * Consume a History "Run again" hand-off: preselect the originating instance when it is
 * still available, and remember the workflow name so the starter picker preselects a
 * matching option by label. The Run flow has no exact-config (seed/steps) prefill
 * channel, so only the instance + workflow are forwarded — never fabricated config.
 */
function applyRunAgainRequest(): void {
  const request = benchmarkNav.consumeRunAgainRequest()
  if (!request) return
  if (performanceTestInstallations.value.some((i) => i.id === request.installationId)) {
    selectedInstallationId.value = request.installationId
  }
  pendingRunAgainWorkflowName.value = request.workflowName
}
watch(() => benchmarkNav.runAgainRequest, applyRunAgainRequest, { immediate: true })
onMounted(applyRunAgainRequest)

function correctRunCount(
  value: string,
  minimum: number,
  maximum: number,
  fallback: number
): string {
  const rawValue = String(value).trim()
  const parsedValue = rawValue === '' ? Number.NaN : Number(rawValue)
  return String(
    Number.isFinite(parsedValue)
      ? Math.min(maximum, Math.max(minimum, Math.round(parsedValue)))
      : fallback
  )
}

function correctWarmupRuns(): void {
  warmupRuns.value = correctRunCount(warmupRuns.value, 1, 5, 1)
}

function correctMeasuredRuns(): void {
  measuredRuns.value = correctRunCount(measuredRuns.value, 1, 100, 5)
}

function secondsToMilliseconds(seconds: number | null | undefined): number | null {
  return seconds == null ? null : seconds * 1000
}

async function importWorkflow(sourcePath?: string): Promise<void> {
  if (isWorkflowImporting.value || isWorkflowDeleting.value || isWorkflowLocked.value) return
  isWorkflowImporting.value = true
  workflowImportError.value = null
  try {
    const result = await window.api.importPerformanceTestWorkflow(sourcePath)
    if (result.ok && result.filePath) {
      workflowFilePath.value = result.filePath
      workflowDisplayName.value = null
      starterWorkflowInstallationId.value = null
      selectedStarterWorkflowId.value = null
      workflowModality.value = null
    } else if (!result.canceled) {
      workflowImportError.value = result.message || t('performanceTest.importFailed')
    }
  } catch (error) {
    workflowImportError.value = (error as Error)?.message || t('performanceTest.importFailed')
  } finally {
    isWorkflowImporting.value = false
  }
}

async function openStarterWorkflowPicker(): Promise<void> {
  const installationId = selectedInstallationId.value
  if (!installationId || isWorkflowLocked.value || isWorkflowImporting.value) return
  if (!navigator.onLine) {
    workflowImportError.value = t('performanceTest.exampleWorkflowsOffline')
    return
  }
  isStarterPickerLoading.value = true
  workflowImportError.value = null
  try {
    starterWorkflowOptions.value =
      await window.api.getPerformanceTestStarterWorkflows(installationId)
    if (starterWorkflowOptions.value.length === 0) {
      workflowImportError.value = t('performanceTest.noStarterWorkflows')
      return
    }
    const recommended = starterWorkflowOptions.value.find((option) => option.recommended)
    // A pending "Run again" preselects the matching catalog option by label (best-effort:
    // benchmarks persist the workflow display name, not the catalog id), then clears.
    const runAgainMatch = pendingRunAgainWorkflowName.value
      ? starterWorkflowOptions.value.find(
          (option) => option.label === pendingRunAgainWorkflowName.value
        )
      : undefined
    pendingRunAgainWorkflowName.value = null
    selectedStarterWorkflowId.value =
      runAgainMatch?.value ??
      starterWorkflowOptions.value.find(
        (option) => option.value === selectedStarterWorkflowId.value
      )?.value ??
      recommended?.value ??
      starterWorkflowOptions.value[0]!.value
    isStarterPickerOpen.value = true
  } catch (error) {
    workflowImportError.value = (error as Error)?.message || t('performanceTest.importFailed')
  } finally {
    isStarterPickerLoading.value = false
  }
}

async function prepareStarterWorkflow(): Promise<void> {
  const installationId = selectedInstallationId.value
  const templateId = selectedStarterWorkflowId.value
  const option = starterWorkflowOptions.value.find(({ value }) => value === templateId)
  if (!installationId || !templateId || !option || isWorkflowImporting.value) return

  const previousPath = workflowFilePath.value
  isStarterPickerOpen.value = false
  isWorkflowImporting.value = true
  workflowImportError.value = null
  pendingStarterWorkflowLabel.value = option.label
  try {
    const result = await window.api.preparePerformanceTestStarterWorkflow(
      installationId,
      templateId
    )
    if (!result.ok || !result.filePath) {
      throw new Error(
        result.offline
          ? t('performanceTest.exampleWorkflowsOffline')
          : result.message || t('performanceTest.importFailed')
      )
    }
    if (selectedInstallationId.value !== installationId) {
      await window.api.deletePerformanceTestWorkflow(result.filePath).catch(() => {})
      return
    }
    workflowFilePath.value = result.filePath
    workflowDisplayName.value = result.templateLabel || option.label
    starterWorkflowInstallationId.value = installationId
    workflowModality.value = toModality(option.data?.modality)
    if (previousPath && previousPath !== result.filePath) {
      await window.api.deletePerformanceTestWorkflow(previousPath).catch(() => {})
    }
  } catch (error) {
    workflowImportError.value = (error as Error)?.message || t('performanceTest.importFailed')
  } finally {
    pendingStarterWorkflowLabel.value = null
    isWorkflowImporting.value = false
  }
}

async function deleteWorkflow(): Promise<void> {
  const filePath = workflowFilePath.value
  if (!filePath || isWorkflowDeleting.value || isWorkflowLocked.value) return
  isWorkflowDeleting.value = true
  workflowImportError.value = null
  try {
    const result = await window.api.deletePerformanceTestWorkflow(filePath)
    if (result.ok) {
      if (workflowFilePath.value === filePath) {
        workflowFilePath.value = null
        workflowDisplayName.value = null
        starterWorkflowInstallationId.value = null
        selectedStarterWorkflowId.value = null
        workflowModality.value = null
      }
      if (result.status === 'preserved') {
        workflowImportError.value = result.message || t('performanceTest.deleteFailed')
      }
    } else {
      workflowImportError.value = result.message || t('performanceTest.deleteFailed')
    }
  } catch (error) {
    workflowImportError.value = (error as Error)?.message || t('performanceTest.deleteFailed')
  } finally {
    isWorkflowDeleting.value = false
  }
}

async function dropWorkflow(event: DragEvent): Promise<void> {
  isWorkflowDragging.value = false
  const file = event.dataTransfer?.files[0]
  if (!file) return
  const sourcePath = window.api.getPathForFile(file)
  if (!sourcePath) return
  await importWorkflow(sourcePath)
}

async function runPerformanceTest(): Promise<void> {
  const installationId = selectedInstallationId.value
  const filePath = workflowFilePath.value
  if (
    !installationId ||
    !filePath ||
    isLaunching.value ||
    isStopping.value ||
    isWorkflowImporting.value ||
    isWorkflowDeleting.value
  )
    return

  correctWarmupRuns()
  correctMeasuredRuns()
  const warmups = Number(warmupRuns.value)
  const runs = Number(measuredRuns.value)
  const sessionId = performanceTestSessionId(installationId)
  const token = ++runToken
  const runTelemetry: PerformanceTestRunTelemetry = {
    installationId,
    warmupRuns: warmups,
    measuredRuns: runs,
    startedAtMs: performance.now()
  }
  activeRunTelemetry = runTelemetry
  emitTelemetryAction('comfy.desktop.performance_test.started', {
    installation_id: installationId,
    warmup_runs: warmups,
    measured_runs: runs,
    total_runs: warmups + runs
  })
  isLaunching.value = true
  performanceTestResult.value = null
  resultModality.value = null
  priorBenchmarks.value = []
  progressSessionId.value = sessionId
  completedProgressRuns.value = 0
  totalProgressRuns.value = warmups + runs
  try {
    if (sessionStore.isRunning(sessionId)) await window.api.stopComfyUI(sessionId)
    logInstallationId.value = sessionId
    performanceTestInstallationId.value = installationId
    sessionStore.startSession(sessionId)
    const launchPromise = window.api.runAction(installationId, 'launch', {
      launchModeOverride: 'console',
      autoPortOnConflict: true,
      sessionIdOverride: sessionId
    })
    activeLaunchPromise = launchPromise
    const result = await launchPromise
    activeLaunchPromise = null
    if (token !== runToken) return
    if (!result.ok && !result.cancelled) {
      sessionStore.appendOutput(sessionId, result.message || t('performanceTest.launchFailed'))
    }
    if (!result.ok) {
      performanceTestInstallationId.value = null
      return
    }

    sessionStore.appendOutput(
      sessionId,
      `\n${t('performanceTest.submittingRuns', {
        count: runs,
        warmupCount: warmups
      })}\n`
    )
    try {
      const submission = await window.api.runPerformanceTestWorkflow(
        sessionId,
        filePath,
        runs,
        warmups
      )
      if (submission.ok) {
        performanceTestResult.value = submission
        resultModality.value = workflowModality.value
        void loadPriorBenchmarks(submission)
        if (activeRunTelemetry === runTelemetry) {
          activeRunTelemetry = null
          const summary = submission.resultsSummary
          const statistics = submission.statistics
          const hardware = submission.hardware
          emitTelemetryAction('comfy.desktop.performance_test.completed', {
            installation_id: runTelemetry.installationId,
            warmup_runs: runTelemetry.warmupRuns,
            measured_runs: runTelemetry.measuredRuns,
            successful_runs:
              summary?.measuredJobCount ??
              statistics?.measuredJobCount ??
              Math.max(0, submission.submitted - (submission.failedRuns ?? 0)),
            failed_runs: summary?.failedRunCount ?? submission.failedRuns ?? 0,
            duration_ms: performance.now() - runTelemetry.startedAtMs,
            fastest_run_duration_ms: secondsToMilliseconds(
              summary?.fastestJobDurationSeconds ?? statistics?.fastest.durationSeconds
            ),
            average_run_duration_ms: secondsToMilliseconds(
              summary?.averageJobDurationSeconds ?? statistics?.averageDurationSeconds
            ),
            median_run_duration_ms: secondsToMilliseconds(
              summary?.medianJobDurationSeconds ?? statistics?.medianDurationSeconds
            ),
            slowest_run_duration_ms: secondsToMilliseconds(
              summary?.slowestJobDurationSeconds ?? statistics?.slowest.durationSeconds
            ),
            deviceType: hardware?.deviceType ?? null,
            deviceIndex: hardware?.deviceIndex ?? null,
            deviceName: hardware?.deviceName ?? null,
            backend: hardware?.backend ?? null,
            devicesDeviceType: hardware?.devices.map((device) => device.deviceType) ?? [],
            devicesDeviceIndex: hardware?.devices.map((device) => device.deviceIndex) ?? [],
            devicesDeviceName: hardware?.devices.map((device) => device.deviceName) ?? [],
            devicesBackend: hardware?.devices.map((device) => device.backend) ?? [],
            vramMb: hardware?.vramMb ?? null,
            ramMb: hardware?.ramMb ?? null,
            pytorchVersion: hardware?.pytorchVersion ?? null,
            xformersVersion: hardware?.xformersVersion ?? null,
            cudaDeviceSet: hardware?.cudaDeviceSet ?? null
          })
        }
      }
      sessionStore.appendOutput(
        sessionId,
        submission.ok
          ? `${t('performanceTest.completedRuns', {
              count: submission.submitted,
              failed: submission.failedRuns,
              path: submission.resultPath
            })}\n`
          : `${submission.message || t('performanceTest.submitFailed')}\n`
      )
      if (submission.ok) await stopPerformanceTest()
    } catch (error) {
      sessionStore.appendOutput(
        sessionId,
        `${(error as Error)?.message || t('performanceTest.submitFailed')}\n`
      )
    }
  } catch (error) {
    sessionStore.appendOutput(
      sessionId,
      (error as Error)?.message || t('performanceTest.launchFailed')
    )
    performanceTestInstallationId.value = null
  } finally {
    const logs = sessionStore.getSession(sessionId)?.output
    if (logs !== undefined) {
      try {
        const savedLogs = await window.api.savePerformanceTestLogs(filePath, logs)
        if (!savedLogs.ok) {
          console.error('Failed to save performance test logs:', savedLogs.message)
        }
      } catch (error) {
        console.error('Failed to save performance test logs:', error)
      }
    }
    activeLaunchPromise = null
    if (activeRunTelemetry === runTelemetry) activeRunTelemetry = null
    progressSessionId.value = null
    isLaunching.value = false
  }
}

function openResultsFolder(): void {
  if (resultsFolderPath.value) void window.api.openPath(resultsFolderPath.value)
}

/** Load prior runs for the inline compare delta, excluding the just-finished run. */
async function loadPriorBenchmarks(submission: RunPerformanceTestWorkflowResult): Promise<void> {
  try {
    const list = await window.api.listPerformanceTestBenchmarks(
      resultsFolderPath.value ?? undefined
    )
    const currentCreatedAt = submission.resultsSummary?.createdAt ?? null
    priorBenchmarks.value = list.benchmarks.filter(
      (benchmark) => benchmark.createdAt !== currentCreatedAt
    )
  } catch {
    priorBenchmarks.value = []
  }
}

async function exportResultsImage(): Promise<void> {
  const summaryPath = performanceTestResult.value?.resultsSummaryPath
  const defaultPath = resultsFolderPath.value
  if (!summaryPath || !defaultPath) return
  isExportingResults.value = true
  exportResultsError.value = null
  try {
    const summary = await window.api.readPerformanceTestResultsSummary(summaryPath)
    const svg = buildPerformanceTestResultsSvg(summary, t)
    if (!svg) throw new Error(t('performanceTest.exportImageFailed'))
    const png = await createResultsPng(svg)
    const exported = await window.api.exportResultsImage(png, 'performance-test', defaultPath)
    if (!exported.ok && !exported.canceled) {
      exportResultsError.value = exported.message || t('performanceTest.exportImageFailed')
    }
  } catch (error) {
    exportResultsError.value = (error as Error)?.message || t('performanceTest.exportImageFailed')
  } finally {
    isExportingResults.value = false
  }
}

async function stopPerformanceTest(): Promise<void> {
  const installationId = performanceTestInstallationId.value
  if (!installationId || !canStop.value) return
  const sessionId = performanceTestSessionId(installationId)
  runToken += 1

  isStopping.value = true
  try {
    await window.api.cancelOperation(sessionId)
    if (activeLaunchPromise) {
      await activeLaunchPromise.catch(() => undefined)
    }
    await window.api.stopComfyUI(sessionId)
    if (performanceTestInstallationId.value === installationId)
      performanceTestInstallationId.value = null
  } catch (error) {
    sessionStore.appendOutput(
      sessionId,
      `\n${(error as Error)?.message || t('performanceTest.stopFailed')}\n`
    )
  } finally {
    isStopping.value = false
  }
}

async function stopPerformanceTestFromUser(): Promise<void> {
  const telemetry = activeRunTelemetry
  if (telemetry) {
    activeRunTelemetry = null
    emitTelemetryAction('comfy.desktop.performance_test.stopped', {
      installation_id: telemetry.installationId,
      warmup_runs: telemetry.warmupRuns,
      measured_runs: telemetry.measuredRuns,
      completed_runs: completedProgressRuns.value,
      total_runs: telemetry.warmupRuns + telemetry.measuredRuns,
      duration_ms: performance.now() - telemetry.startedAtMs
    })
  }
  await stopPerformanceTest()
}

async function toggleLogs(): Promise<void> {
  logsExpanded.value = !logsExpanded.value
  if (logsExpanded.value) {
    await nextTick()
    if (logsElement.value) logsElement.value.scrollTop = logsElement.value.scrollHeight
  }
}

watch(performanceTestLogs, async () => {
  const logs = logsElement.value
  const shouldFollow = !logs || logs.scrollHeight - logs.scrollTop - logs.clientHeight <= 24
  await nextTick()
  if (shouldFollow && logsElement.value) {
    logsElement.value.scrollTop = logsElement.value.scrollHeight
  }
})
</script>

<template>
  <BrandBackground class="performance-test" data-testid="performance-test">
    <div class="performance-test__layout">
      <div class="performance-test__intro">
        <BrandedPageHeader
          :title="t('performanceTest.title')"
          :description="t('performanceTest.description')"
          logo-test-id="performance-test-logo"
        />
        <div class="performance-test__content">
          <div class="performance-test__columns">
            <section class="performance-test__column">
              <h2>{{ t('performanceTest.selectInstance') }}</h2>
              <div class="performance-test__selection-row">
                <span class="performance-test__selection-label">
                  {{ t('performanceTest.workspaceLabel') }}
                </span>
                <div class="performance-test__selection-control performance-test__workspace-select">
                  <DevPlatformWorkspaceSelector v-model="selectedWorkspaceId" />
                </div>
              </div>
              <div class="performance-test__selection-row">
                <span class="performance-test__selection-label">
                  {{ t('performanceTest.instanceLabel') }}
                </span>
                <div class="performance-test__selection-control performance-test__instance-select">
                  <BaseSelect
                    :model-value="selectedInstallationId ?? ''"
                    :options="instanceOptions"
                    :placeholder="t('performanceTest.selectInstancePlaceholder')"
                    :aria-label="t('performanceTest.selectInstancePlaceholder')"
                    :disabled="instanceOptions.length === 0"
                    @update:model-value="selectedInstallationId = $event"
                  />
                </div>
              </div>
            </section>

            <section class="performance-test__column">
              <h2>{{ t('performanceTest.chooseWorkflow') }}</h2>
              <button
                class="performance-test__starter-workflow brand-secondary"
                type="button"
                :disabled="
                  !selectedInstallationId ||
                  isWorkflowLocked ||
                  isWorkflowImporting ||
                  isStarterPickerLoading
                "
                @click="openStarterWorkflowPicker"
              >
                {{
                  isStarterPickerLoading
                    ? t('performanceTest.loadingStarterWorkflows')
                    : t('performanceTest.chooseStarterWorkflow')
                }}
              </button>
              <div class="performance-test__workflow-divider">
                <span>{{ t('performanceTest.orImportApiWorkflow') }}</span>
              </div>
              <div
                class="performance-test__drop-zone"
                :class="{
                  'performance-test__drop-zone--dragging': isWorkflowDragging,
                  'performance-test__drop-zone--selected':
                    workflowFilePath || pendingStarterWorkflowLabel
                }"
                :aria-busy="isWorkflowImporting || isWorkflowDeleting"
                @dragenter.prevent="isWorkflowDragging = !isWorkflowLocked"
                @dragover.prevent="isWorkflowDragging = !isWorkflowLocked"
                @dragleave.prevent="isWorkflowDragging = false"
                @drop.prevent="dropWorkflow"
              >
                <button
                  class="performance-test__drop-content"
                  type="button"
                  :disabled="isWorkflowLocked"
                  @click="importWorkflow()"
                >
                  <span v-if="!workflowFilePath && !pendingStarterWorkflowLabel">
                    {{
                      isWorkflowImporting
                        ? t('performanceTest.importingWorkflow')
                        : t('performanceTest.dropWorkflowHint')
                    }}
                  </span>
                  <span v-else class="performance-test__workflow-file">
                    <strong>{{ workflowFileName }}</strong>
                    <code v-if="pendingStarterWorkflowLabel">
                      {{ t('performanceTest.preparingStarterWorkflow') }}
                    </code>
                    <code v-else>{{ workflowFilePath }}</code>
                  </span>
                </button>
                <button
                  v-if="workflowFilePath && !isWorkflowLocked"
                  class="performance-test__delete-workflow"
                  type="button"
                  :aria-label="t('performanceTest.deleteWorkflow')"
                  :title="t('performanceTest.deleteWorkflow')"
                  :disabled="isWorkflowDeleting"
                  @click="deleteWorkflow"
                >
                  <Trash2 :size="18" aria-hidden="true" />
                </button>
              </div>
              <p v-if="workflowImportError" class="performance-test__workflow-error" role="alert">
                {{ workflowImportError }}
              </p>
            </section>

            <section class="performance-test__column">
              <h2>{{ t('performanceTest.measurementSettings') }}</h2>
              <div class="performance-test__setting">
                <label for="performance-test-warmup-runs">
                  {{ t('performanceTest.warmupRuns') }}
                </label>
                <div class="brand-input performance-test__setting-input">
                  <input
                    id="performance-test-warmup-runs"
                    v-model="warmupRuns"
                    type="number"
                    min="1"
                    max="5"
                    step="1"
                    @change="correctWarmupRuns"
                    @blur="correctWarmupRuns"
                  />
                </div>
              </div>
              <div class="performance-test__setting">
                <label for="performance-test-measured-runs">
                  {{ t('performanceTest.measuredRuns') }}
                </label>
                <div class="brand-input performance-test__setting-input">
                  <input
                    id="performance-test-measured-runs"
                    v-model="measuredRuns"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    @change="correctMeasuredRuns"
                    @blur="correctMeasuredRuns"
                  />
                </div>
              </div>
              <div class="performance-test__run-actions">
                <button
                  class="danger-solid performance-test__stop"
                  type="button"
                  :disabled="!canStop"
                  @click="stopPerformanceTestFromUser"
                >
                  {{ isStopping ? t('performanceTest.stopping') : t('performanceTest.stop') }}
                </button>
                <button
                  class="brand-primary performance-test__run"
                  type="button"
                  :disabled="!canRun"
                  @click="runPerformanceTest"
                >
                  {{ isLaunching ? t('performanceTest.running') : t('performanceTest.run') }}
                </button>
              </div>
            </section>
          </div>

          <section class="performance-test__results-section">
            <CollapsibleSectionToggle
              :expanded="resultsExpanded"
              :label="t('performanceTest.results')"
              @toggle="resultsExpanded = !resultsExpanded"
            />
            <div v-show="resultsExpanded" class="performance-test__results">
              <div v-if="isLaunching && totalProgressRuns > 0" class="performance-test__progress">
                <div class="performance-test__progress-heading">
                  <span>{{ t('performanceTest.runProgress') }}</span>
                  <span>
                    {{
                      t('performanceTest.runProgressCount', {
                        completed: completedProgressRuns,
                        total: totalProgressRuns
                      })
                    }}
                  </span>
                </div>
                <div
                  class="performance-test__progress-track"
                  role="progressbar"
                  :aria-label="t('performanceTest.runProgress')"
                  :aria-valuenow="completedProgressRuns"
                  aria-valuemin="0"
                  :aria-valuemax="totalProgressRuns"
                >
                  <i :style="{ width: `${progressPercent}%` }" />
                </div>
              </div>
              <BenchmarkResultDashboard
                v-else-if="hasResult"
                :core-benchmark="coreBenchmark"
                :steady-state-it-per-s="dashboardSteadyStateItPerS"
                :summary="resultsSummary"
                :statistics="performanceTestResult?.statistics ?? null"
                :modality="resultModality"
                :compare-view="compareView"
              />
              <p v-else class="performance-test__results-placeholder">
                {{ t('performanceTest.resultsPlaceholder') }}
              </p>

              <div v-if="resultsFolderPath" class="performance-test__results-actions">
                <span v-if="exportResultsError" class="performance-test__export-error">
                  {{ exportResultsError }}
                </span>
                <button
                  class="secondary performance-test__open-results"
                  type="button"
                  @click="openResultsFolder"
                >
                  <FolderOpen :size="16" aria-hidden="true" />
                  {{ t('performanceTest.openResultsFolder') }}
                </button>
                <button
                  v-if="
                    performanceTestResult?.statistics &&
                    performanceTestResult.systemInfo &&
                    performanceTestResult.hardware
                  "
                  class="secondary performance-test__export-results"
                  type="button"
                  :disabled="isExportingResults"
                  @click="exportResultsImage"
                >
                  <ImageDown :size="16" aria-hidden="true" />
                  {{
                    isExportingResults
                      ? t('performanceTest.exportingImage')
                      : t('performanceTest.exportResultsImage')
                  }}
                </button>
              </div>
            </div>
          </section>
          <section
            class="performance-test__logs-section"
            :class="{ 'performance-test__logs-section--collapsed': !logsExpanded }"
          >
            <CollapsibleSectionToggle
              :expanded="logsExpanded"
              :label="t('settings.logs')"
              @toggle="toggleLogs"
            />
            <div
              v-show="logsExpanded"
              ref="logsElement"
              class="performance-test__logs scroll-visible"
              aria-live="polite"
            >
              {{ performanceTestLogs || t('performanceTest.logsPlaceholder') }}
            </div>
          </section>
        </div>
      </div>

      <div class="performance-test__account">
        <DevPlatformAccountChip />
      </div>
    </div>

    <BaseModal
      :open="isStarterPickerOpen"
      size="xl"
      :aria-label="t('performanceTest.starterWorkflowPickerTitle')"
      content-class="performance-test__starter-modal"
      @close="isStarterPickerOpen = false"
    >
      <template #header>
        <div>
          <h2>{{ t('performanceTest.starterWorkflowPickerTitle') }}</h2>
          <p>{{ t('performanceTest.starterWorkflowPickerDescription') }}</p>
        </div>
      </template>
      <TemplatePickerStep
        :options="starterWorkflowOptions"
        none-value="none"
        :selected-value="selectedStarterWorkflowId"
        :disk-space="null"
        :disk-space-loading="false"
        compact
        @select="selectedStarterWorkflowId = $event.value"
      />
      <template #footer>
        <button class="brand-secondary" type="button" @click="isStarterPickerOpen = false">
          {{ t('common.cancel') }}
        </button>
        <button
          class="brand-primary"
          type="button"
          :disabled="!selectedStarterWorkflowId"
          @click="prepareStarterWorkflow"
        >
          {{ t('performanceTest.useStarterWorkflow') }}
        </button>
      </template>
    </BaseModal>
  </BrandBackground>
</template>

<style scoped>
.performance-test {
  min-height: 0;
}

.performance-test :deep(.brand-outer-frame),
.performance-test :deep(.brand-inner-frame) {
  min-height: 0;
}

.performance-test__layout {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.performance-test__intro {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  min-height: 100%;
  gap: 24px;
  text-align: left;
}

.performance-test__columns {
  display: grid;
  grid-template-columns: minmax(240px, 3fr) repeat(2, minmax(0, 3.5fr));
  gap: 24px;
  width: 100%;
  min-height: 0;
  flex: 0 0 auto;
}

.performance-test__content {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  min-height: 0;
}

.performance-test__column {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
}

.performance-test__column h2 {
  margin: 0;
  color: var(--neutral-200);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.4;
}

.performance-test__setting {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.performance-test__setting label {
  flex: 0 0 68px;
  color: var(--neutral-200);
  font-size: 13px;
  white-space: nowrap;
}

.performance-test__setting-input {
  box-sizing: border-box;
  flex: 0 1 260px;
  width: 260px;
  min-width: 180px;
  min-height: 30px;
  margin-left: auto;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: var(--takeover-fs-caption);
}

.performance-test__selection-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.performance-test__selection-label {
  flex: 0 0 68px;
  color: var(--neutral-200);
  font-size: 13px;
}

.performance-test__selection-control {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  max-width: 320px;
}

.performance-test__workspace-select :deep(.workspace-selector) {
  width: 100%;
}

.performance-test__workspace-select :deep(.workspace-selector__face) {
  --dp-avatar-size: 20px;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 4px 8px;
}

.performance-test__instance-select :deep(.ui-select-trigger) {
  height: 30px;
  padding: 4px 8px;
}

.performance-test__starter-workflow {
  width: 100%;
  min-height: 34px;
}

.performance-test__workflow-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  color: var(--text-faint);
  font-size: 11px;
  text-transform: uppercase;
}

.performance-test__workflow-divider::before,
.performance-test__workflow-divider::after {
  flex: 1;
  height: 1px;
  background: var(--chooser-surface-border);
  content: '';
}

.performance-test__starter-modal h2 {
  margin: 0;
}

.performance-test__starter-modal p {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}

.performance-test__drop-zone,
.performance-test__logs {
  padding: 20px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: var(--chooser-surface-bg);
  color: var(--text-muted);
}

.performance-test__drop-zone {
  position: relative;
  flex: 0 0 auto;
  width: 100%;
  min-height: 104px;
  padding: 0;
  border-width: 1px;
  border-style: dotted;
  transition:
    border-color 120ms ease,
    background-color 120ms ease;
}

.performance-test__drop-zone:hover,
.performance-test__drop-zone:focus-within,
.performance-test__drop-zone--dragging {
  border-color: var(--chooser-surface-border-hover);
  background: var(--chooser-surface-bg-hover);
}

.performance-test__drop-zone:focus-within {
  outline: none;
}

.performance-test__drop-content {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 102px;
  padding: 20px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: center;
  cursor: pointer;
}

.performance-test__drop-zone--selected .performance-test__drop-content {
  justify-content: flex-start;
  padding-right: 56px;
  text-align: left;
}

.performance-test__workflow-file {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.performance-test__workflow-file strong {
  overflow: hidden;
  color: var(--text-primary);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.performance-test__workflow-file code {
  overflow-wrap: anywhere;
  color: var(--text-faint);
  font-size: 11px;
  font-family: inherit;
}

.performance-test__delete-workflow {
  position: absolute;
  top: 50%;
  right: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transform: translateY(-50%);
}

.performance-test__delete-workflow:hover {
  background: var(--chooser-surface-bg-hover);
  color: var(--accent-danger, #d92d20);
}

.performance-test__workflow-error {
  margin: -8px 0 0;
  color: var(--accent-danger, #d92d20);
  font-size: 12px;
  line-height: 1.4;
}

.performance-test__run-actions {
  display: flex;
  align-self: flex-end;
  gap: 8px;
  margin-top: auto;
}

.performance-test__run,
.performance-test__stop {
  min-width: 96px;
}

.performance-test__logs {
  flex: 0 0 clamp(210px, 37.5vh, 360px);
  min-height: 0;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.performance-test__logs-section {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  min-height: 0;
}

.performance-test__logs-section--collapsed {
  flex: 0 0 auto;
}

.performance-test__results-section {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

.performance-test__results {
  padding: 20px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: var(--chooser-surface-bg);
  color: var(--text-muted);
  font-size: 13px;
}

.performance-test__results-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.performance-test__progress {
  display: grid;
  gap: 12px;
}

.performance-test__progress-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: var(--neutral-200);
}

.performance-test__progress-heading span:first-child {
  color: var(--text-primary);
}

.performance-test__progress-track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--chooser-surface-border);
}

.performance-test__progress-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--comfy-yellow);
  transition: width 180ms ease;
}

.performance-test__open-results,
.performance-test__export-results {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.performance-test__export-error {
  margin-right: auto;
  color: var(--danger);
  font-size: 12px;
}

.performance-test__results-placeholder {
  margin: 0;
}

.performance-test__account {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 2;
  display: flex;
  justify-content: flex-end;
  max-width: min(340px, 45%);
}

@media (max-width: 900px) {
  .performance-test__columns {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
