import { WebContentsView, ipcMain } from 'electron'
import path from 'path'
import { attachContextMenu } from '../lib/contextMenu'
import { resolveTheme } from '../lib/ipc/shared'
import { get as getSetting } from '../settings'
import { TITLEBAR_BG } from '../lib/theme'
import { TITLEBAR_HEIGHT, titleBarOverlayForTheme } from '../lib/titleBarOverlay'
import {
  _registerExtraBroadcastTarget,
  _unregisterExtraBroadcastTarget,
  _activeOperationStatus
} from '../lib/ipc/shared'
import {
  comfyWindows,
  computeBodyMode,
  findEntryByTitleBarSender,
  getEntryByInstallationId,
  revealColdStartHostIfPending,
  VALID_PANELS
} from './registry'
import type { BodyMode, ComfyPanelKey, ComfyWindowEntry } from './registry'

const DASHBOARD_PAGE_PANELS: ReadonlyMap<unknown, ComfyPanelKey> = new Map([
  ['chooser', 'comfy'],
  ['benchmarks', 'benchmarks'],
  ['performance-test', 'performance-test']
])

function opaquePanelBg(): string {
  const overlay = titleBarOverlayForTheme(resolveTheme() === 'dark')
  return overlay.color ?? TITLEBAR_BG
}

function isOpaqueBodyMode(mode: BodyMode): boolean {
  return (
    mode === 'chooser' ||
    mode === 'performance-test' ||
    mode === 'benchmarks' ||
    mode === 'new-install' ||
    mode === 'comfy-lifecycle'
  )
}

export function ensurePanelView(
  windowKey: number,
  entry: ComfyWindowEntry,
  initialPanel: BodyMode
): WebContentsView {
  if (entry.panelView) return entry.panelView

  const panelView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, '../preload/index.js')
    }
  })
  panelView.setBackgroundColor(isOpaqueBodyMode(initialPanel) ? opaquePanelBg() : '#00000000')
  entry.window.contentView.addChildView(panelView)
  attachContextMenu(entry.window, panelView.webContents)
  panelView.setBounds({ x: 0, y: TITLEBAR_HEIGHT + 1, width: 0, height: 0 })
  panelView.setVisible(false)

  panelView.webContents.once('did-finish-load', () => {
    const latest = comfyWindows.get(windowKey)
    if (!latest || latest.window.isDestroyed() || panelView.webContents.isDestroyed()) return
    revealColdStartHostIfPending(windowKey)
    const mode = computeBodyMode(latest)
    if (mode !== 'comfy') {
      panelView.webContents.send('panel-switch', {
        panel: mode,
        installationId: latest.installationId ?? ''
      })
      if (latest.window.isFocused()) panelView.webContents.focus()
    }
  })

  const panelInstallationId = entry.installationId ?? ''
  const firstUseCompleted = getSetting('firstUseCompleted') === true
  const panelQuery: Record<string, string> = {
    installationId: panelInstallationId,
    panel: initialPanel,
    firstUseCompleted: String(firstUseCompleted)
  }
  if (process.env['E2E'] === '1') {
    panelQuery['e2e'] = '1'
  }
  const isDev = !!process.env['ELECTRON_RENDERER_URL']
  const loadPromise = isDev
    ? panelView.webContents.loadURL(
        `${(process.env['ELECTRON_RENDERER_URL'] as string).replace(/\/$/, '')}/panel.html?${new URLSearchParams(panelQuery).toString()}`
      )
    : panelView.webContents.loadFile(path.join(__dirname, '../renderer/panel.html'), {
        query: panelQuery
      })
  void loadPromise.catch(() => {})

  _registerExtraBroadcastTarget(panelView.webContents)
  entry.panelView = panelView
  return panelView
}

export function destroyPanelView(entry: ComfyWindowEntry): void {
  if (!entry.panelView) return
  const oldPanel = entry.panelView
  entry.panelView = null
  if (!oldPanel.webContents.isDestroyed()) {
    _unregisterExtraBroadcastTarget(oldPanel.webContents)
    oldPanel.webContents.close()
  }
  if (!entry.window.isDestroyed()) {
    try {
      entry.window.contentView.removeChildView(oldPanel)
    } catch {}
  }
  if (entry.firstUseMode !== 'none') {
    entry.firstUseMode = 'none'
    if (!entry.titleBarView.webContents.isDestroyed()) {
      entry.titleBarView.webContents.send('comfy-titlebar:first-use-mode-changed', 'none')
    }
  }
}

export function focusActiveBody(entry: ComfyWindowEntry): void {
  if (entry.window.isDestroyed() || !entry.window.isFocused()) return
  const mode = computeBodyMode(entry)
  if (mode === 'comfy') {
    if (!entry.comfyView.webContents.isDestroyed()) entry.comfyView.webContents.focus()
  } else if (
    entry.panelView &&
    !entry.panelView.webContents.isDestroyed() &&
    !entry.panelView.webContents.isLoadingMainFrame()
  ) {
    entry.panelView.webContents.focus()
  }
}

export function setActivePanel(windowKey: number, panel: ComfyPanelKey): void {
  const entry = comfyWindows.get(windowKey)
  if (!entry || entry.window.isDestroyed()) return
  const reassertFullPageTool = panel === 'performance-test' || panel === 'benchmarks'
  if (entry.activePanel === panel && !reassertFullPageTool) return

  entry.activePanel = panel
  const mode = computeBodyMode(entry)
  if (mode !== 'comfy') {
    ensurePanelView(windowKey, entry, mode)
  }
  const isOverlay = mode === 'feedback' || mode === 'announcement'
  entry.pendingOverlayReveal = isOverlay
  if (entry.overlayRevealTimer) clearTimeout(entry.overlayRevealTimer)
  entry.overlayRevealTimer = undefined
  forwardToPanelRenderer(entry, 'panel-switch', {
    panel: mode,
    installationId: entry.installationId ?? ''
  })
  entry.layoutViews()
  if (isOverlay) {
    entry.overlayRevealTimer = setTimeout(() => {
      entry.overlayRevealTimer = undefined
      if (!entry.pendingOverlayReveal || entry.window.isDestroyed()) return
      entry.pendingOverlayReveal = false
      entry.layoutViews()
    }, 400)
  }
  if (!entry.titleBarView.webContents.isDestroyed()) {
    entry.titleBarView.webContents.send('comfy-titlebar:panel-changed', panel)
  }
  focusActiveBody(entry)
}

export function openAnnouncement(windowKey: number): void {
  const entry = comfyWindows.get(windowKey)
  if (!entry || entry.window.isDestroyed()) return
  const mode = computeBodyMode(entry)
  const overCanvas = mode === 'comfy'
  const panelView =
    entry.panelView ?? ensurePanelView(windowKey, entry, overCanvas ? 'announcement' : mode)
  if (overCanvas) {
    setActivePanel(windowKey, 'announcement')
  } else {
    focusActiveBody(entry)
  }
  sendToPanelDeferred(panelView, 'comfy-panel:open-announcement', {})
}

export function prewarmAttachedPanel(entry: ComfyWindowEntry): void {
  setActivePanel(entry.windowKey, 'comfy')
  ensurePanelView(entry.windowKey, entry, computeBodyMode(entry))
  entry.layoutViews()
}

export function refreshComfyTabBody(installationId: string): void {
  const entry = getEntryByInstallationId(installationId)
  if (!entry || entry.window.isDestroyed()) return
  if (entry.activePanel !== 'comfy') return
  const bgOp = _activeOperationStatus.get(installationId)
  if (bgOp && !bgOp.done) return

  const mode = computeBodyMode(entry)
  if (mode === 'comfy-lifecycle') {
    const lifecyclePanel = ensurePanelView(entry.windowKey, entry, 'comfy-lifecycle')
    if (!lifecyclePanel.webContents.isDestroyed()) {
      lifecyclePanel.setBackgroundColor(opaquePanelBg())
    }
  }
  forwardToPanelRenderer(entry, 'panel-switch', { panel: mode, installationId })
  entry.layoutViews()
  focusActiveBody(entry)
}

export function sendToPanelDeferred(
  panelView: WebContentsView,
  channel: string,
  payload: unknown
): void {
  if (panelView.webContents.isDestroyed()) return
  const send = (): void => {
    if (panelView.webContents.isDestroyed()) return
    panelView.webContents.send(channel, payload)
  }
  if (panelView.webContents.isLoadingMainFrame()) {
    panelView.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

function forwardToPanelRenderer(entry: ComfyWindowEntry, channel: string, payload?: unknown): void {
  const pv = entry.panelView
  if (!pv || pv.webContents.isDestroyed()) return
  sendToPanelDeferred(pv, channel, payload)
}

export function registerPanelViewIpc(): void {
  ipcMain.on('comfy-window:set-panel', (event, payload: { panel: string }) => {
    const found = findEntryByTitleBarSender(event.sender)
    if (!found) return
    const panel = payload?.panel as ComfyPanelKey
    if (!VALID_PANELS.has(panel)) return
    setActivePanel(found.id, panel)
  })

  ipcMain.on('comfy-window:close-current-panel', (event) => {
    for (const [id, entry] of comfyWindows) {
      if (entry.panelView?.webContents === event.sender) {
        setActivePanel(id, 'comfy')
        return
      }
    }
  })

  ipcMain.on('comfy-window:close-announcement', (event) => {
    for (const [id, entry] of comfyWindows) {
      if (entry.panelView?.webContents === event.sender) {
        if (entry.activePanel === 'announcement') setActivePanel(id, 'comfy')
        return
      }
    }
  })

  ipcMain.on('comfy-window:navigate-panel', (event, page: unknown) => {
    const panel = DASHBOARD_PAGE_PANELS.get(page)
    if (!panel) return
    for (const [id, entry] of comfyWindows) {
      if (entry.panelView?.webContents !== event.sender) continue
      if (entry.installationId === null) setActivePanel(id, panel)
      return
    }
  })

  ipcMain.on('comfy-window:overlay-ready', (event) => {
    for (const entry of comfyWindows.values()) {
      if (entry.panelView?.webContents === event.sender) {
        if (!entry.pendingOverlayReveal) return
        entry.pendingOverlayReveal = false
        if (entry.overlayRevealTimer) clearTimeout(entry.overlayRevealTimer)
        entry.overlayRevealTimer = undefined
        if (!entry.window.isDestroyed()) entry.layoutViews()
        return
      }
    }
  })
}
