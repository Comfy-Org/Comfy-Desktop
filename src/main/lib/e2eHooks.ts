import {
  _test_setSeededTrayState,
  getDownloadsTrayState,
  type DownloadsTrayState
} from './comfyDownloadManager'
import type { BetaArgView } from '../../types/ipc'
import { isPermittedDownloadUrl, isSecurePublicDownloadUrl } from './downloadUrlPolicy'
import { resolveRedirects, type ResolveRedirectsResult } from './redirectResolver'
import { startModelTransfer, type ModelTransferOutcome } from './modelDownloadTransport'
import { download } from './download'
import { BrowserWindow, session as electronSession } from 'electron'
import path from 'path'
import { fetchJSON } from './fetch'
import { _test_setUpdateState, type AppUpdateState } from './updater'
import {
  get as _releaseCacheGet,
  _test_ageEntries as _test_ageReleaseCacheEntries
} from './release-cache'
import { _test_getOpenTitlePopupBounds } from '../popups/titlePopup'
import { resolveModelManifest } from '../comfybuilder'
import { runModelStagingTask } from '../sources/comfybuilder/modelStagingTask'
import type { InstallationRecord } from '../installations'
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
  isLaunchSpawnHeld,
  armLaunchReadyHold,
  releaseLaunchReadyHold,
  isLaunchReadyHeld
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

export type E2EDownloadPolicy = 'permitted' | 'secure-public'

const e2ePolicies = {
  permitted: isPermittedDownloadUrl,
  'secure-public': isSecurePublicDownloadUrl
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
  armLaunchReadyHold(): void
  releaseLaunchReadyHold(): void
  isLaunchReadyHeld(): boolean
  getReleaseCacheCheckedAt(repo: string, channel: string): number | null
  ageReleaseCache(maxCheckedAt: number): void
  ensureInstallPanelView(installationId: string): boolean
  stageBuildModels(opts: {
    installPath: string
    buildId: string
    version: string
  }): Promise<{ staged: string[] } | { error: string; kind?: string }>
  resolveRedirects(opts: {
    url: string
    policy: E2EDownloadPolicy
    headers?: Record<string, string>
  }): Promise<ResolveRedirectsResult>
  runModelTransfer(opts: {
    url: string
    finalPath: string
    policy: E2EDownloadPolicy
  }): Promise<ModelTransferOutcome>
  runDownload(opts: {
    url: string
    destPath: string
    policy: E2EDownloadPolicy
  }): Promise<{ ok: true } | { ok: false; error: string }>
  runFetchJSON(url: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>
  runAssetDownload(opts: {
    url: string
    filename: string
    outputDir: string
    authToken?: string
  }): Promise<{ status: string; error?: string; savePath?: string }>
  rawSessionDownload(opts: {
    url: string
    headers: Record<string, string>
    destPath: string
  }): Promise<{ chain: string[]; state: string }>
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
    armLaunchReadyHold,
    releaseLaunchReadyHold,
    isLaunchReadyHeld,
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
        const installation = { id: `e2e-${buildId}`, installPath } as InstallationRecord
        const outcome = await runModelStagingTask(
          installation,
          manifest.models,
          new AbortController().signal
        )
        if (outcome === 'busy') return { error: 'The model directory is busy.', kind: 'busy' }
        return { staged: manifest.models.map((m) => `${m.type}/${m.filename}`) }
      } catch (e) {
        const err = e as { message?: string; kind?: string }
        return { error: err.message ?? String(e), ...(err.kind ? { kind: err.kind } : {}) }
      }
    },
    resolveRedirects({ url, policy, headers }) {
      return resolveRedirects({ url, headers, validateUrl: e2ePolicies[policy] })
    },
    runModelTransfer({ url, finalPath, policy }) {
      return startModelTransfer({
        url,
        finalPath,
        directory: 'checkpoints',
        filename: finalPath.split(/[\\/]/).pop() ?? 'model.safetensors',
        validateUrl: e2ePolicies[policy]
      }).done
    },
    async runDownload({ url, destPath, policy }) {
      try {
        await download(url, destPath, null, { validateUrl: e2ePolicies[policy] })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },
    async runFetchJSON(url) {
      try {
        return { ok: true, data: await fetchJSON(url, { refresh: true }) }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },
    async runAssetDownload({ url, filename, outputDir, authToken }) {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
      if (!win) return { status: 'no-window' }
      const dm = await import('./comfyDownloadManager')
      const admission = await dm.startManagedAssetDownload(win, url, filename, outputDir, authToken)
      if (admission.status !== 'accepted') return { status: admission.status }
      const terminal = new Set(['completed', 'error', 'cancelled'])
      for (let i = 0; i < 300; i++) {
        const row = dm.getAllDownloads().find((d) => d.id === admission.downloadId)
        if (row && terminal.has(row.status)) {
          return { status: row.status, error: row.error, savePath: row.savePath }
        }
        await new Promise((r) => setTimeout(r, 50))
      }
      return { status: 'timeout' }
    },
    rawSessionDownload({ url, headers, destPath }) {
      const sess = electronSession.fromPartition(`e2e-raw-download-${Date.now()}`)
      return new Promise((resolve) => {
        sess.once('will-download', (_event, item) => {
          item.setSavePath(path.resolve(destPath))
          item.once('done', (_e, state) => resolve({ chain: item.getURLChain(), state }))
        })
        sess.downloadURL(url, { headers })
      })
    }
  }
  ;(globalThis as unknown as { __e2e: E2EHelpers }).__e2e = helpers
}
