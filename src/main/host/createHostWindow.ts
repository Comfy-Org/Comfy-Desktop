import { BrowserWindow, WebContentsView, ipcMain, shell } from 'electron'
import path from 'path'
import type { DatadogForwardedError } from '../../types/ipc'
import type { InstallationRecord } from '../installations'
import { getAppVersion } from '../lib/ipc'
import { attachContextMenu } from '../lib/contextMenu'
import {
  attachSessionDownloadHandler,
  detachWindowDownloads,
  getDownloadsTrayState
} from '../lib/comfyDownloadManager'
import {
  handleFirebasePopup,
  isFirebaseAuthHandlerUrl,
  type SignInFailureContext
} from '../auth/firebaseBridge'
import {
  isCheckoutReturnUrl,
  isCheckoutUrl,
  isLikelyDownloadUrl,
  shouldOpenInPopup
} from '../lib/allowedPopups'
import { COMFY_BG, TITLEBAR_BG } from '../lib/theme'
import { standaloneWindowStyles } from '../lib/standaloneStyles'
import {
  TITLEBAR_HEIGHT,
  TRAFFIC_LIGHT_POSITION,
  titleBarOverlayForTheme
} from '../lib/titleBarOverlay'
import {
  _registerExtraBroadcastTarget,
  _unregisterExtraBroadcastTarget,
  resolveTheme
} from '../lib/ipc/shared'
import * as mainTelemetry from '../lib/telemetry'
import { getUserTier } from '../lib/userTier'
import { trackFirebaseAuthReporter } from '../lib/firebaseAuthIdentity'
import { forwardDatadogError } from '../lib/processErrorHandlers'
import { recordDashboardSurface, recordInstanceSurface } from '../lib/lastSession'
import * as settings from '../settings'
import * as updater from '../lib/updater'
import { getSavedBounds, getWindowOptions, saveWindowBounds } from '../lib/windowState'
import { ensureSystemModal } from '../popups/systemModal'
import { hideCheckoutBackdrop, showCheckoutBackdrop } from '../popups/checkoutBackdrop'
import { hideTitlePopupForParent, prewarmTitlePopup } from '../popups/titlePopup'
import { destroyPanelView, ensurePanelView } from './panelView'
import { expectedPartitionFor } from './partition'
import {
  comfyWindows,
  computeBodyMode,
  dropAttachClaimsForWindow,
  hasRunningSessionForEntry,
  isChooserHost,
  isInstallHost,
  nextWindowKey,
  registerHostEntry,
  revealColdStartHostIfPending,
  setLastFocusedInstallationId,
  shouldConfirmKillForEntry,
  unregisterHostEntry
} from './registry'
import type { ComfyWindowEntry, ComfyPanelKey } from './registry'

const DEFAULT_HOST_WIDTH = 1280
const DEFAULT_HOST_HEIGHT = 900

export type CloseConsultResult = 'cleared' | 'aborted' | 'defer'

export type CloseWindowChoice = 'close' | 'cancel'

export function buildFirebaseAuthForwardedError(
  failure: SignInFailureContext
): DatadogForwardedError {
  const source =
    failure.flow === 'desktop_login_code'
      ? 'firebase-desktop-login-code-failed'
      : 'firebase-loopback-bridge-failed'
  return {
    source,
    message: 'Firebase sign-in failed',
    level: 'warn',
    context: { origin: 'main-process', ...failure }
  }
}

export function shouldBailAfterConsult(consult: CloseConsultResult, forceClose: boolean): boolean {
  return consult === 'aborted' && !forceClose
}

export function installCloseNeedsConfirm(
  confirmEnabled: boolean,
  killsLocalSession: boolean,
  isLastInstallWindow: boolean
): boolean {
  return confirmEnabled && (killsLocalSession || isLastInstallWindow)
}

export function shouldShowInstallCloseConfirm(
  confirmEnabled: boolean,
  consult: CloseConsultResult,
  killsLocalSession: boolean,
  forceClose: boolean,
  isLastInstallWindow: boolean
): boolean {
  return (
    installCloseNeedsConfirm(confirmEnabled, killsLocalSession, isLastInstallWindow) &&
    consult === 'defer' &&
    !forceClose
  )
}

export function shouldBailAfterCloseChoice(
  choice: CloseWindowChoice,
  forceClose: boolean
): boolean {
  return choice === 'cancel' && !forceClose
}

const APP_ICON = path.join(__dirname, '..', '..', 'assets', 'Comfy_Logo_x256.png')
const APP_VERSION = getAppVersion()

export const CHOOSER_HOST_TITLE_TEXT = 'Comfy Desktop'
export const CHOOSER_HOST_WINDOW_TITLE = `${CHOOSER_HOST_TITLE_TEXT} — v${APP_VERSION}`

const CHOOSER_HOST_BOUNDS_KEY = 'chooser'

export interface HostWindowFactories {
  consultPanelRendererClose: (
    panelView: WebContentsView | null | undefined
  ) => Promise<'cleared' | 'aborted' | 'defer'>
  confirmCloseInstanceWindow: (
    window: BrowserWindow,
    isLastWindow: boolean,
    stopsLocalComfy: boolean,
    theme: { bg: string; text: string }
  ) => Promise<CloseWindowChoice>
  detachInstallImpl: (entry: ComfyWindowEntry) => void
  preClearedClose: WeakSet<BrowserWindow>
  computeInstallUpdateAvailable: (
    installationId: string
  ) => Promise<{ available: boolean; version?: string }>
}

let factories: HostWindowFactories | null = null

export function setHostWindowFactories(opts: HostWindowFactories): void {
  factories = opts
}

function getFactories(): HostWindowFactories {
  if (!factories) {
    throw new Error('setHostWindowFactories must be called before host construction')
  }
  return factories
}

const PASSKEY_BANNER_PREFIXES = ['https://accounts.google.com/', 'https://github.com/login']

const PASSKEY_BANNER_CSS =
  `#comfy-passkey-banner{position:fixed;top:0;left:0;right:0;z-index:999999;` +
  `background:#eff6ff;color:#1e40af;font:13px/1.4 system-ui,sans-serif;` +
  `padding:8px 12px;text-align:center;border-bottom:1px solid #93c5fd;box-sizing:border-box;}`

const PASSKEY_BANNER_JS =
  `(function(){` +
  `if(document.getElementById('comfy-passkey-banner'))return;` +
  `const b=document.createElement('div');b.id='comfy-passkey-banner';` +
  `b.textContent='\\u24d8 Passkeys are not supported in Comfy Desktop on macOS. Please use your password or verification code to sign in.';` +
  `document.body.prepend(b);` +
  `document.body.style.paddingTop=(b.offsetHeight)+'px';` +
  `new MutationObserver(function(){` +
  `if(!document.getElementById('comfy-passkey-banner')){` +
  `document.body.prepend(b);document.body.style.paddingTop=(b.offsetHeight)+'px'` +
  `}` +
  `}).observe(document.body,{childList:true});` +
  `})()`

function injectMacPasskeyWarning(childWindow: BrowserWindow): void {
  if (process.platform !== 'darwin') return

  const inject = (): void => {
    const url = childWindow.webContents.getURL()
    if (!PASSKEY_BANNER_PREFIXES.some((prefix) => url.startsWith(prefix))) return
    childWindow.webContents
      .insertCSS(PASSKEY_BANNER_CSS)
      .then(() => childWindow.webContents.executeJavaScript(PASSKEY_BANNER_JS))
      .catch(() => {})
  }

  childWindow.webContents.on('dom-ready', inject)
  childWindow.webContents.on('did-navigate-in-page', inject)
}

const CHECKOUT_RELOAD_TIMEOUT_MS = 4000

function wireCheckoutPopup(
  childWindow: BrowserWindow,
  parent: BrowserWindow,
  hostContents: Electron.WebContents,
  openedAt: number
): void {
  const close = (): void => {
    if (!childWindow.isDestroyed()) childWindow.close()
  }
  let returning = false

  childWindow.once('ready-to-show', () => {
    childWindow.show()
    showCheckoutBackdrop(parent, close)
    attachCheckoutCloseButton(childWindow, close)
  })
  childWindow.once('closed', () => hideCheckoutBackdrop(parent))

  childWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') close()
  })

  const closeOnReturn = (_e: Electron.Event, targetUrl: string): void => {
    if (returning || childWindow.isDestroyed() || !isCheckoutReturnUrl(targetUrl)) return
    returning = true
    mainTelemetry.capture('comfy.desktop.billing.checkout_returned', {
      duration_ms: Date.now() - openedAt,
      user_tier: getUserTier()
    })
    if (hostContents.isDestroyed()) {
      close()
      return
    }
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      close()
    }
    hostContents.once('did-stop-loading', finish)
    setTimeout(finish, CHECKOUT_RELOAD_TIMEOUT_MS)
    hostContents.reload()
  }

  childWindow.webContents.on('will-redirect', closeOnReturn)
  childWindow.webContents.on('did-navigate', closeOnReturn)
}

const CHECKOUT_CLOSE_BUTTON_HTML = `<!doctype html>
<html class="pointer-events-none m-0 h-full w-full overflow-hidden bg-transparent"><head><meta charset="utf-8"><style>${standaloneWindowStyles}</style></head>
<body class="pointer-events-none m-0 h-full w-full overflow-hidden bg-transparent">
<button id="x" class="pointer-events-auto fixed top-2.5 right-2.5 grid size-7 cursor-pointer place-items-center rounded-lg border-0 border-none border-current bg-[rgba(0,0,0,0.06)] text-[rgba(0,0,0,0.55)] [font:16px/1_system-ui] hover:bg-[rgba(0,0,0,0.12)] hover:text-[rgba(0,0,0,0.85)]" aria-label="Close">✕</button>
<script>
  const { ipcRenderer } = require('electron');
  document.getElementById('x').addEventListener('click', () => ipcRenderer.send('comfy-checkout:close'));
</script>
</body></html>`

const CHECKOUT_CLOSE_BUTTON_SIZE = 48

function attachCheckoutCloseButton(childWindow: BrowserWindow, onClose: () => void): void {
  const overlay = new WebContentsView({
    webPreferences: { contextIsolation: false, nodeIntegration: true, sandbox: false }
  })
  overlay.setBackgroundColor('#00000000')
  childWindow.contentView.addChildView(overlay)
  const place = (): void => {
    if (childWindow.isDestroyed()) return
    const { width } = childWindow.getContentBounds()
    overlay.setBounds({
      x: Math.max(0, width - CHECKOUT_CLOSE_BUTTON_SIZE),
      y: 0,
      width: CHECKOUT_CLOSE_BUTTON_SIZE,
      height: CHECKOUT_CLOSE_BUTTON_SIZE
    })
  }
  place()
  childWindow.on('resize', place)
  void overlay.webContents
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(CHECKOUT_CLOSE_BUTTON_HTML)}`)
    .catch(() => {})

  const closeId = overlay.webContents.id
  const handler = (event: Electron.IpcMainEvent): void => {
    if (event.sender.id === closeId) onClose()
  }
  ipcMain.on('comfy-checkout:close', handler)
  childWindow.once('closed', () => ipcMain.removeListener('comfy-checkout:close', handler))
}

export interface CreateHostWindowOpts {
  windowTitle: string
  boundsKey: string
  initialTheme: { bg: string; text: string }
  titleBarOverlay: Electron.TitleBarOverlay | undefined
  comfyWebPreferences: Electron.WebPreferences
  titleBarBackground: string
  titleBarInstallationIdParam: string
  initialTitleBarText: string
  initialSourceCategory: string | null
  initiallyHidden?: boolean
}

export interface CreateHostWindowResult {
  windowKey: number
  comfyWindow: BrowserWindow
  titleBarView: WebContentsView
  comfyView: WebContentsView
  entry: ComfyWindowEntry
  layoutViews: () => void
}

const CASCADE_STEP_PX = 30

export function cascadeOffsetForCollisions(
  windowOptions: Partial<Electron.BrowserWindowConstructorOptions>,
  existingOrigins: ReadonlyArray<{ x: number; y: number }>
): Partial<Electron.BrowserWindowConstructorOptions> {
  if (typeof windowOptions.x !== 'number' || typeof windowOptions.y !== 'number') {
    return windowOptions
  }
  let { x, y } = windowOptions
  let bumped = true
  while (bumped) {
    bumped = false
    for (const origin of existingOrigins) {
      if (origin.x === x && origin.y === y) {
        x += CASCADE_STEP_PX
        y += CASCADE_STEP_PX
        bumped = true
        break
      }
    }
  }
  return { ...windowOptions, x, y }
}

function liveHostOrigins(): { x: number; y: number }[] {
  const origins: { x: number; y: number }[] = []
  for (const [, entry] of comfyWindows) {
    if (entry.window.isDestroyed()) continue
    const { x, y } = entry.window.getBounds()
    origins.push({ x, y })
  }
  return origins
}

function liveBoundsKeyFor(entry: ComfyWindowEntry): string {
  return entry.installationId ?? CHOOSER_HOST_BOUNDS_KEY
}

function findLiveSiblingOrigin(boundsKey: string): { x: number; y: number } | null {
  for (const [, entry] of comfyWindows) {
    if (entry.window.isDestroyed()) continue
    if (liveBoundsKeyFor(entry) !== boundsKey) continue
    const { x, y } = entry.window.getBounds()
    return { x, y }
  }
  return null
}

export function isWindowLayoutable(
  win: Pick<BrowserWindow, 'isDestroyed' | 'isMinimized'>
): boolean {
  return !win.isDestroyed() && !win.isMinimized()
}

export function createHostWindow(opts: CreateHostWindowOpts): CreateHostWindowResult {
  const fx = getFactories()
  const windowKey = nextWindowKey()
  const isChooserKey = opts.boundsKey === CHOOSER_HOST_BOUNDS_KEY
  const saved = isChooserKey ? undefined : getSavedBounds(opts.boundsKey)
  const sibling = findLiveSiblingOrigin(opts.boundsKey)
  const initialOptions = sibling
    ? { x: sibling.x, y: sibling.y, width: DEFAULT_HOST_WIDTH, height: DEFAULT_HOST_HEIGHT }
    : isChooserKey
      ? { width: DEFAULT_HOST_WIDTH, height: DEFAULT_HOST_HEIGHT }
      : getWindowOptions(opts.boundsKey)
  const windowOptions = cascadeOffsetForCollisions(initialOptions, liveHostOrigins())
  const comfyWindow = new BrowserWindow({
    ...windowOptions,
    show: !opts.initiallyHidden,
    minWidth: 800,
    minHeight: 600,
    icon: APP_ICON,
    title: opts.windowTitle,
    backgroundColor: COMFY_BG,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: TRAFFIC_LIGHT_POSITION }
      : { titleBarOverlay: opts.titleBarOverlay }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  comfyWindow.setMenuBarVisibility(false)

  prewarmTitlePopup(comfyWindow)

  const titleBarView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, '../preload/comfyTitleBarPreload.js')
    }
  })
  titleBarView.setBackgroundColor(opts.titleBarBackground)
  loadTitleBarUrl(titleBarView, opts.titleBarInstallationIdParam)
  comfyWindow.contentView.addChildView(titleBarView)
  attachContextMenu(comfyWindow, titleBarView.webContents)
  _registerExtraBroadcastTarget(titleBarView.webContents)
  mainTelemetry.registerTelemetryRelayTarget(titleBarView.webContents)

  const comfyView = buildComfyView(comfyWindow, opts.comfyWebPreferences, windowKey)
  comfyWindow.contentView.addChildView(comfyView)

  const titleBarTotal = TITLEBAR_HEIGHT + 1
  const layoutViews = (): void => {
    if (!isWindowLayoutable(comfyWindow)) return
    const entry = comfyWindows.get(windowKey)
    const [width, height] = comfyWindow.getContentSize() as [number, number]
    const bodyHeight = Math.max(0, height - titleBarTotal)
    const bodyRect = { x: 0, y: titleBarTotal, width, height: bodyHeight }
    titleBarView.setBounds({ x: 0, y: 0, width, height: titleBarTotal })

    const activeComfyView = entry?.comfyView ?? comfyView

    const mode = entry ? computeBodyMode(entry) : 'comfy'
    const isOverlayMode = mode === 'feedback' || mode === 'announcement'
    const showPanel = mode !== 'comfy' && !(isOverlayMode && entry?.pendingOverlayReveal)
    if (showPanel && entry?.panelView) {
      entry.panelView.setBounds(bodyRect)
      entry.panelView.setVisible(true)
      if (isOverlayMode) {
        activeComfyView.setBounds(bodyRect)
        activeComfyView.setVisible(true)
      } else {
        activeComfyView.setBounds({ x: 0, y: titleBarTotal, width: 0, height: 0 })
        activeComfyView.setVisible(false)
      }
    } else {
      activeComfyView.setBounds(bodyRect)
      activeComfyView.setVisible(true)
      if (entry?.panelView) {
        entry.panelView.setBounds({ x: 0, y: titleBarTotal, width: 0, height: 0 })
        entry.panelView.setVisible(false)
      }
    }
  }
  comfyWindow.on('resize', layoutViews)

  let delayedRelayoutTimer: ReturnType<typeof setTimeout> | null = null
  const relayoutWhenVisible = (): void => {
    setImmediate(() => {
      if (!isWindowLayoutable(comfyWindow)) return
      layoutViews()
    })
    if (delayedRelayoutTimer) clearTimeout(delayedRelayoutTimer)
    delayedRelayoutTimer = setTimeout(() => {
      delayedRelayoutTimer = null
      if (!isWindowLayoutable(comfyWindow)) return
      layoutViews()
    }, 50)
  }
  comfyWindow.on('restore', relayoutWhenVisible)
  comfyWindow.on('show', relayoutWhenVisible)
  comfyWindow.on('closed', () => {
    if (delayedRelayoutTimer) clearTimeout(delayedRelayoutTimer)
  })

  if (saved?.maximized) comfyWindow.maximize()

  if (process.platform === 'darwin') {
    const sendFullscreen = (fullscreen: boolean): void => {
      if (titleBarView.webContents.isDestroyed()) return
      titleBarView.webContents.send('comfy-titlebar:fullscreen-changed', fullscreen)
    }
    comfyWindow.on('enter-full-screen', () => sendFullscreen(true))
    comfyWindow.on('leave-full-screen', () => sendFullscreen(false))
  }

  const persistBounds = (): void => {
    const live = comfyWindows.get(windowKey)
    if (!live || isChooserHost(live)) return
    if (!isWindowLayoutable(comfyWindow)) return
    saveWindowBounds(liveBoundsKeyFor(live), comfyWindow)
  }
  comfyWindow.on('resize', persistBounds)
  comfyWindow.on('move', persistBounds)

  comfyWindow.on('focus', () => {
    const entry = comfyWindows.get(windowKey)
    if (entry?.installationId) {
      setLastFocusedInstallationId(entry.installationId)
    }
    if (entry) {
      if (hasRunningSessionForEntry(entry)) recordInstanceSurface(entry.installationId)
      else recordDashboardSurface()
    }
  })

  const onTitleBarReadyHandler = (event: Electron.IpcMainEvent): void => {
    if (event.sender !== titleBarView.webContents) return
    if (titleBarView.webContents.isDestroyed()) return
    const entry = comfyWindows.get(windowKey)
    titleBarView.webContents.send('comfy-titlebar:panel-changed', entry?.activePanel ?? 'comfy')
    if (entry) {
      titleBarView.webContents.send('comfy-titlebar:theme-changed', entry.lastTheme)
      titleBarView.webContents.send('comfy-titlebar:title-changed', entry.titleBarText)
      titleBarView.webContents.send('comfy-titlebar:source-category-changed', entry.sourceCategory)
      titleBarView.webContents.send('comfy-titlebar:installation-id-changed', entry.installationId)
      titleBarView.webContents.send(
        'comfy-titlebar:preview-mode-changed',
        entry.previewInstallationId !== null
      )
      if (!entry.comfyView.webContents.isDestroyed()) {
        titleBarView.webContents.send(
          'comfy-titlebar:zoom-changed',
          entry.comfyView.webContents.getZoomLevel()
        )
      }
    }
    titleBarView.webContents.send(
      'comfy-titlebar:app-update-state-changed',
      updater.getCurrentUpdateState()
    )
    titleBarView.webContents.send('comfy-titlebar:downloads-changed', getDownloadsTrayState())
    const installId = entry?.installationId ?? null
    if (installId !== null) {
      void fx.computeInstallUpdateAvailable(installId).then((state) => {
        if (titleBarView.webContents.isDestroyed()) return
        titleBarView.webContents.send('comfy-titlebar:install-update-changed', state)
      })
    }
    ensureSystemModal(comfyWindow)
  }
  ipcMain.on('comfy-window:title-bar-ready', onTitleBarReadyHandler)

  let closingInFlight = false
  comfyWindow.on('close', (e) => {
    e.preventDefault()
    if (closingInFlight) return
    closingInFlight = true
    void (async () => {
      try {
        const entry = comfyWindows.get(windowKey)
        const skipConsult = fx.preClearedClose.has(comfyWindow)
        const isLastWindow =
          Array.from(comfyWindows.values()).filter((e) => !e.window.isDestroyed()).length <= 1
        if (!skipConsult) hideTitlePopupForParent(comfyWindow)
        const consult: CloseConsultResult = skipConsult
          ? 'cleared'
          : await fx.consultPanelRendererClose(entry?.panelView)
        if (shouldBailAfterConsult(consult, fx.preClearedClose.has(comfyWindow))) return
        const entryForClose = comfyWindows.get(windowKey)
        const isInstallHostWindow = !!entryForClose && isInstallHost(entryForClose)
        const isLastInstallWindow = isLastWindow && isInstallHostWindow
        if (
          shouldShowInstallCloseConfirm(
            settings.get('confirmBeforeClosingWindow') === true,
            consult,
            shouldConfirmKillForEntry(entryForClose),
            fx.preClearedClose.has(comfyWindow),
            isLastInstallWindow
          ) &&
          entryForClose
        ) {
          const closeChoice = await fx.confirmCloseInstanceWindow(
            comfyWindow,
            isLastWindow,
            shouldConfirmKillForEntry(entryForClose),
            entryForClose.lastTheme
          )
          if (shouldBailAfterCloseChoice(closeChoice, fx.preClearedClose.has(comfyWindow))) return
        }
        fx.preClearedClose.delete(comfyWindow)
        if (comfyWindow.isDestroyed()) return
        const safeTeardown = (source: string, fn: () => void): void => {
          try {
            fn()
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            const stack = err instanceof Error ? err.stack : undefined
            forwardDatadogError({
              source,
              message,
              stack,
              level: 'error',
              context: { origin: 'main-process', windowKey: String(windowKey) }
            })
          }
        }
        safeTeardown('host-window-close-install-cleanup', () => {
          if (entry?._installCleanup) entry._installCleanup()
        })
        safeTeardown('host-window-close-detach-downloads', () => detachWindowDownloads(comfyWindow))
        safeTeardown('host-window-close-unregister-broadcast-target', () =>
          _unregisterExtraBroadcastTarget(titleBarView.webContents)
        )
        safeTeardown('host-window-close-unregister-telemetry-relay', () =>
          mainTelemetry.unregisterTelemetryRelayTarget(titleBarView.webContents)
        )
        const liveEntry = comfyWindows.get(windowKey)
        const activeComfyView = liveEntry?.comfyView ?? comfyView
        if (liveEntry) {
          safeTeardown('host-window-close-destroy-panel-view', () => destroyPanelView(liveEntry))
        }
        safeTeardown('host-window-close-title-bar-webcontents-close', () =>
          titleBarView.webContents.close()
        )
        safeTeardown('host-window-close-comfy-webcontents-close', () => {
          if (activeComfyView.webContents && !activeComfyView.webContents.isDestroyed()) {
            activeComfyView.webContents.close()
          }
        })
        comfyWindow.destroy()
      } finally {
        closingInFlight = false
      }
    })()
  })

  comfyWindow.on('closed', () => {
    ipcMain.off('comfy-window:title-bar-ready', onTitleBarReadyHandler)
    const closedEntry = comfyWindows.get(windowKey)
    if (closedEntry) unregisterHostEntry(closedEntry)
    dropAttachClaimsForWindow(windowKey)
  })

  const entry: ComfyWindowEntry = {
    windowKey,
    window: comfyWindow,
    comfyView,
    titleBarView,
    panelView: null,
    activePanel: 'comfy',
    lastTheme: opts.initialTheme,
    layoutViews,
    comfyUrl: '',
    installationId: null,
    constructedPartition:
      typeof opts.comfyWebPreferences.partition === 'string'
        ? opts.comfyWebPreferences.partition
        : null,
    firstUseMode: 'none',
    titleBarText: opts.initialTitleBarText,
    sourceCategory: opts.initialSourceCategory,
    previewInstallationId: null,
    coldStartPendingReveal: false,
    _installCleanup: null,
    detachInstall: () => {}
  }
  entry.detachInstall = () => fx.detachInstallImpl(entry)
  registerHostEntry(entry)

  return { windowKey, comfyWindow, titleBarView, comfyView, entry, layoutViews }
}

export function loadTitleBarUrl(titleBarView: WebContentsView, installationId: string): void {
  const isDev = !!process.env['ELECTRON_RENDERER_URL']
  const tbLoad = isDev
    ? titleBarView.webContents.loadURL(
        `${(process.env['ELECTRON_RENDERER_URL'] as string).replace(/\/$/, '')}/comfyTitleBar.html?installationId=${encodeURIComponent(installationId)}`
      )
    : titleBarView.webContents.loadFile(path.join(__dirname, '../renderer/comfyTitleBar.html'), {
        query: { installationId }
      })
  void tbLoad.catch(() => {})
}

export { expectedPartitionFor }

export function buildComfyView(
  comfyWindow: BrowserWindow,
  webPreferences: Electron.WebPreferences,
  windowKey: number
): WebContentsView {
  const defaultFontFamily: Electron.WebPreferences['defaultFontFamily'] = {
    ...webPreferences.defaultFontFamily,
    monospace:
      process.platform === 'darwin'
        ? 'Menlo'
        : process.platform === 'win32'
          ? 'Consolas'
          : 'monospace'
  }
  const comfyView = new WebContentsView({
    webPreferences: { ...webPreferences, defaultFontFamily }
  })
  comfyView.setBackgroundColor(COMFY_BG)

  const comfyContents = comfyView.webContents
  trackFirebaseAuthReporter(comfyContents)
  attachSessionDownloadHandler(comfyContents.session)

  let nextPopupIsCheckout = false
  let nextCheckoutOpenedAt = 0

  comfyContents.on('did-create-window', (childWindow) => {
    const isCheckout = nextPopupIsCheckout
    const openedAt = nextCheckoutOpenedAt
    nextPopupIsCheckout = false
    nextCheckoutOpenedAt = 0
    childWindow.setIcon(APP_ICON)
    if (process.platform !== 'darwin') childWindow.removeMenu()
    injectMacPasskeyWarning(childWindow)
    if (isCheckout) wireCheckoutPopup(childWindow, comfyWindow, comfyContents, openedAt)
  })
  comfyContents.setWindowOpenHandler(({ url: childUrl }) => {
    if (isFirebaseAuthHandlerUrl(childUrl)) {
      void handleFirebasePopup(childUrl, comfyContents, {
        parentWindow: comfyWindow,
        onError: (failure) => {
          forwardDatadogError(buildFirebaseAuthForwardedError(failure))
        }
      })
      return { action: 'deny' }
    }
    if (isCheckoutUrl(childUrl)) {
      mainTelemetry.capture('comfy.desktop.billing.checkout_opened', {
        source: 'system_browser',
        user_tier: getUserTier()
      })
      void shell.openExternal(childUrl)
      return { action: 'deny' }
    }

    if (shouldOpenInPopup(childUrl)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { webPreferences: { preload: undefined } }
      }
    }
    if (isLikelyDownloadUrl(childUrl)) {
      comfyContents.session.downloadURL(childUrl)
      return { action: 'deny' }
    }
    shell.openExternal(childUrl)
    return { action: 'deny' }
  })
  comfyContents.on('will-prevent-unload', (e) => {
    const liveEntry = comfyWindows.get(windowKey)
    if (!liveEntry || isChooserHost(liveEntry)) return
    e.preventDefault()
  })
  attachContextMenu(comfyWindow, comfyContents)
  return comfyView
}

export function rebuildComfyViewIfNeeded(
  entry: ComfyWindowEntry,
  installation: InstallationRecord
): void {
  const expectedPartition = expectedPartitionFor(installation)
  if (entry.constructedPartition === expectedPartition) return
  if (entry.window.isDestroyed()) return

  const oldView = entry.comfyView
  const newView = buildComfyView(
    entry.window,
    {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/comfyPreload.js'),
      partition: expectedPartition
    },
    entry.windowKey
  )
  entry.window.contentView.addChildView(newView)
  oldView.setVisible(false)
  entry.window.contentView.removeChildView(oldView)
  if (!oldView.webContents.isDestroyed()) oldView.webContents.close()
  entry.comfyView = newView
  entry.constructedPartition = expectedPartition
}

export function getChooserHostTheme(): { bg: string; text: string } {
  const overlay = titleBarOverlayForTheme(resolveTheme() === 'dark')
  return { bg: overlay.color ?? TITLEBAR_BG, text: overlay.symbolColor ?? '#dddddd' }
}

export function applyChooserHostTheme(entry: ComfyWindowEntry): void {
  if (isInstallHost(entry)) return
  if (entry.window.isDestroyed()) return
  const theme = getChooserHostTheme()
  entry.lastTheme = theme
  if (!entry.titleBarView.webContents.isDestroyed()) {
    entry.titleBarView.webContents.send('comfy-titlebar:theme-changed', theme)
  }
  if (process.platform !== 'darwin') {
    try {
      entry.window.setTitleBarOverlay({ color: theme.bg, symbolColor: theme.text })
    } catch {}
  }
}

export function applyChooserHostThemeToAll(): void {
  for (const [, entry] of comfyWindows) {
    if (isChooserHost(entry)) {
      applyChooserHostTheme(entry)
    }
  }
}

export interface OpenChooserHostWindowOptions {
  deferColdStartReveal?: boolean
}

export function openChooserHostWindow(
  initialPanel: ComfyPanelKey = 'comfy',
  opts: OpenChooserHostWindowOptions = {}
): BrowserWindow {
  const initialChooserTheme = getChooserHostTheme()

  const { comfyWindow, entry, titleBarView } = createHostWindow({
    windowTitle: CHOOSER_HOST_WINDOW_TITLE,
    boundsKey: CHOOSER_HOST_BOUNDS_KEY,
    initialTheme: initialChooserTheme,
    titleBarOverlay:
      process.platform === 'darwin'
        ? undefined
        : titleBarOverlayForTheme(resolveTheme() === 'dark'),
    comfyWebPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/comfyPreload.js'),
      partition: 'persist:shared'
    },
    titleBarBackground: initialChooserTheme.bg,
    titleBarInstallationIdParam: '',
    initialTitleBarText: CHOOSER_HOST_TITLE_TEXT,
    initialSourceCategory: null,
    initiallyHidden: true
  })

  entry.coldStartPendingReveal = !opts.deferColdStartReveal

  entry.activePanel = initialPanel
  ensurePanelView(entry.windowKey, entry, computeBodyMode(entry))

  entry.layoutViews()

  const revealKey = entry.windowKey

  if (opts.deferColdStartReveal) return comfyWindow

  titleBarView.webContents.once('dom-ready', () => revealColdStartHostIfPending(revealKey))

  const backstopTimer = setTimeout(() => revealColdStartHostIfPending(revealKey), 2_000)
  comfyWindow.once('closed', () => clearTimeout(backstopTimer))

  return comfyWindow
}
