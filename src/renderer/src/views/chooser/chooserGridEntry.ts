/**
 * One tile in a chooser grid. The chooser renders two families — the user's
 * own installs, and the signed-in workspace's distributions — through the same
 * grid component, so the grid takes a mixed list rather than two props.
 */
import type { Distribution } from '../../devplatform/types'
import type { Installation } from '../../types/ipc'

export type ChooserGridEntry =
  | { kind: 'install'; inst: Installation }
  | { kind: 'dist'; dist: Distribution }

/** Stable `v-for` key. Namespaced so a distribution can never collide with an
 *  installation that happens to share its id. */
export function entryKey(entry: ChooserGridEntry): string {
  return entry.kind === 'install' ? entry.inst.id : `dist:${entry.dist.id}`
}

export function installEntry(inst: Installation): ChooserGridEntry {
  return { kind: 'install', inst }
}

export function distEntry(dist: Distribution): ChooserGridEntry {
  return { kind: 'dist', dist }
}
