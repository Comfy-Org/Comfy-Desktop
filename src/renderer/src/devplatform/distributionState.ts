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

/** A version as a number, or null if it isn't one. Digits only: `Number` reads
 *  '' and ' ' as 0, which would advertise an update over every published
 *  version, and accepts '-1' and '1e3' as integers. */
function versionNumber(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null
  const num = Number(raw)
  return Number.isSafeInteger(num) ? num : null
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
  const currentNum = versionNumber(inst.distributionVersion)
  if (currentNum === null) return ''

  const row = distributions.find((dist) => dist.id === id)
  if (!row || isBlockedDistribution(row)) return ''
  const latestNum = versionNumber(row.version)
  if (latestNum === null) return ''
  return latestNum > currentNum ? String(latestNum) : ''
}
