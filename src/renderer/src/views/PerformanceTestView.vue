<script setup lang="ts">
import Input from '@comfyorg/design-system/input/Input'
import { computed, nextTick, onUnmounted, ref, toRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Check,
  ChevronDown,
  CircleAlert,
  FolderOpen,
  ImageDown,
  LayoutGrid,
  Play,
  Square,
  Trash2,
  Upload
} from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuRadioItem from '@comfyorg/design-system/menu/MenuRadioItem'
import MenuSeparator from '@comfyorg/design-system/menu/MenuSeparator'
import { DropdownMenuRadioGroup } from 'reka-ui'
import BrandBackground from '../components/BrandBackground.vue'
import BrandedPageHeader from '../components/BrandedPageHeader.vue'
import CollapsibleSectionToggle from '../components/CollapsibleSectionToggle.vue'
import InfoTooltip from '../components/InfoTooltip.vue'
import TemplatePickerStep from '../components/TemplatePickerStep.vue'
import BaseModal from '../components/ui/BaseModal.vue'
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

const toggleClass =
  'self-center text-[11px] font-semibold tracking-[0.04em] text-subtle-foreground uppercase hover:text-foreground [&_.collapsible-section-toggle__chevron]:size-3.5'
const filterClass = 'gap-1.5 px-3 text-[13px]/5'
const numberInputClass =
  'w-9 flex-none [&_input]:h-6 [&_input]:w-full [&_input]:rounded-md [&_input]:border-0 [&_input]:bg-transparent [&_input]:p-0 [&_input]:text-center [&_input]:text-[13px] [&_input]:text-foreground [&_input]:tabular-nums [&_input]:shadow-none [&_input]:[appearance:textfield] [&_input]:focus-visible:ring-0 [&_input::-webkit-inner-spin-button]:appearance-none [&_input::-webkit-outer-spin-button]:appearance-none'
const runButtonClass = 'ml-auto min-w-20 gap-1.5 px-3 text-[13px]/5'
const actionClass = 'h-[30px] gap-1.5 rounded-lg px-2 text-[12.5px]/5 font-normal'
const summaryClass = 'ml-3 min-w-0 truncate text-[13px] font-normal tracking-normal normal-case'

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
const instanceOptions = computed<{ value: string; label: string; description: string }[]>(() =>
  performanceTestInstallations.value.map((installation) => ({
    value: installation.id,
    label: installation.name,
    description: [installation.sourceLabel, installation.version].filter(Boolean).join(' · ')
  }))
)
const selectedInstallationId = ref<string | null>(null)
const selectedInstance = computed(() =>
  instanceOptions.value.find((option) => option.value === selectedInstallationId.value)
)
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
const logsExpanded = ref(false)
const systemExpanded = ref(false)
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
const numberLine = computed(() => {
  const statistics = performanceTestResult.value?.statistics
  if (!statistics) return null
  const fastest = statistics.fastest.durationSeconds
  const slowest = statistics.slowest.durationSeconds
  const span = slowest - fastest
  const position = (value: number): number => (span > 0 ? ((value - fastest) / span) * 100 : 50)
  const average = position(statistics.averageDurationSeconds)
  return {
    fastest: formatDuration(fastest),
    slowest: formatDuration(slowest),
    average: formatDuration(statistics.averageDurationSeconds),
    median: formatDuration(statistics.medianDurationSeconds),
    medianAt: `${position(statistics.medianDurationSeconds)}%`,
    averageAt: `${average}%`,
    averageLabelAt: `${Math.min(88, Math.max(12, average))}%`
  }
})
const systemSummary = computed(() => {
  const hardware = performanceTestResult.value?.hardware
  const systemInfo = performanceTestResult.value?.systemInfo
  return [
    computeDeviceNames.value,
    hardware?.vramMb != null ? `${formatMemory(hardware.vramMb)} ${t('performanceTest.vram')}` : '',
    systemInfo ? formatOperatingSystem(systemInfo) : '',
    hardware?.pytorchVersion ? `PyTorch ${hardware.pytorchVersion}` : ''
  ]
    .filter(Boolean)
    .join(' · ')
})
const lastLogLine = computed(
  () =>
    performanceTestLogs.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() ?? ''
)
interface PerformanceTestRunLabel {
  readonly workflow: string
  readonly build: string
  readonly warmups: number
}
const runLabel = ref<PerformanceTestRunLabel | null>(null)
const runSettings = computed(() => [
  {
    id: 'performance-test-warmup-runs',
    label: t('performanceTest.warmupRuns'),
    hint: t('performanceTest.warmupRunsHint'),
    min: '0',
    max: '5',
    value: warmupRuns.value,
    update: (value: string | number | undefined) => (warmupRuns.value = String(value ?? '')),
    commit: correctWarmupRuns
  },
  {
    id: 'performance-test-measured-runs',
    label: t('performanceTest.measuredRuns'),
    hint: t('performanceTest.measuredRunsHint'),
    min: '1',
    max: '100',
    value: measuredRuns.value,
    update: (value: string | number | undefined) => (measuredRuns.value = String(value ?? '')),
    commit: correctMeasuredRuns
  }
])
const runPhase = computed(() => {
  const warmups = runLabel.value?.warmups ?? 0
  const current = Math.min(completedProgressRuns.value + 1, totalProgressRuns.value)
  return current <= warmups
    ? t('performanceTest.runPhaseWarmup')
    : t('performanceTest.runPhaseMeasured', {
        current: current - warmups,
        total: totalProgressRuns.value - warmups
      })
})
const hasWorkflow = computed(() =>
  Boolean(workflowFilePath.value || pendingExampleWorkflowLabel.value)
)
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
  runLabel.value = {
    workflow: workflowLabel.value,
    build: selectedInstance.value?.label ?? '',
    warmups
  }
  logsExpanded.value = true
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
        logsExpanded.value = false
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
        <BrandedPageHeader :title="t('performanceTest.title')" />
        <div class="performance-test__content flex min-h-0 w-full flex-none flex-col">
          <div class="performance-test__setup flex w-full flex-none flex-wrap items-center gap-2">
            <section class="performance-test__step flex min-w-0">
              <h2 class="sr-only">{{ t('performanceTest.selectInstance') }}</h2>
              <div class="performance-test__instance-select min-w-0">
                <Menu
                  :modal="false"
                  align="start"
                  class="z-20 min-w-[var(--reka-dropdown-menu-trigger-width)]"
                  :aria-label="t('performanceTest.selectInstancePlaceholder')"
                >
                  <template #trigger>
                    <Button
                      class="max-w-64"
                      :class="filterClass"
                      variant="secondary"
                      size="md"
                      type="button"
                      :aria-label="t('performanceTest.selectInstancePlaceholder')"
                      :disabled="instanceOptions.length === 0"
                    >
                      <span class="shrink-0 text-subtle-foreground">{{
                        t('performanceTest.selectInstance')
                      }}</span>
                      <span
                        class="truncate"
                        :class="{ 'text-muted-foreground': !selectedInstance }"
                        >{{
                          selectedInstance?.label ?? t('performanceTest.selectInstancePlaceholder')
                        }}</span
                      >
                      <ChevronDown :size="14" class="shrink-0" aria-hidden="true" />
                    </Button>
                  </template>
                  <DropdownMenuRadioGroup :model-value="selectedInstallationId ?? ''">
                    <MenuRadioItem
                      v-for="option in instanceOptions"
                      :key="option.value"
                      as="button"
                      type="button"
                      :value="option.value"
                      class="ui-select-option w-full"
                      @select="selectedInstallationId = option.value"
                    >
                      <span class="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                        <span class="ui-select-option-label">{{ option.label }}</span>
                        <span
                          v-if="option.description"
                          class="ui-select-option-desc text-xs text-muted-foreground"
                          >{{ option.description }}</span
                        >
                      </span>
                      <Check
                        v-if="selectedInstallationId === option.value"
                        :size="15"
                        aria-hidden="true"
                      />
                    </MenuRadioItem>
                  </DropdownMenuRadioGroup>
                </Menu>
              </div>
            </section>
            <section
              class="performance-test__step performance-test__workflow-step performance-test__drop-zone -m-1 flex min-w-0 rounded-[12px] p-1 outline-1 outline-offset-[-1px] transition-[outline-color,background-color] duration-[140ms]"
              :class="[
                isWorkflowDragging
                  ? 'performance-test__drop-zone--dragging bg-white/4 outline-white/35 outline-dashed'
                  : 'outline-transparent',
                { 'performance-test__drop-zone--selected': hasWorkflow }
              ]"
              :aria-busy="isWorkflowImporting || isWorkflowDeleting"
              @dragenter.prevent="isWorkflowDragging = !isWorkflowLocked"
              @dragover.prevent="isWorkflowDragging = !isWorkflowLocked"
              @dragleave.self.prevent="isWorkflowDragging = false"
              @drop.prevent="dropWorkflow"
            >
              <h2 class="sr-only">{{ t('performanceTest.chooseWorkflow') }}</h2>
              <Menu
                :modal="false"
                align="start"
                class="z-20 min-w-[260px]"
                :aria-label="t('performanceTest.chooseWorkflow')"
              >
                <template #trigger>
                  <Button
                    class="performance-test__workflow-trigger max-w-[26rem]"
                    :class="filterClass"
                    variant="secondary"
                    size="md"
                    type="button"
                    :title="workflowFilePath ?? undefined"
                    :disabled="isWorkflowLocked"
                  >
                    <span class="shrink-0 text-subtle-foreground">{{
                      t('performanceTest.chooseWorkflow')
                    }}</span>
                    <span
                      v-if="hasWorkflow"
                      class="performance-test__workflow-file flex min-w-0 items-center gap-1.5"
                    >
                      <span class="truncate">{{ workflowLabel }}</span>
                      <span
                        class="performance-test__workflow-tag shrink-0 rounded-[5px] bg-white/8 px-1.5 text-[11px] leading-[1.45] text-text-muted"
                      >
                        {{
                          workflowDisplayName !== null || pendingExampleWorkflowLabel
                            ? t('performanceTest.exampleTag')
                            : t('performanceTest.apiTag')
                        }}
                      </span>
                    </span>
                    <span v-else class="truncate text-muted-foreground">{{
                      isWorkflowImporting
                        ? t('performanceTest.importingWorkflow')
                        : t('performanceTest.chooseWorkflowPlaceholder')
                    }}</span>
                    <ChevronDown :size="14" class="shrink-0" aria-hidden="true" />
                  </Button>
                </template>
                <MenuItem
                  as="button"
                  type="button"
                  class="performance-test__example-workflow w-full"
                  :disabled="
                    !selectedInstallationId || isWorkflowImporting || isExamplePickerLoading
                  "
                  @select="openExampleWorkflowPicker"
                >
                  <LayoutGrid :size="15" aria-hidden="true" />
                  <span>{{
                    isExamplePickerLoading
                      ? t('performanceTest.loadingExampleWorkflows')
                      : t('performanceTest.chooseExampleWorkflow')
                  }}</span>
                </MenuItem>
                <MenuItem
                  as="button"
                  type="button"
                  class="performance-test__drop-content w-full"
                  :disabled="isWorkflowImporting"
                  @select="importWorkflow()"
                >
                  <Upload :size="15" aria-hidden="true" />
                  <span>{{ t('performanceTest.importApiWorkflow') }}</span>
                  <span class="ml-auto pl-4 text-[12px] text-text-muted">{{
                    t('performanceTest.orDropJson')
                  }}</span>
                </MenuItem>
                <template v-if="workflowFilePath">
                  <MenuSeparator />
                  <MenuItem
                    as="button"
                    type="button"
                    class="performance-test__delete-workflow w-full text-danger"
                    :disabled="isWorkflowDeleting"
                    @select="deleteWorkflow"
                  >
                    <Trash2 :size="15" aria-hidden="true" />
                    <span>{{
                      exampleDownload
                        ? t('performanceTest.cancelExampleDownload')
                        : t('performanceTest.deleteWorkflow')
                    }}</span>
                  </MenuItem>
                </template>
              </Menu>
            </section>
            <section class="performance-test__step flex min-w-0">
              <h2 class="sr-only">{{ t('performanceTest.measurementSettings') }}</h2>
              <div class="performance-test__settings flex flex-wrap items-center gap-2">
                <div
                  v-for="setting in runSettings"
                  :key="setting.id"
                  class="performance-test__setting inline-flex h-8 items-center gap-1.5 rounded-lg bg-secondary pr-1 pl-3 text-[13px]/5 transition-colors focus-within:bg-accent hover:bg-accent"
                >
                  <span
                    class="performance-test__setting-label inline-flex shrink-0 items-center text-subtle-foreground"
                  >
                    <label :for="setting.id" class="whitespace-nowrap">{{ setting.label }}</label>
                    <InfoTooltip :text="setting.hint" icon="info" />
                  </span>
                  <div :class="numberInputClass">
                    <Input
                      :id="setting.id"
                      :model-value="setting.value"
                      type="number"
                      :min="setting.min"
                      :max="setting.max"
                      step="1"
                      @update:model-value="setting.update"
                      @change="setting.commit"
                      @blur="setting.commit"
                    />
                  </div>
                </div>
              </div>
            </section>
            <Button
              v-if="ownsRun"
              :class="runButtonClass"
              class="performance-test__stop"
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
              :class="runButtonClass"
              class="performance-test__run"
              variant="inverted"
              size="md"
              type="button"
              :disabled="!canRun"
              @click="runPerformanceTest"
            >
              <Play :size="14" fill="currentColor" aria-hidden="true" />
              {{ t('performanceTest.run') }}
            </Button>
          </div>

          <p
            v-if="workflowImportError"
            class="performance-test__status performance-test__workflow-error m-0 mt-2.5 flex items-center gap-1.5 text-[12px] leading-[1.4] text-danger"
            role="alert"
          >
            <CircleAlert :size="13" class="shrink-0" aria-hidden="true" />
            {{ workflowImportError }}
          </p>
          <div
            v-else-if="pendingExampleWorkflowLabel || exampleDownload"
            class="performance-test__status mt-2.5 flex min-w-0 items-center gap-2 text-[12px] leading-[1.4] text-text-muted"
          >
            <template v-if="pendingExampleWorkflowLabel">
              {{ t('performanceTest.preparingExampleWorkflow') }}
            </template>
            <template v-else-if="exampleDownload">
              <span class="truncate">{{ exampleDownload.message }}</span>
              <span
                class="performance-test__example-download-bar block h-[3px] w-36 flex-none overflow-hidden rounded-[2px] bg-white/10 [&>span]:block [&>span]:h-full [&>span]:rounded-[inherit] [&>span]:bg-neutral-100 [&>span]:transition-[width] [&>span]:duration-[400ms] [&>span]:ease-[ease]"
                role="progressbar"
                :aria-valuenow="exampleDownload.percent >= 0 ? exampleDownload.percent : undefined"
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
          </div>

          <section
            class="performance-test__results-section mt-6 flex w-full min-w-0 flex-none flex-col rounded-2xl bg-white/[0.035] px-6 pt-[22px] text-[13px] text-text-muted"
            :class="{ 'pb-[22px]': !performanceTestResult?.hardware || isLaunching }"
          >
            <h2 class="sr-only">{{ t('performanceTest.results') }}</h2>
            <div
              v-if="runLabel"
              class="performance-test__results-head mb-[18px] flex min-h-[30px] items-center gap-1"
            >
              <span class="performance-test__run-label min-w-0 truncate text-[12.5px]">
                <span class="font-medium text-foreground">{{ runLabel.workflow }}</span>
                {{ t('performanceTest.resultContextOn') }} {{ runLabel.build }}
              </span>
              <div
                v-if="resultsFolderPath && !isLaunching"
                class="performance-test__results-actions ml-auto -mr-2 flex shrink-0 items-center gap-0.5"
              >
                <span
                  v-if="exportResultsError"
                  class="performance-test__export-error mr-2 text-[12px] text-danger"
                >
                  {{ exportResultsError }}
                </span>
                <Button
                  :class="actionClass"
                  class="performance-test__open-results"
                  variant="muted-textonly"
                  size="unset"
                  type="button"
                  :title="t('performanceTest.openResultsFolder')"
                  @click="openResultsFolder"
                >
                  <FolderOpen :size="15" aria-hidden="true" />
                  <span class="@max-[640px]:sr-only">{{
                    t('performanceTest.openResultsFolder')
                  }}</span>
                </Button>
                <Button
                  v-if="
                    performanceTestResult?.statistics &&
                    performanceTestResult.systemInfo &&
                    performanceTestResult.hardware
                  "
                  :class="actionClass"
                  class="performance-test__export-results"
                  variant="muted-textonly"
                  size="unset"
                  type="button"
                  :title="t('performanceTest.exportResultsImage')"
                  :disabled="isExportingResults"
                  @click="exportResultsImage"
                >
                  <ImageDown :size="15" aria-hidden="true" />
                  <span class="@max-[640px]:sr-only">{{
                    isExportingResults
                      ? t('performanceTest.exportingImage')
                      : t('performanceTest.exportResultsImage')
                  }}</span>
                </Button>
              </div>
            </div>
            <div class="performance-test__results">
              <div
                v-if="isLaunching && totalProgressRuns > 0"
                class="performance-test__progress grid gap-4"
              >
                <div class="performance-test__progress-heading flex items-baseline gap-2.5">
                  <span class="text-[22px] leading-none font-medium text-foreground tabular-nums">{{
                    t('performanceTest.runNumber', {
                      current: Math.min(completedProgressRuns + 1, totalProgressRuns),
                      total: totalProgressRuns
                    })
                  }}</span>
                  <span class="tabular-nums">{{ runPhase }}</span>
                </div>
                <div
                  class="performance-test__progress-track flex h-1.5 gap-1"
                  role="progressbar"
                  :aria-label="t('performanceTest.runProgress')"
                  :aria-valuenow="completedProgressRuns"
                  aria-valuemin="0"
                  :aria-valuemax="totalProgressRuns"
                >
                  <template v-if="totalProgressRuns <= 30">
                    <i
                      v-for="index in totalProgressRuns"
                      :key="index"
                      class="block h-full flex-1 rounded-[3px] transition-colors duration-[180ms]"
                      :class="
                        index <= completedProgressRuns
                          ? index <= (runLabel?.warmups ?? 0)
                            ? 'bg-white/40'
                            : 'bg-neutral-100'
                          : index === completedProgressRuns + 1
                            ? 'animate-pulse bg-white/25'
                            : 'bg-white/8'
                      "
                    />
                  </template>
                  <span v-else class="block h-full flex-1 overflow-hidden rounded-[3px] bg-white/8">
                    <i
                      class="block h-full rounded-[inherit] bg-neutral-100 transition-[width] duration-[180ms]"
                      :style="{ width: `${progressPercent}%` }"
                    />
                  </span>
                </div>
              </div>
              <div
                v-else-if="performanceTestResult?.resultsSummary"
                class="performance-test__summary grid grid-cols-[minmax(200px,240px)_minmax(0,1fr)] items-end gap-x-12 gap-y-6 @max-[640px]:grid-cols-1"
                :class="{ 'pb-[22px]': performanceTestResult.hardware }"
              >
                <div class="performance-test__median flex flex-col gap-2.5">
                  <span
                    v-if="numberLine"
                    class="text-[44px] leading-none font-medium tracking-[-0.02em] text-foreground tabular-nums"
                    >{{ numberLine.median }}</span
                  >
                  <span class="text-[12.5px]">
                    {{
                      t('performanceTest.medianSummary', {
                        count: performanceTestResult.resultsSummary.measuredJobCount,
                        failed: performanceTestResult.resultsSummary.failedRunCount
                      })
                    }}
                  </span>
                </div>
                <div v-if="numberLine" class="min-w-0">
                  <dl
                    class="performance-test__timing-list m-0 grid grid-cols-3 gap-x-6 tabular-nums"
                  >
                    <div
                      v-for="stat in [
                        { label: t('performanceTest.fastestRun'), value: numberLine.fastest },
                        {
                          label: t('performanceTest.averageRunDuration'),
                          value: numberLine.average
                        },
                        { label: t('performanceTest.slowestRun'), value: numberLine.slowest }
                      ]"
                      :key="stat.label"
                      class="flex flex-col gap-1"
                    >
                      <dt class="text-[12px]">{{ stat.label }}</dt>
                      <dd class="m-0 text-[17px] font-medium text-foreground">{{ stat.value }}</dd>
                    </div>
                  </dl>
                  <div
                    class="performance-test__aggregate-chart relative mt-3.5 h-3.5"
                    role="img"
                    :aria-label="t('performanceTest.runDurationChart')"
                  >
                    <span class="absolute inset-x-0 top-[5px] h-1 rounded-[2px] bg-white/14" />
                    <span
                      class="absolute top-0 h-3.5 w-0.5 -translate-x-1/2 rounded-[1px] bg-neutral-300"
                      :style="{ left: numberLine.averageAt }"
                    />
                    <span
                      class="absolute top-px size-3 -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_3px_rgb(255_255_255/0.16)]"
                      :style="{ left: numberLine.medianAt }"
                    />
                  </div>
                  <div
                    class="performance-test__chart-legend mt-2 flex items-center gap-4 text-[11.5px] text-subtle-foreground"
                    aria-hidden="true"
                  >
                    <span class="inline-flex items-center gap-1.5"
                      ><i class="size-2 rounded-full bg-white" />{{
                        t('performanceTest.legendMedian')
                      }}</span
                    >
                    <span class="inline-flex items-center gap-1.5"
                      ><i class="h-2.5 w-0.5 rounded-[1px] bg-neutral-300" />{{
                        t('performanceTest.legendAverage')
                      }}</span
                    >
                    <span class="ml-auto">{{ t('performanceTest.legendRange') }}</span>
                  </div>
                </div>
              </div>
              <div v-else class="performance-test__results-placeholder pt-1 pb-1.5">
                <p class="m-0 mb-1.5 text-[15px] font-medium text-foreground">
                  {{ t('performanceTest.resultsEmptyTitle') }}
                </p>
                <p class="m-0 text-ui text-text-muted">
                  {{ t('performanceTest.resultsPlaceholder') }}
                </p>
              </div>
            </div>
            <div
              v-if="performanceTestResult?.hardware"
              class="performance-test__system-section -mx-6 flex flex-col rounded-b-2xl bg-white/[0.02] px-6"
            >
              <div class="performance-test__system-head flex min-h-11 min-w-0 items-center">
                <h3 class="m-0 flex shrink-0">
                  <CollapsibleSectionToggle
                    :class="toggleClass"
                    :expanded="systemExpanded"
                    :label="t('performanceTest.systemInformation')"
                    @toggle="systemExpanded = !systemExpanded"
                  />
                </h3>
                <span v-if="!systemExpanded" :class="summaryClass" class="text-text-muted">{{
                  systemSummary
                }}</span>
              </div>
              <dl
                v-show="systemExpanded"
                class="performance-test__system m-0 grid grid-cols-3 gap-x-6 pb-3.5 @max-[800px]:grid-cols-1 [&>div]:grid [&>div]:min-h-[30px] [&>div]:grid-cols-[112px_minmax(0,1fr)] [&>div]:items-center [&>div]:gap-3 [&_dt]:text-[12px] [&_dt]:text-text-muted [&_dd]:m-0 [&_dd]:truncate [&_dd]:text-[12.5px] [&_dd]:text-[var(--text-primary)]"
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
            </div>
          </section>

          <section
            class="performance-test__logs-section mt-[18px] flex w-full min-w-0 flex-none flex-col"
            :class="{ 'performance-test__logs-section--collapsed': !logsExpanded }"
          >
            <div class="performance-test__logs-head flex min-h-10 min-w-0 items-center">
              <CollapsibleSectionToggle
                :class="toggleClass"
                class="shrink-0"
                :expanded="logsExpanded"
                :label="t('settings.logs')"
                @toggle="toggleLogs"
              />
              <span
                v-if="!logsExpanded"
                :class="summaryClass"
                class="performance-test__logs-summary font-[ui-monospace,SFMono-Regular,Consolas,'Liberation_Mono',monospace] text-[12px] text-text-muted"
                >{{ lastLogLine || t('performanceTest.logsPlaceholder') }}</span
              >
            </div>
            <div
              v-show="logsExpanded"
              ref="logsElement"
              class="performance-test__logs mt-1.5 max-h-[min(360px,37.5vh)] min-h-0 overflow-auto rounded-xl bg-[color-mix(in_srgb,black_35%,transparent)] px-3.5 py-3 text-text-muted font-[ui-monospace,SFMono-Regular,Consolas,'Liberation_Mono',monospace] text-[12px] leading-[1.65] whitespace-pre-wrap scroll-visible"
              aria-live="polite"
            >
              {{ performanceTestLogs.trimStart() || t('performanceTest.logsPlaceholder') }}
            </div>
          </section>
        </div>
      </div>
    </div>

    <BaseModal
      :open="isExamplePickerOpen"
      size="xl"
      :aria-label="t('performanceTest.exampleWorkflowPickerTitle')"
      content-class="performance-test__example-modal"
      @close="isExamplePickerOpen = false"
    >
      <template #header>
        <div>
          <h2 class="m-0 text-base leading-[1.3] font-semibold text-neutral-100">
            {{ t('performanceTest.exampleWorkflowPickerTitle') }}
          </h2>
          <p class="m-0 mt-1.5 text-[13px] text-text-muted">
            {{ t('performanceTest.exampleWorkflowPickerDescription') }}
          </p>
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
