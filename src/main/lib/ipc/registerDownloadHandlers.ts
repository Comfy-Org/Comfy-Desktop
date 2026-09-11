import { BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { findEntryByComfySender } from '../../host/registry'
import {
  cancelModelDownload,
  clearFinishedDownloads,
  dismissRecentDownload,
  getAllDownloads,
  getDownloadThumbnail,
  pauseModelDownload,
  resumeModelDownload,
  retryDownload,
  startModelDownload
} from '../comfyDownloadManager'
import { openModelAccessPageWindow } from '../modelAccessPage'

export function registerDownloadHandlers(): void {
  ipcMain.on('desktop2-is-remote', (event) => {
    const entry = findEntryByComfySender(event.sender)
    event.returnValue = entry?.sourceCategory === 'cloud' || entry?.sourceCategory === 'remote'
  })

  ipcMain.handle('desktop2-open-model-access-page', (event, payload?: { url?: unknown }) =>
    openModelAccessPageWindow(event.sender, payload?.url)
  )

  ipcMain.handle(
    'desktop2-download-model',
    (event, { url, filename, directory }: { url: string; filename: string; directory: string }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return false
      return startModelDownload(win, url, filename, directory, event.sender)
    }
  )

  // Control payloads accept a stable job id (`ref`) or, for compatibility with
  // older renderer bundles / the in-Comfy bridge, the download URL (`url`).
  const controlRef = (payload?: { ref?: unknown; url?: unknown }): string | null => {
    if (typeof payload?.ref === 'string' && payload.ref) return payload.ref
    if (typeof payload?.url === 'string' && payload.url) return payload.url
    return null
  }

  ipcMain.handle('model-download-pause', (_event, payload?: { ref?: string; url?: string }) => {
    const ref = controlRef(payload)
    return ref !== null && pauseModelDownload(ref)
  })

  ipcMain.handle('model-download-resume', (_event, payload?: { ref?: string; url?: string }) => {
    const ref = controlRef(payload)
    return ref !== null && resumeModelDownload(ref)
  })

  ipcMain.handle('model-download-cancel', (_event, payload?: { ref?: string; url?: string }) => {
    const ref = controlRef(payload)
    return ref !== null && cancelModelDownload(ref)
  })

  ipcMain.handle('model-download-dismiss', (_event, payload?: { ref?: string; url?: string }) => {
    const ref = controlRef(payload)
    return ref !== null && dismissRecentDownload(ref)
  })

  ipcMain.handle('model-download-clear-finished', () => clearFinishedDownloads())

  ipcMain.handle('model-download-retry', (_event, payload?: { ref?: string; url?: string }) => {
    const ref = controlRef(payload)
    return ref !== null && retryDownload(ref)
  })

  // Seed the renderer store with active + recent downloads on first paint.
  ipcMain.handle('model-download-list', () => getAllDownloads())

  ipcMain.handle('show-download-in-folder', (_event, { savePath }: { savePath: string }) => {
    if (typeof savePath === 'string' && savePath) {
      shell.showItemInFolder(path.resolve(savePath))
    }
  })

  // Lazy preview thumbnail for a completed image download; null for non-images
  // or unreadable files. Reachable from the panel (`window.api`) and the
  // title-bar popup (`ipcRenderer.invoke`) alike.
  ipcMain.handle('download-thumbnail', (_event, { savePath }: { savePath: string }) =>
    getDownloadThumbnail(savePath)
  )
}
