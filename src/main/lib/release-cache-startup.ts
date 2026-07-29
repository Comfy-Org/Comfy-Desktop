// Startup release-cache pre-warm. The cache is otherwise populated lazily, so without this a user
// who opens the app after weeks sees stale update pills until they visit the Update tab.

import type { InstallationRecord } from '../installations'
import * as releaseCache from './release-cache'
import { fetchLatestRelease } from './comfyui-releases'
import { refreshTorchStackCatalogs } from '../sources/standalone/torchStackCatalog'

/** Skip the startup check if any cache entry was refreshed within this window. */
const STARTUP_RECHECK_MS = 60 * 60 * 1000

const COMFYUI_REPO = 'Comfy-Org/ComfyUI'

/** Source IDs that read from the shared ComfyUI release cache. */
const COMFYUI_SOURCE_IDS = new Set(['standalone', 'portable'])

/** Last time these checks refreshed the torch stack catalog. In-memory on
 *  purpose: the ComfyUI release cache persists across app restarts, so on the
 *  first boot of a new Desktop version every channel can already be fresh -
 *  the torch catalog must still refresh once per app start or the PyTorch
 *  picker looks empty/absent until a manual "Check for Update". */
let _torchCatalogCheckedAt = 0

/** Test-only: reset the in-memory torch-catalog floor to cold start. */
export function _resetTorchCatalogFloorForTest(): void {
  _torchCatalogCheckedAt = 0
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

/**
 * Refresh the release cache for every unique channel in use, then run `onRefreshed` if at
 * least one fetch ran. Fire-and-forget; never throws.
 */
export async function runStartupReleaseChecks(
  installations: InstallationRecord[],
  options: {
    onRefreshed?: () => void
    now?: () => number
    /** Ignore the `STARTUP_RECHECK_MS` floor; used by the periodic poll. */
    bypassFloor?: boolean
  } = {},
): Promise<void> {
  const now = options.now ?? (() => Date.now())

  const channels = new Set<string>()
  for (const inst of installations) {
    if (!_isComfyUIInstall(inst)) continue
    channels.add(_channelOf(inst))
  }
  if (channels.size === 0) return

  const tasks: Promise<unknown>[] = []
  for (const channel of channels) {
    if (!options.bypassFloor) {
      const existing = releaseCache.get(COMFYUI_REPO, channel)
      if (existing?.checkedAt && now() - existing.checkedAt < STARTUP_RECHECK_MS) continue
    }

    tasks.push(
      releaseCache.getOrFetch(
        COMFYUI_REPO,
        channel,
        async () => {
          const release = await fetchLatestRelease(channel)
          if (!release) return null
          return releaseCache.buildCacheEntry(release)
        },
        /* force */ true,
      ).catch(() => null),
    )
  }
  // Refresh the switchable-PyTorch-stack catalog alongside the release fetch
  // so the Update tab's PyTorch picker stays current without a manual
  // "Check for Update". Best-effort: a catalog failure never blocks the
  // release check. The catalog has its own floor, independent of the
  // release-cache floor above: catalog freshness is unrelated to the
  // persisted release cache, which can be fresh on a boot where the catalog
  // was never fetched at all (e.g. first run after a Desktop upgrade).
  if (options.bypassFloor || now() - _torchCatalogCheckedAt >= STARTUP_RECHECK_MS) {
    _torchCatalogCheckedAt = now()
    tasks.push(refreshTorchStackCatalogs(installations).catch(() => null))
  }

  if (tasks.length === 0) return

  await Promise.allSettled(tasks)
  options.onRefreshed?.()
}

/** Matches the picker's stale-cache threshold so pills reflect upstream within this window. */
const PERIODIC_RECHECK_INTERVAL_MS = 15 * 60 * 1000

/**
 * Re-run `runStartupReleaseChecks` on an interval; returns a stop function.
 * Timer is `unref()`'d so it never keeps the process alive on its own.
 */
export function startPeriodicReleaseChecks(
  getInstallations: () => Promise<InstallationRecord[]>,
  options: { onRefreshed?: () => void; intervalMs?: number } = {},
): () => void {
  const intervalMs = options.intervalMs ?? PERIODIC_RECHECK_INTERVAL_MS
  const timer = setInterval(() => {
    void (async () => {
      try {
        const installs = await getInstallations()
        await runStartupReleaseChecks(installs, {
          onRefreshed: options.onRefreshed,
          bypassFloor: true,
        })
      } catch {
        // never let the periodic poll crash the timer
      }
    })()
  }, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
