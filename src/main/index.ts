import {
  app,
  Menu,
  ipcMain,
  net,
  dialog,
  crashReporter,
  nativeTheme,
  powerMonitor,
  BrowserWindow
} from 'electron'
import type { WebContentsView } from 'electron'
import type { Tray } from 'electron'
import path from 'path'
import fs from 'fs'
import { normaliseFirstUseMode } from '../shared/firstUseMode'
import { execFile } from 'child_process'
import type { ChildProcess } from 'child_process'
import todesktop from '@todesktop/runtime'
import * as ipc from './lib/ipc'
import { getAppVersion } from './lib/ipc'
import type { ExitCallbackInfo } from './lib/ipc'
import { closeAllPopouts } from './lib/popoutWindows'
import { disposeAllTerminals } from './lib/terminal'
import * as updater from './lib/updater'
import * as settings from './settings'
import { installAppMenu } from './menu'
import * as i18n from './lib/i18n'
import { migrateXdgPaths, persistWinDataRootChoice } from './lib/paths'
import { saveWindowBounds } from './lib/windowState'
import { flushLastSessionSync, recordDashboardSurface } from './lib/lastSession'
import { registerProcessErrorHandlers } from './lib/processErrorHandlers'
import { registerAppsIpc } from './apps/appsView'
import { registerOutputFilesScheme, registerOutputFolderHandlers } from './lib/outputFolders'
import { initAppLog, flushOperationOutput } from './lib/appLog'
import { pruneCrashDumps } from './lib/crashDumps'
import { createStartupReentryGate } from './lib/startupReentryGate'
import { registerTitleTooltipIpc } from './popups/titleTooltip'
import { registerTitleCoachmarkIpc } from './popups/titleCoachmark'
import {
  openSystemModal,
  openSystemModalAsync,
  openSystemModalChoiceAsync,
  registerSystemModalIpc
} from './popups/systemModal'
import {
  registerTitlePopupIpc,
  triggerPickerSnapshotBroadcast,
  openDownloadsTrayForInstall,
  type InstancePickerInstall
} from './popups/titlePopup'
import { registerPickerSettingsIpc } from './popups/pickerSettingsHandlers'
import { waitForPort, COMFY_BOOT_TIMEOUT_MS } from './lib/process'
import {
  clearQuitReason,
  isQuitInProgress,
  setQuitReason,
  setSessionEnding
} from './lib/quit-state'
import { showUpdateInstallSplash } from './lib/updateSplash'
import type { InstallationRecord } from './installations'
import {
  cleanupTempDownloads,
  downloadEvents,
  getDownloadsTrayState,
  hasActiveModelTransfers,
  initializeModelDownloads,
  resumeModelDownloadsAfterWake,
  suspendActiveModelDownloadsForQuit,
  suspendActiveModelDownloadsForSleep
} from './lib/comfyDownloadManager'
import { stopAgentPrefetches } from './lib/agentRequirementsLaunch'
import { prefetchEnrolledAgents } from './lib/agentPrefetch'
import {
  hasActiveTemplateDownloads,
  getTemplateDownloadState
} from './sources/standalone/templateDownloadTask'
import { isTerminal as isTemplateDownloadTerminal } from './sources/standalone/templateDownloadCore'
import { registerAssetDownloadHandlers } from './lib/ipc/registerAssetDownloadHandlers'
import { registerDownloadHandlers } from './lib/ipc/registerDownloadHandlers'
import { registerTemplateInputAssetHandlers } from './lib/ipc/registerTemplateInputAssetHandlers'
import { emitInstanceStartedTelemetry } from './lib/ipc/sessionStartTelemetry'
import { emitStorageTelemetry } from './lib/ipc/storageTelemetry'
import {
  get as getInstallation,
  installationEvents,
  list as listInstallations
} from './installations'
import { startPeriodicReleaseChecks } from './lib/release-cache-startup'
import { showSplashPage } from './lib/relaunchPage'
import { COMFY_BG, SPLASH_DARK, TITLEBAR_BG, type SplashTheme } from './lib/theme'
import { titleBarOverlayForTheme } from './lib/titleBarOverlay'
import {
  sourceMap,
  _broadcastToRenderer,
  _runningSessions,
  _operationAborts,
  _activeOperationStatus,
  _getLaunchingInstallationIds,
  stopRunning,
  resolveTheme,
  MSG_CANCELLED,
  type PickerOperationStatus
} from './lib/ipc/shared'
import { enrichInstallationsForRenderer } from './lib/ipc/registerInstallationHandlers'
import { getSnapshotListData } from './lib/snapshots'
import { update as updateInstallation, resolveAutoLaunchInstall } from './installations'
import { AUTO_LAUNCH_NONE } from './settings'
import { lookupInstallUpdateOverride, recordIpcInvocation } from './lib/e2eOverrides'
import * as mainTelemetry from './lib/telemetry'
import {
  clearLegacyIdentityRetryMarker,
  consumeFirstLaunch,
  getDeviceId,
  getIdClass,
  hasCompletedFirstLaunch,
  hasPersistedDeviceId,
  initDeviceId,
  markIdentityMigrationCompleted,
  startMachineIdLookup
} from './lib/deviceId'
import { getInitialAnonymousDistinctId } from './lib/websiteAnonymousIdentity'
import { recoverPendingIdentityRotation } from './lib/pendingIdentityMerge'
import { initExperiments } from './lib/experiments'
import { initCloudFreeRuns } from './lib/cloudFreeRuns'
import { initCoreBetaFlags, refreshCoreBetaFlags } from './lib/coreBetaCampaignFlags'
import { initEmbeddedSessionFlag } from './lib/embeddedSessionFlag'
import { initStaffFlagTargeting } from './lib/staffFlagTargeting'
import { initUserTier } from './lib/userTier'
import { readSmartAppControlState } from './lib/smartAppControl'

import {
  claimAttachHost,
  comfyWindows,
  computeBodyMode,
  consumeAttachClaim,
  dropAttachClaimsForWindow,
  findEntryByTitleBarSender,
  findEntryByHostWindow,
  forceRevealHostWindow,
  getEntryByInstallationId,
  isChooserHost,
  isInstallHost,
  openOrFocusAnyHostWindow,
  openOrFocusChooserHostWindow,
  raiseAllHostWindows,
  setHostFactories,
  shouldConfirmKillForEntry
} from './host/registry'
import type { ComfyWindowEntry } from './host/registry'
import {
  applyChooserHostThemeToAll,
  createHostWindow,
  expectedPartitionFor,
  openChooserHostWindow,
  rebuildComfyViewIfNeeded,
  setHostWindowFactories
} from './host/createHostWindow'
import { attachInstall, setAttachFactories, type ZoomResetSource } from './host/attach'
import { resetCanvasRendered } from './lib/canvasEntry'
import { IN_PLACE_RELAUNCH, REQUIRES_STOPPED } from '../types/ipc'
import { dispatchSessionAction, handleLaunch } from './lib/ipc/sessionActions'
import { applyAttachHostPreview, clearAttachHostPreview } from './host/attachHostPreview'
import { takePriorSessionUnclean } from './lib/comfyProcessRecord'
import {
  _detachInstallImpl,
  confirmAndCloseAllHostWindows,
  confirmAndCloseHostWindow,
  confirmCloseInstanceWindow,
  consultPanelRendererClose,
  detachOrphanedInstallHosts,
  preClearedClose,
  returnToDashboard
} from './host/detach'
import {
  destroyPanelView,
  ensurePanelView,
  focusActiveBody,
  openAnnouncement,
  prewarmAttachedPanel,
  refreshComfyTabBody,
  registerPanelViewIpc,
  sendToPanelDeferred,
  setActivePanel
} from './host/panelView'

export type { ComfyPanelKey } from './host/registry'

try {
  crashReporter.start({ uploadToServer: false })
} catch {}

if (settings.get('hardwareAcceleration') === false) {
  app.disableHardwareAcceleration()
}

registerOutputFilesScheme()

todesktop.init({ autoUpdater: false })

const APP_VERSION = getAppVersion()

let tray: Tray | null = null

let _stopPeriodicReleaseChecks: (() => void) | null = null

function focusExternalProcessWindow(pid: number): void {
  if (process.platform === 'win32') {
    const vbsPath = path.join(app.getPath('temp'), `comfy-focus-${pid}.vbs`)
    fs.writeFileSync(vbsPath, `CreateObject("WScript.Shell").AppActivate ${pid}`)
    execFile('wscript.exe', ['//Nologo', '//B', vbsPath], { windowsHide: true }, () => {
      fs.unlink(vbsPath, () => {})
    })
  } else if (process.platform === 'darwin') {
    execFile(
      'osascript',
      [
        '-e',
        `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`
      ],
      () => {}
    )
  }
}
function updateTrayMenu(): void {
  if (!tray) return
  const contextMenu = Menu.buildFromTemplate([
    {
      label: i18n.t('tray.showApp'),
      click: () => {
        openOrFocusChooserHostWindow()
      }
    },
    { type: 'separator' },
    { label: i18n.t('tray.quit'), click: () => quitApp() }
  ])
  tray.setContextMenu(contextMenu)
}

function quitApp(): void {
  setQuitReason('user-quit')
  ipc.cancelAll()
  for (const [, entry] of comfyWindows) {
    if (!entry.window.isDestroyed()) entry.window.destroy()
  }
  comfyWindows.clear()
  if (tray) {
    tray.destroy()
    tray = null
  }
  app.quit()
}

const STARTUP_RESTORE_REVEAL_BACKSTOP_MS = 10_000
const pendingStartupRestoreRevealTimers = new Map<number, ReturnType<typeof setTimeout>>()

const STARTUP_INSTALL_QUIT_BACKSTOP_MS = 4_000

function clearStartupRestoreRevealTimer(windowKey: number): void {
  const timer = pendingStartupRestoreRevealTimers.get(windowKey)
  if (timer) clearTimeout(timer)
  pendingStartupRestoreRevealTimers.delete(windowKey)
}

function revealStartupRestoreDashboard(windowKey: number): void {
  clearStartupRestoreRevealTimer(windowKey)
  recordDashboardSurface()
  forceRevealHostWindow(windowKey)
}

async function openStartupSurface(): Promise<void> {
  const firstUseDone = settings.get('firstUseCompleted') === true
  const autoLaunchValue = firstUseDone
    ? (settings.get('autoLaunchOnStartup') as string | undefined)
    : undefined
  const explicitInst =
    autoLaunchValue && autoLaunchValue !== AUTO_LAUNCH_NONE
      ? await resolveAutoLaunchInstall(autoLaunchValue)
      : null

  const chooserWindow = explicitInst
    ? openChooserHostWindow('comfy', { deferColdStartReveal: true })
    : openOrFocusChooserHostWindow()

  if (!explicitInst) return
  const installationId = explicitInst.id

  void (async () => {
    const entry = findEntryByHostWindow(chooserWindow)
    if (!entry || entry.window.isDestroyed() || !isChooserHost(entry)) {
      if (!chooserWindow.isDestroyed()) chooserWindow.show()
      return
    }

    const timer = setTimeout(
      () => revealStartupRestoreDashboard(entry.windowKey),
      STARTUP_RESTORE_REVEAL_BACKSTOP_MS
    )
    pendingStartupRestoreRevealTimers.set(entry.windowKey, timer)

    const inst = await getInstallation(installationId)
    if (!inst) {
      revealStartupRestoreDashboard(entry.windowKey)
      return
    }
    const panelView =
      entry.panelView ?? ensurePanelView(entry.windowKey, entry, computeBodyMode(entry))
    if (panelView.webContents.isDestroyed()) {
      revealStartupRestoreDashboard(entry.windowKey)
      return
    }
    sendToPanelDeferred(panelView, 'panel-trigger-overlay', {
      kind: 'picker-pick-install',
      installationId,
      startupRestore: true
    })
  })()
}

function onComfyExited({ installationId, crashed }: ExitCallbackInfo = {}): void {
  if (!installationId) return
  if (crashed) recordDashboardSurface()
  refreshComfyTabBody(installationId)
}

interface RelaunchState {
  originalUrl: string
  theme: SplashTheme
  navBlocker: (e: Electron.Event) => void
  token: number
}

const relaunchStates = new Map<string, RelaunchState>()
const comfyFailRetryTimerCancels = new Map<string, () => void>()
const comfyReloads = new Map<string, () => void>()
const comfyZoomResets = new Map<string, (source: ZoomResetSource) => void>()
let relaunchTokenCounter = 0
const comfyRevealTokens = new Map<string, number>()

async function onModelFolderRelaunch({
  installationId
}: {
  installationId: string
}): Promise<void> {
  const entry = getEntryByInstallationId(installationId)
  if (!entry || entry.window.isDestroyed()) return
  const comfyContents = entry.comfyView.webContents

  const prev = relaunchStates.get(installationId)
  if (prev) comfyContents.off('will-navigate', prev.navBlocker)

  const currentUrl = comfyContents.getURL()
  const originalUrl = prev ? prev.originalUrl : currentUrl

  const cancelRetry = comfyFailRetryTimerCancels.get(installationId)
  if (cancelRetry) cancelRetry()

  const blockNav = (e: Electron.Event): void => {
    e.preventDefault()
  }
  comfyContents.on('will-navigate', blockNav)

  const theme: SplashTheme = SPLASH_DARK
  const token = ++relaunchTokenCounter

  relaunchStates.set(installationId, { originalUrl, theme, navBlocker: blockNav, token })
  await showSplashPage(comfyContents, theme)
}

function onComfyRestarted({
  installationId,
  process: _proc
}: { installationId?: string; process?: ChildProcess } = {}): void {
  if (!installationId) return
  const entry = getEntryByInstallationId(installationId)
  if (!entry || entry.window.isDestroyed()) return
  const comfyContents = entry.comfyView.webContents

  const state = relaunchStates.get(installationId)
  const myToken = state?.token

  const currentUrl = state?.originalUrl || comfyContents.getURL()
  if (!currentUrl) return

  const url = new URL(currentUrl)
  const port = parseInt(url.port, 10)
  if (!port) return

  const cleanupRelaunchState = (): void => {
    const current = relaunchStates.get(installationId)
    if (current && current.token === myToken) {
      if (!entry.window.isDestroyed()) comfyContents.off('will-navigate', current.navBlocker)
      relaunchStates.delete(installationId)
    }
  }

  const isStale = (): boolean => {
    const current = relaunchStates.get(installationId)
    return !!current && current.token !== myToken
  }

  waitForPort(port, '127.0.0.1', { timeoutMs: COMFY_BOOT_TIMEOUT_MS })
    .then(async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        if (entry.window.isDestroyed() || isStale()) {
          cleanupRelaunchState()
          return
        }
        try {
          const resp = await net.fetch(currentUrl, { method: 'HEAD' })
          resp.body?.cancel()
          break
        } catch {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
        }
      }
      if (entry.window.isDestroyed() || isStale()) {
        cleanupRelaunchState()
        return
      }
      if (relaunchStates.has(installationId) && !state) return
      cleanupRelaunchState()
      entry.comfyView.setBackgroundColor(state?.theme.bg ?? COMFY_BG)
      await comfyContents.loadURL(currentUrl)
    })
    .catch((err) => {
      cleanupRelaunchState()
      console.error(`ComfyUI restart failed for ${installationId}:`, err)
    })
}

function onStop({ installationId }: { installationId?: string } = {}): void {
  if (installationId) {
    refreshComfyTabBody(installationId)
  } else {
    for (const entry of comfyWindows.values()) {
      if (isInstallHost(entry)) {
        refreshComfyTabBody(entry.installationId)
      }
    }
  }
}

function onLaunch({
  port,
  url,
  process: proc,
  installation,
  mode
}: {
  port: number
  url?: string
  process: ChildProcess | null
  installation: InstallationRecord
  mode: string
}): void {
  const comfyUrl = url || `http://127.0.0.1:${port}`
  const installationId = installation.id

  if (mode === 'console' || mode === 'external') {
    return
  }

  resetCanvasRendered(installationId)

  const existing = getEntryByInstallationId(installationId)
  if (existing && !existing.window.isDestroyed()) {
    consumeAttachClaim(installationId)
    existing.comfyUrl = comfyUrl

    const revealReusedComfy = (): void => {
      if (existing.window.isDestroyed() || existing.installationId !== installationId) return
      if (existing.activePanel !== 'progress') {
        setActivePanel(existing.windowKey, 'comfy')
      }
      refreshComfyTabBody(installationId)
    }

    if (!existing.comfyView.webContents.isDestroyed()) {
      const comfyContents = existing.comfyView.webContents
      comfyFailRetryTimerCancels.get(installationId)?.()
      const revealToken = (comfyRevealTokens.get(installationId) ?? 0) + 1
      comfyRevealTokens.set(installationId, revealToken)
      void (async () => {
        existing.comfyView.setBackgroundColor(SPLASH_DARK.bg)
        await showSplashPage(comfyContents, SPLASH_DARK, {
          title: i18n.t('launch.launchSplashTitle'),
          desc: i18n.t('launch.launchSplashDesc')
        }).catch(() => {})
        if (
          comfyRevealTokens.get(installationId) !== revealToken ||
          existing.window.isDestroyed() ||
          comfyContents.isDestroyed() ||
          existing.installationId !== installationId
        ) {
          return
        }
        if (!_runningSessions.has(installationId)) {
          refreshComfyTabBody(installationId)
          return
        }
        revealReusedComfy()
        void comfyContents.loadURL(comfyUrl).catch(() => {})
      })()
    } else {
      revealReusedComfy()
    }

    if (proc) {
      proc.on('exit', () => {})
    }
    scheduleTemplateTrayAutoOpen(installationId)
    return
  }

  const claimedKey = consumeAttachClaim(installationId)
  if (claimedKey !== undefined) {
    const claimed = comfyWindows.get(claimedKey)
    if (claimed && !claimed.window.isDestroyed() && isChooserHost(claimed)) {
      rebuildComfyViewIfNeeded(claimed, installation)
      destroyPanelView(claimed)
      const ok = attachInstall(claimed, { installation, comfyUrl, isLocal: !url })
      if (ok) {
        prewarmAttachedPanel(claimed)
        if (proc) {
          proc.on('exit', () => {})
        }
        scheduleTemplateTrayAutoOpen(installationId)
        return
      }
    }
  }

  const initialSourceCategory = sourceMap[installation.sourceId]?.category ?? null

  const { entry } = createHostWindow({
    windowTitle: `${installation.name} — Comfy Desktop v${APP_VERSION}`,
    boundsKey: installationId,
    initialTheme: { bg: COMFY_BG, text: '#dddddd' },
    titleBarOverlay:
      process.platform === 'darwin'
        ? undefined
        : titleBarOverlayForTheme(resolveTheme() === 'dark'),
    comfyWebPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/comfyPreload.js'),
      partition: expectedPartitionFor(installation)
    },
    titleBarBackground: TITLEBAR_BG,
    titleBarInstallationIdParam: installationId,
    initialTitleBarText: installation.name,
    initialSourceCategory
  })

  const attached = attachInstall(entry, { installation, comfyUrl, isLocal: !url })
  if (!attached) {
    entry.window.destroy()
    return
  }

  entry.layoutViews()

  if (proc) {
    proc.on('exit', () => {})
  }

  scheduleTemplateTrayAutoOpen(installationId)
}

const TEMPLATE_TRAY_AUTO_OPEN_MS = 2500

function scheduleTemplateTrayAutoOpen(installationId: string): void {
  const state = getTemplateDownloadState(installationId)
  if (!state || isTemplateDownloadTerminal(state.status)) return
  setTimeout(() => {
    const cur = getTemplateDownloadState(installationId)
    if (cur && !isTemplateDownloadTerminal(cur.status)) {
      openDownloadsTrayForInstall(installationId)
    }
  }, TEMPLATE_TRAY_AUTO_OPEN_MS)
}

ipcMain.handle('quit-app', () => quitApp())

ipcMain.handle('app:relaunch', () => {
  setQuitReason('user-quit')
  ipc.cancelAll()
  for (const [, entry] of comfyWindows) {
    if (!entry.window.isDestroyed()) entry.window.destroy()
  }
  comfyWindows.clear()
  if (tray) {
    tray.destroy()
    tray = null
  }
  app.relaunch()
  app.quit()
})

ipcMain.handle('reset-zoom', () => {})

ipcMain.on('comfy-window:startup-restore-reveal', (event, payload: { result?: unknown }) => {
  const result = payload?.result === 'dashboard-fallback' ? 'dashboard-fallback' : 'takeover-ready'
  for (const [windowKey, entry] of comfyWindows) {
    if (entry.panelView?.webContents !== event.sender) continue
    clearStartupRestoreRevealTimer(windowKey)
    if (result === 'dashboard-fallback') recordDashboardSurface()
    forceRevealHostWindow(windowKey)
    return
  }
})

ipcMain.on('comfy-window:set-first-use-mode', (event, payload: { mode: unknown }) => {
  const mode = normaliseFirstUseMode(payload?.mode)
  recordIpcInvocation('comfy-window:set-first-use-mode', { mode })
  for (const entry of comfyWindows.values()) {
    if (entry.panelView?.webContents === event.sender) {
      entry.firstUseMode = mode
      if (!entry.titleBarView.webContents.isDestroyed()) {
        entry.titleBarView.webContents.send('comfy-titlebar:first-use-mode-changed', mode)
      }
      return
    }
    return
  }
})

async function computeInstallUpdateAvailable(
  installationId: string
): Promise<{ available: boolean; version?: string }> {
  if (!installationId) return { available: false }
  const override = lookupInstallUpdateOverride(installationId)
  if (override) return override
  try {
    const inst = await getInstallation(installationId)
    if (!inst) return { available: false }
    const source = sourceMap[inst.sourceId]
    const tag = source?.getStatusTag ? source.getStatusTag(inst) : undefined
    if (tag?.style !== 'update') return { available: false }
    return { available: true, version: tag.version }
  } catch {
    return { available: false }
  }
}

function _broadcastAppUpdateStateToTitleBars(state: updater.AppUpdateState): void {
  for (const entry of comfyWindows.values()) {
    const wc = entry.titleBarView.webContents
    if (wc.isDestroyed()) continue
    try {
      wc.send('comfy-titlebar:app-update-state-changed', state)
    } catch {}
  }
}

ipcMain.on('comfy-window:click-refresh-instance', (event) => {
  const found = findEntryByTitleBarSender(event.sender)
  if (!found) return
  const { entry } = found
  if (entry.window.isDestroyed()) return
  const id = entry.installationId
  if (id === null) return
  comfyReloads.get(id)?.()
  focusActiveBody(entry)
})

ipcMain.on('comfy-window:reset-zoom', (event) => {
  const found = findEntryByTitleBarSender(event.sender)
  if (!found) return
  const { entry } = found
  if (entry.window.isDestroyed()) return
  const id = entry.installationId
  if (id === null) return
  comfyZoomResets.get(id)?.('titlebar')
  focusActiveBody(entry)
})

ipcMain.on('comfy-window:click-app-update-pill', (event) => {
  const found = findEntryByTitleBarSender(event.sender)
  if (!found) return
  const { entry } = found
  if (entry.window.isDestroyed()) return
  const state = updater.getCurrentUpdateState()
  if (state.kind === null) return
  if (state.kind === 'downloading') {
    const panelView = entry.panelView
    if (!panelView) return
    sendToPanelDeferred(panelView, 'panel-trigger-overlay', {
      kind: 'open-settings',
      installationId: entry.installationId,
      settingsTab: 'global'
    })
    return
  }
  const isReady = state.kind === 'ready'
  const version = state.version ?? i18n.t('appUpdate.fallbackVersion')
  const title = isReady ? i18n.t('appUpdate.readyTitle') : i18n.t('appUpdate.availableTitle')
  const message = isReady
    ? i18n.t('appUpdate.readyMessage', { version })
    : i18n.t('appUpdate.availableMessage', { version })
  const confirmLabel = isReady ? i18n.t('appUpdate.restartNow') : i18n.t('appUpdate.download')
  const cancelLabel = i18n.t('appUpdate.later')
  const theme = entry.lastTheme
  openSystemModal({
    parent: entry.window,
    spec: {
      id: `app-update-${state.kind}-${version}`,
      title,
      message,
      confirmLabel,
      cancelLabel,
      confirmStyle: 'primary',
      theme
    },
    callback: (action) => {
      if (action !== 'confirm') return
      if (isReady) {
        updater.installUpdate()
      } else {
        void updater.downloadUpdate()
      }
    }
  })
})

ipcMain.on('comfy-window:click-install-update-pill', (event) => {
  const found = findEntryByTitleBarSender(event.sender)
  if (!found) return
  const { entry } = found
  const installationId = entry.installationId
  if (!installationId) return
  const panelView =
    entry.panelView ?? ensurePanelView(entry.windowKey, entry, computeBodyMode(entry))
  sendToPanelDeferred(panelView, 'panel-trigger-overlay', {
    kind: 'install-update',
    installationId
  })
})

function notifyTitleBarDownloads(titleBarView: WebContentsView): void {
  if (titleBarView.webContents.isDestroyed()) return
  titleBarView.webContents.send('comfy-titlebar:downloads-changed', getDownloadsTrayState())
}

function _broadcastDownloadsToTitleBars(): void {
  for (const entry of comfyWindows.values()) {
    notifyTitleBarDownloads(entry.titleBarView)
  }
}

function triggerOpenFeedback(entryId: number, source: 'titlebar' | 'menu'): void {
  const parentEntry = comfyWindows.get(entryId)
  if (!parentEntry || parentEntry.window.isDestroyed()) return
  const panelView = parentEntry.panelView ?? ensurePanelView(entryId, parentEntry, 'feedback')
  setActivePanel(entryId, 'feedback')
  sendToPanelDeferred(panelView, 'comfy-panel:open-feedback', { source })
}

ipcMain.on('comfy-window:click-feedback', (event) => {
  const found = findEntryByTitleBarSender(event.sender)
  if (!found) return
  triggerOpenFeedback(found.entry.windowKey, 'titlebar')
})

ipcMain.on('comfy-window:click-announcement', (event) => {
  const found = findEntryByTitleBarSender(event.sender)
  if (!found) return
  openAnnouncement(found.entry.windowKey)
})

ipcMain.on('comfy-window:new-chooser-window', () => {
  openChooserHostWindow()
})

ipcMain.handle('focus-comfy-window', (_event, installationId: string) => {
  recordIpcInvocation('focus-comfy-window', { installationId })
  const entry = getEntryByInstallationId(installationId)
  if (entry && !entry.window.isDestroyed()) {
    entry.window.show()
    entry.window.focus()
    return true
  }

  const proc = ipc.getSessionProcess(installationId)
  if (proc?.pid) {
    focusExternalProcessWindow(proc.pid)
    return true
  }

  return false
})

ipcMain.handle('open-install-window', (_event, installationId: string) => {
  recordIpcInvocation('open-install-window', { installationId })
  const existing = getEntryByInstallationId(installationId)
  if (existing && !existing.window.isDestroyed()) {
    existing.window.show()
    existing.window.focus()
    return true
  }
  openChooserHostWindow()
  return true
})

ipcMain.handle(
  'close-comfy-window',
  (_event, installationId: string, opts?: { skipConfirm?: boolean }) => {
    const entry = getEntryByInstallationId(installationId)
    if (!entry || entry.window.isDestroyed()) return false
    if (opts?.skipConfirm) preClearedClose.add(entry.window)
    entry.window.close()
    return true
  }
)

ipcMain.handle('close-host-window', (event) => {
  for (const [, entry] of comfyWindows) {
    if (entry.window.isDestroyed()) continue
    if (entry.panelView?.webContents === event.sender) {
      entry.window.close()
      return true
    }
  }
  return false
})

ipcMain.handle('return-to-dashboard', (event) => {
  for (const [, entry] of comfyWindows) {
    if (entry.window.isDestroyed()) continue
    if (!isInstallHost(entry)) continue
    if (entry.panelView?.webContents !== event.sender) continue
    entry.detachInstall()
    return true
  }
  return false
})

ipcMain.handle('claim-attach-host', (event, installationId: string) => {
  for (const [, entry] of comfyWindows) {
    if (entry.window.isDestroyed()) continue
    if (isInstallHost(entry)) continue
    if (entry.panelView?.webContents !== event.sender) continue
    claimAttachHost(installationId, entry.windowKey)
    void applyAttachHostPreview(entry, installationId)
    return true
  }
  return false
})

ipcMain.handle('release-attach-host-preview', (event) => {
  for (const [, entry] of comfyWindows) {
    if (entry.window.isDestroyed()) continue
    if (isInstallHost(entry)) continue
    if (entry.panelView?.webContents !== event.sender) continue
    dropAttachClaimsForWindow(entry.windowKey)
    clearAttachHostPreview(entry)
    return true
  }
  return false
})

ipcMain.handle('transfer-host-bounds-to-install', (event, installationId: string) => {
  for (const [, entry] of comfyWindows) {
    if (entry.window.isDestroyed()) continue
    if (isInstallHost(entry)) continue
    if (entry.panelView?.webContents !== event.sender) continue
    saveWindowBounds(installationId, entry.window)
    return true
  }
  return false
})

function findInstallationIdForWindow(win: BrowserWindow): string | undefined {
  for (const entry of comfyWindows.values()) {
    if (entry.window !== win) continue
    return entry.installationId ?? undefined
  }
  return undefined
}

const hostReentryGate = createStartupReentryGate()

if (app.isPackaged && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  if (process.platform === 'win32') startMachineIdLookup()
  const sacStateRead = readSmartAppControlState()

  if (app.isPackaged) {
    app.on('second-instance', () => {
      hostReentryGate.runOrQueue(() => openOrFocusAnyHostWindow())
    })
  }

  app.on('browser-window-created', (_event, window) => {
    window.on('query-session-end', () => {
      updater.suppressInstallOnQuit()
    })
    window.on('session-end', () => {
      setSessionEnding()
      updater.suppressInstallOnQuit()
    })
  })

  app.whenReady().then(async () => {
    initAppLog()
    registerProcessErrorHandlers()
    nativeTheme.themeSource = 'dark'
    pruneCrashDumps()
    console.info(
      `App started v${APP_VERSION} pid=${process.pid} platform=${process.platform} crashDumps=${app.getPath('crashDumps')}`
    )

    if (process.env['E2E'] === '1') {
      const { registerE2EHooks } = await import('./lib/e2eHooks')
      registerE2EHooks()
    }

    if (!app.isPackaged) {
      const { registerDevShortcuts } = await import('./lib/devShortcuts')
      registerDevShortcuts({ computeInstallUpdateAvailable })
    }

    setHostWindowFactories({
      consultPanelRendererClose,
      confirmCloseInstanceWindow,
      detachInstallImpl: _detachInstallImpl,
      preClearedClose,
      computeInstallUpdateAvailable
    })
    setAttachFactories({
      comfyFailRetryTimerCancels,
      comfyReloads,
      comfyZoomResets,
      relaunchStates,
      computeInstallUpdateAvailable
    })
    setHostFactories({ createChooser: openChooserHostWindow })
    registerPanelViewIpc()
    registerAppsIpc()
    registerOutputFolderHandlers()

    migrateXdgPaths()
    persistWinDataRootChoice()

    installAppMenu(process.platform, undefined, {
      onCheckForUpdates: () => {
        void updater.runCheck('app-menu').catch(() => {})
      }
    })

    if (process.platform !== 'darwin') {
      app.on('browser-window-created', (_event, window) => {
        window.setMenuBarVisibility(false)
        window.autoHideMenuBar = true
      })
    }

    const telemetrySetting = settings.get('telemetryEnabled') as boolean | undefined
    const initialConsent: mainTelemetry.ConsentState =
      telemetrySetting === true ? 'granted' : telemetrySetting === false ? 'denied' : 'undecided'
    let priorSessionUnclean = false
    try {
      priorSessionUnclean = takePriorSessionUnclean()
    } catch (err) {
      console.warn('[comfy-procs] startup scan failed:', err)
    }
    mainTelemetry.initTelemetry({
      appVersion: APP_VERSION,
      appEnv: app.isPackaged ? 'prod-v2' : 'dev',
      isPackaged: app.isPackaged,
      sessionStartProps: { prior_session_unclean: priorSessionUnclean }
    })
    mainTelemetry.setConsentState(initialConsent)
    mainTelemetry.installAppHooks()

    const existingInstallation = hasCompletedFirstLaunch() || hasPersistedDeviceId()
    const { legacyId } = await initDeviceId()
    clearLegacyIdentityRetryMarker()
    const installationId = getDeviceId()
    const sacState = await sacStateRead
    console.info('[sac-state] init: state=', sacState)
    mainTelemetry.setSmartAppControlState(sacState)
    const anonymousDistinctId = recoverPendingIdentityRotation(
      getInitialAnonymousDistinctId(existingInstallation)
    )

    mainTelemetry.bindAnonymousId(anonymousDistinctId, installationId, {
      app_version: APP_VERSION,
      platform: process.platform,
      arch: process.arch,
      id_class: getIdClass()
    })

    mainTelemetry.registerPersonProperties(settings.getTrackedSettingsTelemetryProperties())

    const isFirstLaunch = consumeFirstLaunch()
    if (legacyId) {
      markIdentityMigrationCompleted()
    }

    void initExperiments({
      distinctId: installationId,
      personProperties: {
        platform: process.platform,
        arch: process.arch,
        app_version: APP_VERSION,
        id_class: getIdClass()
      }
    })

    initStaffFlagTargeting({ onFlagPropertiesChange: () => void refreshCoreBetaFlags() })

    await initUserTier()

    void initCloudFreeRuns({ distinctId: installationId })

    void initCoreBetaFlags({
      distinctId: installationId,
      betaEnabled: settings.peekBetaFeaturesEnabled()
    }).then(prefetchEnrolledAgents)

    void initEmbeddedSessionFlag({ distinctId: installationId })

    const locale = (settings.get('language') as string | undefined) || app.getLocale().split('-')[0]
    i18n.init(locale)

    mainTelemetry.capture('comfy.desktop.app.language_resolved', {
      os_locale: app.getLocale(),
      selected_language: (settings.get('language') as string | undefined) || null,
      effective_language: i18n.getLocale()
    })

    if (isFirstLaunch) {
      mainTelemetry.captureFirstLaunch({
        id_class: getIdClass(),
        locale
      })
    }
    registerTitleTooltipIpc({
      findParentByTitleBarSender: (wc) => findEntryByTitleBarSender(wc)?.entry.window ?? null
    })
    registerTitleCoachmarkIpc({
      findParentByTitleBarSender: (wc) => findEntryByTitleBarSender(wc)?.entry.window ?? null,
      findTitleBarByParent: (parent) =>
        findEntryByHostWindow(parent)?.titleBarView.webContents ?? null
    })
    registerSystemModalIpc()

    const deliverPickToEntry = (entry: ComfyWindowEntry, installationId: string): void => {
      if (entry.window.isDestroyed()) return
      const panelView =
        entry.panelView ?? ensurePanelView(entry.windowKey, entry, computeBodyMode(entry))
      if (panelView.webContents.isDestroyed()) return
      sendToPanelDeferred(panelView, 'panel-trigger-overlay', {
        kind: 'picker-pick-install',
        installationId
      })
    }

    const openInstallInNewWindow = async (
      installationId: string,
      opts?: { allowDuplicate?: boolean }
    ): Promise<void> => {
      const existing = getEntryByInstallationId(installationId)
      const willFocusExisting =
        !!existing && !existing.window.isDestroyed() && !opts?.allowDuplicate
      recordIpcInvocation('open-install-new-window', {
        installationId,
        allowDuplicate: opts?.allowDuplicate === true,
        focusedExisting: willFocusExisting
      })
      if (willFocusExisting) {
        existing.window.show()
        existing.window.focus()
        return
      }
      try {
        const inst = await getInstallation(installationId)
        if (!inst) {
          console.error('openInstallInNewWindow: unknown installation, not spawning', {
            installationId
          })
          return
        }
        const target = findEntryByHostWindow(openChooserHostWindow())
        if (!target) {
          console.error('openInstallInNewWindow: spawned chooser host not in registry', {
            installationId
          })
          return
        }
        mainTelemetry.emit('comfy.desktop.instance.opened_new_window', {
          to_installation_id: installationId,
          method: 'picker'
        })
        deliverPickToEntry(target, installationId)
      } catch (err) {
        console.error('openInstallInNewWindow failed:', err)
      }
    }

    const pickInstallFromPicker = async (
      installationId: string,
      parentEntryId: number,
      opts?: { confirmed?: boolean }
    ): Promise<void> => {
      const existing = getEntryByInstallationId(installationId)
      if (existing && !existing.window.isDestroyed()) {
        existing.window.show()
        existing.window.focus()
        return
      }
      const parentEntry = comfyWindows.get(parentEntryId)
      if (!parentEntry || parentEntry.window.isDestroyed()) return

      if (parentEntry.installationId === installationId) return

      if (parentEntry.installationId != null) {
        if (!opts?.confirmed && shouldConfirmKillForEntry(parentEntry)) {
          let targetName = installationId
          try {
            const target = await getInstallation(installationId)
            if (target?.name) targetName = target.name
          } catch {}
          const choice = await openSystemModalChoiceAsync({
            parent: parentEntry.window,
            spec: {
              title: 'Switch instance?',
              message: `Switch to ${targetName}?`,
              details: [
                {
                  label: 'Heads up',
                  items: [
                    'Switch stops the current instance and replaces it in this window.',
                    'Open in new window keeps the current instance running.'
                  ]
                }
              ],
              confirmLabel: 'Switch',
              secondaryLabel: 'Open in new window',
              cancelLabel: 'Cancel',
              confirmStyle: 'primary',
              theme: parentEntry.lastTheme
            }
          })
          if (choice === 'cancel') return
          if (choice === 'secondary') {
            openInstallInNewWindow(installationId)
            return
          }
        }
        mainTelemetry.emit('comfy.desktop.instance.switched', {
          from_installation_id: parentEntry.installationId,
          to_installation_id: installationId,
          method: 'picker'
        })
        parentEntry.detachInstall()
      }

      deliverPickToEntry(parentEntry, installationId)
    }

    registerTitlePopupIpc({
      openChooserHostWindow,
      returnToDashboard,
      confirmAndCloseAllHostWindows: (parentWindow) =>
        confirmAndCloseAllHostWindows(parentWindow, quitApp),
      confirmAndCloseHostWindow,
      setActivePanel,
      triggerOpenFeedback,
      resetComfyZoom: (installationId) => comfyZoomResets.get(installationId)?.('menu'),
      sendToPanelDeferred,
      ensurePanelViewForEntry: (entry) =>
        entry.panelView ?? ensurePanelView(entry.windowKey, entry, computeBodyMode(entry)),
      pickerRunBackgroundOp: ({ installationId, actionId, actionData, title, cancellable }) => {
        void (async () => {
          const inst = await getInstallation(installationId)
          if (!inst) {
            _activeOperationStatus.set(installationId, {
              status: '',
              percent: -1,
              done: true,
              ok: false,
              error: 'Installation not found.',
              cancellable,
              title,
              actionId,
              actionData
            })
            triggerPickerSnapshotBroadcast()
            return
          }

          if (_operationAborts.has(installationId)) {
            const activeOperation = _activeOperationStatus.get(installationId)
            if (activeOperation && !activeOperation.done) return

            _activeOperationStatus.set(installationId, {
              status: '',
              percent: -1,
              done: true,
              ok: false,
              error: 'Another operation is already running.',
              cancellable,
              title,
              actionId,
              actionData
            })
            triggerPickerSnapshotBroadcast()
            return
          }

          const opStartMs = Date.now()
          mainTelemetry.capture('comfy.desktop.action.invoked', {
            action_id: actionId,
            installation_id: installationId,
            source: 'picker'
          })
          const emitPickerOpResult = (
            opResult: 'success' | 'failed' | 'cancelled_user',
            errorMessage?: string | null
          ): void => {
            mainTelemetry.emit('comfy.desktop.op.result', {
              installation_id: installationId,
              action_id: actionId,
              source: 'picker',
              result: opResult,
              duration_ms: Date.now() - opStartMs,
              ...(opResult === 'failed' && errorMessage
                ? { error_bucket: mainTelemetry.bucketError(errorMessage) }
                : {})
            })
          }

          const wasRunning = _runningSessions.has(installationId)
          if (REQUIRES_STOPPED.has(actionId) && wasRunning) {
            _activeOperationStatus.set(installationId, {
              status: 'Stopping…',
              percent: -1,
              done: false,
              ok: null,
              error: null,
              cancellable,
              title,
              actionId,
              actionData
            })
            triggerPickerSnapshotBroadcast()
            try {
              await stopRunning(installationId)
            } catch (err) {
              _activeOperationStatus.set(installationId, {
                status: '',
                percent: -1,
                done: true,
                ok: false,
                error: (err as Error).message ?? 'Stop failed.',
                cancellable,
                title,
                actionId,
                actionData
              })
              triggerPickerSnapshotBroadcast()
              emitPickerOpResult('failed', (err as Error).message ?? 'Stop failed.')
              return
            }
          }

          _activeOperationStatus.set(installationId, {
            status: '',
            percent: -1,
            done: false,
            ok: null,
            error: null,
            cancellable,
            title,
            actionId,
            actionData
          })
          triggerPickerSnapshotBroadcast()

          const feedStatus = (channel: string, payload: Record<string, unknown>): void => {
            if (channel !== 'install-progress') return
            const cur = _activeOperationStatus.get(installationId)
            if (!cur || cur.done) return
            const status =
              typeof payload.status === 'string'
                ? payload.status
                : typeof payload.phase === 'string'
                  ? payload.phase
                  : cur.status
            const percent = typeof payload.percent === 'number' ? payload.percent : cur.percent
            const speedBytesPerSec =
              typeof payload.speedBytesPerSec === 'number'
                ? payload.speedBytesPerSec
                : cur.speedBytesPerSec
            _activeOperationStatus.set(installationId, {
              ...cur,
              status,
              percent,
              speedBytesPerSec
            })
            triggerPickerSnapshotBroadcast()
          }
          const stubSender = {
            isDestroyed: () => false,
            send: feedStatus as unknown as Electron.WebContents['send']
          } as unknown as Electron.WebContents
          const stubEvent = { sender: stubSender } as unknown as Electron.IpcMainInvokeEvent

          let result: PickerOperationStatus
          try {
            const actionResult = await dispatchSessionAction(
              { event: stubEvent, installationId, inst, actionData },
              actionId
            )
            const wantsRelaunch = wasRunning && IN_PLACE_RELAUNCH.has(actionId)
            if (actionResult.ok && wantsRelaunch) {
              const freshInst = (await getInstallation(installationId)) ?? inst
              await handleLaunch({
                event: stubEvent,
                installationId,
                inst: freshInst,
                actionData: undefined
              })
            }
            const wasCancelled = actionResult.cancelled === true
            result = {
              status: '',
              percent: wasCancelled ? -1 : 100,
              done: true,
              ok: !wasCancelled && actionResult.ok !== false,
              error: wasCancelled
                ? MSG_CANCELLED
                : actionResult.ok === false
                  ? (actionResult.message ?? 'Failed.')
                  : null,
              cancellable,
              title,
              actionId,
              actionData
            }
            if (wasCancelled) {
              emitPickerOpResult('cancelled_user')
            } else if (actionResult.ok !== false) {
              emitPickerOpResult('success')
            } else {
              emitPickerOpResult('failed', actionResult.message ?? 'Failed.')
            }
          } catch (err) {
            const abort = _operationAborts.get(installationId)
            result = {
              status: '',
              percent: -1,
              done: true,
              ok: false,
              error: abort?.signal.aborted ? MSG_CANCELLED : ((err as Error).message ?? 'Failed.'),
              cancellable,
              title,
              actionId,
              actionData
            }
            if (abort?.signal.aborted) {
              emitPickerOpResult('cancelled_user')
            } else {
              emitPickerOpResult('failed', (err as Error).message ?? 'Failed.')
            }
          }
          _activeOperationStatus.set(installationId, result)
          triggerPickerSnapshotBroadcast()
          setTimeout(() => {
            const cur = _activeOperationStatus.get(installationId)
            if (cur?.done && cur.ok) {
              _activeOperationStatus.delete(installationId)
              triggerPickerSnapshotBroadcast()
            }
          }, 15_000)
        })()
      },
      broadcastPickerSnapshot: () => triggerPickerSnapshotBroadcast(),
      getInstancePickerInstalls: async () => {
        const all = await listInstallations()
        const { enriched } = enrichInstallationsForRenderer(all)
        return enriched as unknown as InstancePickerInstall[]
      },
      getRunningInstallationIds: () => Array.from(_runningSessions.keys()),
      getRunningSessionStartedAt: () =>
        Object.fromEntries(Array.from(_runningSessions, ([id, s]) => [id, s.startedAt])),
      getLaunchingInstallationIds: () => _getLaunchingInstallationIds(),
      getPickerDetailsForInstall: async (installationId) => {
        const inst = await getInstallation(installationId)
        if (!inst) return { settings: null, snapshots: null }
        const source = sourceMap[inst.sourceId]
        const settings = source
          ? (source.getDetailSections(inst) as Record<string, unknown>[])
          : null
        let snapshots: Record<string, unknown> | null = null
        if (inst.installPath) {
          try {
            const data = await getSnapshotListData(inst.installPath)
            snapshots = { ...data, copyEvents: [] }
          } catch (err) {
            console.error(`Picker: snapshot read failed for ${installationId}:`, err)
            snapshots = null
          }
        }
        return { settings, snapshots }
      },
      pickerUpdateField: async (installationId, fieldId, value) => {
        const inst = await getInstallation(installationId)
        if (!inst) return { ok: false, message: 'Installation not found.' }
        const source = sourceMap[inst.sourceId]
        if (!source) return { ok: false, message: 'Unknown source.' }
        const sections = source.getDetailSections(inst) as Record<string, unknown>[]
        const allowed = new Set<string>(['name', 'seen'])
        for (const section of sections) {
          const fields = section.fields as Record<string, unknown>[] | undefined
          if (!fields) continue
          for (const f of fields) {
            if (f.editable && typeof f.id === 'string') allowed.add(f.id)
          }
        }
        if (!allowed.has(fieldId)) {
          return { ok: false, message: `Field '${fieldId}' is not editable.` }
        }
        try {
          await updateInstallation(installationId, { [fieldId]: value })
          if (fieldId === 'updateChannel') {
            const next = await getInstallation(installationId)
            if (next) {
              const abort = new AbortController()
              source
                .handleAction('check-update', next, undefined, {
                  update: (data) => updateInstallation(installationId, data).then(() => {}),
                  sendProgress: () => {},
                  sendOutput: () => {},
                  signal: abort.signal
                })
                .catch((err) => {
                  console.error(
                    `Picker: check-update after channel switch failed for ${installationId}:`,
                    err
                  )
                })
            }
          }
          return { ok: true }
        } catch (err) {
          return { ok: false, message: err instanceof Error ? err.message : 'Update failed.' }
        }
      },
      pickerRunAction: async (installationId, actionId, actionData) => {
        try {
          const inst = await getInstallation(installationId)
          if (!inst) return { ok: false, message: 'Installation not found.' }
          const source = sourceMap[inst.sourceId]
          if (!source) return { ok: false, message: 'Unknown source.' }
          const abort = new AbortController()
          const result = await source.handleAction(actionId, inst, actionData, {
            update: (data) => updateInstallation(installationId, data).then(() => {}),
            sendProgress: () => {},
            sendOutput: () => {},
            signal: abort.signal
          })
          return {
            ok: result.ok !== false,
            message: typeof result.message === 'string' ? result.message : undefined
          }
        } catch (err) {
          return { ok: false, message: err instanceof Error ? err.message : 'Action failed.' }
        }
      },
      pickInstallFromPicker,
      openInstallInNewWindow,
      restartInstallFromPicker: async (installationId, parentEntryId, opts) => {
        const parentEntry = comfyWindows.get(parentEntryId)
        if (!parentEntry || parentEntry.window.isDestroyed()) return
        const boundInstallationId = parentEntry.installationId ?? parentEntry.previewInstallationId
        if (boundInstallationId !== installationId) return
        if (opts?.confirmed !== true && shouldConfirmKillForEntry(parentEntry)) {
          const confirmed = await openSystemModalAsync({
            parent: parentEntry.window,
            spec: {
              title: 'Restart instance?',
              message: 'Restart this instance?',
              details: [
                {
                  label: 'Heads up',
                  items: [
                    'Restarting will stop the running session.',
                    'Any unsaved work in the workflow will be lost.'
                  ]
                }
              ],
              confirmLabel: 'Restart',
              cancelLabel: 'Cancel',
              confirmStyle: 'primary',
              theme: parentEntry.lastTheme
            }
          })
          if (!confirmed) return
        }
        try {
          const cancelled = await ipc.cancelLaunching(installationId)
          recordIpcInvocation('picker-restart:cancel-launching', { installationId, cancelled })
          await ipc.stopRunning(installationId)
        } catch (err) {
          console.error(`Picker restart: stop failed for ${installationId}:`, err)
          return
        }
        if (!parentEntry || parentEntry.window.isDestroyed()) return
        const panelView =
          parentEntry.panelView ??
          ensurePanelView(parentEntryId, parentEntry, computeBodyMode(parentEntry))
        if (panelView.webContents.isDestroyed()) return
        sendToPanelDeferred(panelView, 'panel-trigger-overlay', {
          kind: 'picker-pick-install',
          installationId,
          isRestart: true
        })
      }
    })
    registerPickerSettingsIpc({ quitForRelaunch: quitApp })
    registerDownloadHandlers()
    registerAssetDownloadHandlers({ findInstallationIdForWindow })
    registerTemplateInputAssetHandlers({
      findInstallationIdForWindow,
      isLocalInstallation: (installation) => sourceMap[installation.sourceId]?.category === 'local'
    })
    cleanupTempDownloads()
    await ipc.register({
      onLaunch,
      onStop,
      onComfyExited,
      onInstanceStarted: (info) => {
        void emitInstanceStartedTelemetry(info)
        void emitStorageTelemetry(info.installationId)
      },
      onComfyRestarted,
      onModelFolderRelaunch,
      onLocaleChanged: updateTrayMenu,
      onThemeChanged: applyChooserHostThemeToAll
    })
    initializeModelDownloads().catch((err) => {
      console.warn('Model download startup pass failed at app startup:', err)
    })
    updater.register()
    updater.onUpdateStateChanged(_broadcastAppUpdateStateToTitleBars)
    downloadEvents.on('tray-state-changed', _broadcastDownloadsToTitleBars)
    const updateSplash = updater.hasPendingStartupUpdate() ? showUpdateInstallSplash() : undefined
    let updateInstallQuitStarted = false
    const onUpdateInstallQuit = (): void => {
      updateInstallQuitStarted = true
    }
    app.once('before-quit', onUpdateInstallQuit)
    let installingUpdate = false
    try {
      installingUpdate = await updater.applyPendingUpdateOnStartup(
        updateSplash ? { onInstallCommitted: () => updateSplash.showInstallCountdown() } : undefined
      )
    } catch (err) {
      console.error('applyPendingUpdateOnStartup failed:', err)
    }
    const openSurfaceAndDismissSplash = async (): Promise<void> => {
      try {
        await openStartupSurface()
      } catch (err) {
        console.error('openStartupSurface failed after update splash:', err)
      } finally {
        const otherWindowExists = BrowserWindow.getAllWindows().some(
          (w) => w !== updateSplash?.window && !w.isDestroyed()
        )
        if (updateSplash && !updateSplash.window.isDestroyed() && otherWindowExists) {
          updateSplash.window.destroy()
        }
      }
    }
    if (installingUpdate) {
      setTimeout(() => {
        if (updateInstallQuitStarted) return
        app.removeListener('before-quit', onUpdateInstallQuit)
        clearQuitReason()
        updater.recordStartupInstallBackstopRecovered()
        void openSurfaceAndDismissSplash().then(() => {
          hostReentryGate.open()
        })
      }, STARTUP_INSTALL_QUIT_BACKSTOP_MS)
    } else {
      app.removeListener('before-quit', onUpdateInstallQuit)
      if (updateSplash) {
        await openSurfaceAndDismissSplash()
      } else {
        void openStartupSurface()
      }
      hostReentryGate.open()
    }

    installationEvents.on('changed', () => {
      _broadcastToRenderer('installations-changed', {})
    })

    installationEvents.on('changed', () => {
      void (async () => {
        const liveIds = new Set((await listInstallations()).map((i) => i.id))
        detachOrphanedInstallHosts(liveIds)
      })()
    })

    const _periodicIntervalMs = process.env['E2E_PERIODIC_RECHECK_MS']
      ? Number(process.env['E2E_PERIODIC_RECHECK_MS'])
      : undefined
    _stopPeriodicReleaseChecks = startPeriodicReleaseChecks(listInstallations, {
      onRefreshed: () => _broadcastToRenderer('installations-changed', {}),
      ...(typeof _periodicIntervalMs === 'number' && Number.isFinite(_periodicIntervalMs)
        ? { intervalMs: _periodicIntervalMs }
        : {})
    })
  })

  app.on('activate', () => {
    hostReentryGate.runOrQueue(() => {
      if (process.platform === 'darwin') {
        raiseAllHostWindows()
      } else {
        openOrFocusAnyHostWindow()
      }
    })
  })

  app.on('before-quit', (event) => {
    if (!isQuitInProgress() && hasActiveTemplateDownloads()) {
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        buttons: [i18n.t('templateQuit.quit'), i18n.t('templateQuit.cancel')],
        defaultId: 1,
        cancelId: 1,
        title: i18n.t('templateQuit.title'),
        message: i18n.t('templateQuit.message')
      })
      if (choice === 1) {
        event.preventDefault()
        return
      }
    }
    if (!isQuitInProgress()) {
      setQuitReason('user-quit')
      ipc.cancelAll()
      for (const [, entry] of comfyWindows) {
        if (!entry.window.isDestroyed()) entry.window.destroy()
      }
      comfyWindows.clear()
      closeAllPopouts()
      disposeAllTerminals()
      if (tray) {
        tray.destroy()
        tray = null
      }
    }
    updater.recordProcessExit()
    if (_stopPeriodicReleaseChecks) {
      _stopPeriodicReleaseChecks()
      _stopPeriodicReleaseChecks = null
    }
    flushLastSessionSync()
    flushOperationOutput()
    cleanupTempDownloads()
    stopAgentPrefetches()
  })

  let modelDownloadsSuspended = false
  app.on('will-quit', (event) => {
    if (modelDownloadsSuspended || !hasActiveModelTransfers()) return
    modelDownloadsSuspended = true
    event.preventDefault()
    void suspendActiveModelDownloadsForQuit().finally(() => app.quit())
  })

  powerMonitor.on('suspend', () => {
    suspendActiveModelDownloadsForSleep()
  })
  powerMonitor.on('resume', () => {
    void resumeModelDownloadsAfterWake()
  })

  app.on('window-all-closed', () => {
    if (!ipc.hasRunningSessions()) {
      app.quit()
    }
  })
}
