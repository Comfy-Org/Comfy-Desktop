import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents, WebFrameMain } from 'electron'

type PermissionCheck = (contents: unknown, permission: string, requestingOrigin: string) => boolean
type PermissionRequest = (
  contents: unknown,
  permission: string,
  callback: (granted: boolean) => void,
  details: { requestingUrl: string }
) => void
type WindowOpenHandler = (details: { url: string }) => { action: string }

const mocks = vi.hoisted(() => ({
  appsEnabled: true,
  windows: new Map<number, unknown>(),
  createView: (_options: unknown): unknown => null,
  session: null as unknown,
  openExternal: vi.fn((_url: string) => Promise.resolve()),
  attachDownloads: vi.fn(),
  capture: vi.fn(),
  pages: new Map<string, string>()
}))

vi.mock('electron', () => ({
  WebContentsView: class {
    constructor(options: unknown) {
      return mocks.createView(options) as object
    }
  },
  app: { isPackaged: false },
  session: { fromPartition: () => mocks.session },
  shell: { openExternal: mocks.openExternal }
}))
vi.mock('../host/registry', () => ({
  get comfyWindows() {
    return mocks.windows
  }
}))
vi.mock('../lib/comfyDownloadManager', () => ({
  attachSessionDownloadHandler: mocks.attachDownloads
}))
vi.mock('../lib/contextMenu', () => ({ attachContextMenu: vi.fn() }))
vi.mock('../lib/telemetry', () => ({ capture: mocks.capture }))
vi.mock('./appsCatalog', () => ({
  pageUrlForListedApp: (id: string) => mocks.pages.get(id) ?? null
}))
vi.mock('./appsConfig', () => ({
  areAppsEnabled: async () => mocks.appsEnabled,
  currentAppsLocation: () => ({
    url: 'https://comfy.org/apps/',
    origin: 'https://comfy.org',
    scopePath: '/apps/'
  })
}))

import { _resetForTest as forgetAppsPages, isAppsPageSender, liveAppsPages } from './appsPages'
import {
  APP_OPENED_EVENT,
  APP_PAGE_CLOSED_CHANNEL,
  APP_PAGE_FAILED_EVENT,
  APP_PAGE_STATUS_CHANNEL,
  _resetForTest,
  captureAppPage,
  hideAppPage,
  reloadAppPage,
  showAppPage
} from './appPageView'

const APPS_URL = 'https://comfy.org/apps/'
const CUTOUT = 'remove-background'
const CUTOUT_URL = `${APPS_URL}remove-background/desktop.html`
const UPSCALE = 'upscale'
const UPSCALE_URL = `${APPS_URL}#/upscale`
const WINDOW_KEY = 7
const PANEL_FRAME = { x: 0, y: 41, width: 1200, height: 760 }
const PLACEMENT = { x: 256, y: 8, width: 936, height: 744, cornerRadius: 14 }

class FakeContents extends EventEmitter {
  url = ''
  destroyed = false
  zoom = 1
  windowOpenHandler: WindowOpenHandler | null = null
  mainFrame = { processId: 4, routingId: 1 }
  send = vi.fn()
  focus = vi.fn()
  capturePage = vi.fn()
  loadURL = vi.fn((url: string) => {
    this.url = url
    return Promise.resolve()
  })
  close = vi.fn(() => {
    this.destroyed = true
  })
  getURL(): string {
    return this.url
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  getZoomFactor(): number {
    return this.zoom
  }
  setWindowOpenHandler(handler: WindowOpenHandler): void {
    this.windowOpenHandler = handler
  }
}

class FakeView {
  webContents = new FakeContents()
  visible = true
  bounds = { x: 0, y: 0, width: 0, height: 0 }
  cornerRadius = 0
  setBackgroundColor = vi.fn()
  setVisible(visible: boolean): void {
    this.visible = visible
  }
  setBounds(bounds: typeof this.bounds): void {
    this.bounds = bounds
  }
  setBorderRadius(radius: number): void {
    this.cornerRadius = radius
  }
  getBounds(): typeof this.bounds {
    return this.bounds
  }
}

class FakeWindow extends EventEmitter {
  stack: unknown[] = []
  contentView = {
    get children(): unknown[] {
      return [...stackOf(this)]
    },
    addChildView: (view: unknown) => {
      this.stack = [...this.stack.filter((child) => child !== view), view]
    },
    removeChildView: (view: unknown) => {
      this.stack = this.stack.filter((child) => child !== view)
    }
  }
  isDestroyed(): boolean {
    return false
  }
}

const windowsByContentView = new WeakMap<object, FakeWindow>()
function stackOf(contentView: object): unknown[] {
  return windowsByContentView.get(contentView)?.stack ?? []
}

interface FakeSession {
  check: PermissionCheck | null
  request: PermissionRequest | null
  setPermissionCheckHandler(handler: PermissionCheck): void
  setPermissionRequestHandler(handler: PermissionRequest): void
}

let hostWindow: FakeWindow
let panel: FakeView
let created: FakeView[]
let appsSession: FakeSession

function panelContents(): WebContents {
  return panel.webContents as unknown as WebContents
}

function hostedPage(): FakeView {
  const view = created[0]
  if (!view) throw new Error('The hosted Apps page was never created')
  return view
}

function finishLoading(url = CUTOUT_URL, httpStatus = 200): void {
  const contents = hostedPage().webContents
  contents.url = url
  contents.emit('did-navigate', {}, url, httpStatus)
  contents.emit('dom-ready')
}

function navigationEvent(): { preventDefault: ReturnType<typeof vi.fn> } {
  return { preventDefault: vi.fn() }
}

function sentToPanel(channel: string): unknown[][] {
  return panel.webContents.send.mock.calls.filter(([sent]) => sent === channel)
}

function lastStatusSentToPanel(): unknown {
  return sentToPanel(APP_PAGE_STATUS_CHANNEL).at(-1)?.[1]
}

function openCutout(placement: Record<string, unknown> = PLACEMENT): Promise<string> {
  return showAppPage(panelContents(), CUTOUT, placement)
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetForTest()
  forgetAppsPages()
  mocks.appsEnabled = true
  mocks.pages = new Map([
    [CUTOUT, CUTOUT_URL],
    [UPSCALE, UPSCALE_URL]
  ])
  created = []
  hostWindow = new FakeWindow()
  windowsByContentView.set(hostWindow.contentView, hostWindow)
  panel = new FakeView()
  panel.bounds = { ...PANEL_FRAME }
  hostWindow.contentView.addChildView(panel)
  appsSession = {
    check: null,
    request: null,
    setPermissionCheckHandler(handler) {
      this.check = handler
    },
    setPermissionRequestHandler(handler) {
      this.request = handler
    }
  }
  mocks.session = appsSession
  mocks.createView = () => {
    const view = new FakeView()
    created.push(view)
    return view
  }
  mocks.windows = new Map([[WINDOW_KEY, { window: hostWindow, panelView: panel }]])
})

describe('opening an app', () => {
  it("loads the app's page hidden, then shows it where the panel placed it", async () => {
    expect(await openCutout()).toBe('loading')
    expect(hostedPage().webContents.loadURL).toHaveBeenCalledWith(CUTOUT_URL)
    expect(hostedPage().visible).toBe(false)

    finishLoading()

    expect(hostedPage().visible).toBe(true)
    expect(hostedPage().bounds).toEqual({ x: 256, y: 49, width: 936, height: 744 })
    expect(hostedPage().cornerRadius).toBe(14)
    expect(lastStatusSentToPanel()).toBe('ready')
  })

  it('loads in a sandboxed page with its own storage and no Node access', async () => {
    const options: unknown[] = []
    const createView = mocks.createView
    mocks.createView = (viewOptions) => {
      options.push(viewOptions)
      return createView(viewOptions)
    }

    await openCutout()

    expect(options).toEqual([
      {
        webPreferences: expect.objectContaining({
          session: appsSession,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        })
      }
    ])
  })

  it('keeps the open app as it was when the person comes back to it', async () => {
    await openCutout()
    finishLoading()
    hideAppPage(panelContents())
    expect(hostedPage().visible).toBe(false)

    expect(await openCutout()).toBe('ready')

    expect(created).toHaveLength(1)
    expect(hostedPage().webContents.loadURL).toHaveBeenCalledTimes(1)
    expect(hostedPage().visible).toBe(true)
  })

  it('loads another app in the same page and hides it until that app is ready', async () => {
    await openCutout()
    finishLoading()

    expect(await showAppPage(panelContents(), UPSCALE, PLACEMENT)).toBe('loading')

    expect(created).toHaveLength(1)
    expect(hostedPage().webContents.loadURL).toHaveBeenLastCalledWith(UPSCALE_URL)
    expect(hostedPage().visible).toBe(false)
    expect(lastStatusSentToPanel()).toBe('loading')

    finishLoading(UPSCALE_URL)
    expect(hostedPage().visible).toBe(true)
  })

  it('scales the placement by the panel zoom and keeps it inside the panel', async () => {
    panel.webContents.zoom = 1.25
    await openCutout({ x: 200, y: 0, width: 2000, height: 2000, cornerRadius: 8 })

    expect(hostedPage().bounds).toEqual({ x: 250, y: 41, width: 950, height: 760 })
    expect(hostedPage().cornerRadius).toBe(10)
  })

  it.each([
    null,
    'left',
    { x: 0, y: 0, width: 100 },
    { x: Number.NaN, y: 0, width: 100, height: 100, cornerRadius: 0 },
    { x: 0, y: 0, width: -1, height: 100, cornerRadius: 0 }
  ])('creates nothing for the malformed placement %j', async (placement) => {
    expect(await showAppPage(panelContents(), CUTOUT, placement)).toBe('failed')
    expect(created).toHaveLength(0)
  })

  it.each(['not-in-the-list', '', 42, null, { id: CUTOUT }])(
    'creates nothing for %j, which the apps list does not name',
    async (appId) => {
      expect(await showAppPage(panelContents(), appId, PLACEMENT)).toBe('failed')
      expect(created).toHaveLength(0)
    }
  )

  it('creates nothing while Apps is switched off', async () => {
    mocks.appsEnabled = false

    expect(await openCutout()).toBe('failed')
    expect(created).toHaveLength(0)
  })

  it('creates nothing for a sender that is not a panel', async () => {
    const stranger = new FakeContents() as unknown as WebContents

    expect(await showAppPage(stranger, CUTOUT, PLACEMENT)).toBe('failed')
    expect(created).toHaveLength(0)
  })

  it('takes the keyboard and counts one opening when the person opens an app, not on every resize', async () => {
    await openCutout({ ...PLACEMENT, justOpened: true })
    finishLoading()
    await openCutout()

    expect(hostedPage().webContents.focus).toHaveBeenCalledTimes(1)
    expect(mocks.capture.mock.calls.filter(([name]) => name === APP_OPENED_EVENT)).toEqual([
      [APP_OPENED_EVENT, { app_id: CUTOUT }]
    ])
  })
})

describe('going back to all apps', () => {
  beforeEach(async () => {
    await openCutout()
    finishLoading()
  })

  it('closes the app in Desktop instead of loading the website list, and keeps the app as it was', async () => {
    const event = navigationEvent()
    hostedPage().webContents.emit('will-navigate', event, APPS_URL)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(hostedPage().visible).toBe(false)
    expect(sentToPanel(APP_PAGE_CLOSED_CHANNEL)).toHaveLength(1)
    expect(mocks.openExternal).not.toHaveBeenCalled()

    expect(await openCutout()).toBe('ready')
    expect(hostedPage().webContents.loadURL).toHaveBeenCalledTimes(1)
  })

  it('closes an app drawn by the list page when it routes back to the list, and loads it fresh next time', async () => {
    await showAppPage(panelContents(), UPSCALE, PLACEMENT)
    finishLoading(UPSCALE_URL)

    hostedPage().webContents.emit('did-navigate-in-page', {}, `${APPS_URL}#/`, true)

    expect(hostedPage().visible).toBe(false)
    expect(sentToPanel(APP_PAGE_CLOSED_CHANNEL)).toHaveLength(1)

    expect(await showAppPage(panelContents(), UPSCALE, PLACEMENT)).toBe('loading')
    expect(hostedPage().webContents.loadURL).toHaveBeenLastCalledWith(UPSCALE_URL)
  })

  it('closes the app when the site redirects its page to the list', () => {
    const event = navigationEvent()
    hostedPage().webContents.emit('will-redirect', event, APPS_URL, false, true)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(sentToPanel(APP_PAGE_CLOSED_CHANNEL)).toHaveLength(1)
  })

  it('stays open while an embedded frame changes its own hash', () => {
    hostedPage().webContents.emit('did-navigate-in-page', {}, `${APPS_URL}#/`, false)

    expect(hostedPage().visible).toBe(true)
    expect(sentToPanel(APP_PAGE_CLOSED_CHANNEL)).toHaveLength(0)
  })
})

describe('leaving the apps site', () => {
  beforeEach(async () => {
    await openCutout()
    finishLoading()
  })

  it('follows links inside the apps site', () => {
    const event = navigationEvent()
    hostedPage().webContents.emit('will-navigate', event, `${APPS_URL}genjutsu/desktop.html`)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('opens a link to another site in the browser and stays on the page', () => {
    const event = navigationEvent()
    hostedPage().webContents.emit('will-navigate', event, 'https://docs.comfy.org/pricing')

    expect(event.preventDefault).toHaveBeenCalled()
    expect(mocks.openExternal).toHaveBeenCalledWith('https://docs.comfy.org/pricing')
  })

  it('opens the rest of comfy.org in the browser too', () => {
    const event = navigationEvent()
    hostedPage().webContents.emit('will-navigate', event, 'https://comfy.org/login/')

    expect(event.preventDefault).toHaveBeenCalled()
    expect(mocks.openExternal).toHaveBeenCalledWith('https://comfy.org/login/')
  })

  it('stops a redirect of the page to another site', () => {
    const event = navigationEvent()
    hostedPage().webContents.emit('will-redirect', event, 'https://evil.example/apps/', false, true)

    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('lets an embedded frame redirect on its own', () => {
    const event = navigationEvent()
    hostedPage().webContents.emit(
      'will-redirect',
      event,
      'https://player.example/embed',
      false,
      false
    )

    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('never opens a new window, and sends a web link from one to the browser', () => {
    const handler = hostedPage().webContents.windowOpenHandler
    expect(handler?.({ url: 'https://comfy.org/hub/' })).toEqual({ action: 'deny' })
    expect(mocks.openExternal).toHaveBeenCalledWith('https://comfy.org/hub/')
  })

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'smb://share/x', 'comfy://open'])(
    'does not hand %s to the system',
    (url) => {
      const event = navigationEvent()
      hostedPage().webContents.emit('will-navigate', event, url)
      hostedPage().webContents.windowOpenHandler?.({ url })

      expect(event.preventDefault).toHaveBeenCalled()
      expect(mocks.openExternal).not.toHaveBeenCalled()
    }
  )
})

describe('an app page that cannot load', () => {
  it('hides the page and tells the panel when the site answers 404', async () => {
    await openCutout()
    finishLoading(CUTOUT_URL, 404)

    expect(hostedPage().visible).toBe(false)
    expect(lastStatusSentToPanel()).toBe('failed')
    expect(mocks.capture).toHaveBeenCalledWith(APP_PAGE_FAILED_EVENT, {
      app_id: CUTOUT,
      reason: 'http_status'
    })
  })

  it('reports a dropped connection, and loads the same app again when the person retries', async () => {
    await openCutout()
    hostedPage().webContents.emit('did-fail-load', {}, -106, 'ERR_INTERNET_DISCONNECTED', '', true)
    expect(lastStatusSentToPanel()).toBe('failed')
    expect(mocks.capture).toHaveBeenCalledWith(APP_PAGE_FAILED_EVENT, {
      app_id: CUTOUT,
      reason: 'network'
    })

    reloadAppPage(panelContents(), CUTOUT)
    expect(lastStatusSentToPanel()).toBe('loading')
    expect(hostedPage().webContents.loadURL).toHaveBeenCalledTimes(2)
    expect(hostedPage().webContents.loadURL).toHaveBeenLastCalledWith(CUTOUT_URL)

    finishLoading()
    expect(hostedPage().visible).toBe(true)
    expect(lastStatusSentToPanel()).toBe('ready')
  })

  it('says the page did not load, without opening the browser, when the site sends it to another site while it loads', async () => {
    await openCutout()
    const event = navigationEvent()
    hostedPage().webContents.emit(
      'will-redirect',
      event,
      'https://www.comfy.org/apps/',
      false,
      true
    )

    expect(event.preventDefault).toHaveBeenCalled()
    expect(mocks.openExternal).not.toHaveBeenCalled()
    expect(hostedPage().visible).toBe(false)
    expect(lastStatusSentToPanel()).toBe('failed')
    expect(mocks.capture).toHaveBeenCalledWith(APP_PAGE_FAILED_EVENT, {
      app_id: CUTOUT,
      reason: 'redirected'
    })
  })

  it('says the page still did not load when the person retries an app this window never loaded', async () => {
    await openCutout()
    finishLoading()
    hideAppPage(panelContents())
    mocks.pages.delete(UPSCALE)
    expect(await showAppPage(panelContents(), UPSCALE, PLACEMENT)).toBe('failed')

    reloadAppPage(panelContents(), UPSCALE)

    expect(lastStatusSentToPanel()).toBe('failed')
    expect(hostedPage().webContents.loadURL).toHaveBeenCalledTimes(1)
    expect(hostedPage().visible).toBe(false)
  })

  it('tries a failed app again when the person opens it once more', async () => {
    await openCutout({ ...PLACEMENT, justOpened: true })
    finishLoading(CUTOUT_URL, 503)
    hideAppPage(panelContents())

    expect(await openCutout({ ...PLACEMENT, justOpened: true })).toBe('loading')
    expect(hostedPage().webContents.loadURL).toHaveBeenCalledTimes(2)
  })

  it('ignores an aborted navigation and a failing embedded frame', async () => {
    await openCutout()
    finishLoading()
    hostedPage().webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', CUTOUT_URL, true)
    hostedPage().webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', '', false)

    expect(hostedPage().visible).toBe(true)
    expect(lastStatusSentToPanel()).toBe('ready')
  })

  it('reports a crashed page once', async () => {
    await openCutout()
    finishLoading()
    hostedPage().webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    hostedPage().webContents.emit('render-process-gone', {}, { reason: 'crashed' })

    expect(hostedPage().visible).toBe(false)
    expect(mocks.capture.mock.calls.filter(([name]) => name === APP_PAGE_FAILED_EVENT)).toEqual([
      [APP_PAGE_FAILED_EVENT, { app_id: CUTOUT, reason: 'crashed' }]
    ])
  })
})

describe('what an app page may do on this computer', () => {
  beforeEach(async () => {
    await openCutout()
  })

  function requested(permission: string, requestingUrl: string): boolean {
    let granted: boolean | null = null
    appsSession.request?.(null, permission, (answer) => (granted = answer), { requestingUrl })
    if (granted === null) throw new Error('The permission request was never answered')
    return granted
  }

  it.each(['clipboard-sanitized-write', 'fullscreen'])('may use %s', (permission) => {
    expect(appsSession.check?.(null, permission, 'https://comfy.org/')).toBe(true)
    expect(requested(permission, CUTOUT_URL)).toBe(true)
  })

  it.each([
    'media',
    'geolocation',
    'notifications',
    'clipboard-read',
    'openExternal',
    'display-capture',
    'usb'
  ])('may not use %s', (permission) => {
    expect(appsSession.check?.(null, permission, 'https://comfy.org/')).toBe(false)
    expect(requested(permission, CUTOUT_URL)).toBe(false)
  })

  it('grants nothing to a frame from another site', () => {
    expect(appsSession.check?.(null, 'fullscreen', 'https://player.example/')).toBe(false)
    expect(requested('fullscreen', 'https://player.example/embed')).toBe(false)
  })

  it('sends downloads through the downloads shelf', () => {
    expect(mocks.attachDownloads).toHaveBeenCalledWith(appsSession)
  })
})

describe('staying in step with the panel', () => {
  beforeEach(async () => {
    await openCutout()
    finishLoading()
  })

  it('hides when the panel reloads, and when it crashes', async () => {
    panel.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(hostedPage().visible).toBe(false)

    await openCutout()
    expect(hostedPage().visible).toBe(true)

    panel.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(hostedPage().visible).toBe(false)
  })

  it('stays up while the panel only changes its hash', () => {
    panel.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })

    expect(hostedPage().visible).toBe(true)
  })

  it('goes back above a panel that was rebuilt over it', async () => {
    hostWindow.contentView.addChildView(panel)
    expect(hostWindow.stack.at(-1)).toBe(panel)

    await openCutout()

    expect(hostWindow.stack.at(-1)).toBe(hostedPage())
  })

  it('does not climb over a popup that opened above it', async () => {
    const popup = new FakeView()
    hostWindow.contentView.addChildView(popup)

    await openCutout()

    expect(hostWindow.stack.at(-1)).toBe(popup)
  })

  it('hands the panel a frame of the page only while it is on screen', async () => {
    hostedPage().webContents.capturePage.mockResolvedValue({
      isEmpty: () => false,
      toDataURL: () => 'data:image/png;base64,frame'
    })
    expect(await captureAppPage(panelContents())).toBe('data:image/png;base64,frame')

    hideAppPage(panelContents())
    expect(await captureAppPage(panelContents())).toBeNull()
  })

  it('closes the page with its window', () => {
    hostWindow.emit('closed')

    expect(hostedPage().webContents.close).toHaveBeenCalled()
    expect(liveAppsPages()).toEqual([])
  })
})

describe('isAppsPageSender', () => {
  function frame(url: string, routingId = 1): WebFrameMain {
    return { url, processId: 4, routingId } as unknown as WebFrameMain
  }

  beforeEach(async () => {
    await openCutout()
    finishLoading()
  })

  it('trusts the top frame of the hosted page while it is on the apps site', () => {
    const page = hostedPage().webContents as unknown as WebContents

    expect(isAppsPageSender(page, frame(CUTOUT_URL))).toBe(true)
    expect(liveAppsPages()).toEqual([page])
  })

  it('does not trust a frame embedded in the hosted page', () => {
    const page = hostedPage().webContents as unknown as WebContents

    expect(isAppsPageSender(page, frame(CUTOUT_URL, 9))).toBe(false)
  })

  it('does not trust the hosted page once it shows anything outside the apps site', () => {
    const page = hostedPage().webContents as unknown as WebContents
    hostedPage().webContents.url = 'https://comfy.org/hub/'

    expect(isAppsPageSender(page, frame('https://comfy.org/hub/'))).toBe(false)
    expect(liveAppsPages()).toEqual([])
  })

  it('does not trust another page that happens to show the apps site', () => {
    const other = new FakeContents() as unknown as WebContents

    expect(isAppsPageSender(other, frame(CUTOUT_URL))).toBe(false)
    expect(isAppsPageSender(panelContents(), frame(CUTOUT_URL))).toBe(false)
  })

  it('does not trust a sender with no frame', () => {
    const page = hostedPage().webContents as unknown as WebContents

    expect(isAppsPageSender(page, null)).toBe(false)
  })
})
