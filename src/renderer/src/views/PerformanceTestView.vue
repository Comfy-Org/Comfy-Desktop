<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, toRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpen, ImageDown, Trash2 } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import BrandBackground from '../components/BrandBackground.vue'
import BrandedPageHeader from '../components/BrandedPageHeader.vue'
import CollapsibleSectionToggle from '../components/CollapsibleSectionToggle.vue'
import InfoTooltip from '../components/InfoTooltip.vue'
import TemplatePickerStep from '../components/TemplatePickerStep.vue'
import BaseModal from '../components/ui/BaseModal.vue'
import BaseSelect, { type BaseSelectOption } from '../components/ui/BaseSelect.vue'
import { usePerformanceTestExampleWorkflow } from '../composables/usePerformanceTestExampleWorkflow'
import { useWorkspaceInstallScope } from '../composables/useWorkspaceInstallScope'
import { useAuthStore } from '../stores/authStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type {
  ActionResult,
  PerformanceTestResultsSummary,
  RunPerformanceTestWorkflowResult
} from '../types/ipc'
import {
  createResultsPng,
  createPerformanceTestResultsSvg,
  type PerformanceTestImageMetric
} from '../lib/performanceTestResultsSvg'
import { emitTelemetryAction } from '../lib/telemetry'
import { performanceTestSessionKey } from '../../../shared/performanceTestSession'
import DevPlatformAccountChip from './devplatform/DevPlatformAccountChip.vue'
import DevPlatformWorkspaceSelector from './devplatform/DevPlatformWorkspaceSelector.vue'

const brandButtonClass =
  'inline-flex items-center justify-center rounded-lg border border-solid px-4 py-2.5 font-sans text-[length:var(--takeover-fs-body)] leading-[inherit] font-medium whitespace-normal appearance-auto transition-[background,border-color,color] duration-[120ms] ease-[ease] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] focus-visible:[outline-style:solid] disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-55'
const primaryButtonClass =
  'border-comfy-yellow bg-comfy-yellow text-neutral-900 disabled:hover:border-comfy-yellow disabled:hover:bg-comfy-yellow hover:enabled:border-[color-mix(in_srgb,var(--comfy-yellow)_88%,#000)] hover:enabled:bg-[color-mix(in_srgb,var(--comfy-yellow)_88%,#000)] focus-visible:outline-[color-mix(in_srgb,var(--comfy-yellow)_80%,var(--neutral-100))]'
const secondaryButtonClass =
  'border-border bg-secondary text-foreground disabled:hover:border-border disabled:hover:bg-secondary hover:enabled:border-border-strong hover:enabled:bg-accent'
const ordinaryButtonClass =
  'inline-flex items-center gap-2 rounded-lg border border-solid border-[var(--border)] bg-surface px-4 py-2 font-sans text-[14px] leading-[1.5] font-normal whitespace-normal appearance-auto transition-none hover:bg-[var(--border)] focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] disabled:pointer-events-auto disabled:cursor-default disabled:opacity-40'
const resultListClass =
  'grid gap-x-6 m-0 [&>div]:min-w-0 [&_dt]:text-neutral-200 [&_dt]:[text-align:var(--perf-label-align,left)] [&_dd]:mt-[var(--perf-value-margin,4px)] [&_dd]:[overflow-wrap:anywhere] [&_dd]:[color:var(--perf-value-color,var(--text-primary))] [&_dd]:text-[length:var(--perf-value-size,24px)] [&_dd]:leading-[var(--perf-value-leading,1.25)] [&_dd]:[text-align:var(--perf-value-align,left)]'
const compactResultListClass =
  'grid-cols-1 gap-y-2 [--perf-value-margin:0px] [--perf-value-size:12px] [--perf-value-leading:1.3] [--perf-value-color:var(--text-muted)] [--perf-value-align:right] [--perf-label-align:left] [&>div]:flex [&>div]:items-baseline [&>div]:justify-between [&>div]:gap-2 [&>div]:pb-1 [&>div]:border-b [&>div]:border-solid [&>div]:border-[var(--chooser-surface-border)] [&_dt]:flex-none [&_dt]:text-[12px]'

interface PerformanceTestRunTelemetry {
  readonly installationId: string
  readonly workflowName: string
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
const {
  options: exampleWorkflowOptions,
  diskSpace: exampleDiskSpace,
  selectedId: selectedExampleWorkflowId,
  isPickerOpen: isExamplePickerOpen,
  isPickerLoading: isExamplePickerLoading,
  diskError: exampleDiskError,
  pendingLabel: pendingExampleWorkflowLabel,
  displayName: workflowDisplayName,
  download: exampleDownload,
  isForOtherInstallation: isExampleForOtherInstallation,
  openPicker: openExampleWorkflowPicker,
  prepare: prepareExampleWorkflow,
  release: releaseExampleWorkflow,
  clearState: clearExampleWorkflowState
} = usePerformanceTestExampleWorkflow({
  picker: useTemplateRef<InstanceType<typeof TemplatePickerStep>>('examplePicker'),
  selectedInstallationId,
  isSelectedInstallationInstalled: computed(
    () =>
      performanceTestInstallations.value.find(({ id }) => id === selectedInstallationId.value)
        ?.status === 'installed'
  ),
  workflowFilePath,
  workflowError: workflowImportError,
  isWorkflowImporting,
  isWorkflowLocked,
  deleteWorkflow,
  t
})
const isExportingResults = ref(false)
const exportResultsError = ref<string | null>(null)
const logsExpanded = ref(true)
const resultsExpanded = ref(true)
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
const workflowLabel = computed(
  () =>
    pendingExampleWorkflowLabel.value ??
    workflowDisplayName.value ??
    workflowFilePath.value?.split(/[\\/]/).pop() ??
    ''
)
const canRun = computed(() => {
  const installationId = selectedInstallationId.value
  const sessionId = installationId ? performanceTestSessionKey(installationId) : ''
  return Boolean(
    installationId &&
    workflowFilePath.value &&
    !isLaunching.value &&
    !isStopping.value &&
    !isWorkflowImporting.value &&
    !isWorkflowDeleting.value &&
    !exampleDownload.value &&
    !isExampleForOtherInstallation.value &&
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
  warmupRuns.value = correctRunCount(warmupRuns.value, 0, 5, 1)
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
      releaseExampleWorkflow()
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
      if (workflowFilePath.value === filePath) {
        workflowFilePath.value = null
        clearExampleWorkflowState()
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
  const sessionId = performanceTestSessionKey(installationId)
  const token = ++runToken
  const runTelemetry: PerformanceTestRunTelemetry = {
    installationId,
    // Bundled examples send their stored file name (`<templateId>.json`, as in results.json);
    // imported workflows are user-named files, so they are reported only as 'custom'.
    workflowName:
      workflowDisplayName.value === null ? 'custom' : (filePath.split(/[\\/]/).pop() ?? ''),
    warmupRuns: warmups,
    measuredRuns: runs,
    startedAtMs: performance.now()
  }
  activeRunTelemetry = runTelemetry
  emitTelemetryAction('comfy.desktop.performance_test.started', {
    installation_id: installationId,
    workflow_name: runTelemetry.workflowName,
    warmup_runs: warmups,
    measured_runs: runs,
    total_runs: warmups + runs
  })
  isLaunching.value = true
  performanceTestResult.value = null
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
        if (activeRunTelemetry === runTelemetry) {
          activeRunTelemetry = null
          const summary = submission.resultsSummary
          const statistics = submission.statistics
          const hardware = submission.hardware
          emitTelemetryAction('comfy.desktop.performance_test.completed', {
            installation_id: runTelemetry.installationId,
            workflow_name: runTelemetry.workflowName,
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
  const sessionId = performanceTestSessionKey(installationId)
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
      workflow_name: telemetry.workflowName,
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
  <BrandBackground
    class="performance-test min-h-0 [&_.brand-outer-frame]:min-h-0 [&_.brand-inner-frame]:min-h-0"
    data-testid="performance-test"
  >
    <div
      class="performance-test__layout relative h-full min-h-0 w-full overflow-x-hidden overflow-y-auto"
    >
      <div
        class="performance-test__intro flex min-h-full w-full flex-col items-start gap-6 text-left"
      >
        <BrandedPageHeader
          :title="t('performanceTest.title')"
          :description="t('performanceTest.description')"
          logo-test-id="performance-test-logo"
        />
        <div class="performance-test__content flex min-h-0 w-full flex-none flex-col gap-6">
          <div
            class="performance-test__columns grid min-h-0 w-full flex-none grid-cols-[minmax(240px,3fr)_repeat(2,minmax(0,3.5fr))] gap-6 [@media(max-width:900px)]:grid-cols-1"
          >
            <section
              class="performance-test__column flex min-h-0 min-w-0 flex-col gap-4 [&>h2]:m-0 [&>h2]:text-neutral-200 [&>h2]:text-[13px] [&>h2]:font-normal [&>h2]:leading-[1.4]"
            >
              <h2>{{ t('performanceTest.selectInstance') }}</h2>
              <div class="performance-test__selection-row flex w-full items-center gap-3">
                <span
                  class="performance-test__selection-label flex-[0_0_68px] text-[13px] text-neutral-200"
                >
                  {{ t('performanceTest.workspaceLabel') }}
                </span>
                <div
                  class="performance-test__selection-control min-w-0 w-full max-w-80 flex-auto performance-test__workspace-select [&_.workspace-selector]:w-full [&_.workspace-selector\_\_face]:box-border [&_.workspace-selector\_\_face]:w-full [&_.workspace-selector\_\_face]:min-w-0 [&_.workspace-selector\_\_face]:px-2 [&_.workspace-selector\_\_face]:py-0 [&_.workspace-selector\_\_face]:[--dp-avatar-size:20px]"
                >
                  <DevPlatformWorkspaceSelector v-model="selectedWorkspaceId" />
                </div>
              </div>
              <div class="performance-test__selection-row flex w-full items-center gap-3">
                <span
                  class="performance-test__selection-label flex-[0_0_68px] text-[13px] text-neutral-200"
                >
                  {{ t('performanceTest.instanceLabel') }}
                </span>
                <div
                  class="performance-test__selection-control min-w-0 w-full max-w-80 flex-auto performance-test__instance-select [&_.ui-select-trigger]:h-[30px] [&_.ui-select-trigger]:px-2 [&_.ui-select-trigger]:py-1"
                >
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

            <section
              class="performance-test__column flex min-h-0 min-w-0 flex-col gap-4 [&>h2]:m-0 [&>h2]:text-neutral-200 [&>h2]:text-[13px] [&>h2]:font-normal [&>h2]:leading-[1.4]"
            >
              <h2>{{ t('performanceTest.chooseWorkflow') }}</h2>
              <Button
                class="performance-test__example-workflow box-border h-[30px] w-full px-2 py-1 text-[length:var(--takeover-fs-caption)]"
                variant="secondary"
                size="unset"
                :class="[
                  brandButtonClass,
                  secondaryButtonClass,
                  'h-[30px] px-2 py-1 text-[length:var(--takeover-fs-caption)]'
                ]"
                type="button"
                :disabled="
                  !selectedInstallationId ||
                  isWorkflowLocked ||
                  isWorkflowImporting ||
                  isExamplePickerLoading
                "
                @click="openExampleWorkflowPicker"
              >
                {{
                  isExamplePickerLoading
                    ? t('performanceTest.loadingExampleWorkflows')
                    : t('performanceTest.chooseExampleWorkflow')
                }}
              </Button>
              <div
                class="performance-test__workflow-divider flex w-full items-center gap-2.5 text-[11px] text-[var(--text-faint)] uppercase before:h-px before:flex-1 before:bg-[var(--chooser-surface-border)] before:content-[''] after:h-px after:flex-1 after:bg-[var(--chooser-surface-border)] after:content-['']"
              >
                <span>{{ t('performanceTest.orImportApiWorkflow') }}</span>
              </div>
              <div
                class="performance-test__drop-zone relative min-h-[104px] w-full flex-none rounded-lg border border-dotted p-0 text-text-muted transition-[border-color,background-color] duration-[120ms] ease-[ease] hover:border-[var(--chooser-surface-border-hover)] hover:bg-[var(--chooser-surface-bg-hover)] focus-within:border-[var(--chooser-surface-border-hover)] focus-within:bg-[var(--chooser-surface-bg-hover)] focus-within:outline-none"
                :class="[
                  isWorkflowDragging
                    ? 'border-[var(--chooser-surface-border-hover)] bg-[var(--chooser-surface-bg-hover)]'
                    : 'border-[var(--chooser-surface-border)] bg-[var(--chooser-surface-bg)]',
                  {
                    'performance-test__drop-zone--dragging': isWorkflowDragging,
                    'performance-test__drop-zone--selected':
                      workflowFilePath || pendingExampleWorkflowLabel
                  }
                ]"
                :aria-busy="isWorkflowImporting || isWorkflowDeleting"
                @dragenter.prevent="isWorkflowDragging = !isWorkflowLocked"
                @dragover.prevent="isWorkflowDragging = !isWorkflowLocked"
                @dragleave.prevent="isWorkflowDragging = false"
                @drop.prevent="dropWorkflow"
              >
                <button
                  class="performance-test__drop-content flex min-h-[102px] w-full items-center border-0 bg-transparent p-5 font-[inherit] text-[13px] text-inherit cursor-pointer"
                  type="button"
                  :class="
                    workflowFilePath || pendingExampleWorkflowLabel
                      ? 'justify-start pr-14 text-left'
                      : 'justify-center text-center'
                  "
                  :disabled="isWorkflowLocked"
                  @click="importWorkflow()"
                >
                  <span v-if="!workflowFilePath && !pendingExampleWorkflowLabel">
                    {{
                      isWorkflowImporting
                        ? t('performanceTest.importingWorkflow')
                        : t('performanceTest.dropWorkflowHint')
                    }}
                  </span>
                  <span
                    v-else
                    class="performance-test__workflow-file flex min-w-0 flex-col gap-1.5 [&>strong]:truncate [&>strong]:text-[var(--text-primary)] [&>strong]:font-semibold [&>code]:[overflow-wrap:anywhere] [&>code]:text-[var(--text-faint)] [&>code]:text-[11px] [&>code]:font-[inherit]"
                  >
                    <strong>{{ workflowLabel }}</strong>
                    <code v-if="pendingExampleWorkflowLabel">
                      {{ t('performanceTest.preparingExampleWorkflow') }}
                    </code>
                    <template v-else-if="exampleDownload">
                      <code>{{ exampleDownload.message }}</code>
                      <span
                        class="performance-test__example-download-bar block h-1 overflow-hidden rounded-[2px] bg-[var(--chooser-surface-border)] [&>span]:block [&>span]:h-full [&>span]:rounded-[inherit] [&>span]:bg-[var(--accent)] [&>span]:transition-[width] [&>span]:duration-[400ms] [&>span]:ease-[ease]"
                        role="progressbar"
                        :aria-valuenow="
                          exampleDownload.percent >= 0 ? exampleDownload.percent : undefined
                        "
                        aria-valuemin="0"
                        aria-valuemax="100"
                        :aria-label="t('performanceTest.exampleModelsDownload')"
                      >
                        <span
                          v-if="exampleDownload.percent >= 0"
                          :style="{ width: `${exampleDownload.percent}%` }"
                        />
                        <span
                          v-else
                          class="performance-test__example-download-bar--indeterminate w-[30%] animate-[performance-test-download-pulse_1.2s_ease-in-out_infinite_alternate]"
                        />
                      </span>
                    </template>
                    <code v-else>{{ workflowFilePath }}</code>
                  </span>
                </button>
                <Button
                  v-if="workflowFilePath && !isWorkflowLocked"
                  class="performance-test__delete-workflow absolute top-1/2 right-4 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent p-0 text-text-muted cursor-pointer hover:bg-[var(--chooser-surface-bg-hover)] hover:text-[var(--accent-danger,#d92d20)] focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] appearance-auto font-normal transition-none"
                  variant="textonly"
                  size="unset"
                  type="button"
                  :aria-label="
                    exampleDownload
                      ? t('performanceTest.cancelExampleDownload')
                      : t('performanceTest.deleteWorkflow')
                  "
                  :title="
                    exampleDownload
                      ? t('performanceTest.cancelExampleDownload')
                      : t('performanceTest.deleteWorkflow')
                  "
                  :disabled="isWorkflowDeleting"
                  @click="deleteWorkflow"
                >
                  <Trash2 :size="18" aria-hidden="true" />
                </Button>
              </div>
              <p
                v-if="workflowImportError"
                class="performance-test__workflow-error -mt-2 mr-0 mb-0 ml-0 text-[12px] leading-[1.4] text-[var(--accent-danger,#d92d20)]"
                role="alert"
              >
                {{ workflowImportError }}
              </p>
            </section>

            <section
              class="performance-test__column flex min-h-0 min-w-0 flex-col gap-4 [&>h2]:m-0 [&>h2]:text-neutral-200 [&>h2]:text-[13px] [&>h2]:font-normal [&>h2]:leading-[1.4]"
            >
              <h2>{{ t('performanceTest.measurementSettings') }}</h2>
              <div
                class="performance-test__setting flex w-full items-center gap-3 [&_label]:text-neutral-200 [&_label]:text-[13px] [&_label]:whitespace-nowrap"
              >
                <span class="performance-test__setting-label inline-flex flex-none items-center">
                  <label for="performance-test-warmup-runs">
                    {{ t('performanceTest.warmupRuns') }}
                  </label>
                  <InfoTooltip :text="t('performanceTest.warmupRunsHint')" icon="info" />
                </span>
                <div
                  class="performance-test__setting-input box-border ml-auto flex-[0_1_260px] w-[260px] min-w-[180px] min-h-[30px] rounded-md border border-solid border-border bg-[var(--brand-surface-bg)] px-2 py-1 text-neutral-100 text-[length:var(--takeover-fs-caption)] transition-[border-color,background] duration-[120ms] ease-[ease] flex items-center gap-2.5 hover:bg-[var(--brand-surface-bg-hover)] has-[:focus-visible]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_35%,transparent)] [&_input]:appearance-none [&_input]:rounded-none [&_input]:box-content [&_input]:[border-style:none] [&_input]:[outline-style:none] [&_input]:text-left [&_input]:flex-auto [&_input]:min-w-0 [&_input]:w-auto [&_input]:m-0 [&_input]:p-0 [&_input]:border-0 [&_input]:bg-transparent [&_input]:text-inherit [&_input]:font-[inherit] [&_input]:[font-size:inherit] [&_input]:[line-height:inherit] [&_input]:[font-weight:inherit] [&_input]:cursor-text [&_input]:outline-0 [&_input::placeholder]:text-neutral-400"
                >
                  <input
                    id="performance-test-warmup-runs"
                    v-model="warmupRuns"
                    type="number"
                    min="0"
                    max="5"
                    step="1"
                    @change="correctWarmupRuns"
                    @blur="correctWarmupRuns"
                  />
                </div>
              </div>
              <div
                class="performance-test__setting flex w-full items-center gap-3 [&_label]:text-neutral-200 [&_label]:text-[13px] [&_label]:whitespace-nowrap"
              >
                <span class="performance-test__setting-label inline-flex flex-none items-center">
                  <label for="performance-test-measured-runs">
                    {{ t('performanceTest.measuredRuns') }}
                  </label>
                  <InfoTooltip :text="t('performanceTest.measuredRunsHint')" icon="info" />
                </span>
                <div
                  class="performance-test__setting-input box-border ml-auto flex-[0_1_260px] w-[260px] min-w-[180px] min-h-[30px] rounded-md border border-solid border-border bg-[var(--brand-surface-bg)] px-2 py-1 text-neutral-100 text-[length:var(--takeover-fs-caption)] transition-[border-color,background] duration-[120ms] ease-[ease] flex items-center gap-2.5 hover:bg-[var(--brand-surface-bg-hover)] has-[:focus-visible]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_35%,transparent)] [&_input]:appearance-none [&_input]:rounded-none [&_input]:box-content [&_input]:[border-style:none] [&_input]:[outline-style:none] [&_input]:text-left [&_input]:flex-auto [&_input]:min-w-0 [&_input]:w-auto [&_input]:m-0 [&_input]:p-0 [&_input]:border-0 [&_input]:bg-transparent [&_input]:text-inherit [&_input]:font-[inherit] [&_input]:[font-size:inherit] [&_input]:[line-height:inherit] [&_input]:[font-weight:inherit] [&_input]:cursor-text [&_input]:outline-0 [&_input::placeholder]:text-neutral-400"
                >
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
              <div class="performance-test__run-actions mt-auto flex self-end gap-2">
                <Button
                  class="performance-test__stop min-w-24"
                  variant="destructive"
                  size="unset"
                  :class="[
                    ordinaryButtonClass,
                    'border-danger bg-danger text-bg hover:bg-[color-mix(in_srgb,var(--danger)_85%,#000)]'
                  ]"
                  type="button"
                  :disabled="!canStop"
                  @click="stopPerformanceTestFromUser"
                >
                  {{ isStopping ? t('performanceTest.stopping') : t('performanceTest.stop') }}
                </Button>
                <Button
                  class="performance-test__run min-w-24"
                  variant="inverted"
                  size="unset"
                  :class="[brandButtonClass, primaryButtonClass]"
                  type="button"
                  :disabled="!canRun"
                  @click="runPerformanceTest"
                >
                  {{ isLaunching ? t('performanceTest.running') : t('performanceTest.run') }}
                </Button>
              </div>
            </section>
          </div>

          <section class="performance-test__results-section flex w-full flex-none flex-col gap-4">
            <CollapsibleSectionToggle
              :expanded="resultsExpanded"
              :label="t('performanceTest.results')"
              @toggle="resultsExpanded = !resultsExpanded"
            />
            <div
              v-show="resultsExpanded"
              class="performance-test__results rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--chooser-surface-bg)] p-5 text-[13px] text-text-muted [&>h3]:mt-5 [&>h3]:mb-3 [&>h3]:text-neutral-200 [&>h3]:text-[13px] [&>h3]:font-normal"
            >
              <div
                v-if="isLaunching && totalProgressRuns > 0"
                class="performance-test__progress grid gap-3"
              >
                <div
                  class="performance-test__progress-heading flex items-center justify-between gap-4 text-neutral-200 [&>span:first-child]:text-[var(--text-primary)]"
                >
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
                  class="performance-test__progress-track h-2 overflow-hidden rounded-[999px] bg-[var(--chooser-surface-border)] [&>i]:block [&>i]:h-full [&>i]:rounded-[inherit] [&>i]:bg-comfy-yellow [&>i]:transition-[width] [&>i]:duration-[180ms] [&>i]:ease-[ease]"
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
                <div
                  class="performance-test__summary grid grid-cols-2 gap-6 [--perf-label-align:right] [--perf-value-align:right] [@media(max-width:900px)]:grid-cols-1"
                >
                  <div
                    class="performance-test__summary-column [--perf-label-align:left] [--perf-value-align:left]"
                  >
                    <dl
                      class="performance-test__result-list grid-cols-2 gap-y-3"
                      :class="resultListClass"
                    >
                      <div class="performance-test__result-workflow col-span-full">
                        <dt>{{ t('performanceTest.workflowFileName') }}</dt>
                        <dd>{{ performanceTestResult.resultsSummary.workflowName }}</dd>
                      </div>
                    </dl>
                    <div
                      v-if="performanceTestResult.statistics"
                      class="performance-test__aggregate-chart mt-8 grid gap-[5px]"
                      role="img"
                      :aria-label="t('performanceTest.runDurationChart')"
                    >
                      <div
                        v-for="aggregate in aggregateChart"
                        :key="aggregate.label"
                        class="performance-test__aggregate-bar grid grid-cols-[110px_minmax(40px,1fr)] items-center gap-2 text-[10px] leading-[1.2] text-text-muted [&>div]:h-[5px] [&>div]:overflow-hidden [&>div]:rounded-[999px] [&>div]:bg-[var(--chooser-surface-border)] [&_i]:block [&_i]:h-full [&_i]:rounded-[inherit] [&_i]:bg-comfy-yellow"
                      >
                        <span>{{ aggregate.label }}</span>
                        <div aria-hidden="true">
                          <i :style="{ width: aggregate.width }" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <dl
                    class="performance-test__result-list performance-test__timing-list grid-cols-2 gap-y-3 content-start"
                    :class="resultListClass"
                  >
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
              <p v-else class="performance-test__results-placeholder m-0">
                {{ t('performanceTest.resultsPlaceholder') }}
              </p>

              <template v-if="performanceTestResult?.hardware">
                <h3>{{ t('performanceTest.systemInformation') }}</h3>
                <div class="performance-test__system-groups grid grid-cols-2 gap-3">
                  <section
                    class="performance-test__system-group min-w-0 rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[color-mix(in_srgb,var(--chooser-surface-bg-hover)_45%,transparent)] p-3.5"
                  >
                    <dl
                      class="performance-test__result-list performance-test__result-list--compact"
                      :class="[resultListClass, compactResultListClass]"
                    >
                      <div>
                        <dt>{{ t('performanceTest.device') }}</dt>
                        <dd>{{ computeDeviceNames }}</dd>
                      </div>
                      <div v-if="performanceTestResult.hardware.vramMb != null">
                        <dt>{{ t('performanceTest.vram') }}</dt>
                        <dd>{{ formatMemory(performanceTestResult.hardware.vramMb) }}</dd>
                      </div>
                      <div v-if="performanceTestResult.hardware.ramMb != null">
                        <dt>{{ t('performanceTest.ram') }}</dt>
                        <dd>{{ formatMemory(performanceTestResult.hardware.ramMb) }}</dd>
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
                    class="performance-test__system-group min-w-0 rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[color-mix(in_srgb,var(--chooser-surface-bg-hover)_45%,transparent)] p-3.5"
                  >
                    <dl
                      class="performance-test__result-list performance-test__result-list--compact"
                      :class="[resultListClass, compactResultListClass]"
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

              <div
                v-if="resultsFolderPath"
                class="performance-test__results-actions mt-4 flex items-center justify-end gap-2"
              >
                <span
                  v-if="exportResultsError"
                  class="performance-test__export-error mr-auto text-[12px] text-danger"
                >
                  {{ exportResultsError }}
                </span>
                <Button
                  class="performance-test__open-results inline-flex items-center gap-2"
                  variant="secondary"
                  size="unset"
                  :class="ordinaryButtonClass"
                  type="button"
                  @click="openResultsFolder"
                >
                  <FolderOpen :size="16" aria-hidden="true" />
                  {{ t('performanceTest.openResultsFolder') }}
                </Button>
                <Button
                  v-if="
                    performanceTestResult?.statistics &&
                    performanceTestResult.systemInfo &&
                    performanceTestResult.hardware
                  "
                  class="performance-test__export-results inline-flex items-center gap-2"
                  variant="secondary"
                  size="unset"
                  :class="ordinaryButtonClass"
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
                </Button>
              </div>
            </div>
          </section>
          <section
            class="performance-test__logs-section flex min-h-0 w-full flex-none flex-col gap-4"
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
              class="performance-test__logs min-h-0 flex-[0_0_clamp(210px,37.5vh,360px)] overflow-auto rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--chooser-surface-bg)] p-5 text-text-muted font-[ui-monospace,SFMono-Regular,Consolas,'Liberation_Mono',monospace] text-[12px] leading-[1.5] whitespace-pre-wrap scroll-visible"
              aria-live="polite"
            >
              {{ performanceTestLogs || t('performanceTest.logsPlaceholder') }}
            </div>
          </section>
        </div>
      </div>

      <div
        class="performance-test__account absolute top-0 right-0 z-[2] flex justify-end max-w-[min(340px,45%)]"
      >
        <DevPlatformAccountChip />
      </div>
    </div>

    <BaseModal
      :open="isExamplePickerOpen"
      size="xl"
      :aria-label="t('performanceTest.exampleWorkflowPickerTitle')"
      content-class="performance-test__example-modal [&_h2]:m-0 [&_h2+p]:mt-1.5 [&_h2+p]:mr-0 [&_h2+p]:mb-0 [&_h2+p]:ml-0 [&_h2+p]:text-[13px] [&_h2+p]:text-text-muted"
      @close="isExamplePickerOpen = false"
    >
      <template #header>
        <div>
          <h2>{{ t('performanceTest.exampleWorkflowPickerTitle') }}</h2>
          <p>{{ t('performanceTest.exampleWorkflowPickerDescription') }}</p>
        </div>
      </template>
      <p
        v-if="exampleDiskError"
        class="performance-test__example-disk-error mt-0 mr-0 mb-3 ml-0 text-[12px] text-[var(--accent-danger,#d92d20)]"
        role="alert"
      >
        {{ exampleDiskError }}
      </p>
      <TemplatePickerStep
        ref="examplePicker"
        :options="exampleWorkflowOptions"
        :selected-value="selectedExampleWorkflowId"
        :disk-space="exampleDiskSpace"
        :disk-space-loading="false"
        compact
        @select="selectedExampleWorkflowId = $event.value"
      />
      <template #footer>
        <Button
          variant="secondary"
          size="unset"
          :class="[brandButtonClass, secondaryButtonClass]"
          type="button"
          @click="isExamplePickerOpen = false"
        >
          {{ t('common.cancel') }}
        </Button>
        <Button
          variant="inverted"
          size="unset"
          :class="[brandButtonClass, primaryButtonClass]"
          type="button"
          :disabled="!selectedExampleWorkflowId || !!exampleDiskError"
          data-testid="performance-test-use-example"
          @click="prepareExampleWorkflow"
        >
          {{ t('performanceTest.useExampleWorkflow') }}
        </Button>
      </template>
    </BaseModal>
  </BrandBackground>
</template>

<style>
/* The indeterminate bar moves by percentages of its own width. */
@keyframes performance-test-download-pulse {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(333%);
  }
}
</style>
