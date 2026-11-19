import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'
import { useProgressStore, type Operation } from '../stores/progressStore'
import { useModal } from './useModal'
import { isUninstallOpKind, updatesBuildInPlace } from '../lib/progressOpKind'
import { progressStepName } from '../lib/progressStatusLabel'
import type { ErrorInstance } from '../stores/sessionStore'
import type { Installation, ProgressStep } from '../types/ipc'

export type BuildProgressKind = 'install' | 'launch' | 'uninstall' | 'update' | 'working'

export interface BuildProgress {
  kind: BuildProgressKind
  percent: number | null
  phase: string
  cancelling: boolean
  cancellable: boolean
  task: string
}

const CANCEL_COPY: Record<BuildProgressKind, string> = {
  install: 'installProgress',
  launch: 'installProgress',
  uninstall: 'uninstallProgress',
  update: 'updateProgress',
  working: 'workingProgress'
}

export function inPlaceTaskLabel(
  progress: BuildProgress,
  t: (key: string, params?: Record<string, unknown>) => string
): string | null {
  const { kind, percent, task } = progress
  if (kind === 'update') {
    return percent === null
      ? t('updateProgress.status')
      : t('updateProgress.tileStatus', { percent })
  }
  if (kind === 'working') {
    return percent === null ? task : t('installProgress.detail', { phase: task, percent })
  }
  return null
}

export function cancelConfirmKey(kind: BuildProgressKind): string {
  return `${CANCEL_COPY[kind]}.cancelConfirm`
}

export function operationTask(title: string): string {
  return title.split(/ [\u2014-] /)[0]?.trim() || title
}

const VIEW_BUILD_LOGS: InjectionKey<(installationId: string) => void> = Symbol('viewBuildLogs')

export function provideBuildLogs(view: (installationId: string) => void): void {
  provide(VIEW_BUILD_LOGS, view)
}

export function useViewBuildLogs(): (installationId: string) => void {
  return inject(VIEW_BUILD_LOGS, () => {})
}

export function buildProgressOf(
  progressStore: ReturnType<typeof useProgressStore>,
  installationId: string,
  nameStep: (step: ProgressStep) => string = (step) => step.label
): BuildProgress | null {
  const op = progressStore.operations.get(installationId)
  if (!op) return null
  const activeStep = op.steps?.find((step) => step.phase === op.activePhase)
  if (isUninstallOpKind(op.opKind)) {
    const removedButStillListed = op.finished && op.result?.ok === true
    if (op.finished && !removedButStillListed) return null
    const { percent, indeterminate } = progressStore.globalProgressFor(op)
    return {
      kind: 'uninstall',
      percent: indeterminate ? null : Math.round(percent),
      phase: '',
      cancelling: op.cancelRequested,
      cancellable: true,
      task: ''
    }
  }
  if (op.finished) return null
  if (op.opKind === 'launch') {
    return {
      kind: 'launch',
      percent: op.flatPercent >= 0 ? Math.round(op.flatPercent) : null,
      phase: activeStep ? nameStep(activeStep) : op.flatStatus,
      cancelling: op.cancelRequested,
      cancellable: true,
      task: ''
    }
  }
  if (updatesBuildInPlace(op.opKind, op.actionId)) {
    const { percent, indeterminate } = progressStore.globalProgressFor(op)
    return {
      kind: 'update',
      percent: indeterminate && percent <= 0 ? null : Math.round(percent),
      phase: activeStep ? nameStep(activeStep) : op.flatStatus,
      cancelling: op.cancelRequested,
      cancellable: op.cancellable,
      task: ''
    }
  }
  if (op.opKind === 'install') {
    const { percent } = progressStore.globalProgressFor(op)
    return {
      kind: 'install',
      percent: Math.round(percent),
      phase: activeStep ? nameStep(activeStep) : '',
      cancelling: op.cancelRequested,
      cancellable: true,
      task: ''
    }
  }
  const { percent, indeterminate } = progressStore.globalProgressFor(op)
  return {
    kind: 'working',
    percent: indeterminate && percent <= 0 ? null : Math.round(percent),
    phase: activeStep ? nameStep(activeStep) : op.flatStatus,
    cancelling: op.cancelRequested,
    cancellable: op.cancellable,
    task: operationTask(op.title)
  }
}

export function operationFailureOf(
  progressStore: ReturnType<typeof useProgressStore>,
  installationId: string
): string | null {
  const op = progressStore.operations.get(installationId)
  if (!op?.finished || !op.error) return null
  if (op.opKind === 'launch' || op.opKind === 'install' || isUninstallOpKind(op.opKind)) return null
  return op.error
}

export function launchFailed(
  progressStore: ReturnType<typeof useProgressStore>,
  installationId: string
): boolean {
  const op = progressStore.operations.get(installationId)
  return !!op && op.opKind === 'launch' && op.finished && !!op.error && !op.superseded
}

export type BuildFailureKind = 'broken' | 'didnt-start' | 'crashed' | 'error'

export interface BuildFailure {
  kind: BuildFailureKind
  label: string
}

type FailureSession = { errorInstances: ReadonlyMap<string, ErrorInstance> }

export function buildFailure(
  build: Installation,
  sessionStore: FailureSession,
  progressStore: ReturnType<typeof useProgressStore>,
  t: (key: string) => string
): BuildFailure | null {
  if (build.statusTag?.style === 'danger') return { kind: 'broken', label: build.statusTag.label }
  const error = sessionStore.errorInstances.get(build.id)
  if (launchFailed(progressStore, build.id) || error?.startFailed) {
    return { kind: 'didnt-start', label: t('home.buildDidntStart') }
  }
  if (!error) return null
  if (error.exitCode != null || error.signal != null) {
    return { kind: 'crashed', label: t('home.buildCrashed') }
  }
  return { kind: 'error', label: t('chooser.statusError') }
}

export function uninstallFailureOf(
  progressStore: ReturnType<typeof useProgressStore>,
  installationId: string
): string | null {
  const op = progressStore.operations.get(installationId)
  if (!op || !isUninstallOpKind(op.opKind) || !op.finished) return null
  return op.error
}

export function useInstallingBuilds(): (installationId: string) => boolean {
  const progressStore = useProgressStore()
  return (installationId) => buildProgressOf(progressStore, installationId)?.kind === 'install'
}

export function stopsWithItsWindow(opKind: Operation['opKind']): boolean {
  return opKind !== 'launch' && opKind !== 'install' && !isUninstallOpKind(opKind)
}

export function useConfirmStopTask(): (installationId: string, name: string) => Promise<boolean> {
  const { t } = useI18n()
  const progressStore = useProgressStore()
  const modal = useModal()

  return async (installationId, name) => {
    const op = progressStore.operations.get(installationId)
    const current = buildProgressOf(progressStore, installationId)
    if (!op || op.finished || !current) return true
    if (current.kind === 'launch') {
      progressStore.cancelOperation(installationId)
      return true
    }
    if (!current.cancellable) {
      await modal.alert({
        title: t('workingProgress.cannotStopTitle'),
        message: t('workingProgress.cannotStopMessage', { name, task: current.task })
      })
      return false
    }
    const copy = CANCEL_COPY[current.kind]
    const confirmed = await modal.confirm({
      title: t(`${copy}.cancelTitle`),
      message: t(`${copy}.cancelMessage`, { name, task: current.task }),
      confirmLabel: t(`${copy}.cancelConfirm`),
      confirmStyle: 'danger'
    })
    if (!confirmed) return false
    if (progressStore.operations.get(installationId) !== op) return false
    if (!op.finished) progressStore.cancelOperation(installationId)
    return true
  }
}

export function useBuildProgress(build: () => Installation): {
  progress: ComputedRef<BuildProgress | null>
  detail: ComputedRef<string>
  viewLogs: () => void
  cancel: () => Promise<void>
} {
  const i18n = useI18n()
  const { t } = i18n
  const progressStore = useProgressStore()
  const view = useViewBuildLogs()
  const confirmStopTask = useConfirmStopTask()

  const progress = computed(() =>
    buildProgressOf(progressStore, build().id, (step) => progressStepName(step, i18n))
  )
  const detail = computed(() => {
    const current = progress.value
    if (!current) return ''
    if (current.cancelling) return t('installProgress.cancelling')
    const phase =
      current.kind === 'uninstall' ? t('uninstallProgress.removingFiles') : current.phase
    if (!phase) return t('installProgress.starting')
    if (current.percent === null) return phase
    return t('installProgress.detail', { phase, percent: current.percent })
  })

  function viewLogs(): void {
    view(build().id)
  }

  async function cancel(): Promise<void> {
    const current = build()
    await confirmStopTask(current.id, current.name)
  }

  return { progress, detail, viewLogs, cancel }
}
