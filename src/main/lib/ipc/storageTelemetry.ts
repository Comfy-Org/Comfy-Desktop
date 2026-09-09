/**
 * Storage-drive telemetry emitter.
 *
 * `comfy.desktop.session.storage_detected` - emitted once per local ComfyUI
 * instance boot (alongside `session.instance_started`, same trigger). Answers
 * "what kind of drive is ComfyUI installed on, what kind are the models on,
 * and are they the same drive?" - the axes are storage class (hdd / sata_ssd
 * / nvme_ssd / ...), bus, drive model, max PCIe link generation (drive and
 * slot, NVMe only), and anonymous same-drive grouping.
 *
 * PRIVACY: no paths, mount points, drive letters, labels, serials or UUIDs
 * leave the process. Physical-drive identity is reduced to `*_drive_key`
 * integers (0, 1, 2 ...) assigned per event in role order - they only say
 * "these roles share a drive", never which drive. Drive model/vendor strings
 * are shared product identifiers (same privacy class as `gpu_model` on
 * `accelerator_detected`) and go through `scrubAll` at the emit site.
 */
import * as telemetry from '../telemetry'
import * as settings from '../../settings'
import * as installations from '../../installations'
import { writeAppLog } from '../appLog'
import { dataDir } from '../paths'
import { installOutputDir, resolveInstallModelSearchPaths } from '../models'
import { classifyPaths, type DriveInfo } from '../storageInfo'
import { sourceMap } from './shared'
import { scrubAll } from '../../../shared/piiScrub'

/** Cap on how many model dirs we classify/ship (pathological configs). */
const MAX_MODEL_DIRS = 16

function caseKey(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

function scrubOrNull(value: string | null): string | null {
  return value == null ? null : scrubAll(value)
}

/**
 * Assigns anonymous per-event drive indices. Two paths on the same physical
 * drive (same non-null `driveKey`) get the same index; unresolved drives get
 * `null` so they can never fake a same-drive match.
 */
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

/**
 * Fire-and-forget. Invoked from the `onInstanceStarted` callback on every
 * ComfyUI instance boot; emits nothing for cloud/remote sources (no local
 * storage of interest). Never throws - telemetry must never break a launch.
 */
export async function emitStorageTelemetry(installationId: string): Promise<void> {
  try {
    const inst = await installations.get(installationId)
    if (!inst || !inst.installPath) return
    // Local sources only: cloud sessions have no local install storage and
    // remote sessions run their compute elsewhere.
    if (sourceMap[inst.sourceId]?.category !== 'local') return

    const sharedModelsDirs =
      (settings.get('modelsDirs') as string[] | undefined) ?? settings.defaults.modelsDirs
    const search = resolveInstallModelSearchPaths(inst, sharedModelsDirs)

    // Model locations: launcher-managed roots (built-in + shared/per-install)
    // plus base dirs from the user-authored extra_model_paths.yaml, deduped.
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
    // `||` (not `??`): launch treats an empty per-install outputDir as unset.
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

    // Stable role order so drive index 0 is always the install drive.
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

    // Aggregates over model dirs: a positive observation ("something IS on an
    // HDD / external / a different drive") holds even when the list was
    // truncated, but a negative claim about ALL model dirs does not - report
    // null instead of a false definitive answer.
    const allSameAsInstall =
      knownSame.length === modelSameAsInstall.length && knownSame.length > 0
        ? knownSame.every(Boolean)
        : null
    const anyOnHdd = models.some((m) => m?.storageClass === 'hdd')
    const anyExternal = models.some((m) => m?.external === true)
    // A negative aggregate is only proven when every INCLUDED dir resolved:
    // an unknown/unresolved dir could be on an HDD or external drive.
    const allStorageKnown = models.every((m) => m !== undefined && m.storageClass !== 'unknown')
    const allExternalKnown = models.every((m) => m !== undefined && m.external !== null)

    telemetry.capture('comfy.desktop.session.storage_detected', {
      // NOT `installation_id`: that name is a machine-scoped default property
      // owned by telemetry.ts and per-event overrides of it are legacy debt.
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
      // Max PCIe link generations (capability, not the idle-downtrained
      // negotiated speed): NVMe drives only, null elsewhere. drive < slot
      // means the slot has headroom; drive > slot means the drive is capped.
      install_pcie_max_gen: install?.pcieMaxGen ?? null,
      install_pcie_slot_max_gen: install?.pcieSlotMaxGen ?? null,
      install_drive_key: installKey,

      models_dirs_count: modelDirs.length,
      models_dirs_truncated: truncated,
      models_storage_classes: models.map((m) => m?.storageClass ?? 'unknown'),
      models_buses: models.map((m) => m?.bus ?? 'unknown'),
      models_external: models.map((m) => m?.external ?? null),
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

    // Durable person-level cohort axes (mirrors the `comfyui_gpu_*` pattern).
    // Only stamped when detection produced a real answer so a flaky probe
    // never downgrades a previously-known value to `unknown`.
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
    // Telemetry must never break a launch, but do record why it failed.
    try {
      writeAppLog('DEBUG', `storage telemetry failed: ${String(error)}`)
    } catch {
      // Even the failure log must not break a launch.
    }
  }
}
