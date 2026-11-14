import { ipcMain } from 'electron'
import type { IpcMainEvent } from 'electron'

import { trackAppPageEvent } from '../../apps/appPageEvents'
import { appIdOfPage } from '../../apps/appPageView'
import { areAppsEnabled } from '../../apps/appsConfig'
import { isAppsPageSender } from '../../apps/appsPages'

export const APPS_TELEMETRY_TRACK_CHANNEL = 'apps-telemetry:track'

interface TrackPayload {
  name?: unknown
  props?: unknown
}

async function isFromAppsPage(event: IpcMainEvent): Promise<boolean> {
  return isAppsPageSender(event.sender, event.senderFrame) && (await areAppsEnabled())
}

export async function trackFromAppsPage(event: IpcMainEvent, payload: unknown): Promise<boolean> {
  if (!(await isFromAppsPage(event))) return false
  const appId = appIdOfPage(event.sender)
  if (appId === null) return false
  const { name, props } = (payload && typeof payload === 'object' ? payload : {}) as TrackPayload
  return trackAppPageEvent(name, props, appId)
}

export function registerAppsTelemetryHandlers(): void {
  ipcMain.on(APPS_TELEMETRY_TRACK_CHANNEL, (event, payload: unknown) => {
    trackFromAppsPage(event, payload).catch(() => {})
  })
}
