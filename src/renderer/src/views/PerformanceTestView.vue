<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, Download, FolderOpen, ImageDown, Trash2 } from 'lucide-vue-next'
import BrandBackground from '../components/BrandBackground.vue'
import BrandedPageHeader from '../components/BrandedPageHeader.vue'
import ChoiceCard from '../components/ChoiceCard.vue'
import CollapsibleSectionToggle from '../components/CollapsibleSectionToggle.vue'
import BaseSelect, { type BaseSelectOption } from '../components/ui/BaseSelect.vue'
import { useWorkspaceInstallScope } from '../composables/useWorkspaceInstallScope'
import { useAuthStore } from '../stores/authStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type {
  ActionResult,
  PerformanceTestBenchmark,
  PerformanceTestResultsSummary,
  RunPerformanceTestWorkflowResult
} from '../types/ipc'
import {
  createResultsPng,
  createPerformanceTestResultsSvg,
  type PerformanceTestImageMetric
} from '../lib/performanceTestResultsSvg'
import { emitTelemetryAction } from '../lib/telemetry'
import {
  STANDARD_BENCHMARKS,
  type StandardBenchmark
} from '../../../shared/benchmarks/standardBenchmarks'
import {
  compareToPrevious,
  memoryRowLabelKey,
  perImageSeconds,
  tierFromHardware,
  vramPeakView,
  type CompareResult
} from '../lib/benchmarkMetrics'
import type { GpuTier } from '../../../shared/gpuTier'
import DevPlatformAccountChip from './devplatform/DevPlatformAccountChip.vue'
import DevPlatformWorkspaceSelector from './devplatform/DevPlatformWorkspaceSelector.vue'

/** Run phases surfaced in the Results body (design §5). */
type BenchmarkRunPhase = 'idle' | 'downloading' | 'warmup' | 'measuring' | 'done' | 'error'

interface PerformanceTestRunTelemetry {
  readonly installationId: string
  readonly warmupRuns: number
  readonly measuredRuns: number
  readonly startedAtMs: number
}

const { t } = useI18n()
const authStore = useAuthStore()
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
const workflowImportError = ref<string | null>(null)
const isWorkflowDragging = ref(false)
const isWorkflowImporting = ref(false)
const isWorkflowDeleting = ref(false)
const isLaunching = ref(false)
const isStopping = ref(false)
const isWorkflowLocked = computed(() => isLaunching.value || isStopping.value)
const isExportingResults = ref(false)
const exportResultsError = ref<string | null>(null)
const logsExpanded = ref(false)
const resultsExpanded = ref(true)
const warmupRuns = ref('1')
const measuredRuns = ref('5')
// Advanced disclosure (design §2): collapsed by default; its label echoes the
// live warm-up / measured counts so nothing a user needs to *see* is hidden.
const advancedExpanded = ref(false)
const advancedSummaryLabel = computed(() =>
  t('performanceTest.advancedSummary', {
    warmup: warmupRuns.value,
    measured: measuredRuns.value
  })
)
const logInstallationId = ref<string | null>(null)
const performanceTestInstallationId = ref<string | null>(null)
const logsElement = ref<HTMLElement | null>(null)
const performanceTestResult = ref<RunPerformanceTestWorkflowResult | null>(null)

// --- Standard benchmark suite (flag-gated; BYO path is unchanged) ---------
// Standard benchmark suite is always available (additive, opt-in tab; no flag).
const standardSuiteEnabled = ref(true)
const benchmarkSource = ref<'standard' | 'custom'>('standard')
const standardBenchmarks = STANDARD_BENCHMARKS
const selectedBenchmarkId = ref<string | null>(standardBenchmarks[0]?.id ?? null)
/** Per-benchmark on-disk model presence for the selected instance (card badge). */
const modelsPresentById = reactive<Record<string, boolean>>({})
const runPhase = ref<BenchmarkRunPhase>('idle')
const downloadedBytes = ref(0)
const totalDownloadBytes = ref(0)
/** The benchmark that produced the current result (drives the rich headline). */
const resultBenchmark = ref<StandardBenchmark | null>(null)
const priorBenchmarks = ref<PerformanceTestBenchmark[]>([])
/** This machine's GPU tier + VRAM, for the per-card fit note (design §4.2). */
const machineGpu = ref<{ tier: GpuTier; vramGb: number | null } | null>(null)
const selectedBenchmark = computed(
  () => standardBenchmarks.find((benchmark) => benchmark.id === selectedBenchmarkId.value) ?? null
)
/** Standard suite is the active source only when enabled AND selected. */
const isStandardMode = computed(
  () => standardSuiteEnabled.value && benchmarkSource.value === 'standard'
)

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
const computeDeviceNames = computed(() =>
  (performanceTestResult.value?.hardware?.devices ?? [])
    .flatMap((device) => (device.deviceName ? [device.deviceName] : []))
    .join(', ')
)
const aggregateChart = computed(() => {
  const statistics = performanceTestResult.value?.statistics
  if (!statistics) return []

  const aggregates = [
    {
      label: t('performanceTest.fastestRun'),
      value: statistics.fastest.durationSeconds
    },
    {
      label: t('performanceTest.slowestRun'),
      value: statistics.slowest.durationSeconds
    },
    {
      label: t('performanceTest.averageRunDuration'),
      value: statistics.averageDurationSeconds
    },
    {
      label: t('performanceTest.medianRunDuration'),
      value: statistics.medianDurationSeconds
    }
  ]
  const maximum = Math.max(...aggregates.map(({ value }) => value), 0)

  return aggregates.map((aggregate) => ({
    ...aggregate,
    width: maximum > 0 ? `${(aggregate.value / maximum) * 100}%` : '0%'
  }))
})
const workflowFileName = computed(() => workflowFilePath.value?.split(/[\\/]/).pop() ?? '')
const performanceTestSessionId = (installationId: string): string =>
  `performance-test:${installationId}`
const canRun = computed(() => {
  const installationId = selectedInstallationId.value
  const sessionId = installationId ? performanceTestSessionId(installationId) : ''
  // Standard mode needs a selected benchmark; custom mode needs an imported file.
  const sourceReady = isStandardMode.value
    ? Boolean(selectedBenchmarkId.value)
    : Boolean(workflowFilePath.value)
  return Boolean(
    installationId &&
    sourceReady &&
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

const unsubscribeBenchmarkDownload = window.api.onStandardBenchmarkDownloadProgress((progress) => {
  if (progress.installationId !== selectedInstallationId.value) return
  if (progress.benchmarkId !== selectedBenchmarkId.value) return
  downloadedBytes.value = progress.receivedBytes
  totalDownloadBytes.value = progress.totalBytes
})
onUnmounted(unsubscribeBenchmarkDownload)

onMounted(async () => {
  void refreshModelPresence()
  try {
    const info = await window.api.getSystemInfo()
    machineGpu.value = { tier: info.gpu_tier, vramGb: info.gpu_vram_gb }
  } catch {
    machineGpu.value = null
  }
})

/** Resolve on-disk model presence for every benchmark on the selected instance,
 *  so cards show "Downloaded" vs "~size". Best-effort; unresolved reads false. */
async function refreshModelPresence(): Promise<void> {
  const installationId = selectedInstallationId.value
  if (!installationId) {
    for (const benchmark of standardBenchmarks) modelsPresentById[benchmark.id] = false
    return
  }
  await Promise.all(
    standardBenchmarks.map(async (benchmark) => {
      try {
        modelsPresentById[benchmark.id] = await window.api.standardBenchmarkModelsPresent(
          installationId,
          benchmark.id
        )
      } catch {
        modelsPresentById[benchmark.id] = false
      }
    })
  )
}

watch(selectedWorkspaceId, () => {
  selectedInstallationId.value = null
})

watch(selectedInstallationId, () => {
  if (standardSuiteEnabled.value) void refreshModelPresence()
})

// Auto-select the first eligible instance so Run is actionable without an extra
// click (design principle: one obvious primary action). Re-selects when the list
// populates async or the workspace changes (which resets the selection to null).
watch(
  performanceTestInstallations,
  (installations) => {
    if (!selectedInstallationId.value && installations.length > 0) {
      selectedInstallationId.value = installations[0]!.id
    }
  },
  { immediate: true }
)

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
    } else if (!result.canceled) {
      workflowImportError.value = result.message || t('performanceTest.importFailed')
    }
  } catch (error) {
    workflowImportError.value = (error as Error)?.message || t('performanceTest.importFailed')
  } finally {
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
      if (workflowFilePath.value === filePath) workflowFilePath.value = null
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

// --- Standard benchmark: card fit note + rich result metrics (design §4-6) ---

function formatGbFromBytes(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`
}

/** Per-card fit note. Dedicated GPUs get a fit judgement; Apple/CPU get a
 *  recommendation instead (fit is meaningless on unified/shared memory). */
function benchmarkFit(
  benchmark: StandardBenchmark
): { key: string; params?: Record<string, number>; tone: 'neutral' | 'caution' } | null {
  const gpu = machineGpu.value
  if (!gpu) return null
  if (gpu.tier === 'apple' || gpu.tier === 'cpu_only') {
    return {
      key: 'performanceTest.tierRecommended',
      params: { gb: benchmark.vramTierGb },
      tone: 'neutral'
    }
  }
  const vramGb = gpu.vramGb ?? 0
  return vramGb >= benchmark.vramTierGb
    ? { key: 'performanceTest.fitsVram', tone: 'neutral' }
    : { key: 'performanceTest.mayExceedVram', tone: 'caution' }
}

/** True once a standard run has produced a result worth the rich headline. */
const showBenchmarkHeadline = computed(
  () =>
    standardSuiteEnabled.value &&
    resultBenchmark.value !== null &&
    Boolean(performanceTestResult.value?.resultsSummary)
)

const headlineTier = computed<GpuTier | null>(() => {
  const hardware = performanceTestResult.value?.resultsSummary?.hardware
  if (!hardware) return null
  return tierFromHardware({
    backend: hardware.backend,
    deviceType: hardware.deviceType,
    vramMb: hardware.vramMb
  })
})

const medianPerImageSeconds = computed(() => {
  const summary = performanceTestResult.value?.resultsSummary
  const benchmark = resultBenchmark.value
  if (!summary || !benchmark) return null
  return perImageSeconds(summary.medianJobDurationSeconds, benchmark.imagesPerRun)
})

const vramPeak = computed(() => {
  const hardware = performanceTestResult.value?.resultsSummary?.hardware
  const tier = headlineTier.value
  if (!hardware || !tier) return null
  return vramPeakView({
    tier,
    peakMb: hardware.peakVramMb,
    totalMb: hardware.vramTotalMb ?? hardware.vramMb,
    ramMb: hardware.ramMb
  })
})

const compareResult = computed<CompareResult | null>(() => {
  const summary = performanceTestResult.value?.resultsSummary
  const benchmark = resultBenchmark.value
  if (!summary || !benchmark) return null
  const hardwareName = summary.hardware?.deviceName ?? summary.hardware?.deviceType ?? null
  return compareToPrevious({
    currentPerImageSeconds: medianPerImageSeconds.value,
    imagesPerRun: benchmark.imagesPerRun,
    workflowName: summary.workflowName,
    hardwareName,
    priorBenchmarks: priorBenchmarks.value
  })
})

const benchmarkContextLine = computed(() => {
  const summary = performanceTestResult.value?.resultsSummary
  const benchmark = resultBenchmark.value
  if (!summary || !benchmark) return ''
  const device = computeDeviceNames.value || summary.hardware?.deviceType || ''
  const datetime = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(summary.createdAt))
  return t('performanceTest.contextLine', { name: benchmark.name, device, datetime })
})

const benchmarkRangeRow = computed(() => {
  const summary = performanceTestResult.value?.resultsSummary
  const benchmark = resultBenchmark.value
  if (
    !summary ||
    !benchmark ||
    summary.fastestJobDurationSeconds == null ||
    summary.slowestJobDurationSeconds == null ||
    summary.averageJobDurationSeconds == null
  ) {
    return ''
  }
  const perImage = benchmark.imagesPerRun || 1
  return t('performanceTest.rangeRow', {
    min: (summary.fastestJobDurationSeconds / perImage).toFixed(2),
    max: (summary.slowestJobDurationSeconds / perImage).toFixed(2),
    avg: (summary.averageJobDurationSeconds / perImage).toFixed(2),
    n: summary.measuredJobCount,
    failed: summary.failedRunCount
  })
})

/** Backend-aware label for the System information VRAM/memory row. */
const memoryRowLabel = computed(() => t(memoryRowLabelKey(headlineTier.value ?? 'cpu_only')))

/** Progress phase label for the Results body during a standard run (design §5). */
const benchmarkPhaseLabel = computed(() => {
  const warmups = Number(warmupRuns.value)
  const measured = Number(measuredRuns.value)
  if (completedProgressRuns.value < warmups) {
    return t('performanceTest.warmingUp', {
      done: Math.min(completedProgressRuns.value + 1, warmups),
      total: warmups
    })
  }
  return t('performanceTest.measuring', {
    done: Math.min(completedProgressRuns.value - warmups + 1, measured),
    total: measured
  })
})

const downloadPercent = computed(() =>
  totalDownloadBytes.value > 0
    ? Math.min(100, Math.round((downloadedBytes.value / totalDownloadBytes.value) * 100))
    : 0
)

/**
 * Prepare a standard run: download missing models (download phase) and copy the
 * pinned API-format workflow into a managed session dir. Returns the workflow
 * path to run, or null on failure/abort (message already logged).
 */
async function prepareStandardRun(
  installationId: string,
  sessionId: string
): Promise<string | null> {
  const benchmark = selectedBenchmark.value
  if (!benchmark) return null
  runPhase.value = 'downloading'
  downloadedBytes.value = 0
  totalDownloadBytes.value = benchmark.downloadBytes
  const models = await window.api.ensureStandardBenchmarkModels(installationId, benchmark.id)
  if (!models.ok || !models.present) {
    sessionStore.appendOutput(
      sessionId,
      `${models.message || t('performanceTest.benchmarkModelDownloadFailed')}\n`
    )
    return null
  }
  modelsPresentById[benchmark.id] = true
  const prepared = await window.api.prepareStandardBenchmarkWorkflow(benchmark.id)
  if (!prepared.ok || !prepared.filePath) {
    sessionStore.appendOutput(
      sessionId,
      `${prepared.message || t('performanceTest.submitFailed')}\n`
    )
    return null
  }
  return prepared.filePath
}

async function runPerformanceTest(): Promise<void> {
  const installationId = selectedInstallationId.value
  const standardBenchmarkForRun = isStandardMode.value ? selectedBenchmark.value : null
  // Standard mode resolves its file path after preparing (download + copy);
  // custom mode uses the imported workflow directly.
  let filePath = isStandardMode.value ? null : workflowFilePath.value
  if (
    !installationId ||
    (isStandardMode.value ? !standardBenchmarkForRun : !filePath) ||
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
  resultBenchmark.value = null
  runPhase.value = 'idle'
  progressSessionId.value = sessionId
  completedProgressRuns.value = 0
  totalProgressRuns.value = warmups + runs
  try {
    if (sessionStore.isRunning(sessionId)) await window.api.stopComfyUI(sessionId)
    logInstallationId.value = sessionId
    performanceTestInstallationId.value = installationId
    sessionStore.startSession(sessionId)
    if (standardBenchmarkForRun) {
      filePath = await prepareStandardRun(installationId, sessionId)
      if (token !== runToken) return
      if (!filePath) {
        runPhase.value = 'error'
        performanceTestInstallationId.value = null
        return
      }
    }
    runPhase.value = 'measuring'
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
    if (!filePath) return
    try {
      const submission = await window.api.runPerformanceTestWorkflow(
        sessionId,
        filePath,
        runs,
        warmups
      )
      if (submission.ok) {
        performanceTestResult.value = submission
        runPhase.value = 'done'
        if (standardBenchmarkForRun) {
          resultBenchmark.value = standardBenchmarkForRun
          try {
            // Exclude the run we just saved so compare-to-previous looks at
            // genuinely prior runs, not itself.
            const summaryPath = submission.resultsSummaryPath
            const currentSessionId = summaryPath
              ? (summaryPath.split(/[\\/]/).slice(-2, -1)[0] ?? null)
              : null
            const list = await window.api.listPerformanceTestBenchmarks()
            priorBenchmarks.value = list.benchmarks.filter(
              (benchmark) => benchmark.id !== currentSessionId
            )
          } catch {
            priorBenchmarks.value = []
          }
        }
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
      if (!submission.ok) runPhase.value = 'error'
      if (submission.ok) await stopPerformanceTest()
    } catch (error) {
      runPhase.value = 'error'
      sessionStore.appendOutput(
        sessionId,
        `${(error as Error)?.message || t('performanceTest.submitFailed')}\n`
      )
    }
  } catch (error) {
    runPhase.value = 'error'
    sessionStore.appendOutput(
      sessionId,
      (error as Error)?.message || t('performanceTest.launchFailed')
    )
    performanceTestInstallationId.value = null
  } finally {
    const logs = sessionStore.getSession(sessionId)?.output
    if (filePath && logs !== undefined) {
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

function formatDuration(seconds: number): string {
  return `${seconds.toFixed(3)} s`
}

function formatMemory(megabytes: number): string {
  return `${(megabytes / 1024).toFixed(1)} GB`
}

function formatOperatingSystem(info: PerformanceTestResultsSummary['systemInfo']): string {
  return (
    [info.os_distro, info.os_release].filter(Boolean).join(' ') ||
    `${info.platform} ${info.os_version}`
  )
}

function openResultsFolder(): void {
  if (resultsFolderPath.value) void window.api.openPath(resultsFolderPath.value)
}

async function exportResultsImage(): Promise<void> {
  const summaryPath = performanceTestResult.value?.resultsSummaryPath
  const defaultPath = resultsFolderPath.value
  if (!summaryPath || !defaultPath) return
  isExportingResults.value = true
  exportResultsError.value = null
  try {
    const summary = await window.api.readPerformanceTestResultsSummary(summaryPath)
    const hardware = summary.hardware
    const fastest = summary.fastestJobDurationSeconds
    const slowest = summary.slowestJobDurationSeconds
    const average = summary.averageJobDurationSeconds
    const median = summary.medianJobDurationSeconds
    if (!hardware || fastest === null || slowest === null || average === null || median === null) {
      throw new Error(t('performanceTest.exportImageFailed'))
    }
    const hardwareRows: PerformanceTestImageMetric[] = [
      {
        label: t('performanceTest.device'),
        value: hardware.devices.flatMap((device) => device.deviceName ?? []).join(', ')
      }
    ]
    if (hardware.vramMb != null)
      hardwareRows.push({ label: t('performanceTest.vram'), value: formatMemory(hardware.vramMb) })
    if (hardware.ramMb != null)
      hardwareRows.push({ label: t('performanceTest.ram'), value: formatMemory(hardware.ramMb) })
    if (hardware.pytorchVersion)
      hardwareRows.push({
        label: t('performanceTest.pytorchVersion'),
        value: hardware.pytorchVersion
      })
    if (hardware.xformersVersion)
      hardwareRows.push({
        label: t('performanceTest.xformersVersion'),
        value: hardware.xformersVersion
      })

    const svg = createPerformanceTestResultsSvg({
      title: t('performanceTest.imageTitle', { workflowName: summary.workflowName }),
      aggregateTitle: t('performanceTest.runDurationChart'),
      systemInformationTitle: t('performanceTest.systemInformation'),
      testDateTime: new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(summary.createdAt)),
      metrics: [
        {
          label: t('performanceTest.measuredRunCount'),
          value: String(summary.measuredJobCount)
        },
        {
          label: t('performanceTest.failedRunCount'),
          value: String(summary.failedRunCount)
        },
        {
          label: t('performanceTest.fastestRun'),
          value: formatDuration(fastest),
          durationSeconds: fastest
        },
        {
          label: t('performanceTest.slowestRun'),
          value: formatDuration(slowest),
          durationSeconds: slowest
        },
        {
          label: t('performanceTest.averageRunDuration'),
          value: formatDuration(average),
          durationSeconds: average
        },
        {
          label: t('performanceTest.medianRunDuration'),
          value: formatDuration(median),
          durationSeconds: median
        }
      ],
      hardware: hardwareRows,
      system: [
        { label: t('performanceTest.cpu'), value: summary.systemInfo.cpu_model },
        { label: t('performanceTest.cpuCores'), value: String(summary.systemInfo.cpu_cores) },
        { label: t('performanceTest.architecture'), value: summary.systemInfo.arch },
        {
          label: t('performanceTest.operatingSystem'),
          value: formatOperatingSystem(summary.systemInfo)
        }
      ]
    })
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
          <div class="performance-test__context-bar">
            <span class="performance-test__context-label">{{ t('performanceTest.runOn') }}</span>
            <div class="performance-test__workspace-select">
              <DevPlatformWorkspaceSelector v-model="selectedWorkspaceId" />
            </div>
            <div class="performance-test__instance-select">
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

          <div
            v-if="standardSuiteEnabled"
            class="performance-test__source-toggle"
            role="radiogroup"
            :aria-label="t('performanceTest.sourceLabel')"
          >
            <button
              type="button"
              role="radio"
              :aria-checked="benchmarkSource === 'standard'"
              class="performance-test__source-option"
              :class="{
                'performance-test__source-option--active': benchmarkSource === 'standard'
              }"
              :disabled="isWorkflowLocked"
              @click="benchmarkSource = 'standard'"
            >
              {{ t('performanceTest.sourceStandard') }}
            </button>
            <button
              type="button"
              role="radio"
              :aria-checked="benchmarkSource === 'custom'"
              class="performance-test__source-option"
              :class="{
                'performance-test__source-option--active': benchmarkSource === 'custom'
              }"
              :disabled="isWorkflowLocked"
              @click="benchmarkSource = 'custom'"
            >
              {{ t('performanceTest.sourceCustom') }}
            </button>
          </div>

          <div
            v-if="isStandardMode"
            class="performance-test__benchmark-cards"
            role="radiogroup"
            :aria-label="t('performanceTest.chooseBenchmark')"
          >
            <ChoiceCard
              v-for="benchmark in standardBenchmarks"
              :key="benchmark.id"
              selectable
              :selected="selectedBenchmarkId === benchmark.id"
              :tab-stop="selectedBenchmarkId === benchmark.id"
              :disabled="isWorkflowLocked"
              :label="benchmark.name"
              :description="`${benchmark.measures} · ${benchmark.specLine}`"
              @click="selectedBenchmarkId = benchmark.id"
            >
              <template #label-trailing>
                <span
                  v-if="modelsPresentById[benchmark.id]"
                  class="performance-test__download-badge performance-test__download-badge--present"
                  :title="
                    t('performanceTest.downloadedWithSize', {
                      size: formatGbFromBytes(benchmark.downloadBytes)
                    })
                  "
                >
                  {{ t('performanceTest.downloaded') }}
                </span>
                <span
                  v-else
                  class="performance-test__download-badge"
                  :title="t('performanceTest.downloadsOnFirstRun')"
                >
                  {{
                    t('performanceTest.downloadPending', {
                      size: formatGbFromBytes(benchmark.downloadBytes)
                    })
                  }}
                  <Download :size="13" aria-hidden="true" />
                </span>
              </template>
              <template #desc-trailing>
                <span class="performance-test__tier-row">
                  <span class="performance-test__tier-chip">
                    {{ t('performanceTest.tierChip', { gb: benchmark.vramTierGb }) }}
                  </span>
                  <span
                    v-if="benchmarkFit(benchmark)"
                    class="performance-test__fit-note"
                    :class="{
                      'performance-test__fit-note--caution':
                        benchmarkFit(benchmark)?.tone === 'caution'
                    }"
                  >
                    {{ t(benchmarkFit(benchmark)!.key, benchmarkFit(benchmark)!.params ?? {}) }}
                  </span>
                </span>
              </template>
            </ChoiceCard>
          </div>

          <template v-else>
            <div
              class="performance-test__drop-zone"
              :class="{
                'performance-test__drop-zone--dragging': isWorkflowDragging,
                'performance-test__drop-zone--selected': workflowFilePath
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
                <span v-if="!workflowFilePath">
                  {{
                    isWorkflowImporting
                      ? t('performanceTest.importingWorkflow')
                      : t('performanceTest.dropWorkflowHint')
                  }}
                </span>
                <span v-else class="performance-test__workflow-file">
                  <strong>{{ workflowFileName }}</strong>
                  <code>{{ workflowFilePath }}</code>
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
          </template>

          <div class="performance-test__advanced">
            <CollapsibleSectionToggle
              :expanded="advancedExpanded"
              :label="advancedSummaryLabel"
              @toggle="advancedExpanded = !advancedExpanded"
            />
            <div v-show="advancedExpanded" class="performance-test__advanced-body">
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
              <p class="performance-test__advanced-note">
                {{ t('performanceTest.advancedHelper') }}
              </p>
            </div>
          </div>

          <div class="performance-test__run-actions">
            <button
              v-if="isLaunching || isStopping"
              class="danger-solid performance-test__stop"
              type="button"
              :disabled="!canStop"
              @click="stopPerformanceTestFromUser"
            >
              {{ isStopping ? t('performanceTest.stopping') : t('performanceTest.stop') }}
            </button>
            <button
              v-else
              class="brand-primary performance-test__run"
              type="button"
              :disabled="!canRun"
              @click="runPerformanceTest"
            >
              {{ isStandardMode ? t('performanceTest.runBenchmark') : t('performanceTest.run') }}
            </button>
          </div>

          <section class="performance-test__results-section">
            <CollapsibleSectionToggle
              :expanded="resultsExpanded"
              :label="t('performanceTest.results')"
              @toggle="resultsExpanded = !resultsExpanded"
            />
            <div v-show="resultsExpanded" class="performance-test__results">
              <div
                v-if="isLaunching && isStandardMode && runPhase === 'downloading'"
                class="performance-test__progress"
              >
                <div class="performance-test__progress-heading">
                  <span>
                    {{
                      t('performanceTest.downloadingModels', {
                        name: selectedBenchmark?.name ?? ''
                      })
                    }}
                  </span>
                  <span>
                    {{
                      t('performanceTest.downloadingProgress', {
                        received: formatGbFromBytes(downloadedBytes),
                        total: formatGbFromBytes(totalDownloadBytes)
                      })
                    }}
                  </span>
                </div>
                <div
                  class="performance-test__progress-track"
                  role="progressbar"
                  :aria-valuenow="downloadPercent"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <i :style="{ width: `${downloadPercent}%` }" />
                </div>
                <p class="performance-test__phase-note">
                  {{ t('performanceTest.downloadOnceNote') }}
                </p>
              </div>
              <div
                v-else-if="isLaunching && totalProgressRuns > 0"
                class="performance-test__progress"
              >
                <div class="performance-test__progress-heading">
                  <span>{{
                    isStandardMode ? benchmarkPhaseLabel : t('performanceTest.runProgress')
                  }}</span>
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
              <template v-else-if="performanceTestResult?.resultsSummary">
                <div v-if="showBenchmarkHeadline" class="performance-test__benchmark-headline">
                  <p class="performance-test__context-line">{{ benchmarkContextLine }}</p>
                  <div class="performance-test__headline-band">
                    <div class="performance-test__headline-stat">
                      <div class="performance-test__headline-value">
                        <template v-if="medianPerImageSeconds != null">
                          {{ medianPerImageSeconds.toFixed(2) }}
                          <span class="performance-test__headline-unit">
                            {{
                              resultBenchmark
                                ? t('performanceTest.secPerImage')
                                : t('performanceTest.secPerRun')
                            }}
                          </span>
                        </template>
                        <template v-else>{{ t('performanceTest.peakNotMeasured') }}</template>
                      </div>
                      <p class="performance-test__headline-sub">
                        {{
                          t('performanceTest.medianOfRuns', {
                            n: performanceTestResult.resultsSummary.measuredJobCount
                          })
                        }}
                      </p>
                      <p
                        v-if="compareResult && compareResult.kind !== 'first'"
                        class="performance-test__compare"
                        :class="{
                          'performance-test__compare--positive': compareResult.tone === 'positive',
                          'performance-test__compare--caution': compareResult.tone === 'caution'
                        }"
                      >
                        <ArrowUp
                          v-if="compareResult.kind === 'faster'"
                          :size="14"
                          aria-hidden="true"
                        />
                        <ArrowDown
                          v-else-if="compareResult.kind === 'slower'"
                          :size="14"
                          aria-hidden="true"
                        />
                        <span v-if="compareResult.kind === 'faster'">
                          {{
                            t('performanceTest.deltaFaster', {
                              pct: compareResult.pct,
                              prev: compareResult.prevSeconds.toFixed(2)
                            })
                          }}
                        </span>
                        <span v-else-if="compareResult.kind === 'slower'">
                          {{
                            t('performanceTest.deltaSlower', {
                              pct: compareResult.pct,
                              prev: compareResult.prevSeconds.toFixed(2)
                            })
                          }}
                        </span>
                        <span v-else-if="compareResult.kind === 'same'">
                          {{
                            t('performanceTest.deltaSame', {
                              prev: compareResult.prevSeconds.toFixed(2)
                            })
                          }}
                        </span>
                        <span v-else-if="compareResult.kind === 'differentGpu'">
                          {{ t('performanceTest.deltaDifferentGpu') }}
                        </span>
                      </p>
                      <p
                        v-else-if="compareResult && compareResult.kind === 'first'"
                        class="performance-test__compare"
                      >
                        {{ t('performanceTest.deltaFirstRun') }}
                      </p>
                    </div>
                    <div v-if="vramPeak" class="performance-test__headline-stat">
                      <div class="performance-test__headline-value">
                        <template v-if="!vramPeak.notMeasured && vramPeak.peakGb != null">
                          {{ vramPeak.peakGb }} GB
                          <span class="performance-test__headline-unit">
                            {{ t(vramPeak.headlineKey) }}
                          </span>
                        </template>
                        <template v-else>
                          {{ t(vramPeak.headlineKey) }} {{ t('performanceTest.peakNotMeasured') }}
                        </template>
                      </div>
                      <p
                        v-if="!vramPeak.notMeasured && vramPeak.secondLine"
                        class="performance-test__headline-sub"
                        :class="{
                          'performance-test__compare--caution': vramPeak.tone === 'caution'
                        }"
                      >
                        {{ t(vramPeak.secondLine.key, vramPeak.secondLine.params) }}
                      </p>
                    </div>
                  </div>
                  <p v-if="benchmarkRangeRow" class="performance-test__range-row">
                    {{ benchmarkRangeRow }}
                  </p>
                </div>
                <div class="performance-test__summary">
                  <div class="performance-test__summary-column">
                    <dl class="performance-test__result-list">
                      <div class="performance-test__result-workflow">
                        <dt>{{ t('performanceTest.workflowFileName') }}</dt>
                        <dd>{{ performanceTestResult.resultsSummary.workflowName }}</dd>
                      </div>
                    </dl>
                    <div
                      v-if="performanceTestResult.statistics"
                      class="performance-test__aggregate-chart"
                      role="img"
                      :aria-label="t('performanceTest.runDurationChart')"
                    >
                      <div
                        v-for="aggregate in aggregateChart"
                        :key="aggregate.label"
                        class="performance-test__aggregate-bar"
                      >
                        <span>{{ aggregate.label }}</span>
                        <div aria-hidden="true">
                          <i :style="{ width: aggregate.width }" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <dl class="performance-test__result-list performance-test__timing-list">
                    <div>
                      <dt>{{ t('performanceTest.measuredRunCount') }}</dt>
                      <dd>{{ performanceTestResult.resultsSummary.measuredJobCount }}</dd>
                    </div>
                    <div>
                      <dt>{{ t('performanceTest.failedRunCount') }}</dt>
                      <dd>{{ performanceTestResult.resultsSummary.failedRunCount }}</dd>
                    </div>
                    <template v-if="performanceTestResult.statistics">
                      <div>
                        <dt>{{ t('performanceTest.fastestRun') }}</dt>
                        <dd>
                          {{
                            formatDuration(performanceTestResult.statistics.fastest.durationSeconds)
                          }}
                        </dd>
                      </div>
                      <div>
                        <dt>{{ t('performanceTest.averageRunDuration') }}</dt>
                        <dd>
                          {{
                            formatDuration(performanceTestResult.statistics.averageDurationSeconds)
                          }}
                        </dd>
                      </div>
                      <div>
                        <dt>{{ t('performanceTest.slowestRun') }}</dt>
                        <dd>
                          {{
                            formatDuration(performanceTestResult.statistics.slowest.durationSeconds)
                          }}
                        </dd>
                      </div>
                      <div>
                        <dt>{{ t('performanceTest.medianRunDuration') }}</dt>
                        <dd>
                          {{
                            formatDuration(performanceTestResult.statistics.medianDurationSeconds)
                          }}
                        </dd>
                      </div>
                    </template>
                  </dl>
                </div>
              </template>
              <p v-else class="performance-test__results-placeholder">
                {{
                  standardSuiteEnabled
                    ? t('performanceTest.idlePlaceholder')
                    : t('performanceTest.resultsPlaceholder')
                }}
              </p>

              <template v-if="performanceTestResult?.hardware">
                <h3>{{ t('performanceTest.systemInformation') }}</h3>
                <div class="performance-test__system-groups">
                  <section class="performance-test__system-group">
                    <dl
                      class="performance-test__result-list performance-test__result-list--compact"
                    >
                      <div>
                        <dt>{{ t('performanceTest.device') }}</dt>
                        <dd>{{ computeDeviceNames }}</dd>
                      </div>
                      <div v-if="performanceTestResult.hardware.vramMb != null">
                        <dt>
                          {{ showBenchmarkHeadline ? memoryRowLabel : t('performanceTest.vram') }}
                        </dt>
                        <dd>{{ formatMemory(performanceTestResult.hardware.vramMb) }}</dd>
                      </div>
                      <div v-if="performanceTestResult.hardware.ramMb != null">
                        <dt>{{ t('performanceTest.ram') }}</dt>
                        <dd>{{ formatMemory(performanceTestResult.hardware.ramMb) }}</dd>
                      </div>
                      <div
                        v-if="showBenchmarkHeadline && performanceTestResult.hardware.driverVersion"
                      >
                        <dt>{{ t('performanceTest.driverVersion') }}</dt>
                        <dd>{{ performanceTestResult.hardware.driverVersion }}</dd>
                      </div>
                      <div v-if="performanceTestResult.hardware.pytorchVersion">
                        <dt>{{ t('performanceTest.pytorchVersion') }}</dt>
                        <dd>{{ performanceTestResult.hardware.pytorchVersion }}</dd>
                      </div>
                      <div v-if="performanceTestResult.hardware.xformersVersion">
                        <dt>{{ t('performanceTest.xformersVersion') }}</dt>
                        <dd>{{ performanceTestResult.hardware.xformersVersion }}</dd>
                      </div>
                    </dl>
                  </section>

                  <section
                    v-if="performanceTestResult.systemInfo"
                    class="performance-test__system-group"
                  >
                    <dl
                      class="performance-test__result-list performance-test__result-list--compact"
                    >
                      <div>
                        <dt>{{ t('performanceTest.cpu') }}</dt>
                        <dd>{{ performanceTestResult.systemInfo.cpu_model }}</dd>
                      </div>
                      <div>
                        <dt>{{ t('performanceTest.cpuCores') }}</dt>
                        <dd>{{ performanceTestResult.systemInfo.cpu_cores }}</dd>
                      </div>
                      <div>
                        <dt>{{ t('performanceTest.architecture') }}</dt>
                        <dd>{{ performanceTestResult.systemInfo.arch }}</dd>
                      </div>
                      <div>
                        <dt>{{ t('performanceTest.operatingSystem') }}</dt>
                        <dd>{{ formatOperatingSystem(performanceTestResult.systemInfo) }}</dd>
                      </div>
                    </dl>
                  </section>
                </div>
              </template>

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

.performance-test__context-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  width: 100%;
  flex: 0 0 auto;
}

.performance-test__context-label {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 12px;
}

.performance-test__workspace-select,
.performance-test__instance-select {
  flex: 0 1 240px;
  min-width: 0;
  max-width: 280px;
}

.performance-test__content {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  min-height: 0;
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

.performance-test__drop-zone,
.performance-test__logs {
  padding: 20px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: var(--chooser-surface-bg);
  color: var(--text-muted);
}

/* --- Standard benchmark suite (flag-gated) --- */
.performance-test__source-toggle {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: var(--chooser-surface-bg);
}

.performance-test__source-option {
  padding: 5px 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.performance-test__source-option--active {
  background: var(--chooser-surface-bg-hover);
  color: var(--text-primary);
}

.performance-test__source-option:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.performance-test__benchmark-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.performance-test__download-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 400;
}

.performance-test__download-badge--present {
  color: var(--accent-positive, var(--comfy-yellow));
}

.performance-test__tier-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.performance-test__tier-chip {
  padding: 2px 8px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 999px;
  font-size: 11px;
}

.performance-test__fit-note {
  color: var(--text-muted);
  font-size: 11px;
}

.performance-test__fit-note--caution {
  color: var(--accent-caution, #d9822b);
}

.performance-test__benchmark-headline {
  display: grid;
  gap: 12px;
  margin-bottom: 20px;
}

.performance-test__context-line {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.performance-test__headline-band {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.performance-test__headline-stat {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--chooser-surface-bg-hover) 45%, transparent);
}

.performance-test__headline-value {
  color: var(--text-primary);
  font-size: 32px;
  line-height: 1.15;
}

.performance-test__headline-unit {
  color: var(--text-muted);
  font-size: 15px;
}

.performance-test__headline-sub {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.performance-test__compare {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.performance-test__compare--positive {
  color: var(--accent-positive, var(--comfy-yellow));
}

.performance-test__compare--caution {
  color: var(--accent-danger, #d92d20);
}

.performance-test__range-row {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.performance-test__phase-note {
  margin: 4px 0 0;
  color: var(--text-faint);
  font-size: 11px;
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

.performance-test__advanced {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.performance-test__advanced-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 340px;
}

.performance-test__advanced-note {
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.4;
}

.performance-test__run-actions {
  display: flex;
  align-self: flex-end;
  gap: 8px;
}

.performance-test__run,
.performance-test__stop {
  min-width: 140px;
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

.performance-test__result-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 24px;
  margin: 0;
}

.performance-test__result-list div {
  min-width: 0;
}

.performance-test__result-list dt {
  color: var(--neutral-200);
}

.performance-test__result-list dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  font-size: 24px;
  line-height: 1.25;
}

.performance-test__summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
}

.performance-test__timing-list {
  align-content: start;
}

.performance-test__summary-column > .performance-test__result-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.performance-test__result-workflow {
  grid-column: 1 / -1;
}

.performance-test__summary .performance-test__result-list dt,
.performance-test__summary .performance-test__result-list dd {
  text-align: right;
}

.performance-test__summary-column .performance-test__result-list dt,
.performance-test__summary-column .performance-test__result-list dd {
  text-align: left;
}

.performance-test__aggregate-chart {
  display: grid;
  gap: 5px;
  margin-top: 32px;
}

.performance-test__aggregate-bar {
  display: grid;
  grid-template-columns: 110px minmax(40px, 1fr);
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.2;
}

.performance-test__aggregate-bar > div {
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--chooser-surface-border);
}

.performance-test__aggregate-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--comfy-yellow);
}

.performance-test__result-list--compact {
  grid-template-columns: minmax(0, 1fr);
  gap: 8px 24px;
}

.performance-test__system-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.performance-test__system-group {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--chooser-surface-bg-hover) 45%, transparent);
}

.performance-test__result-list--compact div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--chooser-surface-border);
}

.performance-test__result-list--compact dt {
  flex: 0 0 auto;
  font-size: 12px;
}

.performance-test__result-list--compact dd {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.3;
  text-align: right;
}

.performance-test__results
  h3
  + .performance-test__result-list:not(.performance-test__result-list--compact)
  dd {
  color: var(--text-muted);
  font-size: 13px;
  line-height: inherit;
}

.performance-test__results h3 {
  margin: 20px 0 12px;
  color: var(--neutral-200);
  font-size: 13px;
  font-weight: 400;
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

@media (max-width: 640px) {
  .performance-test__headline-band {
    grid-template-columns: minmax(0, 1fr);
  }

  .performance-test__summary {
    grid-template-columns: minmax(0, 1fr);
  }

  .performance-test__system-groups {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
