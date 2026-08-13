/**
 * Test-only helpers on `globalThis.__e2e` so the Playwright `app.evaluate(...)` bridge can
 * drive main-side state without the production data paths. Registered only when
 * `E2E === '1'`; implementations live in their owning modules as `_test_*` exports. Mirrored
 * test-side by `e2e/support/devHooks.ts`.
 */

import {
  _test_setSeededTrayState,
  getDownloadsTrayState,
  type DownloadsTrayState
} from './comfyDownloadManager'
import { _test_setUpdateState, type AppUpdateState } from './updater'
import {
  get as _releaseCacheGet,
  _test_ageEntries as _test_ageReleaseCacheEntries
} from './release-cache'
import { _test_getOpenTitlePopupBounds } from '../popups/titlePopup'
import { stageModels, resolveModelManifest } from '../comfybuilder'
import { getBuilderClient } from '../devplatform/session'
import { returnToDashboard } from '../host/detach'
import { comfyWindows, getEntryByInstallationId, isInstallHost } from '../host/registry'
import { ensurePanelView } from '../host/panelView'
import {
  installUpdateOverrides,
  INSTALL_UPDATE_GLOBAL_KEY,
  getIpcInvocations,
  resetIpcInvocations,
  getShellOpenExternalCalls,
  resetShellOpenExternalCalls,
  armLaunchSpawnHold,
  releaseLaunchSpawnHold,
  isLaunchSpawnHeld
} from './e2eOverrides'
import {
  _runningSessions,
  _operationAborts,
  _getLaunchingInstallationIds,
  _hasActiveLaunch,
  _test_addRunningSession,
  _test_clearRunningSessions
} from './ipc/shared'

export interface RunningSessionSnapshot {
  /** Process pid (null for synthetic seeded sessions with no real proc). */
  pid: number | null
  /** Wall-clock ms when the session was registered, so the restart cluster can assert a
   *  re-registration between two snapshots without a real pid delta. */
  startedAt: number
  port: number
  url: string | undefined
}

interface SetInstallUpdateOpts {
  /** Omit to apply the override globally (matches every installationId). */
  installationId?: string
  available: boolean
  version?: string
}

export interface E2EHelpers {
  /** Replace the downloads tray with a snapshot and broadcast `tray-state-changed`. */
  seedDownloads(snapshot: DownloadsTrayState): void
  /** Live downloads tray snapshot (`active` in-flight + `recent` terminal entries). */
  getDownloadsTrayState(): DownloadsTrayState
  /** Stub the install-update probe for one (or all) installations. */
  setInstallUpdate(opts: SetInstallUpdateOpts): void
  setAppUpdateState(state: AppUpdateState): void
  getTitlePopupBounds(): ReturnType<typeof _test_getOpenTitlePopupBounds>
  /** "Return to Dashboard" on the first install-backed host window. Resolves to the
   *  BrowserWindow id flipped, or null if none exists. */
  returnFirstInstallHostToDashboard(): Promise<number | null>
  /** Recorded invocations for an instrumented IPC channel; each entry is the handler's first arg. */
  getIpcInvocations(channel: string): unknown[]
  /** Clear recorded invocations for one channel, or all when called with no argument. */
  resetIpcInvocations(channel?: string): void
  /** URLs `shell.openExternal(...)` was called with via the launcher's wrapper. */
  getShellOpenExternalCalls(): string[]
  resetShellOpenExternalCalls(): void
  /** Register a synthetic running session without spawning a real ComfyUI process. */
  seedRunningSession(opts: { installationId: string; installationName: string }): void
  clearRunningSessions(): void
  /** Snapshot the live `_runningSessions` entry (real or seeded), or `null` if none. */
  getRunningSessionSnapshot(installationId: string): RunningSessionSnapshot | null
  /** Whether a background operation currently holds the per-install abort slot. */
  hasActiveOperation(installationId: string): boolean
  /** Whether the install is in the boot window (launching marker set, no session yet). */
  isLaunching(installationId: string): boolean
  /** Whether a launch handler is in flight for the install - covers the whole
   *  handler, including pre-marker prep. */
  hasActiveLaunch(installationId: string): boolean
  /** Arm a one-shot hold that parks the NEXT launch right before it spawns
   *  ComfyUI - launching marker set, port reserved, no process yet. */
  armLaunchSpawnHold(): void
  /** Release a held launch (and disarm a not-yet-consumed hold). */
  releaseLaunchSpawnHold(): void
  /** Whether a launch is currently parked at the spawn hold. */
  isLaunchSpawnHeld(): boolean
  /** `checkedAt` ms from the shared release cache entry, or `null` if absent. */
  getReleaseCacheCheckedAt(repo: string, channel: string): number | null
  /** Force every release-cache entry to `maxCheckedAt` so the renderer's stale-cache watcher
   *  treats the data as stale. */
  ageReleaseCache(maxCheckedAt: number): void
  /** Mount the install-backed panelView for `installationId` (production mounts it lazily),
   *  so tests can reach `panel.html` immediately after a launch. Returns whether the entry exists. */
  ensureInstallPanelView(installationId: string): boolean
  /** Run the REAL comfybuilder model-staging (resolve manifest -> download ->
   *  verify -> place) against `installPath`, isolated from the archive/auth path.
   *  Resolves to the staged `type/filename` list, or a typed error on failure. */
  stageDistributionModels(opts: {
    installPath: string
    distributionId: string
    version: string
  }): Promise<{ staged: string[] } | { error: string; kind?: string }>
}

export function registerE2EHooks(): void {
  const helpers: E2EHelpers = {
    seedDownloads: _test_setSeededTrayState,
    getDownloadsTrayState,
    setInstallUpdate(opts) {
      const key = opts.installationId ?? INSTALL_UPDATE_GLOBAL_KEY
      if (opts.available) {
        installUpdateOverrides.set(key, { available: true, version: opts.version })
      } else {
        installUpdateOverrides.delete(key)
      }
    },
    setAppUpdateState: _test_setUpdateState,
    getTitlePopupBounds: _test_getOpenTitlePopupBounds,
    async returnFirstInstallHostToDashboard() {
      for (const entry of comfyWindows.values()) {
        if (entry.window.isDestroyed() || !isInstallHost(entry)) continue
        const id = entry.window.id
        await returnToDashboard(entry.windowKey)
        return id
      }
      return null
    },
    getIpcInvocations,
    resetIpcInvocations,
    getShellOpenExternalCalls,
    resetShellOpenExternalCalls,
    seedRunningSession(opts) {
      _test_addRunningSession(opts.installationId, opts.installationName)
    },
    clearRunningSessions: _test_clearRunningSessions,
    getRunningSessionSnapshot(installationId) {
      const session = _runningSessions.get(installationId)
      if (!session) return null
      return {
        pid: session.proc?.pid ?? null,
        startedAt: session.startedAt,
        port: session.port,
        url: session.url
      }
    },
    hasActiveOperation(installationId) {
      return _operationAborts.has(installationId)
    },
    isLaunching(installationId) {
      return _getLaunchingInstallationIds().includes(installationId)
    },
    hasActiveLaunch(installationId) {
      return _hasActiveLaunch(installationId)
    },
    armLaunchSpawnHold,
    releaseLaunchSpawnHold,
    isLaunchSpawnHeld,
    getReleaseCacheCheckedAt(repo, channel) {
      return _releaseCacheGet(repo, channel)?.checkedAt ?? null
    },
    ageReleaseCache: _test_ageReleaseCacheEntries,
    ensureInstallPanelView(installationId) {
      const entry = getEntryByInstallationId(installationId)
      if (!entry || entry.window.isDestroyed()) return false
      ensurePanelView(entry.windowKey, entry, 'comfy-lifecycle')
      return true
    },
    async stageDistributionModels({ installPath, distributionId, version }) {
      const manifest = await resolveModelManifest(getBuilderClient(), distributionId, version)
      try {
        await stageModels({ models: manifest.models, installPath })
        return { staged: manifest.models.map((m) => `${m.type}/${m.filename}`) }
      } catch (e) {
        const err = e as { message?: string; kind?: string }
        return { error: err.message ?? String(e), ...(err.kind ? { kind: err.kind } : {}) }
      }
    }
  }
  ;(globalThis as unknown as { __e2e: E2EHelpers }).__e2e = helpers
}
