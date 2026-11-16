import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'

import { loadedAppPage, showAppOutputs } from '../../apps/appPageView'
import { areAppsEnabled } from '../../apps/appsConfig'
import { isAppsPageSender } from '../../apps/appsPages'
import { readOutputRequest } from '../../apps/outputRequest'

export const APPS_OUTPUTS_SHOW_CHANNEL = 'apps-outputs:show'

async function isFromAppsPage(event: IpcMainInvokeEvent): Promise<boolean> {
  return isAppsPageSender(event.sender, event.senderFrame) && (await areAppsEnabled())
}

export async function showOutputFromAppsPage(
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<boolean> {
  const sentFrom = loadedAppPage(event.sender)
  if (sentFrom === null || !(await isFromAppsPage(event))) return false
  const outputs = readOutputRequest(request)
  if (!outputs) throw new Error('Desktop cannot show these outputs.')
  return showAppOutputs(event.sender, sentFrom, outputs)
}

export function registerAppsOutputsHandlers(): void {
  ipcMain.handle(APPS_OUTPUTS_SHOW_CHANNEL, showOutputFromAppsPage)
}
