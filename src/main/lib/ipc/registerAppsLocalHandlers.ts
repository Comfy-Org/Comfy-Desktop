import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'

import { areAppsEnabled } from '../../apps/appsConfig'
import { isAppsPageSender } from '../../apps/appsPages'
import { localDownload, localFetch, localState, startLocal } from '../../apps/localComfy'
import type {
  ComfyDesktopLocalComfy,
  ComfyDesktopLocalDownload
} from '../../../types/comfyDesktopBridge'
import * as i18n from '../i18n'

export const APPS_LOCAL_CHANNELS = {
  get: 'apps-local:get',
  start: 'apps-local:start',
  fetch: 'apps-local:fetch',
  download: 'apps-local:download'
} as const

async function isFromAppsPage(event: IpcMainInvokeEvent): Promise<boolean> {
  return isAppsPageSender(event.sender, event.senderFrame) && (await areAppsEnabled())
}

function notOffered(): ComfyDesktopLocalComfy {
  return { state: 'unsupported', error: i18n.t('apps.local.notRunning') }
}

export function registerAppsLocalHandlers(): void {
  ipcMain.handle(APPS_LOCAL_CHANNELS.get, async (event, want: unknown) =>
    (await isFromAppsPage(event)) ? localState(want) : notOffered()
  )

  ipcMain.handle(APPS_LOCAL_CHANNELS.start, async (event, want: unknown) =>
    (await isFromAppsPage(event)) ? startLocal(want) : notOffered()
  )

  ipcMain.handle(APPS_LOCAL_CHANNELS.fetch, async (event, request: unknown) => {
    if (!(await isFromAppsPage(event))) throw new Error(i18n.t('apps.local.notRunning'))
    return localFetch(request)
  })

  ipcMain.handle(
    APPS_LOCAL_CHANNELS.download,
    async (event, model: unknown): Promise<ComfyDesktopLocalDownload> =>
      (await isFromAppsPage(event))
        ? localDownload(model)
        : { state: 'failed', error: i18n.t('apps.local.notRunning') }
  )
}
