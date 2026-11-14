import { ipcMain } from 'electron'
import type { IpcMainEvent } from 'electron'

import { trackAppPageEvent } from '../../apps/appPageEvents'
import { loadedAppPage } from '../../apps/appPageView'
import type { LoadedAppPage } from '../../apps/appPageView'
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

function isSamePage(now: LoadedAppPage | null, sent: LoadedAppPage): boolean {
  return now !== null && now.appId === sent.appId && now.document === sent.document
}

export async function trackFromAppsPage(event: IpcMainEvent, payload: unknown): Promise<boolean> {
  const sentFrom = loadedAppPage(event.sender)
  if (sentFrom === null || !(await isFromAppsPage(event))) return false
  if (!isSamePage(loadedAppPage(event.sender), sentFrom)) return false
  const { name, props } = (payload && typeof payload === 'object' ? payload : {}) as TrackPayload
  return trackAppPageEvent(name, props, sentFrom.appId)
}

export function registerAppsTelemetryHandlers(): void {
  ipcMain.on(APPS_TELEMETRY_TRACK_CHANNEL, (event, payload: unknown) => {
    trackFromAppsPage(event, payload).catch(() => {})
  })
}
