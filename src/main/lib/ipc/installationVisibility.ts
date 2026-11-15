import type { InstallationRecord } from '../../installations'

const runningInstalls = new Map<string, number>()

export function markInstallRunning(installationId: string): void {
  runningInstalls.set(installationId, (runningInstalls.get(installationId) ?? 0) + 1)
}

export function markInstallSettled(installationId: string): void {
  const remaining = (runningInstalls.get(installationId) ?? 0) - 1
  if (remaining > 0) runningInstalls.set(installationId, remaining)
  else runningInstalls.delete(installationId)
}

export function isInstallationVisibleToRenderer(installation: InstallationRecord): boolean {
  return installation.status !== 'installing' || runningInstalls.has(installation.id)
}
