import { ipcMain } from 'electron'

import { captureAppPage, hideAppPage, showAppPage } from '../../apps/appPageView'
import { listApps } from '../../apps/appsCatalog'
import { areAppsEnabled } from '../../apps/appsConfig'
import { isPanelSender } from '../../host/registry'
import { sendSurveyResponse } from '../telemetry'

const APP_REQUEST_SURVEY_ID = '01a1f22e-d672-0000-a5ce-85d8a1d81406'
const APP_REQUEST_QUESTION_ID = '0f16a789-5c8e-4871-b44e-ec11c54b8c9b'
const APP_REQUEST_MAX_LENGTH = 500

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

  ipcMain.handle('apps:send-request', async (event, text: unknown) => {
    if (!isPanelSender(event.sender) || typeof text !== 'string') return false
    const request = text.trim().slice(0, APP_REQUEST_MAX_LENGTH)
    if (!request) return false
    return sendSurveyResponse(APP_REQUEST_SURVEY_ID, APP_REQUEST_QUESTION_ID, request)
  })
}
