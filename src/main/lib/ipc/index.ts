import {
  fs,
  app,
  installations,
  settings,
  sourceMap,
  detectDesktopInstall,
  isGitAvailable,
  tryConfigureBootstrapPygit2,
  tryConfigurePygit2Fallback,
  createCache,
  fetchJSON,
  getLatestStableTag,
  getStableTags,
  setCallbacks,
  _broadcastToRenderer,
  migrateDefaults,
  checkInstallationUpdates,
  installDirStateAsync,
  refreshInstallDirStates,
  sweepOrphanPartitions,
  UPDATE_CHECK_INTERVAL
} from './shared'
import { R2_BASE_URL } from '../r2Mirror'
import * as releaseCache from '../release-cache'
import type { RegisterCallbacks } from './shared'
import { registerAppHandlers } from './registerAppHandlers'
import { registerInstallationHandlers } from './registerInstallationHandlers'
import { registerSnapshotHandlers } from './registerSnapshotHandlers'
import { registerSettingsHandlers } from './registerSettingsHandlers'
import { registerSessionHandlers } from './registerSessionHandlers'
import { registerTerminalHandlers } from './registerTerminalHandlers'
import { setTerminalEnvResolver } from '../terminal'
import { registerLogsHandlers } from './registerLogsHandlers'
import { registerCrashHandlers } from './registerCrashHandlers'
import { registerTelemetryHandlers } from './registerTelemetryHandlers'
import { registerDevPlatformHandlers } from './registerDevPlatformHandlers'
import { registerAssetsHandlers } from '../assets'
import { registerEmbeddedSessionHandlers } from './registerEmbeddedSessionHandlers'
import { registerCatalogHandlers } from './registerCatalogHandlers'
import { registerAppsHandlers } from './registerAppsHandlers'
import { registerAppsLocalHandlers } from './registerAppsLocalHandlers'
import { reconcileAdoptedSettings } from '../desktopAdopt'
import {
  finalizeComfyBuilderRecovery,
  recoverComfyBuilderInstallation
} from '../../sources/comfybuilder'

export {
  getAppVersion,
  stopRunning,
  cancelLaunching,
  hasRunningSessions,
  getSessionProcess,
  hasActiveOperations,
  getActiveDetails,
  cancelAll
} from './shared'
export type { RegisterCallbacks, ExitCallbackInfo } from './shared'

let _releaseCacheBridgeWired = false
function wireReleaseCacheBroadcast(): void {
  if (_releaseCacheBridgeWired) return
  _releaseCacheBridgeWired = true
  releaseCache.onEnriched((repo) => {
    _broadcastToRenderer('release-cache-enriched', { repo })
  })
}

export function register(callbacks: RegisterCallbacks = {}): Promise<void> {
  setCallbacks(callbacks)
  wireReleaseCacheBroadcast()

  const warnStartupWrite = (op: string) => (err: unknown) => {
    console.warn(`[ipc] Skipped startup installations ${op}:`, err)
  }
  installations
    .seedDefaults([
      {
        name: installations.CLOUD_INSTALL_NAME,
        sourceId: installations.CLOUD_SOURCE_ID,
        remoteUrl: 'https://cloud.comfy.org/',
        launchMode: 'window',
        browserPartition: 'shared'
      }
    ])
    .catch(warnStartupWrite('seedDefaults'))
  installations
    .ensureExists(installations.CLOUD_SOURCE_ID, {
      name: installations.CLOUD_INSTALL_NAME,
      sourceId: installations.CLOUD_SOURCE_ID,
      remoteUrl: 'https://cloud.comfy.org/',
      launchMode: 'window',
      browserPartition: 'shared',
      status: 'installed'
    })
    .catch(warnStartupWrite('ensureExists(cloud)'))
  installations.enforceCloudName().catch(warnStartupWrite('enforceCloudName'))

  {
    const desktopInfo = detectDesktopInstall()
    if (desktopInfo) {
      installations
        .ensureExists('desktop', {
          name: 'ComfyUI Legacy Desktop',
          sourceId: 'desktop',
          installPath: desktopInfo.basePath,
          launchMode: 'external',
          desktopExePath: desktopInfo.executablePath || undefined,
          status: 'installed'
        })
        .catch(warnStartupWrite('ensureExists(desktop)'))
    }
  }

  const startupMaintenance = migrateDefaults()
    .then(async () => {
      await reconcileAdoptedSettings()
    })
    .catch((err) => {
      console.warn('[ipc] Failed to migrate startup defaults or adopted settings:', err)
    })

  const startupRecovery = startupMaintenance.then(async () => {
    try {
      let all = await installations.list()
      let recovered = false
      const recoveredInstallationIds = new Set<string>()
      for (const inst of all.filter((item) => item.sourceId === 'comfybuilder')) {
        try {
          const result = await recoverComfyBuilderInstallation(inst)
          if (result.action === 'update') {
            const updated = await installations.update(inst.id, result.data)
            if (!updated) continue
            recovered = true
            recoveredInstallationIds.add(inst.id)
            await finalizeComfyBuilderRecovery(inst.installPath)
          }
        } catch (err) {
          console.warn(`[ipc] Failed to recover ComfyBuilder install ${inst.id}:`, err)
        }
      }
      if (recovered) all = await installations.list()
      if (recovered) _broadcastToRenderer('installations-changed', {})
      return { all, recoveredInstallationIds }
    } catch (err) {
      console.warn('[ipc] Failed to recover ComfyBuilder installations:', err)
      return null
    }
  })

  void startupRecovery.then(async (recovery) => {
    if (!recovery) return
    try {
      const { all, recoveredInstallationIds } = recovery
      const sweepable = all.filter((inst) => {
        const source = sourceMap[inst.sourceId]
        return (
          source &&
          !source.skipInstall &&
          inst.installPath &&
          !recoveredInstallationIds.has(inst.id)
        )
      })
      const states = await Promise.all(
        sweepable.map(async (inst) => ({
          inst,
          state: await installDirStateAsync(inst.installPath)
        }))
      )
      let swept = false
      for (const { inst, state } of states) {
        if (state !== 'empty') continue
        try {
          fs.rmSync(inst.installPath, { recursive: true, force: true })
        } catch {}
        await installations.remove(inst.id)
        swept = true
      }

      if (swept) _broadcastToRenderer('installations-changed', {})

      const remaining = await installations.list()
      sweepOrphanPartitions(new Set(remaining.map((i) => i.id)))
    } catch {}
  })

  void (async () => {
    const configureGitBackend = async (): Promise<void> => {
      const forceBootstrap = process.env.COMFY_FORCE_BOOTSTRAP_GIT === '1'

      if (await tryConfigureBootstrapPygit2()) {
        console.log('[ipc] Using bootstrap pygit2 for git operations (default)')
        return
      }

      console.warn(
        '[ipc] Bootstrap pygit2 not available — bootstrap-python/<platform>/ is missing. ' +
          'Run "pnpm run bootstrap" (or "pnpm run bootstrap:fetch") to build it. ' +
          'Falling back to standalone-install pygit2 / system git.'
      )

      if (forceBootstrap) {
        console.warn(
          '[ipc] COMFY_FORCE_BOOTSTRAP_GIT set but bootstrap python not found — no git backend will be configured'
        )
        return
      }

      try {
        const all = await installations.list()
        for (const inst of all) {
          if (inst.sourceId !== 'standalone' || !inst.installPath) continue
          if (await tryConfigurePygit2Fallback(inst.installPath)) {
            console.log(
              '[ipc] Configured pygit2 fallback via standalone install at',
              inst.installPath
            )
            return
          }
        }
      } catch (err) {
        console.warn('[ipc] Failed to enumerate standalone installations for pygit2 fallback:', err)
      }

      try {
        if (await isGitAvailable()) {
          console.log(
            '[ipc] Using system git (bootstrap pygit2 and standalone pygit2 both unavailable)'
          )
          return
        }
      } catch (err) {
        console.warn('[ipc] isGitAvailable() check failed:', err)
      }

      console.warn(
        '[ipc] No git backend available (bootstrap pygit2, standalone pygit2, and system git all missing)'
      )
    }

    await configureGitBackend()

    try {
      await Promise.all([getLatestStableTag(), getStableTags()])
    } catch {}
  })()

  void (async () => {
    try {
      const cache = createCache(
        settings.get('cacheDir') as string,
        settings.get('maxCachedDownloads') as number
      )
      await cache.cleanPartials()
    } catch {}
  })()

  void (async () => {
    try {
      await fetchJSON(`${R2_BASE_URL}/latest.json`)
    } catch {}
  })()

  setTimeout(() => checkInstallationUpdates(), 3_000)
  setInterval(() => checkInstallationUpdates(), UPDATE_CHECK_INTERVAL)

  void refreshInstallDirStates()
  setInterval(() => refreshInstallDirStates(), UPDATE_CHECK_INTERVAL)
  app.on('browser-window-focus', () => {
    void refreshInstallDirStates()
  })

  registerAppHandlers()
  registerInstallationHandlers()
  registerSnapshotHandlers()
  registerSettingsHandlers()
  registerSessionHandlers()
  setTerminalEnvResolver((inst) => sourceMap[inst.sourceId]?.getTerminalEnv?.(inst) ?? null)
  registerTerminalHandlers()
  registerLogsHandlers()
  registerCrashHandlers()
  registerTelemetryHandlers()
  registerDevPlatformHandlers()
  registerAssetsHandlers()
  registerEmbeddedSessionHandlers()
  registerCatalogHandlers()
  registerAppsHandlers()
  registerAppsLocalHandlers()
  return startupRecovery.then(() => undefined)
}
