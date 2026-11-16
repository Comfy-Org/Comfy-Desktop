import { ipcMain } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'

import { loadedAppPage, sendAppOutputAction, showAppOutputs } from '../../apps/appPageView'
import { areAppsEnabled } from '../../apps/appsConfig'
import { isAppsPageSender } from '../../apps/appsPages'
import { readOutputAction, readOutputRequest } from '../../apps/outputRequest'

export const APPS_OUTPUTS_SHOW_CHANNEL = 'apps-outputs:show'
export const APPS_OUTPUT_ACTION_CHANNEL = 'apps:output-action'

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

export function takeOutputAction(event: IpcMainEvent, raw: unknown): void {
  const action = readOutputAction(raw)
  if (action) sendAppOutputAction(event.sender, action)
}

export function registerAppsOutputsHandlers(): void {
  ipcMain.handle(APPS_OUTPUTS_SHOW_CHANNEL, showOutputFromAppsPage)
  ipcMain.on(APPS_OUTPUT_ACTION_CHANNEL, takeOutputAction)
}
