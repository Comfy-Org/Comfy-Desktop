import { ipcMain } from 'electron'

import { captureAppPage, hideAppPage, reloadAppPage, showAppPage } from '../../apps/appPageView'
import { listApps } from '../../apps/appsCatalog'
import { areAppsEnabled } from '../../apps/appsConfig'
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

  ipcMain.on('apps:reload-page', (event, appId: unknown) => reloadAppPage(event.sender, appId))
}
