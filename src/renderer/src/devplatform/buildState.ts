/** Shared identification of installations created from Comfy Builder. */
import type { Installation } from '../types/ipc'

/** The rule itself, over the two raw fields - so callers holding only a subset
 *  of the record (the picker row, the title bar) can ask without a cast.
 *  `distributionId` is the legacy installation schema field, hence the
 *  emptiness check rather than a `typeof`. */
export function isBuildSource(sourceId: unknown, distributionId: unknown): boolean {
  return sourceId === 'comfybuilder' || Boolean(distributionId)
}

/** An install that came from a Build. */
export function isBuildInstall(inst: Installation): boolean {
  return isBuildSource(inst.sourceId, inst.distributionId)
}
