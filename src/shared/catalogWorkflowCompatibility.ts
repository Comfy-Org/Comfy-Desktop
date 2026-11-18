import semver from 'semver'
import type { Installation } from '../types/ipc'

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
  minComfyUIVersion: string | null
): boolean {
  if (
    installation.sourceCategory !== 'local' ||
    installation.sourceId === 'desktop' ||
    installation.status !== 'installed'
  ) {
    return false
  }
  const core = installation.comfyVersion as
    { baseTag?: string; baseTagVerified?: boolean; ancestorTag?: string } | undefined
  const verifiedVersion = core?.baseTagVerified ? core.baseTag : core?.ancestorTag
  return meetsCatalogWorkflowMinimum(
    verifiedVersion ?? core?.baseTag ?? installation.version,
    minComfyUIVersion
  )
}
