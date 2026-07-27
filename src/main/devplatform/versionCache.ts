/**
 * Published-version cache, keyed by distribution id.
 *
 * `SourcePlugin.getDetailSections` is synchronous, so the manage view can't
 * fetch a distribution's version list while building the Update tab. This holds
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

export function setCachedVersions(distributionId: string, versions: number[]): void {
  const sorted = [...new Set(versions)].sort((a, b) => b - a)
  cache.set(distributionId, { versions: sorted, fetchedAt: Date.now() })
}

/** Cached versions, or null when nothing has read the catalog yet. Callers
 *  render a "check for updates" affordance rather than an empty picker. */
export function getCachedVersions(distributionId: string): CachedVersions | null {
  return cache.get(distributionId) ?? null
}

/** Test seam. */
export function clearVersionCache(): void {
  cache.clear()
}
