import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { findInstallationIdByComfySender } from '../../host/registry'
import { subscribeLogs, unsubscribeLogs, getLogsBuffer, type LogsRestore } from '../logsBroadcast'
import { openLogsPopout } from '../logsPopoutWindow'

const EMPTY_RESTORE: LogsRestore = { installationId: '', buffer: [] }

function resolveInstallationId(
  event: IpcMainInvokeEvent,
  explicit: string | null | undefined
): string | null {
  if (explicit) return explicit
  return findInstallationIdByComfySender(event.sender)
}

export function registerLogsHandlers(): void {
  ipcMain.handle('logs-subscribe', (event, installationId?: string | null): LogsRestore => {
    const id = resolveInstallationId(event, installationId)
    if (!id) return EMPTY_RESTORE
    return subscribeLogs(id, event.sender)
  })

  ipcMain.handle('logs-unsubscribe', (event, installationId?: string | null) => {
    const id = resolveInstallationId(event, installationId)
    if (id) unsubscribeLogs(id, event.sender)
  })

  ipcMain.handle('logs-snapshot', (event, installationId?: string | null): string => {
    const id = resolveInstallationId(event, installationId)
    if (!id) return ''
    return getLogsBuffer(id).join('')
  })

  ipcMain.handle(
    'logs-popout-open',
    async (event, installationId?: string | null): Promise<void> => {
      const id = resolveInstallationId(event, installationId)
      if (!id) return
      await openLogsPopout(id)
    }
  )
}
