import { ipcMain, Menu } from 'electron'
import type { IpcMainEvent } from 'electron'

import {
  appRuns,
  captureAppPage,
  hideAppPage,
  noteAppPageRunning,
  runningApps,
  showAppPage
} from '../../apps/appPageView'
import { listApps } from '../../apps/appsCatalog'
import { areAppsEnabled } from '../../apps/appsConfig'
import { isAppsPageSender } from '../../apps/appsPages'
import { findEntryByTitleBarSender, isPanelSender } from '../../host/registry'
import { sendSurveyResponse } from '../telemetry'

const APP_REQUEST_SURVEY_ID = '01a1f22e-d672-0000-a5ce-85d8a1d81406'
const APP_REQUEST_QUESTION_ID = '0f16a789-5c8e-4871-b44e-ec11c54b8c9b'
const APP_REQUEST_MAX_LENGTH = 500

export const OPEN_RUNNING_APP_CHANNEL = 'apps:open-running-app'

interface MenuAnchor {
  x?: unknown
  y?: unknown
}

function anchorCoordinate(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

function openRunningApps(event: IpcMainEvent, anchor: MenuAnchor | undefined): void {
  const found = findEntryByTitleBarSender(event.sender)
  if (!found || found.entry.window.isDestroyed()) return
  const panel = found.entry.panelView?.webContents
  if (!panel || panel.isDestroyed()) return
  const apps = runningApps(found.id)
  const open = (appId: string): void => panel.send(OPEN_RUNNING_APP_CHANNEL, appId)
  const [only, ...others] = apps
  if (!only) return
  if (others.length === 0) {
    open(only.id)
    return
  }
  Menu.buildFromTemplate(
    apps.map((app) => ({ label: app.title, click: () => open(app.id) }))
  ).popup({
    window: found.entry.window,
    x: anchorCoordinate(anchor?.x),
    y: anchorCoordinate(anchor?.y)
  })
}

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

  ipcMain.handle('apps:get-runs', (event) =>
    isPanelSender(event.sender) ? appRuns(event.sender) : []
  )

  ipcMain.on('apps-page:running', (event, running: unknown) => {
    if (isAppsPageSender(event.sender, event.senderFrame)) noteAppPageRunning(event.sender, running)
  })

  ipcMain.on('comfy-titlebar:click-running-apps', (event, payload: { anchor?: MenuAnchor }) =>
    openRunningApps(event, payload?.anchor)
  )

  ipcMain.on('apps:hide-page', (event) => hideAppPage(event.sender))

  ipcMain.handle('apps:send-request', async (event, text: unknown) => {
    if (!isPanelSender(event.sender) || typeof text !== 'string') return false
    const request = text.trim().slice(0, APP_REQUEST_MAX_LENGTH)
    if (!request) return false
    return sendSurveyResponse(APP_REQUEST_SURVEY_ID, APP_REQUEST_QUESTION_ID, request)
  })
}
