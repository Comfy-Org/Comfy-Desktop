import type { InstallationRecord } from '../../installations'

export function isInstallationVisibleToRenderer(installation: InstallationRecord): boolean {
  return installation.status !== 'installing'
}
