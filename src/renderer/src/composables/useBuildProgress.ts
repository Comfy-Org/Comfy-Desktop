import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'
import { useProgressStore } from '../stores/progressStore'
import { useModal } from './useModal'
import type { Installation } from '../types/ipc'

export type BuildProgressKind = 'install' | 'launch'

export interface BuildProgress {
  kind: BuildProgressKind
  percent: number | null
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
  installationId: string
): BuildProgress | null {
  const op = progressStore.operations.get(installationId)
  if (!op || op.finished) return null
  if (op.opKind !== 'install' && op.opKind !== 'launch') return null
  if (op.opKind === 'launch') {
    return {
      kind: 'launch',
      percent: op.flatPercent >= 0 ? Math.round(op.flatPercent) : null,
      cancelling: op.cancelRequested
    }
  }
  const { percent } = progressStore.globalProgressFor(op)
  return {
    kind: 'install',
    percent: Math.round(percent),
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

export function useInstallingBuilds(): (installationId: string) => boolean {
  const progressStore = useProgressStore()
  return (installationId) => buildProgressOf(progressStore, installationId)?.kind === 'install'
}

export function useBuildProgress(build: () => Installation): {
  progress: ComputedRef<BuildProgress | null>
  viewLogs: () => void
  cancel: () => Promise<void>
} {
  const { t } = useI18n()
  const progressStore = useProgressStore()
  const modal = useModal()
  const view = useViewBuildLogs()

  const progress = computed(() => buildProgressOf(progressStore, build().id))

  function viewLogs(): void {
    view(build().id)
  }

  async function cancel(): Promise<void> {
    const current = build()
    if (progress.value?.kind === 'launch') {
      progressStore.cancelOperation(current.id)
      return
    }
    const confirmed = await modal.confirm({
      title: t('installProgress.cancelTitle'),
      message: t('installProgress.cancelMessage', { name: current.name }),
      confirmLabel: t('installProgress.cancelConfirm'),
      confirmStyle: 'danger'
    })
    if (confirmed) progressStore.cancelOperation(current.id)
  }

  return { progress, viewLogs, cancel }
}
