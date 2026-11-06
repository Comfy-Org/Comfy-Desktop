import {
  _test_setSeededTrayState,
  getDownloadsTrayState,
  type DownloadsTrayState
} from './comfyDownloadManager'
import type { BetaArgView } from '../../types/ipc'
import { _test_setUpdateState, type AppUpdateState } from './updater'
import {
  get as _releaseCacheGet,
  _test_ageEntries as _test_ageReleaseCacheEntries
} from './release-cache'
import { _test_getOpenTitlePopupBounds } from '../popups/titlePopup'
import { stageModels, resolveModelManifest, installModelsRoot } from '../comfybuilder'
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
  pid: number | null
  startedAt: number
  port: number
  url: string | undefined
}

interface SetInstallUpdateOpts {
  installationId?: string
  available: boolean
  version?: string
}

export interface E2EHelpers {
  seedDownloads(snapshot: DownloadsTrayState): void
  getDownloadsTrayState(): DownloadsTrayState
  setInstallUpdate(opts: SetInstallUpdateOpts): void
  setAppUpdateState(state: AppUpdateState): void
  getTitlePopupBounds(): ReturnType<typeof _test_getOpenTitlePopupBounds>
  returnFirstInstallHostToDashboard(): Promise<number | null>
  getIpcInvocations(channel: string): unknown[]
  resetIpcInvocations(channel?: string): void
  getShellOpenExternalCalls(): string[]
  resetShellOpenExternalCalls(): void
  seedRunningSession(opts: {
    installationId: string
    installationName: string
    coreBetaArgs?: BetaArgView[]
  }): void
  clearRunningSessions(): void
  getRunningSessionSnapshot(installationId: string): RunningSessionSnapshot | null
  hasActiveOperation(installationId: string): boolean
  isLaunching(installationId: string): boolean
  hasActiveLaunch(installationId: string): boolean
  armLaunchSpawnHold(): void
  releaseLaunchSpawnHold(): void
  isLaunchSpawnHeld(): boolean
  getReleaseCacheCheckedAt(repo: string, channel: string): number | null
  ageReleaseCache(maxCheckedAt: number): void
  ensureInstallPanelView(installationId: string): boolean
  stageBuildModels(opts: {
    installPath: string
    buildId: string
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
      _test_addRunningSession(
        opts.installationId,
        opts.installationName,
        undefined,
        opts.coreBetaArgs
      )
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
    async stageBuildModels({ installPath, buildId, version }) {
      const manifest = await resolveModelManifest(getBuilderClient(), buildId, version)
      try {
        const dm = await import('./comfyDownloadManager')
        await dm.initializeModelDownloads()
        const releaseModelRoot = dm.acquireModelDownloadRootLock(installModelsRoot(installPath))
        if (!releaseModelRoot) {
          return { error: 'The model directory is busy.', kind: 'busy' }
        }
        try {
          await stageModels({
            models: manifest.models,
            installPath,
            jobs: { start: dm.startManagedModelJob, cancel: dm.cancelModelDownload }
          })
        } finally {
          releaseModelRoot()
        }
        return { staged: manifest.models.map((m) => `${m.type}/${m.filename}`) }
      } catch (e) {
        const err = e as { message?: string; kind?: string }
        return { error: err.message ?? String(e), ...(err.kind ? { kind: err.kind } : {}) }
      }
    }
  }
  ;(globalThis as unknown as { __e2e: E2EHelpers }).__e2e = helpers
}
