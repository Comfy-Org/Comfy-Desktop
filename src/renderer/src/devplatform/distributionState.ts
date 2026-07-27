/**
 * Which distribution states mean "you can't install this".
 *
 * Shared so the card's receded treatment and the chooser's "See all" collapse
 * are driven by ONE list — if they drifted, a tile could be hidden without
 * looking blocked, or look blocked while still counted as installable.
 */
import type { Distribution, DistributionState } from './types'

/** States that cannot be installed. Shown with a reason, never silently dropped. */
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
