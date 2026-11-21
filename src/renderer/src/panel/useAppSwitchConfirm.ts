import { useI18n } from 'vue-i18n'
import { useDialogs } from '../composables/useDialogs'
import type { AppCard } from '../types/ipc'

const UNKNOWN = 'unknown' as const

export function useAppSwitchConfirm(): (app: AppCard) => Promise<boolean> {
  const { t } = useI18n()
  const dialogs = useDialogs()
  return async (app) => {
    const stop = await window.api.appSwitchStopsRun(app.id).catch(() => UNKNOWN)
    if (!stop) return true
    const choice = await dialogs.confirm({
      title: t('apps.switchWhileRunning.title', { app: app.title }),
      message:
        stop === UNKNOWN
          ? t('apps.switchWhileRunning.bodyUnsure')
          : t('apps.switchWhileRunning.body', { current: stop.appTitle, count: stop.otherRuns }),
      confirmLabel: t('apps.switchWhileRunning.switch'),
      cancelLabel: t('apps.switchWhileRunning.stay')
    })
    return choice === 'primary'
  }
}
