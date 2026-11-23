import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'

import { loadedAppPage } from '../../apps/appPageView'
import type { LoadedAppPage } from '../../apps/appPageView'
import { areAppsEnabled } from '../../apps/appsConfig'
import { appsPageAdmits, isAppsPageSender, liveAppsPages } from '../../apps/appsPages'
import { COMFYUI_EXITED, onRunEnded, onRunsChanged } from '../../apps/localAppEvents'
import {
  localDownload,
  localFetch,
  localState,
  sendToPages,
  startLocal
} from '../../apps/localComfy'
import { machine } from '../../apps/machine'
import { localBuilds, localBuildsForEach, openInComfy } from '../../apps/openInComfy'
import type {
  ComfyDesktopLocalBuild,
  ComfyDesktopLocalComfy,
  ComfyDesktopLocalDownload,
  ComfyDesktopMachine,
  ComfyDesktopOpenInComfy
} from '../../../types/comfyDesktopBridge'
import * as i18n from '../i18n'

export const APPS_LOCAL_CHANNELS = {
  get: 'apps-local:get',
  start: 'apps-local:start',
  fetch: 'apps-local:fetch',
  download: 'apps-local:download',
  openInComfy: 'apps-local:open-in-comfy',
  builds: 'apps-local:builds',
  buildsChanged: 'apps-local:builds-changed',
  machine: 'apps-local:machine'
} as const

let latestAnnouncement = 0

async function announceBuilds(): Promise<void> {
  const announcement = ++latestAnnouncement
  if (liveAppsPages().length === 0 || !(await areAppsEnabled())) return
  const pages = liveAppsPages()
  const asked = pages.map((page) => loadedAppPage(page))
  const lists = await localBuildsForEach(asked.map((loaded) => loaded?.appId ?? null)).catch(
    () => null
  )
  if (!lists || announcement !== latestAnnouncement) return
  const admitted = await Promise.all(pages.map((page) => appsPageAdmits(page)))
  if (announcement !== latestAnnouncement) return
  pages.forEach((page, index) => {
    const builds = lists[index]
    if (!builds || !admitted[index] || page.isDestroyed()) return
    if (!isSamePage(loadedAppPage(page), asked[index] ?? null)) return
    page.send(APPS_LOCAL_CHANNELS.buildsChanged, builds)
  })
}

async function isFromAppsPage(event: IpcMainInvokeEvent): Promise<boolean> {
  return (
    isAppsPageSender(event.sender, event.senderFrame) &&
    (await areAppsEnabled()) &&
    (await appsPageAdmits(event.sender))
  )
}

interface Caller {
  appId: string | null
}

function isSamePage(now: LoadedAppPage | null, sent: LoadedAppPage | null): boolean {
  return now?.appId === sent?.appId && now?.document === sent?.document
}

async function callerUnchanged(event: IpcMainInvokeEvent): Promise<Caller | null> {
  const sentFrom = loadedAppPage(event.sender)
  if (!(await isFromAppsPage(event))) return null
  if (!isSamePage(loadedAppPage(event.sender), sentFrom)) return null
  return { appId: sentFrom?.appId ?? null }
}

function notOffered(): ComfyDesktopLocalComfy {
  return { state: 'unsupported', error: i18n.t('apps.local.notRunning') }
}

export function registerAppsLocalHandlers(): void {
  ipcMain.handle(APPS_LOCAL_CHANNELS.get, async (event, want: unknown) =>
    (await isFromAppsPage(event)) ? localState(event.sender, want) : notOffered()
  )

  ipcMain.handle(APPS_LOCAL_CHANNELS.start, async (event, want: unknown) => {
    const caller = await callerUnchanged(event)
    return caller ? startLocal(event.sender, want, caller.appId) : notOffered()
  })

  ipcMain.handle(APPS_LOCAL_CHANNELS.fetch, async (event, request: unknown) => {
    const caller = await callerUnchanged(event)
    if (!caller) throw new Error(i18n.t('apps.local.notRunning'))
    return localFetch(event.sender, request, caller.appId)
  })

  ipcMain.handle(
    APPS_LOCAL_CHANNELS.download,
    async (event, model: unknown): Promise<ComfyDesktopLocalDownload> => {
      const caller = await callerUnchanged(event)
      return caller
        ? localDownload(event.sender, model, caller.appId)
        : { state: 'failed', error: i18n.t('apps.local.notRunning') }
    }
  )

  ipcMain.handle(
    APPS_LOCAL_CHANNELS.openInComfy,
    async (event, request: unknown): Promise<ComfyDesktopOpenInComfy> =>
      (await isFromAppsPage(event))
        ? openInComfy(event.sender, request)
        : { opened: false, error: i18n.t('apps.local.notRunning') }
  )

  ipcMain.handle(APPS_LOCAL_CHANNELS.builds, async (event): Promise<ComfyDesktopLocalBuild[]> => {
    const caller = await callerUnchanged(event)
    return caller ? localBuilds(caller.appId) : []
  })

  ipcMain.handle(APPS_LOCAL_CHANNELS.machine, async (event): Promise<ComfyDesktopMachine> => {
    if (!(await isFromAppsPage(event))) throw new Error(i18n.t('apps.local.notRunning'))
    return machine()
  })

  onRunsChanged(() => void announceBuilds())
  onRunEnded((promptId, end) => {
    if (end.errorClass !== COMFYUI_EXITED) return
    sendToPages({ type: 'run_failed', data: { prompt_id: promptId, reason: COMFYUI_EXITED } })
  })
}
