import * as installations from '../installations'
import * as settings from '../settings'
import { AUTO_LAUNCH_LAST, AUTO_LAUNCH_NONE } from '../settings'
import { applySettingSet } from './ipc/registerSettingsHandlers'

type InstallationRecord = installations.InstallationRecord

function saveOrWarn(save: () => void): void {
  try {
    save()
  } catch (err) {
    console.warn('[auto-start] could not save the Auto start setting:', err)
  }
}

function isCloud(inst: InstallationRecord): boolean {
  return inst.sourceId === installations.CLOUD_SOURCE_ID
}

function isBeingUninstalled(inst: InstallationRecord): boolean {
  return inst.status === 'partial-delete'
}

async function isOnlyBuildWithoutAutoStart(installationId: string): Promise<boolean> {
  const builds = await installations.list()
  const current = settings.get('autoLaunchOnStartup')
  const chosen =
    current === AUTO_LAUNCH_LAST ||
    builds.some((inst) => inst.id === current && !isCloud(inst) && !isBeingUninstalled(inst))
  if (chosen) return false
  const localBuilds = builds.filter((inst) => !isCloud(inst) && inst.status === 'installed')
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

async function savedAutoStartBuild(saved: string): Promise<InstallationRecord | null> {
  return saved === AUTO_LAUNCH_LAST ? installations.getRecent() : installations.get(saved)
}

export async function pinAutoStartToALocalBuild(): Promise<InstallationRecord | null> {
  const saved = settings.get('autoLaunchOnStartup')
  if (typeof saved !== 'string' || saved === '' || saved === AUTO_LAUNCH_NONE) return null
  const build = await savedAutoStartBuild(saved)
  const localBuild = build && !isCloud(build) ? build : null
  if (saved === AUTO_LAUNCH_LAST || build !== localBuild) {
    saveOrWarn(() => settings.set('autoLaunchOnStartup', localBuild?.id ?? AUTO_LAUNCH_NONE))
  }
  return localBuild
}
