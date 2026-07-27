/**
 * Which distribution states mean "this machine can't install it".
 *
 * These earn no tile on the chooser at all — see
 * `ChooserView.chooserDistributions`. The chooser is a place you pick something
 * to run from, and a card you can only be told "no" by is noise there; the
 * state of a build belongs on the platform.
 */
import type { Distribution, DistributionState } from './types'

export const BLOCKED_DISTRIBUTION_STATES: readonly DistributionState[] = [
  'no-build',
  'platform-mismatch',
]

export function isBlockedDistribution(dist: Pick<Distribution, 'state'>): boolean {
  return BLOCKED_DISTRIBUTION_STATES.includes(dist.state)
}
