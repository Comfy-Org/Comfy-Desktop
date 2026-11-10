import { sourceMap } from '../lib/ipc/shared'
import { getAppVersion } from '../lib/ipc'
import { get as getInstallation } from '../installations'
import type { ComfyWindowEntry } from './registry'
import { hostInstallEvents, isInstallHost } from './registry'
import {
  applyChooserHostTheme,
  CHOOSER_HOST_TITLE_TEXT,
  CHOOSER_HOST_WINDOW_TITLE
} from './createHostWindow'

const APP_VERSION = getAppVersion()

export async function applyAttachHostPreview(
  entry: ComfyWindowEntry,
  installationId: string
): Promise<void> {
  if (entry.window.isDestroyed()) return
  if (isInstallHost(entry)) return
  const previewChanged = entry.previewInstallationId !== installationId
  entry.previewInstallationId = installationId
  if (previewChanged) hostInstallEvents.emit('changed')
  const installation = await getInstallation(installationId)
  if (entry.previewInstallationId !== installationId) return
  if (entry.window.isDestroyed()) return
  if (isInstallHost(entry)) return
  if (!installation) {
    clearAttachHostPreview(entry)
    return
  }
  entry.titleBarText = installation.name
  entry.sourceCategory = sourceMap[installation.sourceId]?.category ?? null
  entry.window.setTitle(`${installation.name} — Comfy Desktop v${APP_VERSION}`)
  if (!entry.titleBarView.webContents.isDestroyed()) {
    entry.titleBarView.webContents.send('comfy-titlebar:title-changed', entry.titleBarText)
    entry.titleBarView.webContents.send(
      'comfy-titlebar:source-category-changed',
      entry.sourceCategory
    )
    entry.titleBarView.webContents.send('comfy-titlebar:preview-mode-changed', true)
  }
}

export function clearAttachHostPreview(entry: ComfyWindowEntry): void {
  if (entry.previewInstallationId === null) return
  entry.previewInstallationId = null
  if (entry.window.isDestroyed()) {
    hostInstallEvents.emit('changed')
    return
  }
  if (isInstallHost(entry)) {
    hostInstallEvents.emit('changed')
    return
  }
  entry.titleBarText = CHOOSER_HOST_TITLE_TEXT
  entry.sourceCategory = null
  entry.window.setTitle(CHOOSER_HOST_WINDOW_TITLE)
  if (!entry.titleBarView.webContents.isDestroyed()) {
    entry.titleBarView.webContents.send('comfy-titlebar:title-changed', entry.titleBarText)
    entry.titleBarView.webContents.send(
      'comfy-titlebar:source-category-changed',
      entry.sourceCategory
    )
    entry.titleBarView.webContents.send('comfy-titlebar:preview-mode-changed', false)
  }
  applyChooserHostTheme(entry)
  hostInstallEvents.emit('changed')
}
