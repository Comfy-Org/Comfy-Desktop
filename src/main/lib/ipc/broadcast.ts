import { BrowserWindow } from 'electron'

const _extraBroadcastTargets = new Set<Electron.WebContents>()

export function _registerExtraBroadcastTarget(wc: Electron.WebContents): void {
  _extraBroadcastTargets.add(wc)
  wc.once('destroyed', () => _extraBroadcastTargets.delete(wc))
}

export function _unregisterExtraBroadcastTarget(wc: Electron.WebContents): void {
  _extraBroadcastTargets.delete(wc)
}

export function _broadcastToRenderer(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(channel, data)
  })
  for (const wc of _extraBroadcastTargets) {
    if (!wc.isDestroyed()) wc.send(channel, data)
  }
}
