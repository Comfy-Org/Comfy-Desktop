import { BrowserWindow, ipcMain, shell } from 'electron'
import type { IpcMainEvent } from 'electron'
import path from 'path'
import { findEntryByComfySender, findInstallationIdByComfySender } from '../../host/registry'
import {
  cancelModelDownload,
  clearFinishedDownloads,
  dismissRecentDownload,
  getAllDownloads,
  getDownloadThumbnail,
  pauseModelDownload,
  resumeModelDownload,
  retryDownload,
  startModelDownload,
  subscribeToInstallationModelJobs
} from '../comfyDownloadManager'
import { getDeviceId, getIdClass } from '../deviceId'
import { openModelAccessPageWindow } from '../modelAccessPage'
import { isTrustedCloudUrl } from '../trustedCloudUrl'

function isTrustedCloudSender({ sender, senderFrame }: IpcMainEvent): boolean {
  if (findEntryByComfySender(sender)?.sourceCategory !== 'cloud' || !senderFrame) return false
  const mainFrame = sender.mainFrame
  return (
    senderFrame.processId === mainFrame.processId &&
    senderFrame.routingId === mainFrame.routingId &&
    isTrustedCloudUrl(senderFrame.url)
  )
}

export function registerDownloadHandlers(): void {
  ipcMain.on('desktop2-is-remote', (event) => {
    const entry = findEntryByComfySender(event.sender)
    event.returnValue = entry?.sourceCategory === 'cloud' || entry?.sourceCategory === 'remote'
  })

  ipcMain.on('desktop2-get-install-id', (event) => {
    event.returnValue =
      isTrustedCloudSender(event) && getIdClass() === 'machine_derived' ? getDeviceId() : undefined
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

  ipcMain.handle('desktop2-list-model-downloads', (event) => {
    const installationId = findInstallationIdByComfySender(event.sender)
    return installationId === null
      ? []
      : subscribeToInstallationModelJobs(installationId, event.sender)
  })

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
