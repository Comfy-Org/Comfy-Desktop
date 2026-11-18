export interface CachedVersions {
  versions: number[]
  fetchedAt: number
}

const cache = new Map<string, CachedVersions>()
let generation = 0

export function setCachedVersions(
  buildId: string,
  versions: number[],
  expectedGeneration: number = generation
): void {
  if (expectedGeneration !== generation) return
  const sorted = [...new Set(versions)].sort((a, b) => b - a)
  cache.set(buildId, { versions: sorted, fetchedAt: Date.now() })
}

export function getVersionCacheGeneration(): number {
  return generation
}

export function getCachedVersions(buildId: string): CachedVersions | null {
  return cache.get(buildId) ?? null
}

export function getAvailableUpdate(buildId: string, installedVersion: string): number | undefined {
  if (installedVersion === '') return undefined
  const current = Number(installedVersion)
  if (!Number.isFinite(current)) return undefined
  const latest = getCachedVersions(buildId)?.versions[0]
  return latest !== undefined && latest > current ? latest : undefined
}

export function clearVersionCache(): void {
  generation += 1
  cache.clear()
}
