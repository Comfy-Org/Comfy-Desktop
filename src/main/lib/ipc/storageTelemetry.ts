import * as telemetry from '../telemetry'
import * as settings from '../../settings'
import * as installations from '../../installations'
import { writeAppLog } from '../appLog'
import { dataDir } from '../paths'
import { installOutputDir, resolveInstallModelSearchPaths } from '../models'
import { classifyPaths, type DriveInfo } from '../storageInfo'
import { sourceMap } from './shared'
import { scrubAll } from '../../../shared/piiScrub'

const MAX_MODEL_DIRS = 16

function caseKey(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

function scrubOrNull(value: string | null): string | null {
  return value == null ? null : scrubAll(value)
}

class DriveIndexer {
  private indices = new Map<string, number>()

  index(info: DriveInfo | undefined): number | null {
    const key = info?.driveKey
    if (key == null) return null
    let idx = this.indices.get(key)
    if (idx === undefined) {
      idx = this.indices.size
      this.indices.set(key, idx)
    }
    return idx
  }

  get count(): number {
    return this.indices.size
  }
}

function sameDrive(a: DriveInfo | undefined, b: DriveInfo | undefined): boolean | null {
  if (a?.driveKey == null || b?.driveKey == null) return null
  return a.driveKey === b.driveKey
}

export async function emitStorageTelemetry(installationId: string): Promise<void> {
  try {
    const inst = await installations.get(installationId)
    if (!inst || !inst.installPath) return
    if (sourceMap[inst.sourceId]?.category !== 'local') return

    const sharedModelsDirs =
      (settings.get('modelsDirs') as string[] | undefined) ?? settings.defaults.modelsDirs
    const search = resolveInstallModelSearchPaths(inst, sharedModelsDirs)

    const modelDirs: string[] = []
    const seen = new Set<string>()
    for (const root of search.modelRoots) {
      const key = caseKey(root)
      if (seen.has(key)) continue
      seen.add(key)
      modelDirs.push(root)
    }
    for (const ep of search.extraPaths) {
      const dir = ep.basePath ?? ep.dir
      const key = caseKey(dir)
      if (seen.has(key)) continue
      seen.add(key)
      modelDirs.push(dir)
    }
    const cappedModelDirs = modelDirs.slice(0, MAX_MODEL_DIRS)
    const primaryDir = search.downloadBaseDir

    const cachePath = (settings.get('cacheDir') as string | undefined) || settings.defaults.cacheDir
    const useSharedIO = (inst.useSharedInputOutput as boolean | undefined) !== false
    const outputPath = useSharedIO
      ? (settings.get('outputDir') as string | undefined) || settings.defaults.outputDir
      : (inst.outputDir as string | undefined) || installOutputDir(inst.installPath)
    const appDataPath = dataDir()

    const allPaths = [
      inst.installPath,
      ...cappedModelDirs,
      primaryDir,
      cachePath,
      outputPath,
      appDataPath
    ]
    const infoMap = await classifyPaths(allPaths)

    const install = infoMap.get(inst.installPath)
    const models = cappedModelDirs.map((d) => infoMap.get(d))
    const primary = infoMap.get(primaryDir)
    const cache = infoMap.get(cachePath)
    const output = infoMap.get(outputPath)
    const appData = infoMap.get(appDataPath)

    const indexer = new DriveIndexer()
    const installKey = indexer.index(install)
    const modelKeys = models.map((m) => indexer.index(m))
    const primaryKey = indexer.index(primary)
    const cacheKey = indexer.index(cache)
    const outputKey = indexer.index(output)
    const appDataKey = indexer.index(appData)

    const modelSameAsInstall = models.map((m) => sameDrive(m, install))
    const knownSame = modelSameAsInstall.filter((v): v is boolean => v !== null)
    const truncated = modelDirs.length > cappedModelDirs.length

    const allSameAsInstall =
      knownSame.length === modelSameAsInstall.length && knownSame.length > 0
        ? knownSame.every(Boolean)
        : null
    const anyOnHdd = models.some((m) => m?.storageClass === 'hdd')
    const anyExternal = models.some((m) => m?.external === true)
    const allStorageKnown = models.every((m) => m !== undefined && m.storageClass !== 'unknown')
    const allExternalKnown = models.every((m) => m !== undefined && m.external !== null)

    telemetry.capture('comfy.desktop.session.storage_detected', {
      install_id: inst.id,

      install_storage_class: install?.storageClass ?? 'unknown',
      install_bus: install?.bus ?? 'unknown',
      install_external: install?.external ?? null,
      install_fs_type: install?.fsType ?? null,
      install_drive_model: scrubOrNull(install?.driveModel ?? null),
      install_drive_vendor: scrubOrNull(install?.driveVendor ?? null),
      install_drive_size_gb: install?.driveSizeGb ?? null,
      install_volume_size_gb: install?.volumeSizeGb ?? null,
      install_volume_free_gb: install?.volumeFreeGb ?? null,
      install_pcie_max_gen: install?.pcieMaxGen ?? null,
      install_pcie_slot_max_gen: install?.pcieSlotMaxGen ?? null,
      install_drive_key: installKey,

      models_dirs_count: modelDirs.length,
      models_dirs_truncated: truncated,
      models_storage_classes: models.map((m) => m?.storageClass ?? 'unknown'),
      models_buses: models.map((m) => m?.bus ?? 'unknown'),
      models_external: models.map((m) => m?.external ?? null),
      models_fs_types: models.map((m) => m?.fsType ?? null),
      models_drive_models: models.map((m) => scrubOrNull(m?.driveModel ?? null)),
      models_pcie_max_gens: models.map((m) => m?.pcieMaxGen ?? null),
      models_drive_keys: modelKeys,

      models_primary_storage_class: primary?.storageClass ?? 'unknown',
      models_primary_bus: primary?.bus ?? 'unknown',
      models_primary_drive_model: scrubOrNull(primary?.driveModel ?? null),
      models_primary_drive_size_gb: primary?.driveSizeGb ?? null,
      models_primary_volume_free_gb: primary?.volumeFreeGb ?? null,
      models_primary_pcie_max_gen: primary?.pcieMaxGen ?? null,
      models_primary_pcie_slot_max_gen: primary?.pcieSlotMaxGen ?? null,
      models_primary_drive_key: primaryKey,

      cache_storage_class: cache?.storageClass ?? 'unknown',
      cache_drive_key: cacheKey,
      output_storage_class: output?.storageClass ?? 'unknown',
      output_drive_key: outputKey,
      app_data_storage_class: appData?.storageClass ?? 'unknown',
      app_data_drive_key: appDataKey,

      distinct_drive_count: indexer.count,
      models_primary_same_drive_as_install: sameDrive(primary, install),
      models_all_same_drive_as_install:
        allSameAsInstall === true && truncated ? null : allSameAsInstall,
      any_models_on_hdd: anyOnHdd ? true : truncated || !allStorageKnown ? null : false,
      any_models_external: anyExternal ? true : truncated || !allExternalKnown ? null : false
    })

    if (install && install.storageClass !== 'unknown') {
      telemetry.registerPersonProperties({
        install_drive_class: install.storageClass,
        install_drive_model: scrubOrNull(install.driveModel),
        ...(primary && primary.storageClass !== 'unknown'
          ? {
              models_primary_drive_class: primary.storageClass,
              models_separate_from_install: sameDrive(primary, install) === false
            }
          : {})
      })
    }
  } catch (error) {
    try {
      writeAppLog('DEBUG', `storage telemetry failed: ${String(error)}`)
    } catch {}
  }
}
