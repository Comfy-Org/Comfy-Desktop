import fs from 'fs'
import path from 'path'
import * as installations from '../installations'
import * as settings from '../settings'
import {
  mapLegacyFolderType,
  resolveInstallModelSearchPaths,
  type InstallModelSearch
} from './models'

/** Primary shared models directory used by interactive and template downloads. */
export function getModelsBaseDir(): string {
  const modelsDirs = settings.get('modelsDirs') as string[] | undefined
  return modelsDirs?.[0] || settings.defaults.modelsDirs[0]!
}

export function getSharedModelsDirs(): string[] {
  const modelsDirs = settings.get('modelsDirs') as string[] | undefined
  return modelsDirs && modelsDirs.length > 0 ? modelsDirs : settings.defaults.modelsDirs
}

/** Installation-aware download context for callers that already hold the
 *  record (e.g. the template-model task). Sync: no store lookup needed. */
export function resolveDownloadContext(inst: installations.InstallationRecord): InstallModelSearch {
  return resolveInstallModelSearchPaths(inst, getSharedModelsDirs())
}

/**
 * Every launcher-managed model root where staged model downloads (or legacy
 * final-path partials) may live: the shared models dirs plus each known
 * installation's model roots and extra model paths. Used by startup
 * migration/hydration of interrupted downloads (issue #1322). NOT
 * best-effort: a failure to list installations or resolve an install's
 * model paths propagates, because a root silently dropped from the scan
 * would let the legacy migration certify directories it never looked at.
 * The caller treats the failure as an unsafe startup pass and gates launch.
 */
export async function collectModelScanRoots(): Promise<string[]> {
  const roots = new Set<string>()
  const shared = getSharedModelsDirs()
  for (const dir of shared) roots.add(dir)
  for (const inst of await installations.list()) {
    if (!inst.installPath) continue
    const search = resolveDownloadContext(inst)
    for (const root of search.modelRoots) roots.add(root)
    for (const extra of search.extraPaths) roots.add(extra.dir)
  }
  return [...roots]
}

export async function resolveDownloadContextById(
  installationId: string | null
): Promise<InstallModelSearch | null> {
  if (!installationId) return null
  try {
    const inst = await installations.get(installationId)
    if (!inst || !inst.installPath) return null
    return resolveDownloadContext(inst)
  } catch {
    return null
  }
}

const ROOT_FOLDER_ALTERNATES: Readonly<Record<string, string[]>> = {
  text_encoders: ['text_encoders', 'clip'],
  diffusion_models: ['diffusion_models', 'unet'],
  controlnet: ['controlnet', 't2i_adapter']
}

function rootRelDirsForDirectory(directory: string): string[] {
  const segments = directory.split(/[\\/]+/).filter(Boolean)
  if (segments.length === 0) return [directory]
  const rawType = segments[0]!
  const remainder = segments.slice(1)
  const heads = ROOT_FOLDER_ALTERNATES[mapLegacyFolderType(rawType)] ?? [rawType]
  return heads.map((head) => path.join(head, ...remainder))
}

/** Every path where an installation's ComfyUI could find a model file. */
export function buildExistenceCandidates(
  ctx: InstallModelSearch | null,
  baseDir: string,
  directory: string,
  filename: string
): string[] {
  const out = new Set<string>()
  out.add(path.join(baseDir, directory, filename))
  if (ctx) {
    const relDirs = rootRelDirsForDirectory(directory)
    for (const root of ctx.modelRoots) {
      for (const rel of relDirs) {
        out.add(path.join(root, rel, filename))
      }
    }
    const segments = directory.split(/[\\/]+/).filter(Boolean)
    if (segments.length > 0) {
      const type = mapLegacyFolderType(segments[0]!)
      const remainder = segments.slice(1)
      for (const extra of ctx.extraPaths) {
        if (extra.type === type) {
          out.add(path.join(extra.dir, ...remainder, filename))
        }
      }
    }
  }
  return [...out]
}

export async function regularFileExists(filePath: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(filePath)).isFile()
  } catch {
    return false
  }
}

/** True when every model is already present in the installation's search set. */
export async function areModelsPresent(
  installationId: string | null,
  models: ReadonlyArray<{ directory: string; filename: string }>
): Promise<boolean> {
  if (models.length === 0) return false
  const ctx = await resolveDownloadContextById(installationId)
  const baseDir = ctx ? ctx.downloadBaseDir : getModelsBaseDir()
  const checks = await Promise.all(
    models.map(async ({ directory, filename }) => {
      for (const candidate of buildExistenceCandidates(ctx, baseDir, directory, filename)) {
        if (await regularFileExists(candidate)) return true
      }
      return false
    })
  )
  return checks.every(Boolean)
}
