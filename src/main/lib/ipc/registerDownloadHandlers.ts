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
import { getDeviceId, getIdClass } from '../deviceId'
import { openModelAccessPageWindow } from '../modelAccessPage'
import { answerBridge, handleBridge } from './comfyBridge'

export function registerDownloadHandlers(): void {
  answerBridge('desktop2-is-remote', false, (event) => {
    const category = findEntryByComfySender(event.sender)?.sourceCategory
    return category === 'cloud' || category === 'remote'
  })

  answerBridge<string | undefined>('desktop2-get-install-id', undefined, () =>
    getIdClass() === 'machine_derived' ? getDeviceId() : undefined
  )

  handleBridge('desktop2-open-model-access-page', false, (event, payload?: { url?: unknown }) =>
    openModelAccessPageWindow(event.sender, payload?.url)
  )

  handleBridge(
    'desktop2-download-model',
    false,
    (event, { url, filename, directory }: { url: string; filename: string; directory: string }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return false
      return startModelDownload(win, url, filename, directory, event.sender)
    }
  )

  const controlRef = (payload?: { ref?: unknown; url?: unknown }): string | null => {
    if (typeof payload?.ref === 'string' && payload.ref) return payload.ref
    if (typeof payload?.url === 'string' && payload.url) return payload.url
    return null
  }

  handleBridge(
    'model-download-pause',
    false,
    (_event, payload?: { ref?: string; url?: string }) => {
      const ref = controlRef(payload)
      return ref !== null && pauseModelDownload(ref)
    }
  )

  handleBridge(
    'model-download-resume',
    false,
    (_event, payload?: { ref?: string; url?: string }) => {
      const ref = controlRef(payload)
      return ref !== null && resumeModelDownload(ref)
    }
  )

  handleBridge(
    'model-download-cancel',
    false,
    (_event, payload?: { ref?: string; url?: string }) => {
      const ref = controlRef(payload)
      return ref !== null && cancelModelDownload(ref)
    }
  )

  ipcMain.handle('model-download-dismiss', (_event, payload?: { ref?: string; url?: string }) => {
    const ref = controlRef(payload)
    return ref !== null && dismissRecentDownload(ref)
  })

  ipcMain.handle('model-download-clear-finished', () => clearFinishedDownloads())

  ipcMain.handle('model-download-retry', (_event, payload?: { ref?: string; url?: string }) => {
    const ref = controlRef(payload)
    return ref !== null && retryDownload(ref)
  })

  ipcMain.handle('model-download-list', () => getAllDownloads())

  ipcMain.handle('show-download-in-folder', (_event, { savePath }: { savePath: string }) => {
    if (typeof savePath === 'string' && savePath) {
      shell.showItemInFolder(path.resolve(savePath))
    }
  })

  ipcMain.handle('download-thumbnail', (_event, { savePath }: { savePath: string }) =>
    getDownloadThumbnail(savePath)
  )
}
