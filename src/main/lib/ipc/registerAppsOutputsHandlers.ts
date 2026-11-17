import { ipcMain } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'

import {
  loadedAppPage,
  sendAppOutputAction,
  showAppOutputs,
  shownOutputFile
} from '../../apps/appPageView'
import { areAppsEnabled } from '../../apps/appsConfig'
import { isAppsPageSender } from '../../apps/appsPages'
import { findInPageBuild, locateOutputFiles } from '../../apps/outputFiles'
import { readOutputAction, readOutputRequest } from '../../apps/outputRequest'
import { revealOutputFile } from '../outputFolders'

export const APPS_OUTPUTS_SHOW_CHANNEL = 'apps-outputs:show'
export const APPS_OUTPUT_ACTION_CHANNEL = 'apps:output-action'

const latestRequest = new WeakMap<WebContents, number>()

async function isFromAppsPage(event: IpcMainInvokeEvent): Promise<boolean> {
  return isAppsPageSender(event.sender, event.senderFrame) && (await areAppsEnabled())
}

function takeTurn(page: WebContents): () => boolean {
  const turn = (latestRequest.get(page) ?? 0) + 1
  latestRequest.set(page, turn)
  return () => latestRequest.get(page) === turn
}

export async function showOutputFromAppsPage(
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<boolean> {
  const sentFrom = loadedAppPage(event.sender)
  if (sentFrom === null || !(await isFromAppsPage(event))) return false
  const outputs = readOutputRequest(request)
  if (!outputs) throw new Error('Desktop cannot show these outputs.')
  const isLatest = takeTurn(event.sender)
  const located = await locateOutputFiles(outputs, await findInPageBuild(event.sender))
  if (!isLatest()) return false
  return showAppOutputs(event.sender, sentFrom, located.outputs, located.files)
}

export function takeOutputAction(event: IpcMainEvent, raw: unknown): void {
  const action = readOutputAction(raw)
  if (!action) return
  const file =
    action.action === 'show-in-folder' ? shownOutputFile(event.sender, action.index) : null
  if (file) void revealOutputFile(file).catch(() => false)
  else sendAppOutputAction(event.sender, action)
}

export function registerAppsOutputsHandlers(): void {
  ipcMain.handle(APPS_OUTPUTS_SHOW_CHANNEL, showOutputFromAppsPage)
  ipcMain.on(APPS_OUTPUT_ACTION_CHANNEL, takeOutputAction)
}
