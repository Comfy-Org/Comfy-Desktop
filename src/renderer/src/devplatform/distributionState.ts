/**
 * One definition of "can't install this", so the tile's receded treatment, its
 * reason tag and its disabled activation can't disagree.
 */
import type { Distribution, DistributionState } from './types'
import type { Installation } from '../types/ipc'

/** The rule itself, over the two raw fields — so callers holding only a subset
 *  of the record (the picker row, the title bar) can ask without a cast.
 *  `distributionId` arrives through an index signature, hence the emptiness
 *  check rather than a `typeof`. */
export function isDistributionSource(sourceId: unknown, distributionId: unknown): boolean {
  return sourceId === 'comfybuilder' || Boolean(distributionId)
}

/** An install that came from a distribution. One definition, so the shelf it
 *  sorts into and the glyph it wears can't disagree. */
export function isDistributionInstall(inst: Installation): boolean {
  return isDistributionSource(inst.sourceId, inst.distributionId)
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

/** The distribution version this install would move to, or '' when there is
 *  nothing to promise. Compares THIS install against its catalog row rather than
 *  reading the row's `state`, which is computed against the highest installed
 *  version. Matching is by `distributionId` only — the chooser's name fallback
 *  is fine for hiding a duplicate card, not for claiming a version. */
export function distributionUpdateVersion(
  inst: Installation,
  distributions: readonly Distribution[]
): string {
  // The linked id is the whole identity check: no id, no claim.
  const id = inst.distributionId
  if (typeof id !== 'string' || !id) return ''
  // `Number('')` is 0, which would read as "behind everything".
  const current = typeof inst.distributionVersion === 'string' ? inst.distributionVersion : ''
  if (!current) return ''
  const currentNum = Number(current)
  if (!Number.isInteger(currentNum)) return ''

  const row = distributions.find((dist) => dist.id === id)
  if (!row || isBlockedDistribution(row)) return ''
  const latestNum = Number(row.version)
  if (!row.version || !Number.isInteger(latestNum)) return ''
  return latestNum > currentNum ? String(latestNum) : ''
}
