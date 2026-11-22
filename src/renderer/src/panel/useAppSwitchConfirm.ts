import { useI18n } from 'vue-i18n'
import { useDialogs } from '../composables/useDialogs'
import type { AppCard, AppSwitchStop } from '../types/ipc'

const UNKNOWN = 'unknown' as const

export function useAppSwitchConfirm(): (
  app: AppCard,
  openAppId: string | null,
  stillWanted?: () => boolean
) => Promise<boolean> {
  const { t } = useI18n()
  const dialogs = useDialogs()
  const switchMessage = (stop: AppSwitchStop | typeof UNKNOWN): string => {
    if (stop === UNKNOWN) return t('apps.switchWhileRunning.bodyUnsure')
    const current = stop.appTitle
    if ('closesDraft' in stop) return t('apps.switchWhileRunning.bodyDraft', { current })
    return t('apps.switchWhileRunning.body', { current, count: stop.otherRuns })
  }
  return async (app, openAppId, stillWanted = () => true) => {
    if (app.id === openAppId) return true
    const stop = await window.api.appSwitchStopsRun(app.id).catch(() => UNKNOWN)
    if (!stillWanted()) return false
    if (!stop) return true
    const choice = await dialogs.confirm({
      title: t('apps.switchWhileRunning.title', { app: app.title }),
      message: switchMessage(stop),
      confirmLabel: t('apps.switchWhileRunning.switch'),
      cancelLabel: t('apps.switchWhileRunning.stay')
    })
    return choice === 'primary'
  }
}
