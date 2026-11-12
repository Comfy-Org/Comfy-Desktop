import { computed, onUnmounted, ref, shallowRef } from 'vue'
import { useSessionStore } from '../stores/sessionStore'
import { emitTelemetryAction } from '../lib/telemetry'
import type { ActionResult, RunPerformanceTestWorkflowResult } from '../types/ipc'
import { performanceTestSessionKey } from '../../../shared/performanceTestSession'

export interface PerformanceTestRunRequest {
  readonly installationId: string
  readonly buildName: string
  readonly workflowPath: string
  readonly workflowName: string
  readonly telemetryWorkflowName: string
  readonly warmupRuns: number
  readonly measuredRuns: number
}

export type PerformanceTestStage = 'idle' | 'starting' | 'running' | 'finishing' | 'stopping'

interface RunTelemetry {
  readonly installationId: string
  readonly workflowName: string
  readonly warmupRuns: number
  readonly measuredRuns: number
  readonly startedAtMs: number
}

type Translate = (key: string, values?: Record<string, unknown>) => string

function secondsToMilliseconds(seconds: number | null | undefined): number | null {
  return seconds == null ? null : seconds * 1000
}

function errorMessage(error: unknown, fallback: string): string {
  return (error as Error | undefined)?.message || fallback
}

function emitCompleted(
  telemetry: RunTelemetry,
  submission: RunPerformanceTestWorkflowResult
): void {
  const summary = submission.resultsSummary
  const statistics = submission.statistics
  const hardware = submission.hardware
  emitTelemetryAction('comfy.desktop.performance_test.completed', {
    installation_id: telemetry.installationId,
    workflow_name: telemetry.workflowName,
    warmup_runs: telemetry.warmupRuns,
    measured_runs: telemetry.measuredRuns,
    successful_runs:
      summary?.measuredJobCount ??
      statistics?.measuredJobCount ??
      Math.max(0, submission.submitted - (submission.failedRuns ?? 0)),
    failed_runs: summary?.failedRunCount ?? submission.failedRuns ?? 0,
    duration_ms: performance.now() - telemetry.startedAtMs,
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

export function usePerformanceTestRun(t: Translate) {
  const sessionStore = useSessionStore()
  const isActive = ref(false)
  const phase = ref<'starting' | 'running' | 'finishing'>('starting')
  const isStopping = ref(false)
  const buildInstallationId = ref<string | null>(null)
  const request = shallowRef<PerformanceTestRunRequest | null>(null)
  const result = shallowRef<RunPerformanceTestWorkflowResult | null>(null)
  const failure = ref<string | null>(null)
  const logSessionId = ref<string | null>(null)
  const progressSessionId = ref<string | null>(null)
  const completedRuns = ref(0)
  const totalRuns = ref(0)
  let activeLaunch: Promise<ActionResult> | null = null
  let activeTelemetry: RunTelemetry | null = null
  let runToken = 0

  const stage = computed<PerformanceTestStage>(() => {
    if (isStopping.value) return 'stopping'
    return isActive.value ? phase.value : 'idle'
  })
  const isBusy = computed(() => stage.value !== 'idle')
  const ownsBuild = computed(() => isBusy.value || buildInstallationId.value !== null)
  const canStop = computed(() => Boolean(buildInstallationId.value && !isStopping.value))
  const logs = computed(() =>
    logSessionId.value ? (sessionStore.getSession(logSessionId.value)?.output ?? '') : ''
  )

  const unsubscribeProgress = window.api.onPerformanceTestProgress((progress) => {
    if (progress.sessionId !== progressSessionId.value) return
    completedRuns.value = progress.completedRuns
    totalRuns.value = progress.totalRuns
  })
  onUnmounted(unsubscribeProgress)

  function canStart(installationId: string): boolean {
    return !isBusy.value && !sessionStore.isLaunching(performanceTestSessionKey(installationId))
  }

  async function submit(
    run: PerformanceTestRunRequest,
    sessionId: string,
    token: number,
    telemetry: RunTelemetry
  ): Promise<void> {
    sessionStore.appendOutput(
      sessionId,
      `\n${t('performanceTest.submittingRuns', {
        count: run.measuredRuns,
        warmupCount: run.warmupRuns
      })}\n`
    )
    let submission: RunPerformanceTestWorkflowResult | null = null
    let outcome: string
    try {
      submission = await window.api.runPerformanceTestWorkflow(
        sessionId,
        run.workflowPath,
        run.measuredRuns,
        run.warmupRuns
      )
      outcome = submission.ok
        ? t('performanceTest.completedRuns', {
            count: submission.submitted,
            failed: submission.failedRuns,
            path: submission.resultPath
          })
        : submission.message || t('performanceTest.submitFailed')
    } catch (error) {
      outcome = errorMessage(error, t('performanceTest.submitFailed'))
    }
    if (token === runToken) {
      if (submission?.ok) {
        result.value = submission
        if (activeTelemetry === telemetry) {
          activeTelemetry = null
          emitCompleted(telemetry, submission)
        }
      } else {
        failure.value = outcome
      }
    }
    sessionStore.appendOutput(sessionId, `${outcome}\n`)
  }

  async function saveLogs(sessionId: string, workflowPath: string): Promise<void> {
    const logs = sessionStore.getSession(sessionId)?.output
    if (logs === undefined) return
    try {
      const saved = await window.api.savePerformanceTestLogs(workflowPath, logs)
      if (!saved.ok) console.error('Failed to save performance test logs:', saved.message)
    } catch (error) {
      console.error('Failed to save performance test logs:', error)
    }
  }

  async function start(run: PerformanceTestRunRequest): Promise<void> {
    if (!canStart(run.installationId)) return
    const sessionId = performanceTestSessionKey(run.installationId)
    const token = ++runToken
    const telemetry: RunTelemetry = {
      installationId: run.installationId,
      workflowName: run.telemetryWorkflowName,
      warmupRuns: run.warmupRuns,
      measuredRuns: run.measuredRuns,
      startedAtMs: performance.now()
    }
    activeTelemetry = telemetry
    emitTelemetryAction('comfy.desktop.performance_test.started', {
      installation_id: run.installationId,
      workflow_name: telemetry.workflowName,
      warmup_runs: run.warmupRuns,
      measured_runs: run.measuredRuns,
      total_runs: run.warmupRuns + run.measuredRuns
    })
    isActive.value = true
    phase.value = 'starting'
    request.value = run
    result.value = null
    failure.value = null
    progressSessionId.value = sessionId
    completedRuns.value = 0
    totalRuns.value = run.warmupRuns + run.measuredRuns
    try {
      if (sessionStore.isRunning(sessionId)) await window.api.stopComfyUI(sessionId)
      logSessionId.value = sessionId
      buildInstallationId.value = run.installationId
      sessionStore.startSession(sessionId)
      activeLaunch = window.api.runAction(run.installationId, 'launch', {
        launchModeOverride: 'console',
        autoPortOnConflict: true,
        sessionIdOverride: sessionId
      })
      const launched = await activeLaunch
      activeLaunch = null
      if (token !== runToken) return
      if (!launched.ok) {
        buildInstallationId.value = null
        if (!launched.cancelled) {
          failure.value = launched.message || t('performanceTest.launchFailed')
          sessionStore.appendOutput(sessionId, failure.value)
        }
        return
      }
      phase.value = 'running'
      await submit(run, sessionId, token, telemetry)
      if (token !== runToken) return
      phase.value = 'finishing'
      await stop()
    } catch (error) {
      const message = errorMessage(error, t('performanceTest.launchFailed'))
      sessionStore.appendOutput(sessionId, message)
      if (token === runToken) failure.value = message
      buildInstallationId.value = null
    } finally {
      await saveLogs(sessionId, run.workflowPath)
      activeLaunch = null
      if (activeTelemetry === telemetry) activeTelemetry = null
      if (!result.value && !failure.value) request.value = null
      progressSessionId.value = null
      isActive.value = false
    }
  }

  async function stop(): Promise<void> {
    const installationId = buildInstallationId.value
    if (!installationId || !canStop.value) return
    const sessionId = performanceTestSessionKey(installationId)
    runToken += 1
    isStopping.value = true
    try {
      await window.api.cancelOperation(sessionId)
      if (activeLaunch) await activeLaunch.catch(() => undefined)
      await window.api.stopComfyUI(sessionId)
      if (buildInstallationId.value === installationId) buildInstallationId.value = null
    } catch (error) {
      sessionStore.appendOutput(
        sessionId,
        `\n${errorMessage(error, t('performanceTest.stopFailed'))}\n`
      )
    } finally {
      isStopping.value = false
    }
  }

  async function stopFromUser(): Promise<void> {
    const telemetry = activeTelemetry
    if (telemetry) {
      activeTelemetry = null
      emitTelemetryAction('comfy.desktop.performance_test.stopped', {
        installation_id: telemetry.installationId,
        workflow_name: telemetry.workflowName,
        warmup_runs: telemetry.warmupRuns,
        measured_runs: telemetry.measuredRuns,
        completed_runs: completedRuns.value,
        total_runs: telemetry.warmupRuns + telemetry.measuredRuns,
        duration_ms: performance.now() - telemetry.startedAtMs
      })
    }
    await stop()
  }

  return {
    stage,
    isBusy,
    ownsBuild,
    canStop,
    request,
    result,
    failure,
    logs,
    completedRuns,
    totalRuns,
    canStart,
    start,
    stopFromUser
  }
}
