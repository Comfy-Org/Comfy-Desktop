import type { InstallationRecord } from '../installations'
import * as releaseCache from './release-cache'
import { fetchLatestRelease } from './comfyui-releases'
import { refreshTorchStackCatalogs } from '../sources/standalone/torchStackCatalog'

const STARTUP_RECHECK_MS = 60 * 60 * 1000

const COMFYUI_REPO = 'Comfy-Org/ComfyUI'

const COMFYUI_SOURCE_IDS = new Set(['standalone', 'portable'])

let _torchCatalogCheckedAt = 0
let _torchCatalogRefresh: Promise<boolean> | null = null

export function _resetTorchCatalogFloorForTest(): void {
  _torchCatalogCheckedAt = 0
  _torchCatalogRefresh = null
}

function _refreshTorchCatalog(
  installations: InstallationRecord[],
  now: () => number
): Promise<boolean> {
  _torchCatalogRefresh ??= refreshTorchStackCatalogs(installations)
    .then((ok) => {
      if (ok) _torchCatalogCheckedAt = now()
      return ok
    })
    .catch(() => false)
    .finally(() => {
      _torchCatalogRefresh = null
    })
  return _torchCatalogRefresh
}

function _isComfyUIInstall(inst: InstallationRecord): boolean {
  if (inst.status !== 'installed') return false
  const sourceId = (inst as unknown as { sourceId?: string }).sourceId
  return sourceId !== undefined && COMFYUI_SOURCE_IDS.has(sourceId)
}

function _channelOf(inst: InstallationRecord): string {
  const ch = (inst as unknown as { updateChannel?: string }).updateChannel
  return ch || 'stable'
}

export async function runStartupReleaseChecks(
  installations: InstallationRecord[],
  options: {
    onRefreshed?: () => void
    now?: () => number
    bypassFloor?: boolean
  } = {}
): Promise<void> {
  const now = options.now ?? (() => Date.now())

  const channels = new Set<string>()
  for (const inst of installations) {
    if (!_isComfyUIInstall(inst)) continue
    channels.add(_channelOf(inst))
  }
  if (channels.size === 0) return

  let refreshed = false
  const tasks: Promise<unknown>[] = []
  for (const channel of channels) {
    const previousCheckedAt = releaseCache.get(COMFYUI_REPO, channel)?.checkedAt
    if (
      !options.bypassFloor &&
      previousCheckedAt &&
      now() - previousCheckedAt < STARTUP_RECHECK_MS
    ) {
      continue
    }

    tasks.push(
      releaseCache
        .getOrFetch(
          COMFYUI_REPO,
          channel,
          async () => {
            const release = await fetchLatestRelease(channel)
            if (!release) return null
            return releaseCache.buildCacheEntry(release)
          },
          true
        )
        .then((entry) => {
          if (entry?.checkedAt && entry.checkedAt !== previousCheckedAt) refreshed = true
        })
        .catch(() => null)
    )
  }
  if (options.bypassFloor || now() - _torchCatalogCheckedAt >= STARTUP_RECHECK_MS) {
    tasks.push(
      _refreshTorchCatalog(installations, now).then((ok) => {
        if (ok) refreshed = true
      })
    )
  }

  if (tasks.length === 0) return

  await Promise.allSettled(tasks)
  if (refreshed) options.onRefreshed?.()
}

const PERIODIC_RECHECK_INTERVAL_MS = 15 * 60 * 1000

export function startPeriodicReleaseChecks(
  getInstallations: () => Promise<InstallationRecord[]>,
  options: { onRefreshed?: () => void; intervalMs?: number } = {}
): () => void {
  const intervalMs = options.intervalMs ?? PERIODIC_RECHECK_INTERVAL_MS
  const timer = setInterval(() => {
    void (async () => {
      try {
        const installs = await getInstallations()
        await runStartupReleaseChecks(installs, {
          onRefreshed: options.onRefreshed,
          bypassFloor: true
        })
      } catch {}
    })()
  }, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
