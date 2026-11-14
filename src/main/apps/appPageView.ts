import { WebContentsView, app, session, shell } from 'electron'
import type { Event, Session, WebContents } from 'electron'
import path from 'path'

import { isAppsListUrl, isInAppsScope, isWebUrl } from '../../shared/appsLocation'
import type { AppsLocation } from '../../shared/appsLocation'
import type { AppPagePlacement, AppPageStatus } from '../../types/ipc'
import { comfyWindows } from '../host/registry'
import type { ComfyWindowEntry } from '../host/registry'
import { attachSessionDownloadHandler } from '../lib/comfyDownloadManager'
import { attachContextMenu } from '../lib/contextMenu'
import { recordShellOpenExternal } from '../lib/e2eOverrides'
import * as mainTelemetry from '../lib/telemetry'
import { COMFY_BG } from '../lib/theme'
import { pageUrlForListedApp } from './appsCatalog'
import { areAppsEnabled, currentAppsLocation } from './appsConfig'
import { registerAppsPage } from './appsPages'

export const APPS_PARTITION = 'persist:comfy-apps'
export const APP_PAGE_STATUS_CHANNEL = 'apps:page-status-changed'
export const APP_PAGE_CLOSED_CHANNEL = 'apps:page-closed'
export const APP_OPENED_EVENT = 'comfy.desktop.apps.app_opened'
export const APP_PAGE_FAILED_EVENT = 'comfy.desktop.apps.app_page_failed'

const NAVIGATION_ABORTED = -3
const FIRST_HTTP_ERROR_STATUS = 400
const PAGE_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write', 'fullscreen'])

type PageFailure = 'http_status' | 'network' | 'crashed'

export interface LoadedAppPage {
  appId: string
  document: number
}

interface HostedPage {
  view: WebContentsView
  appId: string | null
  loaded: LoadedAppPage | null
  loadStarted: boolean
  documents: number
  status: AppPageStatus
  wanted: boolean
  focusWhenReady: boolean
  forget: () => void
}

interface PageHost {
  windowKey: number
  entry: ComfyWindowEntry
}

const hostedByWindow = new Map<number, HostedPage>()
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
  if (!isWebUrl(url)) return
  if (process.env['E2E'] === '1' && !app.isPackaged) {
    recordShellOpenExternal(url)
    return
  }
  void shell.openExternal(url).catch(() => {})
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
  if (!isOnScreen(hosted) || !hosted.focusWhenReady) return
  hosted.focusWhenReady = false
  contents.focus()
}

function conceal(hosted: HostedPage): void {
  hosted.wanted = false
  hosted.focusWhenReady = false
  applyVisibility(hosted)
}

function setStatus(windowKey: number, hosted: HostedPage, status: AppPageStatus): void {
  if (hosted.status === status) return
  hosted.status = status
  applyVisibility(hosted)
  panelOf(windowKey)?.send(APP_PAGE_STATUS_CHANNEL, status)
}

function fail(windowKey: number, hosted: HostedPage, reason: PageFailure): void {
  if (hosted.status !== 'failed') {
    mainTelemetry.capture(APP_PAGE_FAILED_EVENT, { app_id: hosted.appId, reason })
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

function isAppsOwnPage(appId: string, url: string): boolean {
  const own = pageUrlForListedApp(appId)
  return own !== null && pagePath(own) !== null && pagePath(own) === pagePath(url)
}

function commitDocument(hosted: HostedPage, url: string): void {
  hosted.documents += 1
  const appId = hosted.appId
  const started = hosted.loadStarted
  hosted.loadStarted = false
  hosted.loaded =
    appId !== null && (started || isAppsOwnPage(appId, url))
      ? { appId, document: hosted.documents }
      : null
}

function load(windowKey: number, hosted: HostedPage, url: string): void {
  hosted.loaded = null
  hosted.loadStarted = true
  setStatus(windowKey, hosted, 'loading')
  void hosted.view.webContents.loadURL(url).catch(() => {})
}

function closeForList(windowKey: number, hosted: HostedPage, pageStillShowsApp: boolean): void {
  if (!pageStillShowsApp) {
    hosted.appId = null
    hosted.loaded = null
  }
  conceal(hosted)
  panelOf(windowKey)?.send(APP_PAGE_CLOSED_CHANNEL)
}

function disposeHostedPage(windowKey: number): void {
  const hosted = hostedByWindow.get(windowKey)
  if (!hosted) return
  hostedByWindow.delete(windowKey)
  hosted.forget()
  if (!hosted.view.webContents.isDestroyed()) hosted.view.webContents.close()
}

function createHostedPage({ windowKey, entry }: PageHost, location: AppsLocation): HostedPage {
  const appsSession = session.fromPartition(APPS_PARTITION)
  secureSession(appsSession, location)
  const view = new WebContentsView({
    webPreferences: {
      session: appsSession,
      preload: path.join(__dirname, '../preload/appsPreload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })
  view.setBackgroundColor(COMFY_BG)
  view.setVisible(false)
  entry.window.contentView.addChildView(view)

  const contents = view.webContents
  const hosted: HostedPage = {
    view,
    appId: null,
    loaded: null,
    loadStarted: false,
    documents: 0,
    status: 'loading',
    wanted: false,
    focusWhenReady: false,
    forget: registerAppsPage(contents)
  }
  const steer = (event: Event, url: string, pageStillShowsApp: boolean): void => {
    if (isAppsListUrl(location, url)) {
      event.preventDefault()
      closeForList(windowKey, hosted, pageStillShowsApp)
      return
    }
    if (isInAppsScope(location, url)) return
    event.preventDefault()
    openOutside(url)
  }
  contents.on('will-navigate', (event, url) => steer(event, url, true))
  contents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame) steer(event, url, false)
  })
  contents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  contents.on('did-navigate', (_event, url, httpResponseCode) => {
    commitDocument(hosted, url)
    if (isAppsListUrl(location, url)) closeForList(windowKey, hosted, false)
    else if (httpResponseCode >= FIRST_HTTP_ERROR_STATUS) fail(windowKey, hosted, 'http_status')
  })
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame && isAppsListUrl(location, url)) closeForList(windowKey, hosted, false)
  })
  contents.on('dom-ready', () => {
    if (hosted.status !== 'loading' || !isInAppsScope(location, contents.getURL())) return
    setStatus(windowKey, hosted, 'ready')
  })
  contents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (isMainFrame && errorCode !== NAVIGATION_ABORTED) fail(windowKey, hosted, 'network')
  })
  contents.on('render-process-gone', () => fail(windowKey, hosted, 'crashed'))
  attachContextMenu(entry.window, contents)
  entry.window.once('closed', () => disposeHostedPage(windowKey))

  hostedByWindow.set(windowKey, hosted)
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
  disposeHostedPage(host.windowKey)
  return null
}

function isMeasure(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function parsePlacement(raw: unknown): AppPagePlacement | null {
  if (!raw || typeof raw !== 'object') return null
  const { x, y, width, height, cornerRadius, justOpened } = raw as Record<string, unknown>
  if (!isMeasure(x) || !isMeasure(y) || !isMeasure(width) || !isMeasure(height)) return null
  if (!isMeasure(cornerRadius)) return null
  return { x, y, width, height, cornerRadius, justOpened: justOpened === true }
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
  for (const hosted of hostedByWindow.values()) {
    if (hosted.view.webContents === contents) return hosted.loaded
  }
  return null
}

export async function showAppPage(
  panel: WebContents,
  appId: unknown,
  rawPlacement: unknown
): Promise<AppPageStatus> {
  const placement = parsePlacement(rawPlacement)
  if (typeof appId !== 'string' || !placement || !(await areAppsEnabled())) return 'failed'
  const pageUrl = pageUrlForListedApp(appId)
  const host = hostOf(panel)
  if (!pageUrl || !host) return 'failed'
  const hosted = hostedFor(host) ?? createHostedPage(host, currentAppsLocation())
  concealWhenPanelGoes(host.windowKey, panel)
  const retriesFailedPage = placement.justOpened === true && hosted.status === 'failed'
  if (hosted.appId !== appId || retriesFailedPage) {
    hosted.appId = appId
    load(host.windowKey, hosted, pageUrl)
  }
  if (placement.justOpened) mainTelemetry.capture(APP_OPENED_EVENT, { app_id: appId })
  hosted.wanted = true
  hosted.focusWhenReady = hosted.focusWhenReady || placement.justOpened === true
  place(host.entry, hosted.view, placement)
  raiseAbovePanel(host.entry, hosted.view)
  applyVisibility(hosted)
  return hosted.status
}

export function hideAppPage(panel: WebContents): void {
  const host = hostOf(panel)
  const hosted = host && hostedFor(host)
  if (hosted) conceal(hosted)
}

export async function captureAppPage(panel: WebContents): Promise<string | null> {
  const host = hostOf(panel)
  const hosted = host && hostedFor(host)
  if (!hosted || !isOnScreen(hosted)) return null
  try {
    const frame = await hosted.view.webContents.capturePage()
    return frame.isEmpty() ? null : frame.toDataURL()
  } catch {
    return null
  }
}

export function reloadAppPage(panel: WebContents): void {
  const host = hostOf(panel)
  const hosted = host && hostedFor(host)
  const pageUrl = hosted?.appId ? pageUrlForListedApp(hosted.appId) : null
  if (!host || !hosted || !pageUrl) return
  load(host.windowKey, hosted, pageUrl)
}

export function _resetForTest(): void {
  hostedByWindow.clear()
}
