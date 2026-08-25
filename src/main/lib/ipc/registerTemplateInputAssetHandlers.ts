import { BrowserWindow, ipcMain } from 'electron'
import { get as getInstallation, type InstallationRecord } from '../../installations'
import {
  resolveInputDir,
  resolveTemplateInputAssetAvailability,
  resolveTemplateInputAssetSnapshot
} from '../../sources/standalone/templateInputAssets'
import { isPersistableTemplateId } from '../../sources/standalone/curatedTemplates'
import {
  getActiveAssetDownload,
  startManagedAssetDownload,
  type DownloadProgress
} from '../comfyDownloadManager'
import type {
  ComfyTemplateInputAsset,
  ComfyTemplateInputAssetDownload,
  ComfyTemplateInputAssetDownloadResult
} from '../../../types/comfyDesktopBridge'

interface TemplateInputAssetHandlerOptions {
  findInstallationIdForWindow: (win: BrowserWindow) => string | undefined
  isLocalInstallation: (installation: InstallationRecord) => boolean
}

function toDownloadSnapshot(
  progress: DownloadProgress | undefined,
  downloadId?: string,
  filename?: string
): ComfyTemplateInputAssetDownload | undefined {
  const resolvedId = progress?.id ?? downloadId
  const resolvedFilename = progress?.filename ?? filename
  if (!resolvedId || !resolvedFilename) return undefined

  return {
    downloadId: resolvedId,
    filename: resolvedFilename,
    progress: progress?.progress ?? 0,
    ...(progress?.receivedBytes === undefined ? {} : { receivedBytes: progress.receivedBytes }),
    ...(progress?.totalBytes === undefined ? {} : { totalBytes: progress.totalBytes }),
    status: progress?.status ?? 'pending',
    ...(progress?.error === undefined ? {} : { error: progress.error })
  }
}

export function registerTemplateInputAssetHandlers({
  findInstallationIdForWindow,
  isLocalInstallation
}: TemplateInputAssetHandlerOptions): void {
  async function resolveRequestContext(sender: Electron.WebContents) {
    const win = BrowserWindow.fromWebContents(sender)
    if (!win) return null
    const installationId = findInstallationIdForWindow(win)
    if (!installationId) return null
    const installation = await getInstallation(installationId)
    return installation && isLocalInstallation(installation) ? { installation, win } : null
  }

  ipcMain.handle(
    'desktop2-get-template-input-assets',
    async (
      event,
      { templateId }: { templateId: unknown }
    ): Promise<ComfyTemplateInputAsset[] | null> => {
      if (!isPersistableTemplateId(templateId)) return null
      const context = await resolveRequestContext(event.sender)
      if (!context) return null

      const assets = await resolveTemplateInputAssetSnapshot(context.installation, templateId)
      if (!assets) return null
      const availability = await resolveTemplateInputAssetAvailability(
        context.installation,
        assets.map(({ filename }) => filename)
      )
      const availabilityByFilename = new Map(
        availability.map(({ filename, status }) => [filename, status])
      )
      const inputDir = resolveInputDir(context.installation)

      return assets.map(({ assetId, filename, mediaType, previewUrl, url }) => {
        const activeDownload = toDownloadSnapshot(getActiveAssetDownload(url, filename, inputDir))
        return {
          assetId,
          filename,
          mediaType,
          previewUrl,
          availability: availabilityByFilename.get(filename) ?? 'unknown',
          ...(activeDownload ? { activeDownload } : {})
        }
      })
    }
  )

  ipcMain.handle(
    'desktop2-download-template-input-asset',
    async (
      event,
      { templateId, assetId }: { templateId: unknown; assetId: unknown }
    ): Promise<ComfyTemplateInputAssetDownloadResult> => {
      if (!isPersistableTemplateId(templateId) || typeof assetId !== 'string') {
        return { status: 'not-started' as const, reason: 'invalid-request' as const }
      }
      const context = await resolveRequestContext(event.sender)
      if (!context) {
        return { status: 'not-started' as const, reason: 'unavailable' as const }
      }

      const assets = await resolveTemplateInputAssetSnapshot(context.installation, templateId)
      if (!assets) {
        return { status: 'not-started' as const, reason: 'unavailable' as const }
      }
      const asset = assets.find((candidate) => candidate.assetId === assetId)
      if (!asset) {
        return { status: 'not-started' as const, reason: 'not-declared' as const }
      }

      const [availability] = await resolveTemplateInputAssetAvailability(context.installation, [
        asset.filename
      ])
      if (availability?.status === 'present') return { status: 'already-present' as const }
      if (availability?.status !== 'missing') {
        return { status: 'not-started' as const, reason: 'unavailable' as const }
      }

      const inputDir = resolveInputDir(context.installation)
      const admission = await startManagedAssetDownload(
        context.win,
        asset.url,
        asset.filename,
        inputDir,
        undefined,
        event.sender,
        { existingFilePolicy: 'skip' }
      )
      if (admission.status === 'already-present') return admission
      if (admission.status === 'not-started') {
        return { status: 'not-started' as const, reason: 'unavailable' as const }
      }

      const download = toDownloadSnapshot(
        getActiveAssetDownload(asset.url, asset.filename, inputDir),
        admission.downloadId,
        asset.filename
      )
      if (!download) {
        return { status: 'not-started' as const, reason: 'unavailable' as const }
      }
      return { status: admission.status, download }
    }
  )
}
