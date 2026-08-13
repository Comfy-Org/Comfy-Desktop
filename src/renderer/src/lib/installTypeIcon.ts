import { Cloud, Computer, LaptopMinimal, Globe, Box, Package } from 'lucide-vue-next'
import type { LucideIcon } from 'lucide-vue-next'
import { isDistributionSource } from '../devplatform/distributionState'

/** Stable UX-side install-type key. Callers switch on this for styling /
 *  analytics rather than the raw `sourceCategory` from the source plugins. */
export type InstallTypeKey =
  | 'standalone'
  | 'cloud'
  | 'legacyDesktop'
  | 'remote'
  | 'distribution'
  | 'unknown'

export interface InstallTypeIconMeta {
  key: InstallTypeKey
  icon: LucideIcon
  labelKey: string
}

/** Map a raw `sourceCategory` to its install-type icon metadata. Shared by
 *  the chooser tile and the title bar so the icon vocabulary can't diverge. */
export function installTypeMetaFor(category: string | undefined | null): InstallTypeIconMeta {
  switch (category) {
    case 'cloud':
      return { key: 'cloud', icon: Cloud, labelKey: 'installType.cloud' }
    case 'desktop':
      return { key: 'legacyDesktop', icon: Computer, labelKey: 'installType.legacyDesktop' }
    case 'remote':
      return { key: 'remote', icon: Globe, labelKey: 'installType.remote' }
    case 'local':
      return { key: 'standalone', icon: LaptopMinimal, labelKey: 'installType.standalone' }
    case 'distribution':
      return { key: 'distribution', icon: Package, labelKey: 'installType.distribution' }
    default:
      return { key: 'unknown', icon: Box, labelKey: 'installType.unknown' }
  }
}

/** Resolve install-type metadata for a concrete installation. Legacy Desktop
 *  installs report `sourceCategory === 'local'`, so the distinct
 *  `legacyDesktop` identity is keyed off the `desktop` sourceId instead.
 *
 *  A distribution install also reports `local`, but wears the distribution
 *  glyph everywhere — what it IS matters more than where it runs, and it keeps
 *  one identity whether it's an install tile, a picker row or a card. */
export function installTypeMetaForInstall(inst: {
  sourceId?: unknown
  sourceCategory: string | null | undefined
  distributionId?: unknown
}): InstallTypeIconMeta {
  if (isDistributionSource(inst.sourceId, inst.distributionId)) {
    return installTypeMetaFor('distribution')
  }
  if (inst.sourceId === 'desktop') return installTypeMetaFor('desktop')
  return installTypeMetaFor(inst.sourceCategory)
}
