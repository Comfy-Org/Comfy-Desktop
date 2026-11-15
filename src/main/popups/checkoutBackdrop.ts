import type { BrowserWindow, WebContentsView } from 'electron'
import { createOverlayView, OVERLAY_PRESSED_SCRIPT } from './overlayView'

interface CheckoutBackdropEntry {
  view: WebContentsView
  visible: boolean
  onDismiss: (() => void) | null
}

const backdropsByParent = new Map<number, CheckoutBackdropEntry>()

const CHECKOUT_BACKDROP_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;-webkit-user-select:none;user-select:none}
  .scrim{position:fixed;inset:0;width:100%;height:100%;background:rgba(33,25,39,0.4);backdrop-filter:blur(8px) saturate(120%);-webkit-backdrop-filter:blur(8px) saturate(120%);cursor:default}
</style></head><body>
<div class="scrim" id="s"></div>
<script>
  document.getElementById('s').addEventListener('mousedown', () => {
    ${OVERLAY_PRESSED_SCRIPT};
  });
</script>
</body></html>`

function fullBounds(parent: BrowserWindow): Electron.Rectangle {
  const cb = parent.getContentBounds()
  return { x: 0, y: 0, width: cb.width, height: cb.height }
}

function ensureBackdrop(parent: BrowserWindow): CheckoutBackdropEntry {
  const existing = backdropsByParent.get(parent.id)
  if (existing && !existing.view.webContents.isDestroyed()) return existing

  const view = createOverlayView(CHECKOUT_BACKDROP_HTML, () => {
    if (entry.visible) entry.onDismiss?.()
  })
  view.setVisible(false)
  view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
  parent.contentView.addChildView(view)

  const entry: CheckoutBackdropEntry = { view, visible: false, onDismiss: null }
  backdropsByParent.set(parent.id, entry)

  parent.on('resize', () => {
    if (!entry.visible || parent.isDestroyed() || view.webContents.isDestroyed()) return
    view.setBounds(fullBounds(parent))
  })
  parent.once('closed', () => {
    if (!view.webContents.isDestroyed()) view.webContents.close()
    backdropsByParent.delete(parent.id)
  })

  return entry
}

export function showCheckoutBackdrop(parent: BrowserWindow, onDismiss: () => void): void {
  if (parent.isDestroyed()) return
  const entry = ensureBackdrop(parent)
  entry.onDismiss = onDismiss
  entry.view.setBounds(fullBounds(parent))
  try {
    parent.contentView.removeChildView(entry.view)
    parent.contentView.addChildView(entry.view)
  } catch {}
  entry.view.setVisible(true)
  entry.visible = true
}

export function hideCheckoutBackdrop(parent: BrowserWindow): void {
  const entry = backdropsByParent.get(parent.id)
  if (!entry || !entry.visible) return
  entry.visible = false
  entry.onDismiss = null
  if (entry.view.webContents.isDestroyed()) return
  entry.view.setVisible(false)
  if (!parent.isDestroyed()) {
    try {
      parent.contentView.removeChildView(entry.view)
    } catch {}
  }
}
