/**
 * PROTOTYPE (throwaway branch) — shared types for the chooser's shelf layout.
 * Two families: the user's own installs, and the workspace's distributions
 * (builder-backed installs + not-yet-installed distributions).
 */
import type { Distribution } from '../../devplatform/types'
import type { Installation } from '../../types/ipc'

/** One tile in a family grid — an install tile or a distribution card. */
export type ChooserGridEntry =
  | { kind: 'install'; inst: Installation }
  | { kind: 'dist'; dist: Distribution }

export function entryKey(entry: ChooserGridEntry): string {
  return entry.kind === 'install' ? entry.inst.id : `dist:${entry.dist.id}`
}
