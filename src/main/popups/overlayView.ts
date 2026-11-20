import type { WebContentsView } from 'electron'
import path from 'path'

import { createDesktopPageView } from '../lib/webContentsViewLifetime'

const OVERLAY_PRESSED_CHANNEL = 'comfy-overlay:pressed'

export const OVERLAY_PRESSED_SCRIPT = 'window.comfyOverlay.pressed()'

export function createOverlayView(html: string, onPressed: () => void): WebContentsView {
  const view = createDesktopPageView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '../preload/overlayPreload.js')
    }
  })
  view.setBackgroundColor('#00000000')
  view.webContents.ipc.on(OVERLAY_PRESSED_CHANNEL, () => onPressed())
  void view.webContents
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    .catch(() => {})
  return view
}
