import { subscribeLogs, unsubscribeLogs, getLogsBuffer, type LogsRestore } from '../logsBroadcast'
import { openLogsPopout } from '../logsPopoutWindow'
import { installOfLogsWindow, installShownTo } from './bridgeCallers'
import type { BridgeCaller } from './bridgeCallers'
import { handleBridge } from './comfyBridge'

const EMPTY_RESTORE: LogsRestore = { installationId: '', buffer: [] }

function installReadBy(caller: BridgeCaller): string | null {
  return installShownTo(caller)?.installationId ?? installOfLogsWindow(caller)
}

function ownInstallationId(caller: BridgeCaller, requested: unknown): string | null {
  const own = installReadBy(caller)
  const asksForAnotherInstall = requested !== null && requested !== undefined && requested !== own
  return asksForAnotherInstall ? null : own
}

export function registerLogsHandlers(): void {
  handleBridge('logs-subscribe', EMPTY_RESTORE, (event, installationId?: unknown): LogsRestore => {
    const id = ownInstallationId(event, installationId)
    return id ? subscribeLogs(id, event.sender) : EMPTY_RESTORE
  })

  handleBridge('logs-unsubscribe', undefined, (event, installationId?: unknown): void => {
    const id = ownInstallationId(event, installationId)
    if (id) unsubscribeLogs(id, event.sender)
  })

  handleBridge('logs-snapshot', '', (_event, installationId?: unknown): string =>
    typeof installationId === 'string' && installationId
      ? getLogsBuffer(installationId).join('')
      : ''
  )

  handleBridge('logs-popout-open', undefined, async (event): Promise<void> => {
    const installation = installShownTo(event)
    if (installation) await openLogsPopout(installation.installationId)
  })
}
