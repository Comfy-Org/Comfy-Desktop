import { ipcMain } from 'electron'
import { _broadcastToRenderer } from './broadcast'
import type { HomeTourReplayState } from '../../../types/ipc'

let replay = { id: 0, pending: false }

function broadcast(finished: boolean): void {
  const state: HomeTourReplayState = { ...replay, finished }
  _broadcastToRenderer('home-tour-replay-changed', state)
}

export function registerHomeTourHandlers(): void {
  ipcMain.handle('get-home-tour-replay', () => ({ ...replay }))
  ipcMain.handle('request-home-tour-replay', () => {
    replay = { id: replay.id + 1, pending: true }
    broadcast(false)
    return replay.id
  })
  ipcMain.handle('finish-home-tour', (_event, shownReplayId: unknown) => {
    if (shownReplayId === replay.id) replay = { ...replay, pending: false }
    broadcast(true)
  })
}
