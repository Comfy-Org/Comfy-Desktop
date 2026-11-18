import { BrowserWindow, ipcMain } from 'electron'
import { get as getInstallation } from '../../installations'
import { startAssetDownload } from '../comfyDownloadManager'
import { autoDownloadDir } from '../outputFolders'

export function registerAssetDownloadHandlers(opts: {
  findInstallationIdForWindow: (win: BrowserWindow) => string | undefined
}): void {
  ipcMain.handle(
    'desktop2-download-asset',
    async (
      event,
      { url, filename, authToken }: { url: string; filename: string; authToken?: string }
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return false
      const installationId = opts.findInstallationIdForWindow(win)
      if (!installationId) return false
      const inst = await getInstallation(installationId)
      if (!inst) return false
      const outputDir = autoDownloadDir(inst)
      if (!outputDir) return false
      return startAssetDownload(win, url, filename, outputDir, authToken, event.sender)
    }
  )
}
