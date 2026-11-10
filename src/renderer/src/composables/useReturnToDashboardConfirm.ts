import { useI18n } from 'vue-i18n'
import { useModal } from './useModal'
import type { Installation } from '../types/ipc'

export type ReturnToDashboardReason = 'in_flight' | 'crashed' | 'stopped' | 'running'

export function useReturnToDashboardConfirm() {
  const { t } = useI18n()
  const modal = useModal()

  async function confirmReturnToDashboard(
    installation: Installation | null | undefined,
    reason: ReturnToDashboardReason
  ): Promise<boolean> {
    if (reason === 'in_flight') {
      return modal.confirm({
        title: t('overlay.cancelCurrentTitle'),
        message: t('overlay.cancelMessage'),
        confirmLabel: t('overlay.cancelConfirm'),
        confirmStyle: 'danger'
      })
    }
    if (!installation || installation.sourceCategory !== 'local') return true
    if (reason === 'stopped' || reason === 'crashed') return true
    return modal.confirm({
      title: t('dashboard.confirmStopLocal.title'),
      message: t('dashboard.confirmStopLocal.message'),
      confirmLabel: t('dashboard.confirmStopLocal.confirmLabel'),
      confirmStyle: 'danger'
    })
  }

  return { confirmReturnToDashboard }
}
