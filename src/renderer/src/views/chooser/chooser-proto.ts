/**
 * PROTOTYPE (throwaway branch) — shared types for the chooser IA layout
 * variants. Three families: the user's own installs, builder-backed installs
 * ("installed from workspace"), and not-yet-installed workspace distributions.
 */
import type { Distribution } from '../../devplatform/types'
import type { Installation } from '../../types/ipc'

/** The three competing layouts: sectioned shelves, filter chips over a flat
 *  grid, and a spatial machine/workspace split. */
export type ChooserProtoLayout = 'shelves' | 'chips' | 'zones'

/** Layout B's chip filter. */
export type ChooserProtoFilter = 'all' | 'yours' | 'installed' | 'available'

/** One tile in a family grid — an install tile or a distribution card.
 *  `builder` marks an install that backs a workspace distribution. */
export type ChooserGridEntry =
  | { kind: 'install'; inst: Installation; builder: boolean }
  | { kind: 'dist'; dist: Distribution }

export function entryKey(entry: ChooserGridEntry): string {
  return entry.kind === 'install' ? entry.inst.id : `dist:${entry.dist.id}`
}
