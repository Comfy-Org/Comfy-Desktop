import path from 'path'
import fs from 'fs'
import { dataDir } from './paths'
import { writeFileSafe } from './safe-file'
import { fetchLatestRelease, getLatestStableTag, truncateNotes } from './comfyui-releases'
import { fetchTags, countCommitsAhead, fetchCommitSha, findNearestTag } from './git'
import { formatComfyVersion, tagsEqual } from './version'
import { readOpMarker } from './opMarker'
import type { ComfyVersion } from './version'

export interface ReleaseCacheEntry {
  checkedAt?: number
  latestTag?: string
  releaseName?: string
  releaseNotes?: string
  releaseUrl?: string
  publishedAt?: string
  installedTag?: string
  commitSha?: string
  baseTag?: string
  commitsAhead?: number
  lastEnrichAttemptAt?: number
  [key: string]: unknown
}

const CACHE_FILE = path.join(dataDir(), 'release-cache.json')

let _entries: Record<string, ReleaseCacheEntry> = {}
let _loaded: boolean = false

function _ensureLoaded(): void {
  if (_loaded) return
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
    _entries = (raw.entries as Record<string, ReleaseCacheEntry>) || {}
  } catch {
    _entries = {}
  }
  _loaded = true
}

function _persist(): void {
  try {
    writeFileSafe(CACHE_FILE, JSON.stringify({ schemaVersion: 1, entries: _entries }, null, 2))
  } catch {}
}

export function _test_ageEntries(maxCheckedAt: number): void {
  _ensureLoaded()
  for (const key of Object.keys(_entries)) {
    const entry = _entries[key]
    if (entry) entry.checkedAt = maxCheckedAt
  }
  _persist()
}

export function makeKey(repo: string, channel: string): string {
  return `github:${repo}:${channel}`
}

export function get(repo: string, channel: string): ReleaseCacheEntry | null {
  _ensureLoaded()
  return _entries[makeKey(repo, channel)] ?? null
}

export function set(repo: string, channel: string, entry: ReleaseCacheEntry): void {
  _ensureLoaded()
  _entries[makeKey(repo, channel)] = entry
  _persist()
}

const _inFlight: Map<string, Promise<ReleaseCacheEntry | null>> = new Map()

const MIN_RECHECK_INTERVAL = 10_000

export async function getOrFetch(
  repo: string,
  channel: string,
  fetchFn: () => Promise<ReleaseCacheEntry | null>,
  force: boolean = false
): Promise<ReleaseCacheEntry | null> {
  const key = makeKey(repo, channel)
  _ensureLoaded()

  const cached = _entries[key]
  if (!force) {
    if (cached) return cached
  } else if (cached?.checkedAt && Date.now() - cached.checkedAt < MIN_RECHECK_INTERVAL) {
    return cached
  }

  if (_inFlight.has(key)) {
    return _inFlight.get(key)!
  }

  const promise = (async () => {
    try {
      const entry = await fetchFn()
      if (entry) {
        _entries[key] = entry
        _persist()
      }
      return entry ?? cached ?? null
    } catch {
      return cached ?? null
    } finally {
      _inFlight.delete(key)
    }
  })()

  _inFlight.set(key, promise)
  return promise
}

export function getEffectiveInfo(
  repo: string,
  channel: string,
  installation: Record<string, unknown>
): (ReleaseCacheEntry & { installedTag: string }) | null {
  const cached = get(repo, channel)
  if (!cached) return null
  const updateInfoByChannel = installation.updateInfoByChannel as
    | Record<string, Record<string, unknown>>
    | undefined
  const perInstall = updateInfoByChannel?.[channel]
  const cv = installation.comfyVersion as ComfyVersion | undefined
  const installedTag =
    (perInstall?.installedTag as string | undefined) ??
    (cv ? formatComfyVersion(cv, 'short') : undefined) ??
    (installation.version as string | undefined) ??
    'unknown'
  return { ...cached, installedTag }
}

export function buildCacheEntry(release: Record<string, unknown>): ReleaseCacheEntry {
  const commitSha = release.commitSha as string | undefined
  const baseTag = release.baseTag as string | undefined
  const commitsAhead = release.commitsAhead as number | undefined
  const cv: ComfyVersion | undefined = commitSha
    ? { commit: commitSha, baseTag, commitsAhead }
    : undefined
  return {
    checkedAt: Date.now(),
    latestTag: release.tag_name as string,
    releaseName: cv
      ? formatComfyVersion(cv, 'short')
      : (release.name as string) || (release.tag_name as string),
    commitSha,
    baseTag,
    commitsAhead,
    releaseNotes: truncateNotes(release.body as string, 4000),
    releaseUrl: release.html_url as string,
    publishedAt: release.published_at as string
  }
}

export async function checkForUpdate(
  repo: string,
  channel: string,
  installation: Record<string, unknown>,
  update: (data: Record<string, unknown>) => Promise<void>
): Promise<{ ok: boolean; navigate?: string; message?: string }> {
  const entry = await getOrFetch(
    repo,
    channel,
    async () => {
      const release = await fetchLatestRelease(channel)
      if (!release) return null
      return buildCacheEntry(release)
    },
    true
  )
  if (!entry) {
    return { ok: false, message: 'Could not fetch releases from GitHub.' }
  }

  const existing =
    (installation.updateInfoByChannel as Record<string, Record<string, unknown>>) || {}
  const prevChannelInfo = existing[channel]
  const cv = installation.comfyVersion as ComfyVersion | undefined
  const installedTag =
    (cv ? formatComfyVersion(cv, 'short') : undefined) ??
    (prevChannelInfo?.installedTag as string | undefined) ??
    (installation.version as string | undefined) ??
    'unknown'
  await update({
    updateInfoByChannel: {
      ...existing,
      [channel]: { installedTag }
    }
  })
  return { ok: true, navigate: 'detail' }
}

const _enrichInflight = new Map<string, Promise<void>>()

const ENRICH_RETRY_THROTTLE_MS = 30_000

const _enrichedListeners = new Set<(repo: string) => void>()

export function onEnriched(cb: (repo: string) => void): () => void {
  _enrichedListeners.add(cb)
  return () => _enrichedListeners.delete(cb)
}

export async function enrichCommitsAhead(repo: string, comfyuiDir: string): Promise<void> {
  const key = `${repo}::${comfyuiDir}`
  const existing = _enrichInflight.get(key)
  if (existing) return existing

  const run = (async () => {
    const entry = get(repo, 'latest')
    if (!entry?.commitSha || entry.commitsAhead !== undefined) return
    if (!fs.existsSync(path.join(comfyuiDir, '.git'))) return
    if (
      entry.lastEnrichAttemptAt !== undefined &&
      Date.now() - entry.lastEnrichAttemptAt < ENRICH_RETRY_THROTTLE_MS
    )
      return

    let baseTag = entry.baseTag
    if (!baseTag) {
      const refreshed = await getLatestStableTag({ refresh: true }).catch(() => null)
      if (refreshed) baseTag = refreshed
    }
    if (!baseTag) {
      await fetchTags(comfyuiDir)
      const local = await findNearestTag(comfyuiDir, entry.commitSha).catch(() => undefined)
      if (local) baseTag = local
    }
    if (!baseTag) {
      _stampEnrichAttempt(repo, entry.commitSha)
      return
    }

    if (entry.baseTag !== baseTag) {
      const current = get(repo, 'latest')
      if (current && current.commitSha === entry.commitSha) {
        set(repo, 'latest', { ...current, baseTag })
      }
    }

    let ahead = await countCommitsAhead(comfyuiDir, baseTag, entry.commitSha)
    if (ahead === undefined) {
      await fetchTags(comfyuiDir)
      await fetchCommitSha(comfyuiDir, entry.commitSha)
      ahead = await countCommitsAhead(comfyuiDir, baseTag, entry.commitSha)
    }
    if (ahead === undefined) {
      _stampEnrichAttempt(repo, entry.commitSha)
      return
    }

    const current = get(repo, 'latest')
    if (!current || current.commitSha !== entry.commitSha) return
    const resolvedBase = current.baseTag ?? baseTag
    const releaseName = formatComfyVersion(
      { commit: current.commitSha!, baseTag: resolvedBase, commitsAhead: ahead },
      'short'
    )
    set(repo, 'latest', {
      ...current,
      baseTag: resolvedBase,
      commitsAhead: ahead,
      releaseName,
      lastEnrichAttemptAt: Date.now()
    })
    _notifyEnriched(repo)
  })().finally(() => _enrichInflight.delete(key))

  _enrichInflight.set(key, run)
  return run
}

function _stampEnrichAttempt(repo: string, commitSha: string): void {
  const current = get(repo, 'latest')
  if (!current || current.commitSha !== commitSha) return
  set(repo, 'latest', { ...current, lastEnrichAttemptAt: Date.now() })
  _notifyEnriched(repo)
}

function _notifyEnriched(repo: string): void {
  for (const cb of _enrichedListeners) {
    try {
      cb(repo)
    } catch (err) {
      console.warn('[release-cache] onEnriched listener threw:', err)
    }
  }
}

export function isUpdateAvailable(
  installation: Record<string, unknown>,
  channel: string,
  info: ReleaseCacheEntry | null
): boolean {
  if (!info || !info.latestTag) return false
  const marker = installation.installPath ? readOpMarker(installation.installPath as string) : null
  if (marker?.op === 'update' && !marker.postHead) return true
  const cv = installation.comfyVersion as ComfyVersion | undefined
  if (cv && channel === 'stable' && cv.commitsAhead !== undefined && cv.commitsAhead > 0)
    return true
  if (cv && channel === 'stable' && cv.commitsAhead === undefined && cv.baseTag) return true

  const lastRollback = installation.lastRollback as Record<string, unknown> | undefined
  const lastUpdateChannel = lastRollback?.channel as string | undefined
  if (lastUpdateChannel && lastUpdateChannel !== channel) {
    if (cv && info.commitSha && cv.commit === info.commitSha) return false
    const postHead = (lastRollback?.postUpdateHead as string | undefined) || ''
    const shortHead = postHead.slice(0, 7)
    const displayVersion = cv ? formatComfyVersion(cv, 'short') : ''
    if (tagsEqual(displayVersion, info.latestTag) || tagsEqual(displayVersion, info.releaseName))
      return false
    if (shortHead && (shortHead === info.latestTag || info.releaseName?.includes(shortHead)))
      return false
    return true
  }
  if (cv && info.commitSha && cv.commit === info.commitSha) return false

  if (
    info.installedTag &&
    info.installedTag !== 'unknown' &&
    !tagsEqual(info.installedTag, info.latestTag) &&
    !tagsEqual(info.installedTag, info.releaseName)
  )
    return true
  return false
}
