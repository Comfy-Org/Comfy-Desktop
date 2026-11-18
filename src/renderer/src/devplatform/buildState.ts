import type { Installation } from '../types/ipc'

export function isBuildSource(sourceId: unknown, distributionId: unknown): boolean {
  return sourceId === 'comfybuilder' || Boolean(distributionId)
}

export function isBuildInstall(inst: Installation): boolean {
  return isBuildSource(inst.sourceId, inst.distributionId)
}
