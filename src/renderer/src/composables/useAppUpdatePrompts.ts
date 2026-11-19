import { useI18n } from 'vue-i18n'
import { useModal } from './useModal'

export function useAppUpdatePrompts(): {
  showAppUpdateRestartPrompt: (version: string | null) => Promise<void>
  showAppUpdateDownloadPrompt: (version: string | null) => Promise<void>
} {
  const { t } = useI18n()
  const modal = useModal()

  function versionLabel(version: string | null): string {
    return version ? `v${version}` : t('appUpdate.fallbackVersion')
  }

  async function showAppUpdateRestartPrompt(version: string | null): Promise<void> {
    const ok = await modal.confirm({
      title: t('appUpdate.readyTitle'),
      message: t('appUpdate.readyMessage', { version: versionLabel(version) }),
      confirmLabel: t('appUpdate.restartNow'),
      confirmStyle: 'primary'
    })
    if (!ok) return
    await window.api.installUpdate()
  }

  async function showAppUpdateDownloadPrompt(version: string | null): Promise<void> {
    const ok = await modal.confirm({
      title: t('appUpdate.availableTitle'),
      message: t('appUpdate.availableMessage', { version: versionLabel(version) }),
      confirmLabel: t('appUpdate.download'),
      confirmStyle: 'primary'
    })
    if (!ok) return
    await window.api.downloadUpdate()
  }

  return { showAppUpdateRestartPrompt, showAppUpdateDownloadPrompt }
}
