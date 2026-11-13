import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'
import { useProgressStore } from '../stores/progressStore'
import { useModal } from './useModal'
import type { Installation } from '../types/ipc'

export interface InstallProgress {
  percent: number
  phase: string
  cancelling: boolean
}

const VIEW_INSTALL_LOGS: InjectionKey<(installationId: string) => void> = Symbol('viewInstallLogs')

export function provideInstallLogs(view: (installationId: string) => void): void {
  provide(VIEW_INSTALL_LOGS, view)
}

export function installProgressOf(
  progressStore: ReturnType<typeof useProgressStore>,
  installationId: string
): InstallProgress | null {
  const op = progressStore.operations.get(installationId)
  if (!op || op.finished || op.opKind !== 'install') return null
  const { percent } = progressStore.globalProgressFor(op)
  const phase = op.steps?.find((step) => step.phase === op.activePhase)?.label ?? ''
  return { percent: Math.round(percent), phase, cancelling: op.cancelRequested }
}

export function useInstallingBuilds(): (installationId: string) => boolean {
  const progressStore = useProgressStore()
  return (installationId) => installProgressOf(progressStore, installationId) !== null
}

export function useInstallProgress(build: () => Installation): {
  progress: ComputedRef<InstallProgress | null>
  detail: ComputedRef<string>
  viewLogs: () => void
  cancel: () => Promise<void>
} {
  const { t } = useI18n()
  const progressStore = useProgressStore()
  const modal = useModal()
  const view = inject(VIEW_INSTALL_LOGS, null)

  const progress = computed(() => installProgressOf(progressStore, build().id))
  const detail = computed(() => {
    const current = progress.value
    if (!current) return ''
    if (current.cancelling) return t('installProgress.cancelling')
    if (!current.phase) return t('installProgress.starting')
    return t('installProgress.detail', { phase: current.phase, percent: current.percent })
  })

  function viewLogs(): void {
    view?.(build().id)
  }

  async function cancel(): Promise<void> {
    const current = build()
    const confirmed = await modal.confirm({
      title: t('installProgress.cancelTitle'),
      message: t('installProgress.cancelMessage', { name: current.name }),
      confirmLabel: t('installProgress.cancelConfirm'),
      confirmStyle: 'danger'
    })
    if (confirmed) progressStore.cancelOperation(current.id)
  }

  return { progress, detail, viewLogs, cancel }
}
