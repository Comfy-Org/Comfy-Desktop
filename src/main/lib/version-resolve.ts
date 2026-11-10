import {
  findNearestTag,
  findLatestVersionTag,
  countCommitsAhead,
  countUniqueCommits,
  isAncestorOf,
  findMergeBase
} from './git'
import type { ComfyVersion } from './version'

export interface LatestTagOverride {
  name: string
  sha: string
}

const _cache = new Map<string, ComfyVersion>()

let _latestTagCache: { repoPath: string; tag: string | undefined; ts: number } | null = null
const LATEST_TAG_TTL_MS = 5_000

async function getCachedLatestTag(repoPath: string): Promise<string | undefined> {
  if (
    _latestTagCache &&
    _latestTagCache.repoPath === repoPath &&
    Date.now() - _latestTagCache.ts < LATEST_TAG_TTL_MS
  ) {
    return _latestTagCache.tag
  }
  const tag = await findLatestVersionTag(repoPath)
  _latestTagCache = { repoPath, tag, ts: Date.now() }
  return tag
}

const MAX_BACKPORT_WALK = 10

async function findBestBackportTag(
  repoPath: string,
  startRef: string,
  commit: string,
  stopTag: string,
  ancestorDist?: number
): Promise<{ tag: string; commitsAhead: number } | undefined> {
  const candidates: string[] = []
  let ref = startRef
  for (let i = 0; i < MAX_BACKPORT_WALK; i++) {
    const tag = await findNearestTag(repoPath, ref)
    if (!tag || tag === stopTag) break
    candidates.push(tag)
    ref = `${tag}~1`
  }
  if (candidates.length === 0) return undefined

  let best: { tag: string; commitsAhead: number } | undefined
  for (let pos = candidates.length - 1; pos >= 0; pos--) {
    const tag = candidates[pos]!
    const branchDist = await countCommitsAhead(repoPath, stopTag, tag)
    if (branchDist === undefined) break
    const unique = await countUniqueCommits(repoPath, tag, commit)
    if (unique === undefined) break
    if (ancestorDist !== undefined && unique > ancestorDist) return undefined
    if (unique > branchDist) break
    const ahead = await countUniqueCommits(repoPath, commit, tag)
    if (ahead === undefined) break
    best = { tag, commitsAhead: ahead }
  }
  return best
}

export async function resolveLocalVersion(
  comfyuiDir: string,
  commit: string,
  fallbackTag?: string,
  latestTagOverride?: LatestTagOverride
): Promise<ComfyVersion> {
  const overrideKey = latestTagOverride
    ? `\0${latestTagOverride.name}\0${latestTagOverride.sha}`
    : ''
  const cacheKey = `${comfyuiDir}\0${commit}${overrideKey}`
  const cached = _cache.get(cacheKey)
  if (cached) {
    if (fallbackTag && !cached.baseTag) {
      return { ...cached, baseTag: fallbackTag, baseTagVerified: false }
    }
    return cached
  }

  const latestTagName = latestTagOverride?.name ?? (await getCachedLatestTag(comfyuiDir))
  const latestTagRef = latestTagOverride?.sha ?? latestTagName

  const ancestorTag = await findNearestTag(comfyuiDir, commit)
  const ancestorDist = ancestorTag
    ? await countCommitsAhead(comfyuiDir, ancestorTag, commit)
    : undefined

  let baseTag: string | undefined
  let commitsAhead: number | undefined
  let baseTagVerified = false

  const shouldUpgrade =
    latestTagName && latestTagName !== ancestorTag && ancestorDist !== undefined && ancestorDist > 0
  let upgraded = false

  if (shouldUpgrade) {
    const ancestorIsParent = ancestorTag
      ? await isAncestorOf(comfyuiDir, ancestorTag, latestTagRef!)
      : false

    if (ancestorIsParent && (await isAncestorOf(comfyuiDir, latestTagRef!, commit))) {
      const dist = await countCommitsAhead(comfyuiDir, latestTagRef!, commit)
      if (dist !== undefined) {
        baseTag = latestTagName
        commitsAhead = dist
        upgraded = true
        baseTagVerified = true
      }
    } else if (ancestorIsParent) {
      const found = await findBestBackportTag(
        comfyuiDir,
        latestTagRef!,
        commit,
        ancestorTag!,
        ancestorDist
      )
      if (found) {
        baseTag = found.tag
        commitsAhead = found.commitsAhead
        upgraded = true
        baseTagVerified = false
      } else {
        const mergeBase = await findMergeBase(comfyuiDir, latestTagRef!, commit)
        const dist =
          mergeBase && mergeBase !== commit
            ? await countCommitsAhead(comfyuiDir, mergeBase, commit)
            : undefined
        if (dist !== undefined) {
          baseTag = latestTagName
          commitsAhead = dist
          upgraded = true
          baseTagVerified = false
        }
      }
    }
  }

  if (!upgraded) {
    baseTag = ancestorTag
    commitsAhead = ancestorDist
    baseTagVerified = ancestorTag !== undefined
  }

  const result: ComfyVersion = { commit, baseTag, commitsAhead, baseTagVerified }
  if (upgraded && !baseTagVerified && ancestorTag) result.ancestorTag = ancestorTag
  _cache.set(cacheKey, result)

  if (fallbackTag && !baseTag) {
    return { ...result, baseTag: fallbackTag, baseTagVerified: false }
  }
  return result
}

export function clearVersionCache(): void {
  _cache.clear()
  _latestTagCache = null
}
