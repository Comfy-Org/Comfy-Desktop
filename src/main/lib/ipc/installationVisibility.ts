import type { InstallationRecord } from '../../installations'

/** Keep in-place managed Build updates visible while fresh installs stay hidden. */
export function isInstallationVisibleToRenderer(installation: InstallationRecord): boolean {
  if (installation.status !== 'installing') return true
  const rollback = installation.comfybuilderRollback
  return (
    installation.sourceId === 'comfybuilder' &&
    rollback !== null &&
    typeof rollback === 'object' &&
    !Array.isArray(rollback)
  )
}
