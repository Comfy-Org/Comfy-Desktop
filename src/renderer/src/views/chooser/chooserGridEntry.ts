/**
 * One tile in a chooser grid. Installs and distributions render through the
 * same grid component, so it takes a mixed list rather than two props.
 */
import type { Distribution } from '../../devplatform/types'
import type { Installation } from '../../types/ipc'

export type ChooserGridEntry =
  | { kind: 'install'; inst: Installation }
  | { kind: 'dist'; dist: Distribution }

/** Stable `v-for` key. Both sides are namespaced so an installation and a
 *  distribution that share an id — or the reserved `__new` tile — can't collide. */
export function entryKey(entry: ChooserGridEntry): string {
  return entry.kind === 'install' ? `install:${entry.inst.id}` : `dist:${entry.dist.id}`
}

export function installEntry(inst: Installation): ChooserGridEntry {
  return { kind: 'install', inst }
}

export function distEntry(dist: Distribution): ChooserGridEntry {
  return { kind: 'dist', dist }
}
