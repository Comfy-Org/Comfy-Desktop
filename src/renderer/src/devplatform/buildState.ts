/**
 * One definition of "can't install this", so the tile's receded treatment, its
 * reason tag and its disabled activation can't disagree.
 */
import type { Build, BuildState } from './types'
import type { Installation } from '../types/ipc'

/** The rule itself, over the two raw fields - so callers holding only a subset
 *  of the record (the picker row, the title bar) can ask without a cast.
 *  `distributionId` is the legacy installation schema field, hence the
 *  emptiness check rather than a `typeof`. */
export function isBuildSource(sourceId: unknown, distributionId: unknown): boolean {
  return sourceId === 'comfybuilder' || Boolean(distributionId)
}

/** An install that came from a build. One definition, so the shelf it
 *  sorts into and the glyph it wears can't disagree. */
export function isBuildInstall(inst: Installation): boolean {
  return isBuildSource(inst.sourceId, inst.distributionId)
}

export const BLOCKED_BUILD_STATES: readonly BuildState[] = ['no-build', 'platform-mismatch']

/** i18n suffix per blocked state: keys both the short tag label (`states.*`)
 *  and the fallback long reason (`blockedReason.*`). */
export const BLOCKED_STATE_KEY: Record<string, string> = {
  'no-build': 'noBuild',
  'platform-mismatch': 'platformMismatch'
}

export function isBlockedBuild(build: Pick<Build, 'state'>): boolean {
  return BLOCKED_BUILD_STATES.includes(build.state)
}
