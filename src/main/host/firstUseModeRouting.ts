import type { WebContents } from 'electron'
import type { FirstUseMode } from '../../shared/firstUseMode'
import type { ComfyWindowEntry } from './registry'

/**
 * Apply a first-use mode to the window whose panel sent it, and tell that
 * window's title bar. Only the sender: the mode locks a title bar, and other
 * windows (other builds) are not in the first-use flow.
 */
export function applyFirstUseModeFromPanel(
  entries: Iterable<ComfyWindowEntry>,
  sender: WebContents,
  mode: FirstUseMode
): void {
  for (const entry of entries) {
    if (entry.panelView?.webContents !== sender) continue
    entry.firstUseMode = mode
    if (!entry.titleBarView.webContents.isDestroyed()) {
      entry.titleBarView.webContents.send('comfy-titlebar:first-use-mode-changed', mode)
    }
    return
  }
}
