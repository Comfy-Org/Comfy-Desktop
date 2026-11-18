import { BrowserWindow } from 'electron'
import { resolveTheme } from './ipc/shared'
import { TITLEBAR_BG } from './theme'

export const TITLEBAR_HEIGHT = 36

export const TRAFFIC_LIGHT_POSITION: Electron.Point = {
  x: 13,
  y: Math.round((TITLEBAR_HEIGHT - 16) / 2)
}

export function titleBarOverlayForTheme(_isDark: boolean): Electron.TitleBarOverlayOptions {
  return {
    color: TITLEBAR_BG,
    symbolColor: '#dddddd',
    height: TITLEBAR_HEIGHT
  }
}

let _mainWindowId: number | null = null

export function setMainWindowId(id: number): void {
  _mainWindowId = id
}

export function updateTitleBarOverlay(): void {
  if (process.platform === 'darwin' || _mainWindowId === null) return
  const win = BrowserWindow.fromId(_mainWindowId)
  if (!win || win.isDestroyed()) return
  const resolved = resolveTheme()
  try {
    win.setTitleBarOverlay(titleBarOverlayForTheme(resolved === 'dark'))
  } catch {}
}
