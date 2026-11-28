import { net, session } from 'electron'
import type { Event, Session, WebContents, WebContentsView } from 'electron'
import path from 'path'

import { isAppsListUrl, isInAppsScope, isWebUrl } from '../../shared/appsLocation'
import type { AppsLocation } from '../../shared/appsLocation'
import type {
  AppOutputAction,
  AppOutputs,
  AppPagePlacement,
  AppPageStatus,
  AppRun,
  AppSwitchStop,
  DraftClosingStop,
  RunningApp,
  TitleBarApps
} from '../../types/ipc'
import { comfyWindows } from '../host/registry'
import type { ComfyWindowEntry } from '../host/registry'
import { attachSessionDownloadHandler } from '../lib/comfyDownloadManager'
import { attachContextMenu } from '../lib/contextMenu'
import { recordExposure } from '../lib/experiments'
import { tryOpenExternalUrl } from '../lib/openExternal'
import * as mainTelemetry from '../lib/telemetry'
import { COMFY_BG } from '../lib/theme'
import { createWebContentsView } from '../lib/webContentsViewLifetime'
import { pageTestGroupForListedApp, pageUrlForListedApp, titleForListedApp } from './appsCatalog'
import { currentAppsLocation } from './appsConfig'
import { startAnsweringFromKeptCopies, stopAnsweringFromKeptCopies } from './appsOffline'
import { registerAppsPage } from './appsPages'
import { draftOf, draftPageUrl, draftSession, forgetDrafts, revokeDraft } from './draftApps'
import { pageUrlForHiddenApp, titleForHiddenApp } from './hiddenApps'
import type { DraftApp } from './draftApps'
import { cloudIdentity, isDraftStillAllowed } from './draftLinks'
import { pageTestPropertiesFor, pageTestPropertiesOf, rememberPageTestGroup } from './pageTest'
import type { PageTestGroup } from './pageTest'

export const APPS_PARTITION = 'persist:comfy-apps'
export const APP_PAGE_STATUS_CHANNEL = 'apps:page-status-changed'
export const APP_PAGE_CLOSED_CHANNEL = 'apps:page-closed'
export const APP_BACK_TO_LIST_ASKED_CHANNEL = 'apps:back-to-list-asked'
export const APPS_LIST_CHANGED_CHANNEL = 'apps:list-changed'
export const APP_OUTPUTS_CHANNEL = 'apps:outputs'
export const APP_OUTPUT_ACTION_CHANNEL = 'apps-outputs:action'
export const APP_RUNS_CHANNEL = 'apps:runs-changed'
export const TITLE_BAR_APPS_CHANNEL = 'comfy-titlebar:apps-running-changed'
export const MAX_BACKGROUND_RUNS = 3
export const APP_OPENED_EVENT = 'comfy.desktop.apps.app_opened'
export const APP_PAGE_FAILED_EVENT = 'comfy.desktop.apps.app_page_failed'

const NAVIGATION_ABORTED = -3
const FIRST_HTTP_ERROR_STATUS = 400
const PAGE_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write', 'fullscreen'])

type PageFailure = 'http_status' | 'network' | 'crashed' | 'redirected'

export interface LoadedAppPage {
  appId: string
  document: number
}

interface ShownOutputs {
  page: LoadedAppPage
  count: number
  files: readonly (string | null)[]
}

interface HostedPage {
  windowKey: number
  view: WebContentsView
  session: Session
  appId: string | null
  loaded: LoadedAppPage | null
  loadStarted: boolean
  retriedFromKeptCopies: boolean
  loadingUrl: string | null
  startUrl: string | null
  routeBase: string | null
  documents: number
  status: AppPageStatus
  wanted: boolean
  focusWhenReady: boolean
  outputs: ShownOutputs | null
  running: boolean
  finished: boolean
  staffTitle: string | null
  fromStaffList: boolean
  openedBy: string | null
  forget: () => void
}

interface PageHost {
  windowKey: number
  entry: ComfyWindowEntry
}

const hostedByWindow = new Map<number, HostedPage>()
const backgroundByWindow = new Map<number, Map<string, HostedPage>>()
const watchedWindows = new WeakSet<object>()
const securedSessions = new WeakSet<Session>()
const watchedPanels = new WeakSet<WebContents>()

function originOf(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function secureSession(appsSession: Session, location: AppsLocation): void {
  if (securedSessions.has(appsSession)) return
  securedSessions.add(appsSession)
  appsSession.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin) =>
      PAGE_PERMISSIONS.has(permission) && originOf(requestingOrigin) === location.origin
  )
  appsSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(PAGE_PERMISSIONS.has(permission) && isInAppsScope(location, details.requestingUrl))
  })
  attachSessionDownloadHandler(appsSession)
}

function openOutside(url: string): void {
  if (isWebUrl(url)) void tryOpenExternalUrl(url)
}

function panelOf(windowKey: number): WebContents | null {
  const panel = comfyWindows.get(windowKey)?.panelView?.webContents
  return panel && !panel.isDestroyed() ? panel : null
}

function isOnScreen(hosted: HostedPage): boolean {
  return hosted.wanted && hosted.status === 'ready'
}

function applyVisibility(hosted: HostedPage): void {
  const contents = hosted.view.webContents
  if (contents.isDestroyed()) return
  hosted.view.setVisible(isOnScreen(hosted))
  if (isOnScreen(hosted) && hosted.finished) {
    hosted.finished = false
    announceRuns(hosted.windowKey)
  }
  if (!isOnScreen(hosted) || !hosted.focusWhenReady) return
  hosted.focusWhenReady = false
  contents.focus()
}

function conceal(hosted: HostedPage): void {
  hosted.wanted = false
  hosted.focusWhenReady = false
  applyVisibility(hosted)
}

function backgroundOf(windowKey: number): Map<string, HostedPage> {
  const known = backgroundByWindow.get(windowKey)
  if (known) return known
  const pages = new Map<string, HostedPage>()
  backgroundByWindow.set(windowKey, pages)
  return pages
}

function pagesOf(windowKey: number): HostedPage[] {
  const current = hostedByWindow.get(windowKey)
  const background = [...(backgroundByWindow.get(windowKey)?.values() ?? [])]
  return current ? [current, ...background] : background
}

function everyPage(): HostedPage[] {
  const windowKeys = new Set([...hostedByWindow.keys(), ...backgroundByWindow.keys()])
  return [...windowKeys].flatMap(pagesOf)
}

function listedTitleOf(appId: string): string | null {
  return titleForListedApp(appId) ?? titleForHiddenApp(appId)
}

function runsOf(windowKey: number): AppRun[] {
  return pagesOf(windowKey).flatMap(({ appId, running, finished }) =>
    appId !== null && (running || finished) ? [{ appId, running, finished }] : []
  )
}

function appsWhere(windowKey: number, matches: (run: AppRun) => boolean): RunningApp[] {
  return pagesOf(windowKey).flatMap((hosted) => {
    const { appId, running, finished } = hosted
    if (appId === null || !(running || finished) || !matches({ appId, running, finished })) {
      return []
    }
    return [{ id: appId, title: listedTitleOf(appId) ?? hosted.staffTitle ?? appId }]
  })
}

export function runningApps(windowKey: number): RunningApp[] {
  return appsWhere(windowKey, (run) => run.running)
}

export function titleBarApps(windowKey: number): TitleBarApps {
  return {
    running: runningApps(windowKey),
    ready: appsWhere(windowKey, (run) => run.finished && !run.running)
  }
}

function announceRuns(windowKey: number): void {
  panelOf(windowKey)?.send(APP_RUNS_CHANNEL, runsOf(windowKey))
  const titleBar = comfyWindows.get(windowKey)?.titleBarView?.webContents
  if (titleBar && !titleBar.isDestroyed()) {
    titleBar.send(TITLE_BAR_APPS_CHANNEL, titleBarApps(windowKey))
  }
}

function forgetRun(hosted: HostedPage): void {
  if (!hosted.running && !hosted.finished) return
  hosted.running = false
  hosted.finished = false
  announceRuns(hosted.windowKey)
}

function setRunning(hosted: HostedPage, running: boolean): void {
  if (hosted.running === running) return
  hosted.running = running
  hosted.finished = !running && !isOnScreen(hosted) && hosted.loaded !== null
  announceRuns(hosted.windowKey)
}

function closePage(hosted: HostedPage): void {
  hosted.forget()
  if (hosted.view.webContents.isDestroyed()) return
  comfyWindows.get(hosted.windowKey)?.window.contentView.removeChildView(hosted.view)
  hosted.view.webContents.close()
}

function setStatus(windowKey: number, hosted: HostedPage, status: AppPageStatus): void {
  if (hosted.status === status) return
  hosted.status = status
  applyVisibility(hosted)
  panelOf(windowKey)?.send(APP_PAGE_STATUS_CHANNEL, hosted.appId, status)
}

function fail(windowKey: number, hosted: HostedPage, reason: PageFailure): void {
  if (hosted.status !== 'failed') {
    mainTelemetry.capture(APP_PAGE_FAILED_EVENT, {
      app_id: hosted.appId,
      ...pageTestPropertiesFor(hosted.appId),
      reason
    })
  }
  setStatus(windowKey, hosted, 'failed')
}

const pagePath = (url: string): string | null => {
  try {
    const { origin, pathname } = new URL(url)
    return origin + pathname.replace(/(\/index)?\.html$|\/$/, '')
  } catch {
    return null
  }
}

const routeOf = (url: string): string => {
  try {
    return (new URL(url).hash.split('?', 1)[0] ?? '').replace(/^(#\/.+?)\/+$/, '$1')
  } catch {
    return ''
  }
}

function isInAppRoute(base: string, url: string): boolean {
  if (pagePath(base) === null || pagePath(base) !== pagePath(url)) return false
  const route = routeOf(base)
  if (!route.startsWith('#/')) return true
  const at = routeOf(url)
  return at === route || at.startsWith(`${route}/`)
}

function pageTestGroupForApp(appId: string): PageTestGroup | null {
  return draftPageUrl(appId) === null ? pageTestGroupForListedApp(appId) : null
}

function pageUrlForApp(appId: string): string | null {
  return (
    draftPageUrl(appId) ??
    pageTestGroupForListedApp(appId)?.pageUrl ??
    pageUrlForListedApp(appId) ??
    pageUrlForHiddenApp(appId)
  )
}

function noteAppOpened(appId: string, pageTest: PageTestGroup | null): void {
  mainTelemetry.capture(APP_OPENED_EVENT, { app_id: appId, ...pageTestPropertiesOf(pageTest) })
  if (pageTest) recordExposure(pageTest.key, pageTest.variant, 'shard')
}

function sessionForApp(appId: string): Session {
  const draft = draftOf(appId)
  return draft ? draftSession(draft.origin, draft.mount) : session.fromPartition(APPS_PARTITION)
}

function routeBaseOf(hosted: HostedPage): string | null {
  if (hosted.routeBase !== null) return hosted.routeBase
  return hosted.appId === null ? null : pageUrlForApp(hosted.appId)
}

function isInLoadedRoute(hosted: HostedPage, url: string): boolean {
  const base = routeBaseOf(hosted)
  return base !== null && isInAppRoute(base, url)
}

function commitDocument(hosted: HostedPage, url: string): void {
  hosted.documents += 1
  const appId = hosted.appId
  const started = hosted.loadStarted
  hosted.loadStarted = false
  hosted.loadingUrl = null
  if (started) hosted.routeBase = url
  hosted.loaded =
    appId !== null && (started || isInLoadedRoute(hosted, url))
      ? { appId, document: hosted.documents }
      : null
}

function moveWithinDocument(hosted: HostedPage, url: string): void {
  const appId = hosted.appId
  if (hosted.loadStarted) {
    if (appId === null || url !== hosted.loadingUrl) return
    hosted.loadStarted = false
    hosted.loadingUrl = null
    hosted.routeBase = url
    hosted.loaded = { appId, document: hosted.documents }
    return
  }
  hosted.loaded =
    appId !== null && isInLoadedRoute(hosted, url) ? { appId, document: hosted.documents } : null
}

function dismissStaleOutputs(windowKey: number, hosted: HostedPage): void {
  const shown = hosted.outputs
  if (!shown || isStillLoaded(hosted, shown.page)) return
  hosted.outputs = null
  panelOf(windowKey)?.send(APP_OUTPUTS_CHANNEL, shown.page.appId, null)
}

function choosePageSource(hosted: HostedPage): void {
  if (showsDraftSession(hosted)) return
  if (net.isOnline()) stopAnsweringFromKeptCopies(hosted.session)
  else startAnsweringFromKeptCopies(hosted.session, currentAppsLocation())
}

function retriedFromKeptCopies(hosted: HostedPage, failedUrl: string): boolean {
  if (showsDraftSession(hosted) || hosted.retriedFromKeptCopies) return false
  const url = failedUrl || hosted.loadingUrl
  if (!url) return false
  hosted.retriedFromKeptCopies = true
  startAnsweringFromKeptCopies(hosted.session, currentAppsLocation())
  void hosted.view.webContents.loadURL(url).catch(() => {})
  return true
}

function load(windowKey: number, hosted: HostedPage, url: string): void {
  choosePageSource(hosted)
  hosted.retriedFromKeptCopies = false
  hosted.loaded = null
  hosted.loadStarted = true
  hosted.loadingUrl = url
  hosted.startUrl = url
  hosted.routeBase = null
  setStatus(windowKey, hosted, 'loading')
  void hosted.view.webContents.loadURL(url).catch(() => {})
}

function isDraft(appId: string | null): appId is string {
  return appId !== null && draftOf(appId) !== null
}

export function tellPanelsTheListChanged(): void {
  for (const windowKey of comfyWindows.keys()) panelOf(windowKey)?.send(APPS_LIST_CHANGED_CHANNEL)
}

function isHeld(hosted: HostedPage): boolean {
  if (hostedByWindow.get(hosted.windowKey) === hosted) return true
  return (
    hosted.appId !== null && backgroundByWindow.get(hosted.windowKey)?.get(hosted.appId) === hosted
  )
}

function disposePage(hosted: HostedPage): void {
  if (hostedByWindow.get(hosted.windowKey) === hosted) hostedByWindow.delete(hosted.windowKey)
  const background = backgroundByWindow.get(hosted.windowKey)
  if (hosted.appId !== null && background?.get(hosted.appId) === hosted) {
    background.delete(hosted.appId)
  }
  closePage(hosted)
  forgetRun(hosted)
}

function dropDraft(droppedIn: number, appId: string | null): boolean {
  if (!isDraft(appId)) return false
  revokeDraft(appId)
  for (const hosted of everyPage()) {
    if (hosted.appId !== appId) continue
    conceal(hosted)
    disposePage(hosted)
    if (hosted.windowKey !== droppedIn) panelOf(hosted.windowKey)?.send(APP_PAGE_CLOSED_CHANNEL)
  }
  tellPanelsTheListChanged()
  return true
}

function isDraftRunning(appId: string): boolean {
  return everyPage().some((page) => page.appId === appId && page.running)
}

function titleForApp(appId: string): string {
  return draftOf(appId)?.card.title ?? listedTitleOf(appId) ?? appId
}

function isOnStaffListOnly(appId: string): boolean {
  return draftPageUrl(appId) === null && pageUrlForListedApp(appId) === null
}

function draftClosingStop(appId: string): DraftClosingStop {
  return { appTitle: titleForApp(appId), closesDraft: true }
}

function askedBeforeClosingDraft(windowKey: number, hosted: HostedPage): boolean {
  const appId = hosted.appId
  if (!isDraft(appId) || !isDraftRunning(appId)) return false
  panelOf(windowKey)?.send(APP_BACK_TO_LIST_ASKED_CHANNEL, appId, draftClosingStop(appId))
  return true
}

function closeForList(windowKey: number, hosted: HostedPage, pageStillShowsApp: boolean): void {
  const shown = hostedByWindow.get(windowKey) === hosted
  if (dropDraft(windowKey, hosted.appId)) {
    if (shown) panelOf(windowKey)?.send(APP_PAGE_CLOSED_CHANNEL)
    return
  }
  if (!shown) {
    dropBackgroundPage(hosted)
    return
  }
  if (!pageStillShowsApp) {
    hosted.appId = null
    hosted.loaded = null
    hosted.routeBase = null
  }
  conceal(hosted)
  panelOf(windowKey)?.send(APP_PAGE_CLOSED_CHANNEL)
}

function dropBackgroundPage(hosted: HostedPage): void {
  const background = backgroundByWindow.get(hosted.windowKey)
  if (!hosted.appId || background?.get(hosted.appId) !== hosted) return
  background.delete(hosted.appId)
  closePage(hosted)
  announceRuns(hosted.windowKey)
}

function disposeWindowPages(windowKey: number): void {
  const pages = pagesOf(windowKey)
  hostedByWindow.delete(windowKey)
  backgroundByWindow.delete(windowKey)
  for (const hosted of pages) {
    hosted.forget()
    if (!hosted.view.webContents.isDestroyed()) hosted.view.webContents.close()
  }
}

function showsDraftSession(hosted: HostedPage): boolean {
  return hosted.session !== session.fromPartition(APPS_PARTITION)
}

async function admitsBridge(hosted: HostedPage): Promise<boolean> {
  if (!showsDraftSession(hosted)) return true
  return hosted.appId !== null && (await isDraftStillAllowed(hosted.appId))
}

function createHostedPage(
  { windowKey, entry }: PageHost,
  location: AppsLocation,
  appsSession: Session
): HostedPage {
  secureSession(appsSession, location)
  const view = createWebContentsView({
    webPreferences: {
      session: appsSession,
      preload: path.join(__dirname, '../preload/appsPreload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  view.setBackgroundColor(COMFY_BG)
  view.setVisible(false)
  entry.window.contentView.addChildView(view)

  const contents = view.webContents
  const hosted: HostedPage = {
    windowKey,
    view,
    session: appsSession,
    appId: null,
    loaded: null,
    loadStarted: false,
    retriedFromKeptCopies: false,
    loadingUrl: null,
    startUrl: null,
    routeBase: null,
    documents: 0,
    status: 'loading',
    wanted: false,
    focusWhenReady: false,
    outputs: null,
    running: false,
    finished: false,
    staffTitle: null,
    fromStaffList: false,
    openedBy: null,
    forget: registerAppsPage(contents, () => admitsBridge(hosted))
  }
  const steer = (event: Event, url: string, pageStillShowsApp: boolean): void => {
    if (isAppsListUrl(location, url)) {
      event.preventDefault()
      if (!askedBeforeClosingDraft(windowKey, hosted)) {
        closeForList(windowKey, hosted, pageStillShowsApp)
      }
      return
    }
    if (isInAppsScope(location, url)) return
    event.preventDefault()
    openOutside(url)
  }
  contents.on('will-navigate', (event, url) => steer(event, url, true))
  contents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
    if (!isMainFrame) return
    if (hosted.status === 'loading' && !isInAppsScope(location, url)) {
      event.preventDefault()
      fail(windowKey, hosted, 'redirected')
      return
    }
    steer(event, url, false)
  })
  contents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  contents.on('did-navigate', (_event, url, httpResponseCode) => {
    forgetRun(hosted)
    commitDocument(hosted, url)
    dismissStaleOutputs(windowKey, hosted)
    if (isAppsListUrl(location, url)) closeForList(windowKey, hosted, false)
    else if (httpResponseCode >= FIRST_HTTP_ERROR_STATUS) fail(windowKey, hosted, 'http_status')
  })
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame) return
    if (isAppsListUrl(location, url)) closeForList(windowKey, hosted, false)
    else moveWithinDocument(hosted, url)
    dismissStaleOutputs(windowKey, hosted)
  })
  contents.on('dom-ready', () => {
    if (hosted.status !== 'loading' || !isInAppsScope(location, contents.getURL())) return
    setStatus(windowKey, hosted, 'ready')
  })
  contents.on('did-fail-load', (_event, errorCode, _description, url, isMainFrame) => {
    if (!isMainFrame || errorCode === NAVIGATION_ABORTED) return
    if (retriedFromKeptCopies(hosted, url)) return
    fail(windowKey, hosted, 'network')
  })
  contents.on('render-process-gone', () => {
    forgetRun(hosted)
    fail(windowKey, hosted, 'crashed')
  })
  attachContextMenu(entry.window, contents)
  if (!watchedWindows.has(entry.window)) {
    watchedWindows.add(entry.window)
    entry.window.once('closed', () => disposeWindowPages(windowKey))
  }
  return hosted
}

function hostOf(panel: WebContents): PageHost | null {
  for (const [windowKey, entry] of comfyWindows) {
    if (entry.panelView?.webContents === panel && !entry.window.isDestroyed()) {
      return { windowKey, entry }
    }
  }
  return null
}

function hostedFor(host: PageHost): HostedPage | null {
  const hosted = hostedByWindow.get(host.windowKey)
  if (!hosted) return null
  if (!hosted.view.webContents.isDestroyed()) return hosted
  hostedByWindow.delete(host.windowKey)
  hosted.forget()
  return null
}

function makeRoomInBackground(background: Map<string, HostedPage>): boolean {
  if (background.size < MAX_BACKGROUND_RUNS) return true
  const idle = [...background.values()].find((page) => !page.running)
  if (!idle) return false
  dropBackgroundPage(idle)
  return true
}

function runningAppToKeep(current: HostedPage): string | null {
  if (!current.running || current.appId === null) return null
  return makeRoomInBackground(backgroundOf(current.windowKey)) ? current.appId : null
}

function keptPageFor(
  background: Map<string, HostedPage>,
  appId: string,
  appsSession: Session
): HostedPage | null {
  const kept = background.get(appId)
  if (!kept) return null
  background.delete(appId)
  if (kept.session === appsSession) return kept
  closePage(kept)
  forgetRun(kept)
  return null
}

function pageForApp(
  host: PageHost,
  appId: string,
  location: AppsLocation,
  appsSession: Session
): HostedPage {
  const current = hostedFor(host)
  if (current?.appId === appId && current.session === appsSession) return current
  const background = backgroundOf(host.windowKey)
  const kept = keptPageFor(background, appId, appsSession)
  if (current) {
    const keptRunning = runningAppToKeep(current)
    if (keptRunning !== null) {
      conceal(current)
      background.set(keptRunning, current)
    } else if (kept || current.session !== appsSession) {
      hostedByWindow.delete(host.windowKey)
      closePage(current)
      forgetRun(current)
    } else {
      return current
    }
  }
  const page = kept ?? createHostedPage(host, location, appsSession)
  hostedByWindow.set(host.windowKey, page)
  return page
}

function isMeasure(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function parsePlacement(raw: unknown): AppPagePlacement | null {
  if (!raw || typeof raw !== 'object') return null
  const { x, y, width, height, cornerRadius, justOpened, retry, focus, hidden } = raw as Record<
    string,
    unknown
  >
  if (!isMeasure(x) || !isMeasure(y) || !isMeasure(width) || !isMeasure(height)) return null
  if (!isMeasure(cornerRadius)) return null
  return {
    x,
    y,
    width,
    height,
    cornerRadius,
    justOpened: justOpened === true,
    retry: retry === true,
    focus: focus === true,
    hidden: hidden === true
  }
}

function place(entry: ComfyWindowEntry, view: WebContentsView, placement: AppPagePlacement): void {
  const panel = entry.panelView
  if (!panel) return
  const zoom = panel.webContents.getZoomFactor()
  const frame = panel.getBounds()
  const left = Math.min(Math.round(placement.x * zoom), frame.width)
  const top = Math.min(Math.round(placement.y * zoom), frame.height)
  view.setBounds({
    x: frame.x + left,
    y: frame.y + top,
    width: Math.min(Math.round(placement.width * zoom), frame.width - left),
    height: Math.min(Math.round(placement.height * zoom), frame.height - top)
  })
  view.setBorderRadius(Math.round(placement.cornerRadius * zoom))
}

function raiseAbovePanel(entry: ComfyWindowEntry, view: WebContentsView): void {
  const panel = entry.panelView
  if (!panel) return
  const stack = entry.window.contentView.children
  if (stack.indexOf(view) > stack.indexOf(panel)) return
  entry.window.contentView.removeChildView(view)
  entry.window.contentView.addChildView(view)
}

function concealWhenPanelGoes(windowKey: number, panel: WebContents): void {
  if (watchedPanels.has(panel)) return
  watchedPanels.add(panel)
  const concealHosted = (): void => {
    const hosted = hostedByWindow.get(windowKey)
    if (hosted) conceal(hosted)
  }
  panel.on('render-process-gone', concealHosted)
  panel.on('destroyed', concealHosted)
  panel.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) concealHosted()
  })
}

export function loadedAppPage(contents: WebContents): LoadedAppPage | null {
  return everyPage().find((hosted) => hosted.view.webContents === contents)?.loaded ?? null
}

export async function showAppPage(
  panel: WebContents,
  appId: unknown,
  rawPlacement: unknown
): Promise<AppPageStatus> {
  const placement = parsePlacement(rawPlacement)
  if (typeof appId !== 'string' || !placement) return 'failed'
  const pageUrl = pageUrlForApp(appId)
  const host = hostOf(panel)
  if (!pageUrl || !host) return 'failed'
  const pageTest = pageTestGroupForApp(appId)
  rememberPageTestGroup(appId, pageTest)
  const appsSession = sessionForApp(appId)
  const shown = hostedFor(host)?.appId ?? null
  if (shown !== appId) dropDraft(host.windowKey, shown)
  const hosted = pageForApp(host, appId, currentAppsLocation(), appsSession)
  concealWhenPanelGoes(host.windowKey, panel)
  const askedFresh = placement.justOpened === true || placement.retry === true
  const retriesFailedPage = askedFresh && hosted.status === 'failed'
  const draftMoved = isDraft(appId) && hosted.startUrl !== pageUrl
  if (hosted.appId !== appId || retriesFailedPage || draftMoved) {
    hosted.appId = appId
    hosted.fromStaffList = isOnStaffListOnly(appId)
    hosted.staffTitle = hosted.fromStaffList ? titleForHiddenApp(appId) : null
    hosted.openedBy = cloudIdentity()
    load(host.windowKey, hosted, pageUrl)
  }
  if (placement.justOpened) noteAppOpened(appId, pageTest)
  hosted.wanted = !placement.hidden
  hosted.focusWhenReady = hosted.focusWhenReady || askedFresh || placement.focus === true
  place(host.entry, hosted.view, placement)
  raiseAbovePanel(host.entry, hosted.view)
  applyVisibility(hosted)
  return hosted.status
}

export function closeDraftPages(only?: readonly DraftApp[]): void {
  for (const hosted of everyPage()) {
    if (!showsDraftSession(hosted) || !isHeld(hosted)) continue
    const draft = hosted.appId === null ? null : draftOf(hosted.appId)
    if (only && draft && !only.includes(draft)) continue
    if (hosted.appId !== null) closeForList(hosted.windowKey, hosted, false)
    if (isHeld(hosted)) disposePage(hosted)
  }
  forgetDrafts(only)
  tellPanelsTheListChanged()
}

export function closeStaffPagesOfOtherAccounts(): void {
  const identity = cloudIdentity()
  for (const hosted of everyPage()) {
    if (!hosted.fromStaffList || hosted.appId === null || hosted.openedBy === identity) continue
    closeForList(hosted.windowKey, hosted, false)
    if (isHeld(hosted)) disposePage(hosted)
  }
}

export function closeAppPage(panel: WebContents, appId: unknown): void {
  const host = hostOf(panel)
  const hosted = host && hostedFor(host)
  if (!hosted || hosted.appId === null || hosted.appId !== appId) return
  closeForList(host.windowKey, hosted, true)
}

export function hideAppPage(panel: WebContents): void {
  const host = hostOf(panel)
  const hosted = host && hostedFor(host)
  if (hosted) conceal(hosted)
}

const FROZEN_FRAME_JPEG_QUALITY = 90

export async function captureAppPage(panel: WebContents): Promise<string | null> {
  const host = hostOf(panel)
  const hosted = host && hostedFor(host)
  if (!hosted || !isOnScreen(hosted)) return null
  try {
    const frame = await hosted.view.webContents.capturePage()
    if (frame.isEmpty()) return null
    return `data:image/jpeg;base64,${frame.toJPEG(FROZEN_FRAME_JPEG_QUALITY).toString('base64')}`
  } catch {
    return null
  }
}

export function noteAppPageRunning(contents: WebContents, running: unknown): void {
  if (typeof running !== 'boolean') return
  const hosted = everyPage().find((page) => page.view.webContents === contents)
  if (!hosted || (running && !hosted.loaded)) return
  setRunning(hosted, running)
}

export function appSwitchStopsRun(panel: WebContents, appId: unknown): AppSwitchStop | null {
  const host = hostOf(panel)
  const current = host && hostedFor(host)
  const shown = current?.appId ?? null
  if (!current || shown === null || shown === appId) return null
  if (isDraft(shown)) return isDraftRunning(shown) ? draftClosingStop(shown) : null
  if (!current.running) return null
  const background = [...backgroundOf(current.windowKey).values()]
  const otherRuns = background.filter((page) => page.running && page.appId !== appId).length
  if (otherRuns < MAX_BACKGROUND_RUNS) return null
  return { appTitle: titleForApp(shown), otherRuns }
}

export function appRuns(panel: WebContents): AppRun[] {
  const host = hostOf(panel)
  return host ? runsOf(host.windowKey) : []
}

export function runningAppCount(): number {
  return everyPage().filter((page) => page.running && page.appId !== null).length
}

function isStillLoaded(hosted: HostedPage, page: LoadedAppPage): boolean {
  return hosted.loaded?.appId === page.appId && hosted.loaded.document === page.document
}

export function showAppOutputs(
  contents: WebContents,
  sentFrom: LoadedAppPage,
  outputs: AppOutputs,
  files: readonly (string | null)[] = []
): boolean {
  for (const hosted of everyPage()) {
    if (hosted.view.webContents !== contents) continue
    const windowKey = hosted.windowKey
    const panel = panelOf(windowKey)
    if (!panel || !isOnScreen(hosted) || !isStillLoaded(hosted, sentFrom)) return false
    hosted.outputs = { page: sentFrom, count: outputs.items.length, files }
    if (comfyWindows.get(windowKey)?.window.isFocused()) panel.focus()
    panel.send(APP_OUTPUTS_CHANNEL, sentFrom.appId, outputs)
    return true
  }
  return false
}

function shownOutputsOf(panel: WebContents): { hosted: HostedPage; shown: ShownOutputs } | null {
  const host = hostOf(panel)
  const hosted = host && hostedFor(host)
  const shown = hosted?.outputs
  return hosted && shown && isStillLoaded(hosted, shown.page) ? { hosted, shown } : null
}

export function shownOutputFile(panel: WebContents, index: number): string | null {
  return shownOutputsOf(panel)?.shown.files[index] ?? null
}

export function sendAppOutputAction(panel: WebContents, action: AppOutputAction): void {
  const found = shownOutputsOf(panel)
  if (!found || action.index >= found.shown.count) return
  found.hosted.view.webContents.send(APP_OUTPUT_ACTION_CHANNEL, action)
}

export function _resetForTest(): void {
  hostedByWindow.clear()
  backgroundByWindow.clear()
}
