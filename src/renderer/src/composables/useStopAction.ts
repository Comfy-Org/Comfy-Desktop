import { useI18n } from 'vue-i18n'

export interface StopActionDialogs {
  confirm: (opts: {
    title: string
    message: string
    confirmLabel: string
  }) => Promise<boolean | string>
  alert: (opts: { title: string; message: string }) => Promise<unknown>
}

export function useStopAction(dialogs: StopActionDialogs) {
  const { t } = useI18n()

  async function confirmAndStop(installationId: string): Promise<boolean> {
    const stopLabel = t('actions.stop')
    const confirmed = await dialogs.confirm({
      title: t('actions.stopConfirmTitle'),
      message: t('actions.stopConfirmMessage'),
      confirmLabel: stopLabel
    })
    if (!confirmed) return false
    try {
      await window.api.stopComfyUI(installationId)
      return true
    } catch (err) {
      await dialogs.alert({ title: stopLabel, message: (err as Error)?.message || String(err) })
      return false
    }
  }

  return { confirmAndStop }
}
