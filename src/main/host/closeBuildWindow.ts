import { hideTitlePopupForParent } from '../popups/titlePopup'
import type { CloseComfyWindowOptions } from '../../types/ipc'
import { preClearedClose } from './detach'
import { comfyWindows, getEntryByInstallationId } from './registry'
import type { ComfyWindowEntry } from './registry'

function isOnlyOpenHostWindow(entry: ComfyWindowEntry): boolean {
  return !Array.from(comfyWindows.values()).some(
    (other) => other !== entry && !other.window.isDestroyed()
  )
}

export function closeBuildWindow(installationId: string, opts?: CloseComfyWindowOptions): boolean {
  const entry = getEntryByInstallationId(installationId)
  if (!entry || entry.window.isDestroyed()) return false
  if (opts?.keepDesktopOpen && isOnlyOpenHostWindow(entry)) {
    hideTitlePopupForParent(entry.window)
    entry.detachInstall()
    return true
  }
  if (opts?.skipConfirm) preClearedClose.add(entry.window)
  entry.window.close()
  return true
}
