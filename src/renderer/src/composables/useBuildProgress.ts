import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'
import { useProgressStore } from '../stores/progressStore'
import { useModal } from './useModal'
import { isUninstallOpKind, updatesBuildInPlace } from '../lib/progressOpKind'
import { progressStepName } from '../lib/progressStatusLabel'
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
  return !!op && op.opKind === 'launch' && op.finished && !!op.error
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

export function useBuildProgress(build: () => Installation): {
  progress: ComputedRef<BuildProgress | null>
  detail: ComputedRef<string>
  viewLogs: () => void
  cancel: () => Promise<void>
} {
  const i18n = useI18n()
  const { t } = i18n
  const progressStore = useProgressStore()
  const modal = useModal()
  const view = useViewBuildLogs()

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
    if (progress.value?.kind === 'launch') {
      progressStore.cancelOperation(current.id)
      return
    }
    const copy = CANCEL_COPY[progress.value?.kind ?? 'install']
    const confirmed = await modal.confirm({
      title: t(`${copy}.cancelTitle`),
      message: t(`${copy}.cancelMessage`, { name: current.name, task: progress.value?.task ?? '' }),
      confirmLabel: t(`${copy}.cancelConfirm`),
      confirmStyle: 'danger'
    })
    if (confirmed) progressStore.cancelOperation(current.id)
  }

  return { progress, detail, viewLogs, cancel }
}
