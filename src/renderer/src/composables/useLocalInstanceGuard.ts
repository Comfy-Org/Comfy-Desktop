import { useI18n } from 'vue-i18n'
import { useSessionStore } from '../stores/sessionStore'
import { useInstallationStore } from '../stores/installationStore'
import { useDialogs } from './useDialogs'
import { installationIdOf, sessionKindOf } from '../../../shared/performanceTestSession'
import { isAppsBuild } from '../../../shared/appsBuild'

export function useLocalInstanceGuard() {
  const { t } = useI18n()
  const sessionStore = useSessionStore()
  const installationStore = useInstallationStore()
  const dialogs = useDialogs()

  async function checkBeforeLaunch(
    targetId: string,
    opts: { isRestart?: boolean } = {}
  ): Promise<boolean> {
    if (opts.isRestart) return true

    const target = installationStore.installations.find((i) => i.id === targetId)
    if (target && target.sourceCategory !== 'local') return true
    if (isAppsBuild(target)) return true

    const runningLocal: { id: string; name: string }[] = []
    const label = (id: string, name: string): string =>
      sessionKindOf(id) === 'performance_test'
        ? t('launch.instanceRunningPerformanceTest', { name })
        : name
    for (const [id, instance] of sessionStore.runningInstances) {
      if (id === targetId) continue
      const inst = installationStore.installations.find((i) => i.id === installationIdOf(id))
      if (isAppsBuild(inst)) continue
      if (!inst || inst.sourceCategory === 'local') {
        runningLocal.push({ id, name: label(id, instance.installationName) })
      }
    }
    for (const [id, instance] of sessionStore.launchingInstances) {
      if (id === targetId) continue
      if (runningLocal.some((r) => r.id === id)) continue
      const inst = installationStore.installations.find((i) => i.id === installationIdOf(id))
      if (isAppsBuild(inst)) continue
      if (!inst || inst.sourceCategory === 'local') {
        runningLocal.push({ id, name: label(id, instance.installationName) })
      }
    }

    if (runningLocal.length === 0) return true

    const warningEnabled = await window.api
      .getSetting('warnBeforeRunningMultipleInstances')
      .catch(() => true)
    if (warningEnabled === false) return true

    const choice = await dialogs.confirm({
      title: t('launch.instanceRunningTitle'),
      message: t('launch.instanceRunningMessage'),
      hint: t('launch.instanceRunningPreferencesHint'),
      messageDetails: [
        { label: t('launch.instanceRunningListLabel'), items: runningLocal.map((r) => r.name) }
      ],
      confirmLabel: t('launch.instanceRunningReplace'),
      tone: 'primary',
      secondaryLabel: t('launch.instanceRunningProceed'),
      secondaryTone: 'default',
      showCancel: false,
      showCloseIcon: true
    })

    if (choice === 'primary') {
      await Promise.all(
        runningLocal.map(async (r) => {
          await window.api.stopComfyUI(r.id)
          window.api.closeComfyWindow(r.id, { skipConfirm: true }).catch((err) => {
            console.warn('useLocalInstanceGuard: closeComfyWindow failed', err)
          })
        })
      )
      return true
    }

    return choice === 'secondary'
  }

  return { checkBeforeLaunch }
}
