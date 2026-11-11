<script setup lang="ts">
import Input from '@comfyorg/design-system/input/Input'
import { computed, nextTick, onUnmounted, ref, toRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, FileJson, FolderOpen, ImageDown, Play, Square, X } from 'lucide-vue-next'
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

const cardClass =
  'flex w-full min-w-0 flex-none flex-col rounded-[14px] bg-card px-[18px] pt-1.5 pb-3.5'
const titleClass =
  'mt-1 mb-1 flex min-h-8 items-center gap-2 text-[11px] leading-[1.4] font-semibold tracking-[0.04em] text-subtle-foreground uppercase'
const toggleClass =
  'self-center text-[11px] font-semibold tracking-[0.04em] text-subtle-foreground uppercase hover:text-foreground [&_.collapsible-section-toggle__chevron]:size-3.5'
const factClass = 'grid min-h-10 grid-cols-[112px_minmax(0,1fr)] items-center gap-3'

interface PerformanceTestRunTelemetry {
  readonly installationId: string
  readonly workflowName: string
  readonly warmupRuns: number
  readonly measuredRuns: number
  readonly startedAtMs: number
}

const emit = defineEmits<{
  'run-active-change': [active: boolean]
}>()

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
const statTiles = computed(() => {
  const summary = performanceTestResult.value?.resultsSummary
  const statistics = performanceTestResult.value?.statistics
  if (!summary) return []
  const timings = statistics
    ? [
        {
          label: t('performanceTest.fastestRun'),
          value: formatDuration(statistics.fastest.durationSeconds)
        },
        {
          label: t('performanceTest.averageRunDuration'),
          value: formatDuration(statistics.averageDurationSeconds)
        },
        {
          label: t('performanceTest.medianRunDuration'),
          value: formatDuration(statistics.medianDurationSeconds)
        },
        {
          label: t('performanceTest.slowestRun'),
          value: formatDuration(statistics.slowest.durationSeconds)
        }
      ]
    : []
  return [
    ...timings,
    { label: t('performanceTest.measuredRunCount'), value: String(summary.measuredJobCount) },
    { label: t('performanceTest.failedRunCount'), value: String(summary.failedRunCount) }
  ]
})
const durationRange = computed(() => {
  const statistics = performanceTestResult.value?.statistics
  if (!statistics) return null
  const fastest = statistics.fastest.durationSeconds
  const slowest = statistics.slowest.durationSeconds
  const pad = Math.max(0.05, (slowest - fastest) * 0.5)
  const low = fastest - pad
  const span = slowest + pad - low
  const position = (value: number): number => ((value - low) / span) * 100
  return {
    left: `${position(fastest)}%`,
    width: `${position(slowest) - position(fastest)}%`,
    average: `${position(statistics.averageDurationSeconds)}%`,
    label: `${formatDuration(fastest)} – ${formatDuration(slowest)}`
  }
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
const ownsRun = computed(
  () => isLaunching.value || isStopping.value || performanceTestInstallationId.value !== null
)
watch(ownsRun, (active) => emit('run-active-change', active))
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

function correctRunCountOnCommit(
  event: Event | undefined,
  currentValue: string,
  minimum: number,
  maximum: number,
  fallback: number
): string {
  const input = event?.target instanceof HTMLInputElement ? event.target : undefined
  const corrected = correctRunCount(input?.value ?? currentValue, minimum, maximum, fallback)
  if (input) input.value = corrected
  return corrected
}

function correctWarmupRuns(event?: Event): void {
  warmupRuns.value = correctRunCountOnCommit(event, warmupRuns.value, 0, 5, 1)
}

function correctMeasuredRuns(event?: Event): void {
  measuredRuns.value = correctRunCountOnCommit(event, measuredRuns.value, 1, 100, 5)
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
    class="performance-test min-h-0 [&_.brand-outer-frame]:min-h-0 [&_.brand-inner-frame]:min-h-0 [&_.brand-inner-frame]:p-0"
    data-testid="performance-test"
  >
    <div
      class="performance-test__layout @container relative h-full min-h-0 w-full overflow-x-hidden overflow-y-auto"
    >
      <div
        class="performance-test__intro mx-auto flex min-h-full w-full max-w-300 flex-col items-start gap-5 px-10 pt-9 pb-24 text-left"
      >
        <BrandedPageHeader :title="t('performanceTest.title')">
          <template #actions>
            <Button
              v-if="ownsRun"
              class="performance-test__stop min-w-20 gap-1.5 px-3 text-[13px]/5"
              variant="secondary"
              size="md"
              type="button"
              :disabled="!canStop"
              @click="stopPerformanceTestFromUser"
            >
              <Square :size="13" fill="currentColor" aria-hidden="true" />
              {{ isStopping ? t('performanceTest.stopping') : t('performanceTest.stop') }}
            </Button>
            <Button
              v-else
              class="performance-test__run min-w-20 gap-1.5 px-3 text-[13px]/5"
              variant="inverted"
              size="md"
              type="button"
              :disabled="!canRun"
              @click="runPerformanceTest"
            >
              <Play :size="14" fill="currentColor" aria-hidden="true" />
              {{ t('performanceTest.run') }}
            </Button>
          </template>
        </BrandedPageHeader>
        <div class="performance-test__content flex min-h-0 w-full flex-none flex-col gap-3">
          <div
            class="performance-test__setup grid w-full flex-none grid-cols-3 gap-3 @max-[760px]:grid-cols-1"
          >
            <section class="performance-test__step" :class="cardClass">
              <h2 :class="titleClass">{{ t('performanceTest.selectInstance') }}</h2>
              <div class="performance-test__instance-select min-w-0 w-full">
                <BaseSelect
                  class="h-8 px-3 text-[13px]/5"
                  :model-value="selectedInstallationId ?? ''"
                  :options="instanceOptions"
                  :placeholder="t('performanceTest.selectInstancePlaceholder')"
                  :aria-label="t('performanceTest.selectInstancePlaceholder')"
                  :disabled="instanceOptions.length === 0"
                  @update:model-value="selectedInstallationId = $event"
                />
              </div>
            </section>

            <section class="performance-test__step" :class="cardClass">
              <h2 :class="titleClass">{{ t('performanceTest.chooseWorkflow') }}</h2>
              <Button
                class="performance-test__example-workflow w-full justify-between gap-1.5 px-3 text-[13px]/5 font-normal"
                variant="secondary"
                size="md"
                type="button"
                :disabled="
                  !selectedInstallationId ||
                  isWorkflowLocked ||
                  isWorkflowImporting ||
                  isExamplePickerLoading
                "
                @click="openExampleWorkflowPicker"
              >
                <span class="truncate">
                  {{
                    isExamplePickerLoading
                      ? t('performanceTest.loadingExampleWorkflows')
                      : t('performanceTest.chooseExampleWorkflow')
                  }}
                </span>
                <ChevronDown :size="14" class="shrink-0" aria-hidden="true" />
              </Button>
              <p
                class="performance-test__example-hint mt-0.5 mb-0 text-[12px] leading-[1.45] text-text-muted"
              >
                {{ t('performanceTest.exampleWorkflowPickerDescription') }}
              </p>
              <p
                class="performance-test__workflow-divider mt-2.5 mb-0 text-center text-[11px] text-text-muted"
              >
                {{ t('performanceTest.orImportApiWorkflow') }}
              </p>
              <div
                class="performance-test__drop-zone relative mt-2 w-full flex-none rounded-[10px] text-text-muted transition-[border-color,background-color] duration-[140ms] ease-[ease]"
                :class="[
                  workflowFilePath || pendingExampleWorkflowLabel
                    ? 'bg-white/5'
                    : [
                        'min-h-[84px] border border-dashed hover:border-white/30 hover:bg-white/3 focus-within:border-white/30',
                        isWorkflowDragging ? 'border-white/30 bg-white/3' : 'border-white/15'
                      ],
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
                <Button
                  variant="textonly"
                  size="lg"
                  class="performance-test__drop-content h-auto w-full whitespace-normal font-normal hover:bg-transparent"
                  type="button"
                  :class="
                    workflowFilePath || pendingExampleWorkflowLabel
                      ? 'min-h-10 justify-start py-2 pr-10 pl-3 text-left'
                      : 'min-h-[82px] justify-center p-3 text-center'
                  "
                  :disabled="isWorkflowLocked"
                  @click="importWorkflow()"
                >
                  <span
                    v-if="!workflowFilePath && !pendingExampleWorkflowLabel"
                    class="flex flex-col items-center gap-1 text-[12px] leading-[1.4]"
                  >
                    <FileJson :size="16" class="text-text-muted" aria-hidden="true" />
                    {{
                      isWorkflowImporting
                        ? t('performanceTest.importingWorkflow')
                        : t('performanceTest.dropWorkflowHint')
                    }}
                  </span>
                  <span v-else class="flex min-w-0 grow items-center gap-2.5">
                    <FileJson :size="15" class="shrink-0 text-text-muted" aria-hidden="true" />
                    <span
                      class="performance-test__workflow-file flex min-w-0 grow flex-col gap-1 [&>strong]:truncate [&>strong]:text-[13px] [&>strong]:font-medium [&>strong]:text-[var(--text-primary)] [&>code]:[overflow-wrap:break-word] [&>code]:text-[11px] [&>code]:font-[inherit] [&>code]:text-text-muted"
                    >
                      <strong>{{ workflowLabel }}</strong>
                      <code v-if="pendingExampleWorkflowLabel">
                        {{ t('performanceTest.preparingExampleWorkflow') }}
                      </code>
                      <template v-else-if="exampleDownload">
                        <code>{{ exampleDownload.message }}</code>
                        <span
                          class="performance-test__example-download-bar block h-1 overflow-hidden rounded-[2px] bg-white/10 [&>span]:block [&>span]:h-full [&>span]:rounded-[inherit] [&>span]:bg-neutral-100 [&>span]:transition-[width] [&>span]:duration-[400ms] [&>span]:ease-[ease]"
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
                      <code v-else class="truncate" :title="workflowFilePath ?? undefined">{{
                        workflowFilePath
                      }}</code>
                    </span>
                    <span
                      class="performance-test__workflow-tag shrink-0 rounded-md bg-white/8 px-1.5 py-0.5 text-[11px] leading-[1.3] text-text-muted"
                    >
                      {{
                        workflowDisplayName !== null || pendingExampleWorkflowLabel
                          ? t('performanceTest.exampleTag')
                          : t('performanceTest.apiTag')
                      }}
                    </span>
                  </span>
                </Button>
                <Button
                  v-if="workflowFilePath && !isWorkflowLocked"
                  class="performance-test__delete-workflow absolute top-1/2 right-1.5 size-7 -translate-y-1/2 rounded-lg"
                  variant="muted-textonly"
                  size="icon"
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
                  <X :size="15" aria-hidden="true" />
                </Button>
              </div>
              <p
                v-if="workflowImportError"
                class="performance-test__workflow-error mt-2 mr-0 mb-0 ml-0 text-[12px] leading-[1.4] text-[var(--accent-danger,#d92d20)]"
                role="alert"
              >
                {{ workflowImportError }}
              </p>
            </section>

            <section class="performance-test__step" :class="cardClass">
              <h2 :class="titleClass">{{ t('performanceTest.measurementSettings') }}</h2>
              <div class="performance-test__settings flex flex-col">
                <div class="performance-test__setting" :class="factClass">
                  <span
                    class="performance-test__setting-label inline-flex min-w-0 items-center text-[12px] text-text-muted"
                  >
                    <label for="performance-test-warmup-runs" class="whitespace-nowrap">
                      {{ t('performanceTest.warmupRuns') }}
                    </label>
                    <InfoTooltip :text="t('performanceTest.warmupRunsHint')" icon="info" />
                  </span>
                  <div
                    class="performance-test__setting-input w-full [&_input]:h-8 [&_input]:text-center"
                  >
                    <Input
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
                <div class="performance-test__setting" :class="factClass">
                  <span
                    class="performance-test__setting-label inline-flex min-w-0 items-center text-[12px] text-text-muted"
                  >
                    <label for="performance-test-measured-runs" class="whitespace-nowrap">
                      {{ t('performanceTest.measuredRuns') }}
                    </label>
                    <InfoTooltip :text="t('performanceTest.measuredRunsHint')" icon="info" />
                  </span>
                  <div
                    class="performance-test__setting-input w-full [&_input]:h-8 [&_input]:text-center"
                  >
                    <Input
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
              </div>
            </section>
          </div>

          <section class="performance-test__results-section" :class="cardClass">
            <div class="performance-test__results-head" :class="titleClass">
              <CollapsibleSectionToggle
                :class="toggleClass"
                :expanded="resultsExpanded"
                :label="t('performanceTest.results')"
                @toggle="resultsExpanded = !resultsExpanded"
              />
              <div
                v-if="resultsFolderPath"
                class="performance-test__results-actions ml-auto flex items-center gap-1 tracking-normal normal-case"
              >
                <span
                  v-if="exportResultsError"
                  class="performance-test__export-error mr-2 text-[12px] font-normal text-danger"
                >
                  {{ exportResultsError }}
                </span>
                <Button
                  class="performance-test__open-results gap-1.5 px-2.5 text-[13px]/5 font-normal"
                  variant="muted-textonly"
                  size="md"
                  type="button"
                  @click="openResultsFolder"
                >
                  <FolderOpen :size="15" aria-hidden="true" />
                  {{ t('performanceTest.openResultsFolder') }}
                </Button>
                <Button
                  v-if="
                    performanceTestResult?.statistics &&
                    performanceTestResult.systemInfo &&
                    performanceTestResult.hardware
                  "
                  class="performance-test__export-results gap-1.5 px-2.5 text-[13px]/5 font-normal"
                  variant="muted-textonly"
                  size="md"
                  type="button"
                  :disabled="isExportingResults"
                  @click="exportResultsImage"
                >
                  <ImageDown :size="15" aria-hidden="true" />
                  {{
                    isExportingResults
                      ? t('performanceTest.exportingImage')
                      : t('performanceTest.exportResultsImage')
                  }}
                </Button>
              </div>
            </div>
            <div
              v-show="resultsExpanded"
              class="performance-test__results text-[13px] text-text-muted"
            >
              <div
                v-if="isLaunching && totalProgressRuns > 0"
                class="performance-test__progress grid gap-2 pt-1.5 pb-1"
              >
                <div
                  class="performance-test__progress-heading flex items-center justify-between gap-4"
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
                  class="performance-test__progress-track h-1.5 overflow-hidden rounded-[999px] bg-white/10 [&>i]:block [&>i]:h-full [&>i]:rounded-[inherit] [&>i]:bg-neutral-100 [&>i]:transition-[width] [&>i]:duration-[180ms] [&>i]:ease-[ease]"
                  role="progressbar"
                  :aria-label="t('performanceTest.runProgress')"
                  :aria-valuenow="completedProgressRuns"
                  aria-valuemin="0"
                  :aria-valuemax="totalProgressRuns"
                >
                  <i :style="{ width: `${progressPercent}%` }" />
                </div>
              </div>
              <div
                v-else-if="performanceTestResult?.resultsSummary"
                class="performance-test__summary flex flex-col gap-3"
              >
                <dl
                  class="performance-test__timing-list m-0 grid grid-cols-6 gap-2 @max-[760px]:grid-cols-3"
                >
                  <div
                    v-for="tile in statTiles"
                    :key="tile.label"
                    class="rounded-[10px] bg-white/4 px-3 py-2.5"
                  >
                    <dt class="text-[12px] text-text-muted">{{ tile.label }}</dt>
                    <dd
                      class="m-0 mt-0.5 text-[18px] font-semibold tracking-[-0.01em] text-[var(--text-primary)] tabular-nums [overflow-wrap:anywhere]"
                    >
                      {{ tile.value }}
                    </dd>
                  </div>
                </dl>
                <div
                  class="performance-test__aggregate-chart grid min-h-11 grid-cols-[minmax(0,220px)_minmax(0,1fr)_150px] items-center gap-3 rounded-lg px-2 @max-[800px]:grid-cols-[minmax(0,1fr)_120px]"
                  role="img"
                  :aria-label="t('performanceTest.runDurationChart')"
                >
                  <span
                    class="performance-test__result-workflow flex min-w-0 items-center gap-2 text-[13px] text-[var(--text-primary)]"
                  >
                    <i class="size-2 shrink-0 rounded-full bg-neutral-100" aria-hidden="true" />
                    <span class="truncate">{{
                      performanceTestResult.resultsSummary.workflowName
                    }}</span>
                  </span>
                  <template v-if="durationRange">
                    <span
                      class="performance-test__aggregate-track relative h-2 rounded-[999px] bg-white/6 @max-[800px]:hidden"
                      aria-hidden="true"
                    >
                      <i
                        class="absolute inset-y-0 min-w-1 rounded-[999px] bg-neutral-100 opacity-85"
                        :style="{ left: durationRange.left, width: durationRange.width }"
                      />
                      <i
                        class="absolute -inset-y-1 w-0.5 rounded-[1px] bg-neutral-100"
                        :style="{ left: durationRange.average }"
                      />
                    </span>
                    <span class="text-right text-[12px] tabular-nums">{{
                      durationRange.label
                    }}</span>
                  </template>
                </div>
              </div>
              <p
                v-else
                class="performance-test__results-placeholder mt-0 mb-1 text-ui text-muted-foreground"
              >
                {{ t('performanceTest.resultsPlaceholder') }}
              </p>
            </div>
          </section>

          <section
            v-if="performanceTestResult?.hardware"
            class="performance-test__system-section"
            :class="cardClass"
          >
            <h2 :class="titleClass">{{ t('performanceTest.systemInformation') }}</h2>
            <dl
              class="performance-test__system m-0 grid grid-cols-3 gap-x-6 @max-[800px]:grid-cols-1 [&>div]:grid [&>div]:min-h-10 [&>div]:grid-cols-[112px_minmax(0,1fr)] [&>div]:items-center [&>div]:gap-3 [&_dt]:text-[12px] [&_dt]:text-text-muted [&_dd]:m-0 [&_dd]:truncate [&_dd]:text-[13px] [&_dd]:text-[var(--text-primary)]"
            >
              <div>
                <dt>{{ t('performanceTest.device') }}</dt>
                <dd :title="computeDeviceNames">{{ computeDeviceNames }}</dd>
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
              <template v-if="performanceTestResult.systemInfo">
                <div>
                  <dt>{{ t('performanceTest.cpu') }}</dt>
                  <dd :title="performanceTestResult.systemInfo.cpu_model">
                    {{ performanceTestResult.systemInfo.cpu_model }}
                  </dd>
                </div>
                <div>
                  <dt>{{ t('performanceTest.cpuCores') }}</dt>
                  <dd>{{ performanceTestResult.systemInfo.cpu_cores }}</dd>
                </div>
                <div>
                  <dt>{{ t('performanceTest.operatingSystem') }}</dt>
                  <dd :title="formatOperatingSystem(performanceTestResult.systemInfo)">
                    {{ formatOperatingSystem(performanceTestResult.systemInfo) }}
                  </dd>
                </div>
                <div>
                  <dt>{{ t('performanceTest.architecture') }}</dt>
                  <dd>{{ performanceTestResult.systemInfo.arch }}</dd>
                </div>
              </template>
            </dl>
          </section>

          <section
            class="performance-test__logs-section"
            :class="[cardClass, { 'performance-test__logs-section--collapsed': !logsExpanded }]"
          >
            <div class="performance-test__logs-head" :class="titleClass">
              <CollapsibleSectionToggle
                :class="toggleClass"
                :expanded="logsExpanded"
                :label="t('settings.logs')"
                @toggle="toggleLogs"
              />
            </div>
            <div
              v-show="logsExpanded"
              ref="logsElement"
              class="performance-test__logs max-h-[min(360px,37.5vh)] min-h-0 overflow-auto rounded-[10px] bg-[color-mix(in_srgb,black_35%,transparent)] px-3.5 py-3 text-text-muted font-[ui-monospace,SFMono-Regular,Consolas,'Liberation_Mono',monospace] text-[12px] leading-[1.6] whitespace-pre-wrap scroll-visible"
              aria-live="polite"
            >
              {{ performanceTestLogs || t('performanceTest.logsPlaceholder') }}
            </div>
          </section>
        </div>
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
        <Button variant="secondary" size="lg" type="button" @click="isExamplePickerOpen = false">
          {{ t('common.cancel') }}
        </Button>
        <Button
          variant="inverted"
          size="lg"
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
@keyframes performance-test-download-pulse {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(333%);
  }
}
</style>
