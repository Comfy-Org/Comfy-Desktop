/**
 * The entry type a chooser grid renders, plus its constructors and key. Installs
 * and distributions flow through one grid as a single mixed list rather than two
 * props, so each entry is tagged and keyed by a namespaced id to avoid collision.
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
