import { ipcMain } from 'electron'
import { getEntryByInstallationId, hostInstallEvents } from '../host/registry'
import { _broadcastToRenderer } from '../lib/ipc/broadcast'

export const AUTO_START_READY_CHANNEL = 'auto-start-ready-changed'

let readyBuildId: string | null = null

function announce(): void {
  _broadcastToRenderer(AUTO_START_READY_CHANNEL, { installationId: readyBuildId })
}

function hasComfyWindow(installationId: string): boolean {
  return getEntryByInstallationId(installationId) !== undefined
}

export function autoStartReadyBuild(): string | null {
  return readyBuildId
}

export function noteAutoStartReady(installationId: string): void {
  if (hasComfyWindow(installationId)) return
  readyBuildId = installationId
  announce()
}

export function dismissAutoStartReady(installationId?: string): void {
  if (readyBuildId === null) return
  if (installationId !== undefined && installationId !== readyBuildId) return
  readyBuildId = null
  announce()
}

function dismissOnceItsWindowOpens(): void {
  if (readyBuildId !== null && hasComfyWindow(readyBuildId)) dismissAutoStartReady()
}

hostInstallEvents.on('changed', dismissOnceItsWindowOpens)

export function registerAutoStartNoticeHandlers(): void {
  ipcMain.handle('get-auto-start-ready', () => autoStartReadyBuild())
  ipcMain.handle('dismiss-auto-start-ready', (_event, installationId: unknown) =>
    dismissAutoStartReady(typeof installationId === 'string' ? installationId : undefined)
  )
}

export function _resetForTest(): void {
  readyBuildId = null
}
