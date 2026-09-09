import type { BrowserWindow } from 'electron'

/**
 * Pull the user back into the app after the system browser completes
 * sign-in. `show()` un-minimises on platforms that need it; `focus()`
 * lifts the OS-level focus from the browser. Best-effort — a missing or
 * destroyed window is a no-op.
 */
export function restoreParentWindow(parentWindow?: BrowserWindow): void {
  if (!parentWindow || parentWindow.isDestroyed()) return
  if (parentWindow.isMinimized()) parentWindow.restore()
  parentWindow.show()
  parentWindow.focus()
}
