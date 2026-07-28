/**
 * One definition of "can't install this", so the tile's receded treatment, its
 * reason tag and its disabled activation can't disagree.
 */
import type { Distribution, DistributionState } from './types'
import type { Installation } from '../types/ipc'

/** An install that came from a distribution. One definition, so the shelf it
 *  sorts into and the glyph it wears can't disagree. `distributionId` arrives
 *  through an index signature, hence the emptiness check. */
export function isDistributionInstall(inst: Installation): boolean {
  return inst.sourceId === 'comfybuilder' || Boolean(inst.distributionId)
}

export const BLOCKED_DISTRIBUTION_STATES: readonly DistributionState[] = [
  'no-build',
  'platform-mismatch',
]

/** i18n suffix per blocked state: keys both the short tag label (`states.*`)
 *  and the fallback long reason (`blockedReason.*`). */
export const BLOCKED_STATE_KEY: Record<string, string> = {
  'no-build': 'noBuild',
  'platform-mismatch': 'platformMismatch',
}

export function isBlockedDistribution(dist: Pick<Distribution, 'state'>): boolean {
  return BLOCKED_DISTRIBUTION_STATES.includes(dist.state)
}
