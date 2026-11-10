import { WebContentsView } from 'electron'
import type { BrowserWindow } from 'electron'
import path from 'path'
import { _registerExtraBroadcastTarget } from '../lib/ipc/broadcast'
import { attachContextMenu } from '../lib/contextMenu'

export interface EmbeddedPopupViewOpts {
  parent: BrowserWindow
  htmlName: string
  preloadName: string
  initialBounds: Electron.Rectangle
  hideOnParentEvents?: ReadonlyArray<'blur' | 'will-move' | 'move' | 'resize'>
  hideOnPopupBlur?: boolean
  onParentClosed?: () => void
  onDestroyed?: () => void
  onHide?: () => void
}

export class EmbeddedPopupView {
  readonly popup: WebContentsView
  readonly parentWindow: BrowserWindow
  readonly popupWebContentsId: number
  readonly parentWindowId: number
  rendererReady = false
  isOpen = false
  pendingShowTimer: NodeJS.Timeout | null = null
  suppressBlurDismiss = false
  private readonly onHideCallback?: () => void

  constructor(opts: EmbeddedPopupViewOpts) {
    const { parent } = opts
    this.parentWindow = parent
    this.parentWindowId = parent.id
    this.onHideCallback = opts.onHide

    const popup = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload/', opts.preloadName)
      }
    })
    popup.setBackgroundColor('#00000000')
    popup.setVisible(false)
    popup.setBounds(opts.initialBounds)
    parent.contentView.addChildView(popup)
    this.popup = popup
    this.popupWebContentsId = popup.webContents.id

    _registerExtraBroadcastTarget(popup.webContents)

    {
      let priorSuppress = false
      attachContextMenu(parent, popup.webContents, {
        onMenuOpen: () => {
          priorSuppress = this.suppressBlurDismiss
          this.suppressBlurDismiss = true
        },
        onMenuClose: () => {
          this.suppressBlurDismiss = priorSuppress
        }
      })
    }

    const isDev = !!process.env['ELECTRON_RENDERER_URL']
    const loadPromise = isDev
      ? popup.webContents.loadURL(
          `${(process.env['ELECTRON_RENDERER_URL'] as string).replace(/\/$/, '')}/${opts.htmlName}.html`
        )
      : popup.webContents.loadFile(path.join(__dirname, `../renderer/${opts.htmlName}.html`))
    void loadPromise.catch(() => {})

    const dismiss = (): void => {
      if (this.suppressBlurDismiss) return
      this.hide()
    }
    type DismissEmitter = {
      on(event: string, listener: () => void): void
      removeListener(event: string, listener: () => void): void
    }
    const dismissEvents = opts.hideOnParentEvents ?? []
    const parentEmitter = parent as unknown as DismissEmitter
    const parentListeners = new Map<string, () => void>()
    for (const event of dismissEvents) {
      parentListeners.set(event, dismiss)
      parentEmitter.on(event, dismiss)
    }
    if (opts.hideOnPopupBlur) {
      popup.webContents.on('blur', dismiss)
    }

    const onParentClosed = (): void => {
      opts.onParentClosed?.()
      try {
        parent.contentView.removeChildView(popup)
      } catch {}
      if (!popup.webContents.isDestroyed()) popup.webContents.close()
    }
    parent.once('closed', onParentClosed)

    popup.webContents.once('destroyed', () => {
      if (!parent.isDestroyed()) {
        for (const event of dismissEvents) {
          const listener = parentListeners.get(event)
          if (listener) parentEmitter.removeListener(event, listener)
        }
        parent.removeListener('closed', onParentClosed)
      }
      opts.onDestroyed?.()
    })
  }

  isDestroyed(): boolean {
    return this.popup.webContents.isDestroyed() || this.parentWindow.isDestroyed()
  }

  showOnTop(opts: { focus?: boolean } = {}): void {
    if (this.pendingShowTimer) {
      clearTimeout(this.pendingShowTimer)
      this.pendingShowTimer = null
    }
    if (this.popup.webContents.isDestroyed()) return
    if (!this.parentWindow.isDestroyed()) {
      try {
        this.parentWindow.contentView.removeChildView(this.popup)
      } catch {}
      this.parentWindow.contentView.addChildView(this.popup)
    }
    this.popup.setVisible(true)
    if (opts.focus) this.popup.webContents.focus()
    this.isOpen = true
  }

  hide(opts: { focusParent?: boolean } = {}): void {
    if (!this.isOpen && !this.pendingShowTimer) return
    this.isOpen = false
    if (this.pendingShowTimer) {
      clearTimeout(this.pendingShowTimer)
      this.pendingShowTimer = null
    }
    if (!this.popup.webContents.isDestroyed()) {
      this.popup.setVisible(false)
      if (opts.focusParent && !this.parentWindow.isDestroyed()) {
        this.parentWindow.focus()
      }
    }
    this.onHideCallback?.()
  }

  scheduleShowFallback(timeoutMs: number, callback: () => void): void {
    if (this.pendingShowTimer) clearTimeout(this.pendingShowTimer)
    this.pendingShowTimer = setTimeout(() => {
      this.pendingShowTimer = null
      callback()
    }, timeoutMs)
  }

  cancelPendingShow(): void {
    if (this.pendingShowTimer) {
      clearTimeout(this.pendingShowTimer)
      this.pendingShowTimer = null
    }
  }
}
