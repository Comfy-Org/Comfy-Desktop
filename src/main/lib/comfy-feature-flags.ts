import { execFile } from 'child_process'
import * as path from 'path'

export interface FeatureFlagInfo {
  type: string
  default: unknown
  description: string
}

export type FeatureFlagRegistry = Record<string, FeatureFlagInfo>

const registryCache = new Map<string, { registry: FeatureFlagRegistry; version: string }>()

export function parseFeatureFlagOutput(stdout: string): FeatureFlagRegistry {
  if (!stdout) return {}
  try {
    const parsed = JSON.parse(stdout) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as FeatureFlagRegistry
    }
  } catch {}
  return {}
}

export async function getComfyFeatureFlagRegistry(
  pythonPath: string,
  mainPyPath: string,
  cwd: string,
  installationId: string,
  version?: string
): Promise<FeatureFlagRegistry> {
  const cached = registryCache.get(installationId)
  if (cached && version && cached.version === version) {
    return cached.registry
  }

  let registry: FeatureFlagRegistry = {}
  try {
    const stdout = await runListFeatureFlags(pythonPath, mainPyPath, cwd)
    registry = parseFeatureFlagOutput(stdout)
  } catch (err) {
    console.warn('[comfy-feature-flags] Could not get registry:', (err as Error).message)
  }

  registryCache.set(installationId, { registry, version: version ?? '' })
  return registry
}

export function getCachedFeatureFlagRegistry(
  installationId: string,
  version?: string
): FeatureFlagRegistry | null {
  const cached = registryCache.get(installationId)
  if (!cached) return null
  if (version !== undefined && cached.version !== '' && cached.version !== version) {
    return null
  }
  return cached.registry
}

export function isCachedFeatureFlagAvailable(
  installationId: string,
  key: string,
  version?: string
): boolean {
  return key in (getCachedFeatureFlagRegistry(installationId, version) ?? {})
}

function runListFeatureFlags(pythonPath: string, mainPyPath: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mainPyRel = path.relative(cwd, mainPyPath)
    execFile(
      pythonPath,
      ['-s', mainPyRel, '--list-feature-flags'],
      { cwd, timeout: 15000 },
      (err, stdout, stderr) => {
        if (err) {
          const detail = stderr ? `\nstderr: ${stderr.slice(0, 500)}` : ''
          reject(new Error(`--list-feature-flags failed: ${err.message}${detail}`))
          return
        }
        if (!stdout) {
          reject(new Error('Empty --list-feature-flags output'))
          return
        }
        resolve(stdout)
      }
    )
  })
}

export function clearFeatureFlagRegistryCache(installationId: string): void {
  registryCache.delete(installationId)
}
