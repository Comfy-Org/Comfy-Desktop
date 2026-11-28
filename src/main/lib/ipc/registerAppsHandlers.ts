import { ipcMain } from 'electron'
import type { IpcMainEvent } from 'electron'

import {
  appRuns,
  appSwitchStopsRun,
  askPageToStopRun,
  captureAppPage,
  closeAppPage,
  closeDraftPages,
  closeStaffPagesOfOtherAccounts,
  hideAppPage,
  noteAppPageRunning,
  noteAppPageRuns,
  onReportedRunsChanged,
  reportedRunPages,
  showAppPage,
  tellPanelsTheListChanged,
  titleBarApps
} from '../../apps/appPageView'
import { listApps, pictureForListedApp } from '../../apps/appsCatalog'
import { isAppsPageSender } from '../../apps/appsPages'
import {
  forgetHiddenApps,
  listHiddenApps,
  NO_HIDDEN_APPS,
  pictureForHiddenApp
} from '../../apps/hiddenApps'
import { currentDrafts, draftCards } from '../../apps/draftApps'
import {
  acceptDraft,
  canPasteDrafts,
  draftsStillAllowed,
  openPastedDraft
} from '../../apps/draftLinks'
import { usableLocalBuilds } from '../../apps/localBuild'
import { pageBuildId } from '../../apps/localComfy'
import { findEntryByTitleBarSender, isPanelSender } from '../../host/registry'
import {
  closeRunsPopup,
  isGlobalSettingsSender,
  isRunsPopupOpen,
  openRunningAppsMenu,
  openRunsPopup,
  refreshRunsPopup,
  runsPopupWindowKey
} from '../../popups/titlePopup'
import { OPEN_RUNNING_APP_CHANNEL } from '../../../types/ipc'
import type { RunningApp, TitleBarOpenApp, TitleBarRunOverview } from '../../../types/ipc'
import { cloudAuthEvents } from '../cloudAuthEvents'
import { sendSurveyResponse } from '../telemetry'

const APP_REQUEST_SURVEY_ID = '01a1f22e-d672-0000-a5ce-85d8a1d81406'
const APP_REQUEST_QUESTION_ID = '0f16a789-5c8e-4871-b44e-ec11c54b8c9b'
const APP_REQUEST_MAX_LENGTH = 500

let authChanges = 0

async function closeDraftsNoLongerAllowed(): Promise<void> {
  const change = ++authChanges
  const inspected = currentDrafts()
  const allowed = await draftsStillAllowed().catch(() => false)
  if (allowed || change !== authChanges) return
  closeDraftPages(inspected)
}

function dropHiddenApps(): void {
  closeStaffPagesOfOtherAccounts()
  forgetHiddenApps()
  tellPanelsTheListChanged()
}

interface MenuAnchor {
  x?: unknown
  y?: unknown
}

function anchorCoordinate(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

function pictureOf(appId: string): string | null {
  return pictureForListedApp(appId) ?? pictureForHiddenApp(appId)
}

function hasReportedRuns(windowKey: number): boolean {
  return reportedRunPages(windowKey).some(({ runs }) => runs.length > 0)
}

const buildNamesByWindow = new Map<number, Map<string, string>>()
const opensInFlight = new Set<number>()

async function readBuildNames(): Promise<Map<string, string>> {
  const builds = await usableLocalBuilds().catch(() => [])
  return new Map(builds.map(({ id, name }) => [id, name]))
}

function openApps(windowKey: number): TitleBarOpenApp[] {
  const { running, ready } = titleBarApps(windowKey)
  const withState = (state: TitleBarOpenApp['state']) => (app: RunningApp) => ({
    ...app,
    picture: pictureOf(app.id),
    state
  })
  return [...running.map(withState('running')), ...ready.map(withState('ready'))]
}

function runOverview(windowKey: number, buildNames: Map<string, string>): TitleBarRunOverview {
  const pages = reportedRunPages(windowKey)
  const listing = new Set(pages.filter(({ runs }) => runs.length > 0).map(({ appId }) => appId))
  const runs = pages.flatMap(({ appId, title, page, runs }) => {
    const pageBuild = pageBuildId(page)
    return runs.map((run) => {
      const buildId = run.where === 'local' ? pageBuild : null
      return {
        ...run,
        appId,
        appTitle: title,
        picture: pictureOf(appId),
        buildId,
        buildName: buildId === null ? null : (buildNames.get(buildId) ?? null)
      }
    })
  })
  const apps = openApps(windowKey).filter(({ id }) => !listing.has(id))
  return { runs, apps }
}

async function openOverview(windowKey: number, at: { x: number; y: number }): Promise<void> {
  if (opensInFlight.has(windowKey)) return
  opensInFlight.add(windowKey)
  try {
    const buildNames = await readBuildNames()
    buildNamesByWindow.set(windowKey, buildNames)
    openRunsPopup(windowKey, runOverview(windowKey, buildNames), at)
  } finally {
    opensInFlight.delete(windowKey)
  }
}

function openRunningApps(event: IpcMainEvent, anchor: MenuAnchor | undefined): void {
  const found = findEntryByTitleBarSender(event.sender)
  if (!found || found.entry.window.isDestroyed()) return
  const at = { x: anchorCoordinate(anchor?.x), y: anchorCoordinate(anchor?.y) }
  if (hasReportedRuns(found.id)) {
    void openOverview(found.id, at)
    return
  }
  const panel = found.entry.panelView?.webContents
  if (!panel || panel.isDestroyed()) return
  const apps = openApps(found.id)
  const [only, ...others] = apps
  if (!only) return
  if (others.length === 0) {
    panel.send(OPEN_RUNNING_APP_CHANNEL, only.id)
    return
  }
  openRunningAppsMenu(found.id, apps, at)
}

function refreshOpenRunsPopup(windowKey: number): void {
  if (!isRunsPopupOpen(windowKey)) return
  const overview = runOverview(windowKey, buildNamesByWindow.get(windowKey) ?? new Map())
  if (overview.runs.length === 0 && overview.apps.length === 0) {
    closeRunsPopup(windowKey)
    return
  }
  refreshRunsPopup(windowKey, overview)
}

export function registerAppsHandlers(): void {
  ipcMain.handle('apps:list', async (event) => {
    if (!isPanelSender(event.sender)) return []
    const listed = await listApps()
    return [...draftCards(), ...listed]
  })

  ipcMain.handle('apps:list-hidden', async (event) => {
    if (!isPanelSender(event.sender)) return NO_HIDDEN_APPS
    return listHiddenApps().catch(() => NO_HIDDEN_APPS)
  })

  ipcMain.handle('apps:show-page', (event, appId: unknown, placement: unknown) =>
    showAppPage(event.sender, appId, placement)
  )

  ipcMain.handle('apps:capture-page', (event) => captureAppPage(event.sender))

  ipcMain.handle('apps:accept-draft', (event, token: unknown) => acceptDraft(event.sender, token))

  ipcMain.handle('apps:can-paste-draft', (event) =>
    isGlobalSettingsSender(event.sender) ? canPasteDrafts() : false
  )

  ipcMain.handle('apps:open-pasted-draft', (event, address: unknown) =>
    isGlobalSettingsSender(event.sender) ? openPastedDraft(address) : null
  )

  ipcMain.handle('apps:get-runs', (event) =>
    isPanelSender(event.sender) ? appRuns(event.sender) : []
  )

  ipcMain.handle('apps:switch-stops-run', (event, appId: unknown) =>
    isPanelSender(event.sender) ? appSwitchStopsRun(event.sender, appId) : null
  )

  ipcMain.on('apps-page:running', (event, running: unknown) => {
    if (isAppsPageSender(event.sender, event.senderFrame)) noteAppPageRunning(event.sender, running)
  })

  ipcMain.on('apps-page:runs', (event, runs: unknown) => {
    if (isAppsPageSender(event.sender, event.senderFrame)) noteAppPageRuns(event.sender, runs)
  })

  onReportedRunsChanged(refreshOpenRunsPopup)

  ipcMain.on('comfy-titlepopup:stop-run', (event, appId: unknown, runId: unknown) => {
    const windowKey = runsPopupWindowKey(event.sender)
    if (windowKey !== null) askPageToStopRun(windowKey, appId, runId)
  })

  ipcMain.on('comfy-titlebar:click-running-apps', (event, payload: { anchor?: MenuAnchor }) =>
    openRunningApps(event, payload?.anchor)
  )

  ipcMain.on('apps:hide-page', (event) => hideAppPage(event.sender))

  ipcMain.on('apps:close-page', (event, appId: unknown) => {
    if (isPanelSender(event.sender)) closeAppPage(event.sender, appId)
  })

  cloudAuthEvents.on('changed', () => void closeDraftsNoLongerAllowed())
  cloudAuthEvents.on('changed', dropHiddenApps)

  ipcMain.handle('apps:send-request', async (event, text: unknown) => {
    if (!isPanelSender(event.sender) || typeof text !== 'string') return false
    const request = text.trim().slice(0, APP_REQUEST_MAX_LENGTH)
    if (!request) return false
    return sendSurveyResponse(APP_REQUEST_SURVEY_ID, APP_REQUEST_QUESTION_ID, request)
  })
}
