import semver from 'semver'
import type { Installation } from '../types/ipc'

export type LocalBuildVersions = Record<string, string | null>

export function meetsCatalogWorkflowMinimum(
  version: string | null | undefined,
  minimum: string | null
): boolean {
  if (minimum === null) return true
  const current = semver.valid(version)
  const required = semver.valid(minimum)
  return current !== null && required !== null && semver.gte(current, required)
}

export function isCompatibleLocalWorkflowBuild(
  installation: Installation,
  launchableVersions: LocalBuildVersions,
  minComfyUIVersion: string | null
): boolean {
  if (installation.sourceCategory !== 'local' || !(installation.id in launchableVersions)) {
    return false
  }
  return meetsCatalogWorkflowMinimum(launchableVersions[installation.id], minComfyUIVersion)
}
