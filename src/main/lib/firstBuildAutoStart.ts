import * as installations from '../installations'
import * as settings from '../settings'
import { AUTO_LAUNCH_NONE } from '../settings'

export async function isOnlyBuildWithoutAutoStart(installationId: string): Promise<boolean> {
  const current = settings.get('autoLaunchOnStartup') as string | undefined
  if (current !== undefined && current !== AUTO_LAUNCH_NONE) return false
  const localBuilds = (await installations.list()).filter(
    (inst) => inst.sourceId !== installations.CLOUD_SOURCE_ID && inst.status === 'installed'
  )
  return localBuilds.length === 1 && localBuilds[0]!.id === installationId
}
