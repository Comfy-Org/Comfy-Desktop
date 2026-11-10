import { Cloud, Computer, LaptopMinimal, Globe, Box, Package } from 'lucide-vue-next'
import type { LucideIcon } from 'lucide-vue-next'
import { isBuildSource } from '../devplatform/buildState'

export type InstallTypeKey =
  | 'standalone'
  | 'cloud'
  | 'legacyDesktop'
  | 'remote'
  | 'build'
  | 'unknown'

export interface InstallTypeIconMeta {
  key: InstallTypeKey
  icon: LucideIcon
  labelKey: string
}

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
    case 'build':
      return { key: 'build', icon: Package, labelKey: 'installType.build' }
    default:
      return { key: 'unknown', icon: Box, labelKey: 'installType.unknown' }
  }
}

export function installTypeMetaForInstall(inst: {
  sourceId?: unknown
  sourceCategory: string | null | undefined
  distributionId?: unknown
}): InstallTypeIconMeta {
  if (isBuildSource(inst.sourceId, inst.distributionId)) {
    return installTypeMetaFor('build')
  }
  if (inst.sourceId === 'desktop') return installTypeMetaFor('desktop')
  return installTypeMetaFor(inst.sourceCategory)
}
