import { ipcMain } from 'electron'
import { _broadcastToRenderer } from './broadcast'

let replayPending = false

export function registerHomeTourHandlers(): void {
  ipcMain.handle('get-home-tour-replay', () => replayPending)
  ipcMain.handle('set-home-tour-replay', (_event, pending: unknown) => {
    replayPending = pending === true
    _broadcastToRenderer('home-tour-replay-changed', replayPending)
  })
}
