import { defineStore } from 'pinia'
import { reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from './sessionStore'
import { getPhaseWeights } from '../lib/progressWeights'
import { emitTelemetryAction, toErrorBucket } from '../lib/telemetry'
import type {
  ActionResult,
  ErrorDetailData,
  ProgressData,
  ProgressStep,
  ComfyOutputData,
  ShowProgressOpts,
  Unsubscribe
} from '../types/ipc'

export interface Operation {
  title: string
  returnTo?: string
  opKind: NonNullable<ShowProgressOpts['opKind']>
  destroysInstance: boolean
  chainSpan: 'install' | 'launch' | null
  successTerminal: NonNullable<ShowProgressOpts['successTerminal']> | null
  steps: ProgressStep[] | null
  priorSteps: ProgressStep[] | null
  activePhase: string | null
  activePercent: number
  lastStatus: Record<string, string>
  phaseErrors: Record<string, boolean>
  flatStatus: string
  flatPercent: number
  terminalOutput: string
  done: boolean
  error: string | null
  finished: boolean
  cancelRequested: boolean
  result: ActionResult | null
  actionId?: string
  _startedAtMs: number
  _resultEmitted: boolean
  unsubProgress: Unsubscribe | null
  unsubOutput: Unsubscribe | null
  apiCall: (() => Promise<ActionResult>) | null
  _globalFloor: number
}

export const useProgressStore = defineStore('progress', () => {
  const { t } = useI18n()
  const sessionStore = useSessionStore()

  const operations = reactive(new Map<string, Operation>())

  window.api.onErrorDetail?.((data: ErrorDetailData) => {
    const op = operations.get(data.installationId)
    if (op?.error) {
      op.error = data.message
      const session = sessionStore.errorInstances.get(data.installationId)
      if (session) session.message = data.message
    }
  })

  function emitOpResult(
    op: Operation,
    installationId: string,
    result: 'success' | 'failed' | 'cancelled_user' | 'cancelled_abrupt'
  ): void {
    if (op._resultEmitted) return
    op._resultEmitted = true
    emitTelemetryAction('comfy.desktop.op.result', {
      installation_id: installationId,
      action_id: op.actionId ?? null,
      op_kind: op.opKind,
      source: 'panel',
      result,
      duration_ms: Date.now() - op._startedAtMs,
      ...(result === 'failed' && op.error ? { error_bucket: toErrorBucket(op.error) } : {})
    })
  }

  function cleanupOperation(installationId: string): void {
    const op = operations.get(installationId)
    if (!op) return
    if (!op.finished && !op._resultEmitted) {
      emitOpResult(op, installationId, 'cancelled_abrupt')
    }
    if (op.unsubProgress) op.unsubProgress()
    if (op.unsubOutput) op.unsubOutput()
    op.unsubProgress = null
    op.unsubOutput = null
  }

  function getProgressInfo(installationId: string): { status: string; percent: number } | null {
    const op = operations.get(installationId)
    if (!op || op.finished) return null
    if (op.steps && op.activePhase) {
      const raw = op.lastStatus[op.activePhase]
      const stepLabel = op.steps.find((s) => s.phase === op.activePhase)?.label
      const status = (raw && raw !== op.activePhase ? raw : null) || stepLabel || op.activePhase
      return { status, percent: op.activePercent }
    }
    return { status: op.flatStatus || op.title, percent: op.flatPercent }
  }

  function startOperation(opts: {
    installationId: string
    title: string
    apiCall: () => Promise<ActionResult>
    cancellable?: boolean
    returnTo?: string
    opKind?: ShowProgressOpts['opKind']
    destroysInstance?: boolean
    chainSpan?: ShowProgressOpts['chainSpan']
    successTerminal?: ShowProgressOpts['successTerminal']
    actionId?: string
  }): void {
    const {
      installationId,
      title,
      apiCall,
      returnTo,
      opKind,
      destroysInstance,
      chainSpan,
      successTerminal,
      actionId
    } = opts

    const outgoing = operations.get(installationId)
    const carriedPriorSteps =
      chainSpan === 'launch' && outgoing?.steps?.length
        ? [...(outgoing.priorSteps ?? []), ...outgoing.steps]
        : null

    cleanupOperation(installationId)

    sessionStore.startSession(installationId)
    const sessionLabel = title.split(' — ')[0] || t('progress.working')
    sessionStore.setActiveSession(installationId, sessionLabel)

    const op: Operation = {
      title: title || t('progress.working'),
      returnTo,
      opKind: opKind ?? 'generic',
      destroysInstance: !!destroysInstance,
      chainSpan: chainSpan ?? null,
      successTerminal: successTerminal ?? null,
      steps: null,
      priorSteps: carriedPriorSteps,
      activePhase: null,
      activePercent: -1,
      lastStatus: {},
      phaseErrors: {},
      flatStatus: t('progress.starting'),
      flatPercent: -1,
      terminalOutput: '',
      done: false,
      error: null,
      finished: false,
      cancelRequested: false,
      result: null,
      actionId,
      _startedAtMs: Date.now(),
      _resultEmitted: false,
      unsubProgress: null,
      unsubOutput: null,
      apiCall,
      _globalFloor: 0
    }
    operations.set(installationId, op)
    const rop = operations.get(installationId)!

    if (chainSpan === 'launch' && typeof window.api.logsSnapshot === 'function') {
      void window.api
        .logsSnapshot(installationId)
        .then((snapshot) => {
          if (!snapshot) return
          if (operations.get(installationId) !== rop) return
          rop.terminalOutput = snapshot + rop.terminalOutput
        })
        .catch(() => {})
    }

    rop.unsubProgress = window.api.onInstallProgress((data: ProgressData) => {
      if (data.installationId !== installationId) return

      if (data.cancelRequested) {
        rop.cancelRequested = true
        rop.flatStatus = t('progress.cancelling')
        return
      }

      if (data.phase === 'steps' && data.steps) {
        rop.steps = data.steps
        rop.activePhase = null
        rop.activePercent = -1
        return
      }

      if (data.phase === 'done' && rop.steps) {
        rop.done = true
        return
      }

      if (rop.steps) {
        const stepIndex = rop.steps.findIndex((s) => s.phase === data.phase)
        if (stepIndex === -1) return
        rop.activePhase = data.phase
        rop.lastStatus[data.phase] = data.status || data.phase
        rop.phaseErrors[data.phase] = data.error === true
        rop.activePercent = data.percent ?? -1
        return
      }

      if (!rop.cancelRequested) {
        rop.flatStatus = data.status || data.phase
      }
      if (data.percent !== undefined) {
        rop.flatPercent = data.percent
      }
    })

    rop.unsubOutput = window.api.onComfyOutput((data: ComfyOutputData) => {
      if (data.installationId !== installationId) return
      rop.terminalOutput += data.text
    })

    const cleanupRop = (): void => {
      if (rop.unsubProgress) rop.unsubProgress()
      if (rop.unsubOutput) rop.unsubOutput()
      rop.unsubProgress = null
      rop.unsubOutput = null
    }

    let p: Promise<ActionResult>
    try {
      p = apiCall()
    } catch (err) {
      rop.error = (err as Error).message || t('progress.unknownError')
      rop.finished = true
      cleanupRop()
      sessionStore.clearActiveSession(installationId)
      sessionStore.errorInstances.set(installationId, {
        installationName: rop.title,
        message: rop.error
      })
      emitOpResult(rop, installationId, 'failed')
      return
    }

    p.then((result) => {
      rop.finished = true
      if (result.ok || result.cancelled || result.portConflict) rop.result = result
      cleanupRop()

      sessionStore.clearActiveSession(installationId)

      if (result.ok) {
        if (rop.steps) rop.done = true
        emitOpResult(rop, installationId, 'success')
      } else if (result.cancelled) {
        emitOpResult(rop, installationId, 'cancelled_user')
      } else if (!result.portConflict) {
        rop.error = result.message || t('progress.unknownError')
        sessionStore.errorInstances.set(installationId, {
          installationName: rop.title,
          message: rop.error
        })
        emitOpResult(rop, installationId, 'failed')
      }
    }).catch((err: Error) => {
      rop.error = err.message
      rop.finished = true
      cleanupRop()
      sessionStore.clearActiveSession(installationId)
      sessionStore.errorInstances.set(installationId, {
        installationName: rop.title,
        message: rop.error
      })
      emitOpResult(rop, installationId, 'failed')
    })
  }

  function cancelOperation(installationId: string): void {
    const op = operations.get(installationId)
    if (!op) return
    if (op.finished) return
    op.cancelRequested = true
    op.flatStatus = t('progress.cancelling')
    window.api.cancelOperation(installationId)
    window.api.stopComfyUI(installationId)
  }

  function retryOperation(installationId: string): void {
    const op = operations.get(installationId)
    if (!op?.finished || !op.apiCall) return
    startOperation({
      installationId,
      title: op.title,
      apiCall: op.apiCall,
      returnTo: op.returnTo,
      opKind: op.opKind,
      destroysInstance: op.destroysInstance,
      actionId: op.actionId
    })
  }

  function dismissOperation(installationId: string): void {
    if (!operations.get(installationId)?.finished) return
    operations.delete(installationId)
    sessionStore.clearErrorInstance(installationId)
  }

  function globalProgressFor(op: Operation): {
    percent: number
    indeterminate: boolean
  } {
    const PRIOR_FRACTION = 0.7
    const isLaunchLeg = !!op.priorSteps?.length || op.chainSpan === 'launch'
    const isInstallLeg = op.chainSpan === 'install'
    const priorBase = isLaunchLeg ? PRIOR_FRACTION * 100 : 0
    const span = isLaunchLeg ? 1 - PRIOR_FRACTION : isInstallLeg ? PRIOR_FRACTION : 1

    if (op.finished) {
      if (op.result?.ok) {
        return { percent: isInstallLeg ? PRIOR_FRACTION * 100 : 100, indeterminate: false }
      }
      return { percent: op._globalFloor, indeterminate: false }
    }

    if (!op.steps) {
      const raw = op.flatPercent
      if (raw < 0) return { percent: op._globalFloor, indeterminate: true }
      const next = Math.max(op._globalFloor, raw)
      op._globalFloor = next
      return { percent: next, indeterminate: false }
    }

    const weights = getPhaseWeights(op.steps)
    const activeIdx = op.activePhase ? op.steps.findIndex((s) => s.phase === op.activePhase) : -1

    if (activeIdx < 0 || !op.activePhase) {
      const floor = Math.max(op._globalFloor, priorBase)
      op._globalFloor = floor
      return { percent: floor, indeterminate: false }
    }

    let baselineW = 0
    for (let i = 0; i < activeIdx; i++) {
      const prev = op.steps[i]
      if (!prev) continue
      baselineW += weights[prev.phase] ?? 0
    }
    const activeW = weights[op.activePhase] ?? 0
    const baseline = priorBase + baselineW * span * 100
    const slotEnd = priorBase + (baselineW + activeW) * span * 100

    const raw =
      op.activePercent < 0 ? baseline : baseline + (slotEnd - baseline) * (op.activePercent / 100)
    const next = Math.min(99, Math.max(op._globalFloor, raw))
    op._globalFloor = next
    return { percent: next, indeterminate: op.activePercent < 0 }
  }

  return {
    operations,
    getProgressInfo,
    globalProgressFor,
    startOperation,
    cleanupOperation,
    cancelOperation,
    retryOperation,
    dismissOperation
  }
})
