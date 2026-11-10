import type { BrowserWindow } from 'electron'

export function restoreParentWindow(parentWindow?: BrowserWindow): void {
  if (!parentWindow || parentWindow.isDestroyed()) return
  if (parentWindow.isMinimized()) parentWindow.restore()
  parentWindow.show()
  parentWindow.focus()
}
