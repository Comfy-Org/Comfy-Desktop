import { ipcMain } from 'electron'

import {
  captureAppPage,
  hideAppPage,
  sendAppOutputAction,
  showAppPage
} from '../../apps/appPageView'
import { listApps } from '../../apps/appsCatalog'
import { areAppsEnabled } from '../../apps/appsConfig'
import { readOutputAction } from '../../apps/outputRequest'
import { isPanelSender } from '../../host/registry'

export function registerAppsHandlers(): void {
  ipcMain.handle('apps:get-enabled', () => areAppsEnabled())

  ipcMain.handle('apps:list', async (event) => {
    if (!isPanelSender(event.sender) || !(await areAppsEnabled())) return []
    return listApps()
  })

  ipcMain.handle('apps:show-page', (event, appId: unknown, placement: unknown) =>
    showAppPage(event.sender, appId, placement)
  )

  ipcMain.handle('apps:capture-page', (event) => captureAppPage(event.sender))

  ipcMain.on('apps:hide-page', (event) => hideAppPage(event.sender))

  ipcMain.on('apps:output-action', (event, raw: unknown) => {
    const action = readOutputAction(raw)
    if (action) sendAppOutputAction(event.sender, action)
  })
}
