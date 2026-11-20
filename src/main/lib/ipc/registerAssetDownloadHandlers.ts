import { BrowserWindow, ipcMain } from 'electron'
import { findEntryByComfySender } from '../../host/registry'
import { get as getInstallation } from '../../installations'
import type { InstallationRecord } from '../../installations'
import * as settings from '../../settings'
import { startAssetDownload } from '../comfyDownloadManager'
import { isPermittedDownloadUrl, originOf, sameOriginCheck } from '../downloadUrlPolicy'
import type { DownloadUrlCheck } from '../downloadUrlPolicy'
import { isTrustedCloudUrl } from '../trustedCloudUrl'

export function assetUrlCheckFor(sender: Electron.WebContents): DownloadUrlCheck {
  const entry = findEntryByComfySender(sender)
  const sameOrigin = sameOriginCheck([originOf(entry?.comfyUrl), originOf(sender.getURL())])
  if (entry?.sourceCategory !== 'cloud') return sameOrigin
  return (url) => sameOrigin(url) || (isPermittedDownloadUrl(url) && isTrustedCloudUrl(url))
}

function resolveOutputDir(inst: InstallationRecord): string | null {
  if ((inst.autoDownloadOutputs as boolean | undefined) === false) return null
  if ((inst.useSharedOutputDir as boolean | undefined) !== false) {
    return (settings.get('outputDir') as string | undefined) || settings.defaults.outputDir
  }
  const custom = inst.outputDir as string | undefined
  return custom && custom.trim() !== ''
    ? custom
    : (settings.get('outputDir') as string | undefined) || settings.defaults.outputDir
}

export function registerAssetDownloadHandlers(opts: {
  findInstallationIdForWindow: (win: BrowserWindow) => string | undefined
}): void {
  ipcMain.handle(
    'desktop2-download-asset',
    async (
      event,
      { url, filename, authToken }: { url: unknown; filename: unknown; authToken?: unknown }
    ) => {
      if (typeof url !== 'string' || typeof filename !== 'string') return false
      if (authToken !== undefined && typeof authToken !== 'string') return false
      const validateUrl = assetUrlCheckFor(event.sender)
      if (!validateUrl(url)) return false
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return false
      const installationId = opts.findInstallationIdForWindow(win)
      if (!installationId) return false
      const inst = await getInstallation(installationId)
      if (!inst) return false
      const outputDir = resolveOutputDir(inst)
      if (!outputDir) return false
      return startAssetDownload(win, url, filename, outputDir, authToken, event.sender, {
        validateUrl
      })
    }
  )
}
