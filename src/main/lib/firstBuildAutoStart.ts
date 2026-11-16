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
  try {
    if (!(await isOnlyBuildWithoutAutoStart(installationId))) return
    settings.set('autoStartAwaitingFirstStart', installationId)
    applySettingSet('autoLaunchOnStartup', installationId)
  } catch (err) {
    console.warn('[auto-start] could not give the first build Auto start:', err)
  }
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

function isCloud(inst: installations.InstallationRecord): boolean {
  return inst.sourceId === installations.CLOUD_SOURCE_ID
}

async function savedAutoStartBuild(
  saved: string
): Promise<installations.InstallationRecord | null> {
  return saved === AUTO_LAUNCH_LAST ? installations.getRecent() : installations.get(saved)
}

export async function pinAutoStartToALocalBuild(): Promise<void> {
  const saved = settings.get('autoLaunchOnStartup')
  if (typeof saved !== 'string' || saved === AUTO_LAUNCH_NONE) return
  const build = await savedAutoStartBuild(saved)
  if (saved !== AUTO_LAUNCH_LAST && !(build && isCloud(build))) return
  const pinned = build && !isCloud(build) ? build.id : AUTO_LAUNCH_NONE
  saveOrWarn(() => settings.set('autoLaunchOnStartup', pinned))
}
