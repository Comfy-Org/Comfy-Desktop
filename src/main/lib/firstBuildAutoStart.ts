import * as installations from '../installations'
import * as settings from '../settings'
import { AUTO_LAUNCH_LAST, AUTO_LAUNCH_NONE } from '../settings'
import { applySettingSet } from './ipc/registerSettingsHandlers'

function saveOrWarn(save: () => void): void {
  try {
    save()
  } catch (err) {
    console.warn('[auto-start] could not save the Auto start setting:', err)
  }
}

async function isOnlyBuildWithoutAutoStart(installationId: string): Promise<boolean> {
  const builds = await installations.list()
  const current = settings.get('autoLaunchOnStartup')
  const chosen =
    current === AUTO_LAUNCH_LAST ||
    (typeof current === 'string' && builds.some((inst) => inst.id === current))
  if (chosen) return false
  const localBuilds = builds.filter(
    (inst) => inst.sourceId !== installations.CLOUD_SOURCE_ID && inst.status === 'installed'
  )
  return localBuilds.length === 1 && localBuilds[0]!.id === installationId
}

export async function startFirstBuildWithDesktop(installationId: string): Promise<void> {
  if (!(await isOnlyBuildWithoutAutoStart(installationId))) return
  saveOrWarn(() => {
    settings.set('autoStartAwaitingFirstStart', installationId)
    applySettingSet('autoLaunchOnStartup', installationId)
  })
}

export function settleAutoStartOnFirstStart(installationId: string, started: boolean): void {
  if (settings.get('autoStartAwaitingFirstStart') !== installationId) return
  saveOrWarn(() => {
    settings.set('autoStartAwaitingFirstStart', undefined)
    if (!started && settings.get('autoLaunchOnStartup') === installationId) {
      applySettingSet('autoLaunchOnStartup', AUTO_LAUNCH_NONE)
    }
  })
}

export async function pinLastUsedAutoStart(): Promise<void> {
  if (settings.get('autoLaunchOnStartup') !== AUTO_LAUNCH_LAST) return
  const recent = await installations.getRecent()
  saveOrWarn(() => settings.set('autoLaunchOnStartup', recent?.id ?? AUTO_LAUNCH_NONE))
}
