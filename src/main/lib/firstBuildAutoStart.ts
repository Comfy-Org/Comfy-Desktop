import * as installations from '../installations'
import * as settings from '../settings'
import { AUTO_LAUNCH_NONE } from '../settings'
import { applySettingSet } from './ipc/registerSettingsHandlers'

async function isOnlyBuildWithoutAutoStart(installationId: string): Promise<boolean> {
  const localBuilds = (await installations.list()).filter(
    (inst) => inst.sourceId !== installations.CLOUD_SOURCE_ID && inst.status === 'installed'
  )
  const current = settings.get('autoLaunchOnStartup') as string | undefined
  if (current !== undefined && current !== AUTO_LAUNCH_NONE) return false
  return localBuilds.length === 1 && localBuilds[0]!.id === installationId
}

export async function startFirstBuildWithDesktop(installationId: string): Promise<void> {
  if (!(await isOnlyBuildWithoutAutoStart(installationId))) return
  settings.set('autoStartAwaitingFirstStart', installationId)
  applySettingSet('autoLaunchOnStartup', installationId)
}

export function settleAutoStartOnFirstStart(installationId: string, started: boolean): void {
  if (settings.get('autoStartAwaitingFirstStart') !== installationId) return
  settings.set('autoStartAwaitingFirstStart', undefined)
  if (!started && settings.get('autoLaunchOnStartup') === installationId) {
    applySettingSet('autoLaunchOnStartup', AUTO_LAUNCH_NONE)
  }
}
