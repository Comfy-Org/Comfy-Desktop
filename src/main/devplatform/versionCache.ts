/**
 * Published-version cache, keyed by the persisted Builder catalog id.
 *
 * `SourcePlugin.getDetailSections` is synchronous, so the manage view can't
 * fetch a build's version list while building the Update tab. This holds
 * what the last catalog read saw, the way `lib/release-cache` does for
 * standalone channels.
 *
 * Deliberately in-memory and never persisted: it is catalog data, not install
 * state. Persisting it on the record would go stale silently and follow an
 * install through a duplicate.
 */

export interface CachedVersions {
  /** Complete versions, newest first. */
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

/** Capture before an async catalog read so stale responses cannot repopulate
 * the cache after logout, login, or a workspace switch. */
export function getVersionCacheGeneration(): number {
  return generation
}

/** Cached versions, or null when nothing has read the catalog yet. Callers
 *  render a "check for updates" affordance rather than an empty picker. */
export function getCachedVersions(buildId: string): CachedVersions | null {
  return cache.get(buildId) ?? null
}

/** Latest published version when it is newer than the installed version. */
export function getAvailableUpdate(buildId: string, installedVersion: string): number | undefined {
  if (installedVersion === '') return undefined
  const current = Number(installedVersion)
  if (!Number.isFinite(current)) return undefined
  const latest = getCachedVersions(buildId)?.versions[0]
  return latest !== undefined && latest > current ? latest : undefined
}

/** Test seam. */
export function clearVersionCache(): void {
  generation += 1
  cache.clear()
}
