import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'
import { useProgressStore } from '../stores/progressStore'
import { useModal } from './useModal'
import { isUninstallOpKind } from '../lib/progressOpKind'
import { progressStepName } from '../lib/progressStatusLabel'
import type { Installation, ProgressStep } from '../types/ipc'

export type BuildProgressKind = 'install' | 'launch' | 'uninstall'

export interface BuildProgress {
  kind: BuildProgressKind
  percent: number | null
  phase: string
  cancelling: boolean
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
      cancelling: op.cancelRequested
    }
  }
  if (op.finished) return null
  if (op.opKind === 'launch') {
    return {
      kind: 'launch',
      percent: op.flatPercent >= 0 ? Math.round(op.flatPercent) : null,
      phase: activeStep ? nameStep(activeStep) : op.flatStatus,
      cancelling: op.cancelRequested
    }
  }
  if (op.opKind !== 'install') return null
  const { percent } = progressStore.globalProgressFor(op)
  return {
    kind: 'install',
    percent: Math.round(percent),
    phase: activeStep ? nameStep(activeStep) : '',
    cancelling: op.cancelRequested
  }
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
    const uninstalling = progress.value?.kind === 'uninstall'
    const confirmed = await modal.confirm({
      title: uninstalling ? t('uninstallProgress.cancelTitle') : t('installProgress.cancelTitle'),
      message: uninstalling
        ? t('uninstallProgress.cancelMessage', { name: current.name })
        : t('installProgress.cancelMessage', { name: current.name }),
      confirmLabel: uninstalling
        ? t('uninstallProgress.cancelConfirm')
        : t('installProgress.cancelConfirm'),
      confirmStyle: 'danger'
    })
    if (confirmed) progressStore.cancelOperation(current.id)
  }

  return { progress, detail, viewLogs, cancel }
}
