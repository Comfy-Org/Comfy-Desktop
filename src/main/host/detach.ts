import { ipcMain } from 'electron'
import type { BrowserWindow, WebContentsView } from 'electron'
import * as ipc from '../lib/ipc'
import { _runningSessions } from '../lib/ipc/shared'
import { COMFY_BG } from '../lib/theme'
import { destroyPanelView, ensurePanelView } from './panelView'
import { openSystemModalAsync } from '../popups/systemModal'
import type { SystemModalDetailGroup } from '../popups/systemModal'
import { recordDashboardSurface } from '../lib/lastSession'
import * as settings from '../settings'
import { comfyWindows, isChooserHost, isInstallHost, shouldConfirmKillForEntry } from './registry'
import type { ComfyWindowEntry } from './registry'
import {
  applyChooserHostTheme,
  CHOOSER_HOST_TITLE_TEXT,
  CHOOSER_HOST_WINDOW_TITLE,
  installCloseNeedsConfirm
} from './createHostWindow'
import type { CloseWindowChoice } from './createHostWindow'

export const preClearedClose = new WeakSet<BrowserWindow>()

type PanelConsultResult = 'cleared' | 'aborted' | 'defer'

async function consultPanelRenderer(
  panelView: WebContentsView | null | undefined,
  requestPrefix: 'comfy-window:request-close' | 'comfy-window:request-return-to-dashboard',
  fallback: PanelConsultResult
): Promise<PanelConsultResult> {
  if (!panelView || panelView.webContents.isDestroyed()) return fallback
  return new Promise<PanelConsultResult>((resolve) => {
    const prefix = requestPrefix === 'comfy-window:request-close' ? 'close' : 'rtd'
    const requestId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const ackChannel = `${requestPrefix}-ack`
    const responseChannel = `${requestPrefix}-response`
    let settled = false
    let acked = false
    const cleanup = (): void => {
      ipcMain.off(ackChannel, onAck)
      ipcMain.off(responseChannel, onResponse)
      if (!panelView.webContents.isDestroyed()) {
        panelView.webContents.off('render-process-gone', onCrash)
        panelView.webContents.off('destroyed', onCrash)
      }
    }
    const onAck = (
      event: Electron.IpcMainEvent,
      payload: { requestId?: string } | undefined
    ): void => {
      if (event.sender !== panelView.webContents) return
      if (payload?.requestId !== requestId) return
      acked = true
    }
    const onResponse = (
      event: Electron.IpcMainEvent,
      payload: { requestId?: string; cleared?: boolean; defer?: boolean } | undefined
    ): void => {
      if (event.sender !== panelView.webContents) return
      if (payload?.requestId !== requestId) return
      if (settled) return
      settled = true
      cleanup()
      resolve(payload?.defer ? 'defer' : payload?.cleared ? 'cleared' : 'aborted')
    }
    const onCrash = (): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(fallback)
    }
    ipcMain.on(ackChannel, onAck)
    ipcMain.on(responseChannel, onResponse)
    panelView.webContents.on('render-process-gone', onCrash)
    panelView.webContents.on('destroyed', onCrash)
    try {
      panelView.webContents.send(requestPrefix, { requestId })
    } catch {
      settled = true
      cleanup()
      resolve(fallback)
      return
    }
    setTimeout(() => {
      if (settled || acked) return
      settled = true
      cleanup()
      resolve(fallback)
    }, 2000)
  })
}

export async function consultPanelRendererClose(
  panelView: WebContentsView | null | undefined
): Promise<PanelConsultResult> {
  return consultPanelRenderer(panelView, 'comfy-window:request-close', 'defer')
}

export async function consultPanelRendererReturnToDashboard(
  panelView: WebContentsView | null | undefined
): Promise<boolean> {
  return (
    (await consultPanelRenderer(
      panelView,
      'comfy-window:request-return-to-dashboard',
      'cleared'
    )) === 'cleared'
  )
}

export function closeAllHostWindows(): void {
  const entries = Array.from(comfyWindows.values())
  for (const entry of entries) {
    if (!entry.window.isDestroyed()) entry.window.close()
  }
}

export async function returnToDashboard(parentEntryId: number): Promise<void> {
  const entry = comfyWindows.get(parentEntryId)
  if (!entry || isChooserHost(entry) || entry.window.isDestroyed()) return
  const panelAlive = !!entry.panelView && !entry.panelView.webContents.isDestroyed()
  const cleared = panelAlive
    ? await consultPanelRendererReturnToDashboard(entry.panelView)
    : await confirmReturnToDashboardViaSystemModal(entry)
  if (!cleared) return
  if (entry.window.isDestroyed()) return
  entry.detachInstall()
}

async function confirmReturnToDashboardViaSystemModal(entry: ComfyWindowEntry): Promise<boolean> {
  if (!shouldConfirmKillForEntry(entry)) return true
  if (!_runningSessions.has(entry.installationId)) return true
  if (entry.window.isDestroyed()) return true
  return openSystemModalAsync({
    parent: entry.window,
    spec: {
      title: 'Return to Dashboard?',
      message: 'This will stop the current ComfyUI.',
      confirmLabel: 'Return to Dashboard',
      cancelLabel: 'Cancel',
      confirmStyle: 'danger',
      theme: entry.lastTheme
    }
  })
}

export async function confirmAndCloseAllHostWindows(
  parentWindow: BrowserWindow | null,
  performQuit: () => void
): Promise<void> {
  const entries = Array.from(comfyWindows.values()).filter((e) => !e.window.isDestroyed())
  const instanceWindows = entries.filter((e) => shouldConfirmKillForEntry(e))
  if (instanceWindows.length === 0) {
    performQuit()
    return
  }
  const titles = instanceWindows.map((e) => e.titleBarText || 'Untitled instance')
  const details: SystemModalDetailGroup[] = [{ label: 'Open instances', items: titles }]
  if (ipc.hasActiveOperations()) {
    try {
      const items = await ipc.getActiveDetails()
      const operations = items.filter((i) => i.type === 'operation').map((i) => i.name)
      const downloads = items.filter((i) => i.type === 'download').map((i) => i.name)
      if (operations.length > 0)
        details.push({ label: 'In-progress operations', items: operations })
      if (downloads.length > 0) details.push({ label: 'Active downloads', items: downloads })
    } catch {}
  }
  const overlayParentEntry =
    parentWindow && !parentWindow.isDestroyed()
      ? entries.find((e) => e.window === parentWindow)
      : entries[0]
  if (!overlayParentEntry) {
    performQuit()
    return
  }
  const count = instanceWindows.length
  const confirmed = await openSystemModalAsync({
    parent: overlayParentEntry.window,
    spec: {
      title: 'Quit Desktop',
      message:
        count === 1
          ? 'Quit Desktop? This will close the running ComfyUI instance.'
          : `Quit Desktop? This will close ${count} running ComfyUI instances.`,
      details,
      confirmLabel: 'Quit',
      cancelLabel: 'Cancel',
      confirmStyle: 'danger',
      theme: overlayParentEntry.lastTheme
    }
  })
  if (confirmed) performQuit()
}

export async function confirmCloseInstanceWindow(
  window: BrowserWindow,
  isLastWindow: boolean,
  stopsLocalComfy: boolean,
  theme: { bg: string; text: string }
): Promise<CloseWindowChoice> {
  const message = isLastWindow
    ? stopsLocalComfy
      ? 'Close this window? This stops ComfyUI and quits Comfy Desktop.'
      : 'Close this window? This quits Comfy Desktop.'
    : stopsLocalComfy
      ? 'Close this window? This stops the running ComfyUI instance.'
      : 'Close this window?'
  const confirmed = await openSystemModalAsync({
    parent: window,
    spec: {
      title: 'Close Window',
      message,
      confirmLabel: 'Close Window',
      cancelLabel: 'Cancel',
      confirmStyle: 'danger',
      theme
    }
  })
  return confirmed ? 'close' : 'cancel'
}

export async function confirmAndCloseHostWindow(parentWindow: BrowserWindow): Promise<void> {
  if (parentWindow.isDestroyed()) return
  const entry = Array.from(comfyWindows.values()).find((e) => e.window === parentWindow)
  if (!entry) {
    parentWindow.close()
    return
  }
  const liveWindowCount = Array.from(comfyWindows.values()).filter(
    (e) => !e.window.isDestroyed()
  ).length
  const isLastWindow = liveWindowCount <= 1
  if (
    installCloseNeedsConfirm(
      settings.get('confirmBeforeClosingWindow') === true,
      shouldConfirmKillForEntry(entry),
      isLastWindow && isInstallHost(entry)
    )
  ) {
    const choice = await confirmCloseInstanceWindow(
      entry.window,
      isLastWindow,
      shouldConfirmKillForEntry(entry),
      entry.lastTheme
    )
    if (choice === 'cancel') return
  }
  preClearedClose.add(entry.window)
  entry.window.close()
}

export function _detachInstallImpl(entry: ComfyWindowEntry): void {
  if (isChooserHost(entry)) return
  if (entry.window.isDestroyed()) return

  recordDashboardSurface()

  entry._installCleanup?.()

  if (!entry.comfyView.webContents.isDestroyed()) {
    void entry.comfyView.webContents.loadURL('about:blank').catch(() => {})
    entry.comfyView.setBackgroundColor(COMFY_BG)
  }

  entry.titleBarText = CHOOSER_HOST_TITLE_TEXT
  entry.sourceCategory = null
  entry.previewInstallationId = null
  entry.activePanel = 'comfy'
  entry.window.setTitle(CHOOSER_HOST_WINDOW_TITLE)
  if (!entry.titleBarView.webContents.isDestroyed()) {
    entry.titleBarView.webContents.send('comfy-titlebar:title-changed', entry.titleBarText)
    entry.titleBarView.webContents.send(
      'comfy-titlebar:source-category-changed',
      entry.sourceCategory
    )
    entry.titleBarView.webContents.send('comfy-titlebar:installation-id-changed', null)
    entry.titleBarView.webContents.send('comfy-titlebar:preview-mode-changed', false)
    entry.titleBarView.webContents.send('comfy-titlebar:install-update-changed', {
      available: false,
      version: null
    })
  }
  applyChooserHostTheme(entry)

  destroyPanelView(entry)
  ensurePanelView(entry.windowKey, entry, 'chooser')
  entry.layoutViews()
}

export function detachOrphanedInstallHosts(liveIds: ReadonlySet<string>): void {
  const entries = Array.from(comfyWindows.values())
  for (const entry of entries) {
    if (entry.window.isDestroyed()) continue
    if (!isInstallHost(entry)) continue
    if (!entry.installationId) continue
    if (liveIds.has(entry.installationId)) continue
    entry.detachInstall()
  }
}
