import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainEvent, WebContents, WebFrameMain } from 'electron'

import type { AppOutputs } from '../../types/ipc'
import type { DraftApp } from './draftApps'

type PermissionCheck = (contents: unknown, permission: string, requestingOrigin: string) => boolean
type PermissionRequest = (
  contents: unknown,
  permission: string,
  callback: (granted: boolean) => void,
  details: { requestingUrl: string }
) => void
type WindowOpenHandler = (details: { url: string }) => { action: string }

const mocks = vi.hoisted(() => ({
  windows: new Map<number, unknown>(),
  createView: (_options: unknown): unknown => null,
  session: null as unknown,
  openExternal: vi.fn((_url: string) => Promise.resolve()),
  attachDownloads: vi.fn(),
  online: true,
  answering: new Set<unknown>(),
  startAnswering: vi.fn(),
  stopAnswering: vi.fn(),
  capture: vi.fn(),
  pages: new Map<string, string>(),
  titles: new Map<string, string>(),
  drafts: new Map<string, { url: string; accepted: boolean; card?: { title: string } }>(),
  draftSession: null as unknown,
  draftAccountAllowed: true,
  hiddenPages: new Map<string, string>(),
  hiddenTitles: new Map<string, string>(),
  identity: null as string | null
}))

vi.mock('electron', () => ({
  WebContentsView: class {
    constructor(options: unknown) {
      return mocks.createView(options) as object
    }
  },
  app: { isPackaged: false },
  net: { isOnline: () => mocks.online },
  session: { fromPartition: () => mocks.session },
  shell: { openExternal: mocks.openExternal }
}))
vi.mock('../host/registry', () => ({
  get comfyWindows() {
    return mocks.windows
  }
}))
vi.mock('../lib/ipc/registerCreditBalanceHandlers', () => ({
  refreshCreditBalanceAfterRun: vi.fn()
}))
vi.mock('../lib/comfyDownloadManager', () => ({
  attachSessionDownloadHandler: mocks.attachDownloads
}))
vi.mock('../lib/contextMenu', () => ({ attachContextMenu: vi.fn() }))
vi.mock('../lib/telemetry', () => ({
  capture: mocks.capture,
  DEFAULT_EVENT_PROPERTY_NAMES: new Set<string>()
}))
vi.mock('./appsCatalog', () => ({
  pageUrlForListedApp: (id: string) => mocks.pages.get(id) ?? null,
  titleForListedApp: (id: string) => mocks.titles.get(id) ?? null
}))
vi.mock('./draftApps', () => ({
  draftOf: (id: string) => mocks.drafts.get(id) ?? null,
  draftPageUrl: (id: string) => {
    const draft = mocks.drafts.get(id)
    return draft?.accepted ? draft.url : null
  },
  draftSession: () => mocks.draftSession,
  revokeDraft: (id: string) => {
    const draft = mocks.drafts.get(id)
    if (draft) draft.accepted = false
  },
  forgetDrafts: (only?: readonly unknown[]) => {
    for (const [id, draft] of mocks.drafts) {
      if (!only || only.includes(draft)) mocks.drafts.delete(id)
    }
  }
}))
vi.mock('./appsOffline', () => ({
  startAnsweringFromKeptCopies: (appsSession: unknown, location: unknown) => {
    mocks.answering.add(appsSession)
    mocks.startAnswering(appsSession, location)
  },
  stopAnsweringFromKeptCopies: (appsSession: unknown) => {
    mocks.answering.delete(appsSession)
    mocks.stopAnswering(appsSession)
  }
}))
vi.mock('./hiddenApps', () => ({
  pageUrlForHiddenApp: (id: string) => mocks.hiddenPages.get(id) ?? null,
  titleForHiddenApp: (id: string) => mocks.hiddenTitles.get(id) ?? null
}))
vi.mock('./draftLinks', () => ({
  cloudIdentity: () => mocks.identity,
  isDraftStillAllowed: async (id: string) =>
    mocks.draftAccountAllowed && mocks.drafts.get(id)?.accepted === true
}))
vi.mock('./appsConfig', () => ({
  currentAppsLocation: () => ({
    url: 'https://comfy.org/apps/',
    origin: 'https://comfy.org',
    scopePath: '/apps/'
  })
}))

import {
  _resetForTest as forgetAppsPages,
  appsPageAdmits,
  isAppsPageSender,
  liveAppsPages
} from './appsPages'
import {
  APP_OPENED_EVENT,
  APP_OUTPUT_ACTION_CHANNEL,
  APP_OUTPUTS_CHANNEL,
  APP_BACK_TO_LIST_ASKED_CHANNEL,
  APP_PAGE_CLOSED_CHANNEL,
  APP_PAGE_FAILED_EVENT,
  APP_PAGE_STATUS_CHANNEL,
  APPS_LIST_CHANGED_CHANNEL,
  APP_RUNS_CHANNEL,
  MAX_BACKGROUND_RUNS,
  TITLE_BAR_APPS_CHANNEL,
  _resetForTest,
  appSwitchStopsRun,
  captureAppPage,
  closeAppPage,
  closeDraftPages,
  closeStaffPagesOfOtherAccounts,
  hideAppPage,
  loadedAppPage,
  noteAppPageRunning,
  runningAppCount,
  runningApps,
  sendAppOutputAction,
  titleBarApps,
  showAppOutputs,
  shownOutputFile,
  showAppPage
} from './appPageView'
import { trackFromAppsPage } from '../lib/ipc/registerAppsTelemetryHandlers'

const APPS_URL = 'https://comfy.org/apps/'
const CUTOUT = 'remove-background'
const CUTOUT_URL = `${APPS_URL}remove-background/desktop.html`
const UPSCALE = 'upscale'
const UPSCALE_URL = `${APPS_URL}#/upscale`
const DRAFT = 'draft-pr683-depth-swap'
const DRAFT_URL = `${APPS_URL}depth-swap/desktop.html`
const STAFF_IDENTITY = '["staff-subject","ws-1"]'
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
  executeJavaScript = vi.fn()
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
  focused = true
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
  isFocused(): boolean {
    return this.focused
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

function fakeSession(): FakeSession {
  return {
    check: null,
    request: null,
    setPermissionCheckHandler(handler) {
      this.check = handler
    },
    setPermissionRequestHandler(handler) {
      this.request = handler
    }
  }
}

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
  return sentToPanel(APP_PAGE_STATUS_CHANNEL).at(-1)?.[2]
}

function openCutout(placement: Record<string, unknown> = PLACEMENT): Promise<string> {
  return showAppPage(panelContents(), CUTOUT, placement)
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetForTest()
  forgetAppsPages()
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
  appsSession = fakeSession()
  mocks.session = appsSession
  mocks.online = true
  mocks.answering = new Set()
  mocks.drafts = new Map()
  mocks.draftSession = fakeSession()
  mocks.draftAccountAllowed = true
  mocks.hiddenPages = new Map()
  mocks.hiddenTitles = new Map()
  mocks.identity = STAFF_IDENTITY
  mocks.createView = () => {
    const view = new FakeView()
    created.push(view)
    return view
  }
  mocks.windows = new Map([[WINDOW_KEY, { window: hostWindow, panelView: panel }]])
})

describe('opening an app', () => {
  it('loads a page asked for hidden without showing it, and shows it once asked', async () => {
    expect(await openCutout({ ...PLACEMENT, hidden: true })).toBe('loading')
    expect(hostedPage().webContents.loadURL).toHaveBeenCalledWith(CUTOUT_URL)

    finishLoading()

    expect(lastStatusSentToPanel()).toBe('ready')
    expect(hostedPage().visible).toBe(false)

    expect(await openCutout()).toBe('ready')
    expect(hostedPage().webContents.loadURL).toHaveBeenCalledTimes(1)
    expect(hostedPage().visible).toBe(true)
  })

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

describe('a hidden app from the staff list', () => {
  const WORLDS = 'explore-worlds'
  const WORLDS_URL = `${APPS_URL}explore-worlds/desktop.html`

  beforeEach(() => {
    mocks.hiddenPages = new Map([[WORLDS, WORLDS_URL]])
    mocks.hiddenTitles = new Map([[WORLDS, 'Explore Worlds']])
  })

  it('opens its page in the same apps session as a published app', async () => {
    expect(await showAppPage(panelContents(), WORLDS, PLACEMENT)).toBe('loading')

    expect(hostedPage().webContents.loadURL).toHaveBeenCalledWith(WORLDS_URL)
    expect(appsSession.check).not.toBeNull()
    expect((mocks.draftSession as FakeSession).check).toBeNull()
  })

  it('opens nothing once the staff list no longer holds it', async () => {
    mocks.hiddenPages.clear()

    expect(await showAppPage(panelContents(), WORLDS, PLACEMENT)).toBe('failed')
    expect(created).toHaveLength(0)
  })

  it('opens the published page when the app is on both lists', async () => {
    mocks.hiddenPages.set(CUTOUT, `${APPS_URL}somewhere-else/desktop.html`)

    await openCutout()

    expect(hostedPage().webContents.loadURL).toHaveBeenCalledWith(CUTOUT_URL)
  })

  it('names a running hidden app in the title bar by its title on the staff list', async () => {
    await showAppPage(panelContents(), WORLDS, PLACEMENT)
    finishLoading(WORLDS_URL)
    noteAppPageRunning(hostedPage().webContents as unknown as WebContents, true)

    expect(runningApps(WINDOW_KEY)).toEqual([{ id: WORLDS, title: 'Explore Worlds' }])
  })

  it('keeps naming an open hidden app by its title once the staff list forgets it', async () => {
    await showAppPage(panelContents(), WORLDS, PLACEMENT)
    finishLoading(WORLDS_URL)
    noteAppPageRunning(hostedPage().webContents as unknown as WebContents, true)

    mocks.hiddenTitles.clear()

    expect(runningApps(WINDOW_KEY)).toEqual([{ id: WORLDS, title: 'Explore Worlds' }])
  })

  it.each([
    ['signs out', null],
    ['switches to another account', '["other-subject","ws-2"]']
  ])('closes an open hidden app when the person %s', async (_change, identity) => {
    await showAppPage(panelContents(), WORLDS, PLACEMENT)
    finishLoading(WORLDS_URL)

    mocks.identity = identity
    closeStaffPagesOfOtherAccounts()

    expect(hostedPage().webContents.close).toHaveBeenCalled()
    expect(hostedPage().visible).toBe(false)
    expect(sentToPanel(APP_PAGE_CLOSED_CHANNEL)).toHaveLength(1)
    expect(liveAppsPages()).toEqual([])
  })

  it('closes a hidden app kept running in the background when the person signs out', async () => {
    await showAppPage(panelContents(), WORLDS, PLACEMENT)
    finishLoading(WORLDS_URL)
    const worlds = hostedPage()
    noteAppPageRunning(worlds.webContents as unknown as WebContents, true)
    await openCutout()

    mocks.identity = null
    closeStaffPagesOfOtherAccounts()

    expect(worlds.webContents.close).toHaveBeenCalled()
    expect(runningApps(WINDOW_KEY)).toEqual([])
    expect(created.at(-1)!.webContents.close).not.toHaveBeenCalled()
  })

  it('keeps an open hidden app when the same account signs in again', async () => {
    await showAppPage(panelContents(), WORLDS, PLACEMENT)
    finishLoading(WORLDS_URL)

    closeStaffPagesOfOtherAccounts()

    expect(hostedPage().webContents.close).not.toHaveBeenCalled()
    expect(sentToPanel(APP_PAGE_CLOSED_CHANNEL)).toHaveLength(0)
  })

  it('leaves an open app from the Apps page open when the person signs out', async () => {
    await openCutout()
    finishLoading()

    mocks.identity = null
    closeStaffPagesOfOtherAccounts()

    expect(hostedPage().webContents.close).not.toHaveBeenCalled()
    expect(hostedPage().visible).toBe(true)
    expect(sentToPanel(APP_PAGE_CLOSED_CHANNEL)).toHaveLength(0)
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

describe('a draft app', () => {
  function openDraft(): Promise<string> {
    return showAppPage(panelContents(), DRAFT, PLACEMENT)
  }

  beforeEach(async () => {
    mocks.drafts.set(DRAFT, { url: DRAFT_URL, accepted: true })
    await openDraft()
    finishLoading(DRAFT_URL)
  })

  it('loads in its own session', () => {
    expect(mocks.draftSession).not.toBe(appsSession)
    expect((mocks.draftSession as FakeSession).check).not.toBeNull()
    expect(appsSession.check).toBeNull()
  })

  it('never answers from kept copies, even after a dropped connection', () => {
    hostedPage().webContents.emit('did-fail-load', {}, -106, 'ERR_INTERNET_DISCONNECTED', '', true)

    expect(mocks.startAnswering).not.toHaveBeenCalled()
    expect(mocks.stopAnswering).not.toHaveBeenCalled()
    expect(lastStatusSentToPanel()).toBe('failed')
  })

  function draftPage(): WebContents {
    return hostedPage().webContents as unknown as WebContents
  }

  it('drops the draft from the list and closes its page when it goes back to all apps', async () => {
    hostedPage().webContents.emit('will-navigate', navigationEvent(), APPS_URL)

    expect(sentToPanel(APP_BACK_TO_LIST_ASKED_CHANNEL)).toHaveLength(0)
    expect(sentToPanel(APP_PAGE_CLOSED_CHANNEL)).toHaveLength(1)
    expect(sentToPanel(APPS_LIST_CHANGED_CHANNEL)).toHaveLength(1)
    expect(mocks.drafts.get(DRAFT)?.accepted).toBe(false)
    expect(hostedPage().webContents.close).toHaveBeenCalled()
    expect(hostedPage().visible).toBe(false)
    expect(liveAppsPages()).toEqual([])
    expect(await openDraft()).toBe('failed')
  })

  it('drops the draft and closes its page when it routes back to the list', async () => {
    const page = draftPage()

    hostedPage().webContents.emit('did-navigate-in-page', {}, `${APPS_URL}#/`, true)

    expect(sentToPanel(APP_PAGE_CLOSED_CHANNEL)).toHaveLength(1)
    expect(mocks.drafts.get(DRAFT)?.accepted).toBe(false)
    expect(hostedPage().webContents.close).toHaveBeenCalled()
    await expect(appsPageAdmits(page)).resolves.toBe(false)
  })

  it('drops the draft and closes its page once the person opens another app', async () => {
    const page = draftPage()

    await openCutout()

    expect(mocks.drafts.get(DRAFT)?.accepted).toBe(false)
    expect(sentToPanel(APPS_LIST_CHANGED_CHANNEL)).toHaveLength(1)
    expect(hostedPage().webContents.close).toHaveBeenCalled()
    await expect(appsPageAdmits(page)).resolves.toBe(false)
  })

  it('closes a running draft instead of keeping it in the background when another app opens', async () => {
    noteAppPageRunning(draftPage(), true)

    await openCutout()

    expect(mocks.drafts.get(DRAFT)?.accepted).toBe(false)
    expect(hostedPage().webContents.close).toHaveBeenCalled()
    expect(created).toHaveLength(2)
    expect(runningAppCount()).toBe(0)
    expect(sentToPanel(APP_RUNS_CHANNEL).at(-1)?.[1]).toEqual([])
  })

  async function openDraftInAnotherWindow(): Promise<FakeView> {
    const otherWindow = new FakeWindow()
    windowsByContentView.set(otherWindow.contentView, otherWindow)
    const otherPanel = new FakeView()
    otherPanel.bounds = { ...PANEL_FRAME }
    otherWindow.contentView.addChildView(otherPanel)
    mocks.windows.set(WINDOW_KEY + 1, { window: otherWindow, panelView: otherPanel })
    await showAppPage(otherPanel.webContents as unknown as WebContents, DRAFT, PLACEMENT)
    const otherPage = created.at(-1)!
    otherPage.webContents.url = DRAFT_URL
    otherPage.webContents.emit('did-navigate', {}, DRAFT_URL, 200)
    otherPage.webContents.emit('dom-ready')
    return otherPage
  }

  it('says a switch closes the draft while the draft is running', () => {
    mocks.drafts.get(DRAFT)!.card = { title: 'Depth Swap' }
    noteAppPageRunning(draftPage(), true)

    expect(appSwitchStopsRun(panelContents(), CUTOUT)).toEqual({
      appTitle: 'Depth Swap',
      closesDraft: true
    })
    expect(appSwitchStopsRun(panelContents(), DRAFT)).toBeNull()
  })

  it('says a switch closes the draft while it runs in another window', async () => {
    mocks.drafts.get(DRAFT)!.card = { title: 'Depth Swap' }
    const otherPage = await openDraftInAnotherWindow()
    noteAppPageRunning(otherPage.webContents as unknown as WebContents, true)

    expect(appSwitchStopsRun(panelContents(), CUTOUT)).toEqual({
      appTitle: 'Depth Swap',
      closesDraft: true
    })
  })

  it('says nothing about a switch while the draft is not running', async () => {
    await openDraftInAnotherWindow()

    expect(appSwitchStopsRun(panelContents(), CUTOUT)).toBeNull()
  })

  it('keeps a running draft open and asks the panel first when the page goes back to all apps', () => {
    mocks.drafts.get(DRAFT)!.card = { title: 'Depth Swap' }
    noteAppPageRunning(draftPage(), true)
    const navigation = navigationEvent()

    hostedPage().webContents.emit('will-navigate', navigation, APPS_URL)

    expect(navigation.preventDefault).toHaveBeenCalled()
    expect(sentToPanel(APP_BACK_TO_LIST_ASKED_CHANNEL)).toEqual([
      [APP_BACK_TO_LIST_ASKED_CHANNEL, DRAFT, { appTitle: 'Depth Swap', closesDraft: true }]
    ])
    expect(sentToPanel(APP_PAGE_CLOSED_CHANNEL)).toHaveLength(0)
    expect(hostedPage().webContents.close).not.toHaveBeenCalled()
    expect(mocks.drafts.get(DRAFT)?.accepted).toBe(true)
    expect(runningAppCount()).toBe(1)
  })

  it('asks the panel first when the draft runs in another window and this page goes back', async () => {
    mocks.drafts.get(DRAFT)!.card = { title: 'Depth Swap' }
    const otherPage = await openDraftInAnotherWindow()
    noteAppPageRunning(otherPage.webContents as unknown as WebContents, true)

    hostedPage().webContents.emit('will-navigate', navigationEvent(), APPS_URL)

    expect(sentToPanel(APP_BACK_TO_LIST_ASKED_CHANNEL)).toHaveLength(1)
    expect(otherPage.webContents.close).not.toHaveBeenCalled()
  })

  it('closes the running draft once the panel says go back', () => {
    mocks.drafts.get(DRAFT)!.card = { title: 'Depth Swap' }
    noteAppPageRunning(draftPage(), true)
    hostedPage().webContents.emit('will-navigate', navigationEvent(), APPS_URL)

    closeAppPage(panelContents(), DRAFT)

    expect(hostedPage().webContents.close).toHaveBeenCalled()
    expect(sentToPanel(APP_PAGE_CLOSED_CHANNEL)).toHaveLength(1)
    expect(mocks.drafts.get(DRAFT)?.accepted).toBe(false)
    expect(runningAppCount()).toBe(0)
  })

  it('leaves the page open when the go-back answer names an app the window no longer shows', () => {
    noteAppPageRunning(draftPage(), true)

    closeAppPage(panelContents(), CUTOUT)

    expect(hostedPage().webContents.close).not.toHaveBeenCalled()
    expect(sentToPanel(APP_PAGE_CLOSED_CHANNEL)).toHaveLength(0)
  })

  it('keeps a running draft and its run when the panel goes back to all apps', () => {
    noteAppPageRunning(draftPage(), true)

    hideAppPage(panelContents())

    expect(hostedPage().webContents.close).not.toHaveBeenCalled()
    expect(mocks.drafts.get(DRAFT)?.accepted).toBe(true)
    expect(runningAppCount()).toBe(1)
  })

  it('closes the draft in another window too once one window drops it', async () => {
    const otherWindow = new FakeWindow()
    windowsByContentView.set(otherWindow.contentView, otherWindow)
    const otherPanel = new FakeView()
    otherPanel.bounds = { ...PANEL_FRAME }
    otherWindow.contentView.addChildView(otherPanel)
    mocks.windows.set(WINDOW_KEY + 1, { window: otherWindow, panelView: otherPanel })
    await showAppPage(otherPanel.webContents as unknown as WebContents, DRAFT, PLACEMENT)
    const otherPage = created[1]!

    hostedPage().webContents.emit('will-navigate', navigationEvent(), APPS_URL)

    expect(otherPage.webContents.close).toHaveBeenCalled()
    await expect(appsPageAdmits(otherPage.webContents as unknown as WebContents)).resolves.toBe(
      false
    )
    expect(
      otherPanel.webContents.send.mock.calls.filter(([sent]) => sent === APP_PAGE_CLOSED_CHANNEL)
    ).toHaveLength(1)
    expect(
      otherPanel.webContents.send.mock.calls.filter(([sent]) => sent === APPS_LIST_CHANGED_CHANNEL)
    ).toHaveLength(1)
  })

  it('lets the draft page use the Desktop bridge while the draft is still allowed', async () => {
    await expect(appsPageAdmits(draftPage())).resolves.toBe(true)
  })

  it('refuses the Desktop bridge to the draft page as soon as the signed-in account no longer allows it', async () => {
    mocks.draftAccountAllowed = false

    await expect(appsPageAdmits(draftPage())).resolves.toBe(false)
  })

  it('keeps the draft as it was when the person comes back to it', async () => {
    hideAppPage(panelContents())

    expect(await openDraft()).toBe('ready')
    expect(hostedPage().webContents.loadURL).toHaveBeenCalledTimes(1)
  })

  it('loads the draft again when its address changed since the page loaded', async () => {
    hideAppPage(panelContents())
    mocks.drafts.set(DRAFT, { url: `${APPS_URL}depth-swap/`, accepted: true })

    expect(await openDraft()).toBe('loading')
    expect(hostedPage().webContents.loadURL).toHaveBeenLastCalledWith(`${APPS_URL}depth-swap/`)
  })

  it('closes the draft back to the list and forgets every draft when the Cloud account changes', async () => {
    const page = draftPage()

    closeDraftPages()

    await expect(appsPageAdmits(page)).resolves.toBe(false)
    expect(sentToPanel(APP_PAGE_CLOSED_CHANNEL)).toHaveLength(1)
    expect(sentToPanel(APPS_LIST_CHANGED_CHANNEL).length).toBeGreaterThan(0)
    expect(hostedPage().webContents.close).toHaveBeenCalled()
    expect(mocks.drafts.size).toBe(0)
  })

  it('closes only the drafts the account change checked, not one registered again since', async () => {
    const page = draftPage()
    const checked = mocks.drafts.get(DRAFT)!
    const newer = { url: DRAFT_URL, accepted: true }
    mocks.drafts.set(DRAFT, newer)

    closeDraftPages([checked] as unknown as DraftApp[])

    expect(hostedPage().webContents.close).not.toHaveBeenCalled()
    expect(mocks.drafts.get(DRAFT)).toBe(newer)
    expect(newer.accepted).toBe(true)
    await expect(appsPageAdmits(page)).resolves.toBe(true)
    expect(sentToPanel(APP_PAGE_CLOSED_CHANNEL)).toHaveLength(0)
  })

  it('closes a draft the account change checked', async () => {
    const page = draftPage()

    closeDraftPages([mocks.drafts.get(DRAFT)!] as unknown as DraftApp[])

    expect(hostedPage().webContents.close).toHaveBeenCalled()
    expect(mocks.drafts.size).toBe(0)
    await expect(appsPageAdmits(page)).resolves.toBe(false)
  })

  it('watches its window once however many times the draft is opened and dropped', async () => {
    for (let round = 0; round < 3; round += 1) {
      created.at(-1)!.webContents.emit('will-navigate', navigationEvent(), APPS_URL)
      mocks.drafts.set(DRAFT, { url: DRAFT_URL, accepted: true })
      expect(await openDraft()).toBe('loading')
    }

    expect(created).toHaveLength(4)
    expect(hostWindow.listenerCount('closed')).toBe(1)

    hostWindow.emit('closed')

    expect(created.at(-1)!.webContents.close).toHaveBeenCalled()
    expect(liveAppsPages()).toEqual([])
  })
})

describe('a Cloud account change', () => {
  it('leaves an open listed app as it is and tells the panel to list apps again', async () => {
    mocks.drafts.set(DRAFT, { url: DRAFT_URL, accepted: true })
    await openCutout()
    finishLoading()

    closeDraftPages()

    await expect(appsPageAdmits(hostedPage().webContents as unknown as WebContents)).resolves.toBe(
      true
    )
    expect(hostedPage().webContents.close).not.toHaveBeenCalled()
    expect(hostedPage().visible).toBe(true)
    expect(sentToPanel(APP_PAGE_CLOSED_CHANNEL)).toHaveLength(0)
    expect(sentToPanel(APPS_LIST_CHANGED_CHANNEL)).toHaveLength(1)
    expect(mocks.drafts.size).toBe(0)
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

function dropConnection(): void {
  hostedPage().webContents.emit('did-fail-load', {}, -106, 'ERR_INTERNET_DISCONNECTED', '', true)
}

describe('an app page with no internet', () => {
  it('loads from the network while this computer is online, without kept copies in the way', async () => {
    mocks.answering.add(appsSession)

    await openCutout()

    expect(mocks.stopAnswering).toHaveBeenCalledWith(appsSession)
    expect(mocks.startAnswering).not.toHaveBeenCalled()
    expect(hostedPage().webContents.loadURL).toHaveBeenCalledWith(CUTOUT_URL)
  })

  it('loads from the kept copies when this computer is offline', async () => {
    mocks.online = false

    await openCutout()

    expect(mocks.startAnswering).toHaveBeenCalledWith(appsSession, {
      url: 'https://comfy.org/apps/',
      origin: 'https://comfy.org',
      scopePath: '/apps/'
    })
    expect(mocks.stopAnswering).not.toHaveBeenCalled()
  })

  it('loads the page again from the kept copies when the network fails, without reporting it', async () => {
    await openCutout()

    dropConnection()

    expect(mocks.startAnswering).toHaveBeenCalledTimes(1)
    expect(hostedPage().webContents.loadURL).toHaveBeenCalledTimes(2)
    expect(hostedPage().webContents.loadURL).toHaveBeenLastCalledWith(CUTOUT_URL)
    expect(lastStatusSentToPanel()).not.toBe('failed')
    expect(mocks.capture).not.toHaveBeenCalledWith(APP_PAGE_FAILED_EVENT, expect.anything())

    finishLoading()
    expect(lastStatusSentToPanel()).toBe('ready')
  })

  it('still gets its own retry from the kept copies when another page already turned them on', async () => {
    await openCutout()
    mocks.answering.add(appsSession)

    dropConnection()

    expect(hostedPage().webContents.loadURL).toHaveBeenCalledTimes(2)
    expect(lastStatusSentToPanel()).not.toBe('failed')
  })

  it("says the page didn't load when the kept copies fail too", async () => {
    await openCutout()

    dropConnection()
    dropConnection()

    expect(hostedPage().webContents.loadURL).toHaveBeenCalledTimes(2)
    expect(lastStatusSentToPanel()).toBe('failed')
    expect(mocks.capture).toHaveBeenCalledWith(APP_PAGE_FAILED_EVENT, {
      app_id: CUTOUT,
      reason: 'network'
    })
  })
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
    dropConnection()
    dropConnection()
    expect(lastStatusSentToPanel()).toBe('failed')
    expect(mocks.capture).toHaveBeenCalledWith(APP_PAGE_FAILED_EVENT, {
      app_id: CUTOUT,
      reason: 'network'
    })

    expect(await openCutout({ ...PLACEMENT, retry: true })).toBe('loading')
    expect(lastStatusSentToPanel()).toBe('loading')
    expect(hostedPage().webContents.loadURL).toHaveBeenCalledTimes(3)
    expect(hostedPage().webContents.loadURL).toHaveBeenLastCalledWith(CUTOUT_URL)

    finishLoading()
    expect(hostedPage().visible).toBe(true)
    expect(lastStatusSentToPanel()).toBe('ready')
    expect(mocks.capture).not.toHaveBeenCalledWith(APP_OPENED_EVENT, expect.anything())
  })

  it('follows a redirect that stays on the apps site while the page loads', async () => {
    await openCutout()
    const event = navigationEvent()
    hostedPage().webContents.emit('will-redirect', event, `${CUTOUT_URL}?v=2`, false, true)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(mocks.capture).not.toHaveBeenCalledWith(APP_PAGE_FAILED_EVENT, expect.anything())

    finishLoading(`${CUTOUT_URL}?v=2`)
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

  it('asks again whether a refused app may open when the person retries it, and loads it once it may', async () => {
    await openCutout()
    finishLoading()
    hideAppPage(panelContents())
    mocks.pages.delete(UPSCALE)
    expect(await showAppPage(panelContents(), UPSCALE, PLACEMENT)).toBe('failed')

    expect(await showAppPage(panelContents(), UPSCALE, { ...PLACEMENT, retry: true })).toBe(
      'failed'
    )
    expect(hostedPage().webContents.loadURL).toHaveBeenCalledTimes(1)
    expect(hostedPage().visible).toBe(false)

    mocks.pages.set(UPSCALE, UPSCALE_URL)
    expect(await showAppPage(panelContents(), UPSCALE, { ...PLACEMENT, retry: true })).toBe(
      'loading'
    )
    expect(hostedPage().webContents.loadURL).toHaveBeenLastCalledWith(UPSCALE_URL)
    finishLoading(UPSCALE_URL)
    expect(hostedPage().visible).toBe(true)
  })

  it("names the app with every status, so the panel can tell a hidden app's page from the one it shows", async () => {
    await openCutout()
    hideAppPage(panelContents())
    mocks.pages.delete(UPSCALE)
    expect(await showAppPage(panelContents(), UPSCALE, PLACEMENT)).toBe('failed')

    finishLoading()

    expect(sentToPanel(APP_PAGE_STATUS_CHANNEL).at(-1)).toEqual([
      APP_PAGE_STATUS_CHANNEL,
      CUTOUT,
      'ready'
    ])
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
      toJPEG: () => Buffer.from('frame')
    })
    expect(await captureAppPage(panelContents())).toBe(
      `data:image/jpeg;base64,${Buffer.from('frame').toString('base64')}`
    )

    hideAppPage(panelContents())
    expect(await captureAppPage(panelContents())).toBeNull()
  })

  it('closes the page with its window', () => {
    hostWindow.emit('closed')

    expect(hostedPage().webContents.close).toHaveBeenCalled()
    expect(liveAppsPages()).toEqual([])
  })
})

describe('keeping apps running in the background', () => {
  const HDR = 'sdr-to-hdr'
  const HDR_URL = `${APPS_URL}sdr-to-hdr/desktop.html`
  const SWAP = 'product-swap'
  const SWAP_URL = `${APPS_URL}product-swap/desktop.html`
  const ADS = 'product-ads'
  const ADS_URL = `${APPS_URL}product-ads/desktop.html`
  const ROOM = 'room-design'
  const ROOM_URL = `${APPS_URL}room-design/desktop.html`
  const URLS: Record<string, string> = {
    [CUTOUT]: CUTOUT_URL,
    [HDR]: HDR_URL,
    [SWAP]: SWAP_URL,
    [ADS]: ADS_URL,
    [ROOM]: ROOM_URL
  }

  beforeEach(() => {
    for (const [id, url] of Object.entries(URLS)) mocks.pages.set(id, url)
    mocks.titles = new Map([
      [CUTOUT, 'Remove Background'],
      [HDR, 'SDR to HDR']
    ])
  })

  function pageOf(url: string): FakeView {
    const view = created.findLast((one) => one.webContents.url === url)
    if (!view) throw new Error(`No page loaded ${url}`)
    return view
  }

  async function openAndLoad(appId: string): Promise<FakeView> {
    await showAppPage(panelContents(), appId, PLACEMENT)
    const view = pageOf(URLS[appId] ?? '')
    view.webContents.emit('did-navigate', {}, view.webContents.url, 200)
    view.webContents.emit('dom-ready')
    return view
  }

  function reportRun(view: FakeView, running: unknown): void {
    noteAppPageRunning(view.webContents as unknown as WebContents, running)
  }

  async function runInBackground(appId: string): Promise<FakeView> {
    const view = await openAndLoad(appId)
    reportRun(view, true)
    return view
  }

  function runsSentToPanel(): unknown {
    return sentToPanel(APP_RUNS_CHANNEL).at(-1)?.[1]
  }

  it('loads the next app over an idle page, as before', async () => {
    const cutout = await openAndLoad(CUTOUT)

    await showAppPage(panelContents(), HDR, PLACEMENT)

    expect(created).toEqual([cutout])
    expect(cutout.webContents.loadURL).toHaveBeenLastCalledWith(HDR_URL)
  })

  it('keeps a running app alive and hidden in its own page while the next app opens', async () => {
    const cutout = await runInBackground(CUTOUT)

    await showAppPage(panelContents(), HDR, PLACEMENT)

    expect(created).toHaveLength(2)
    expect(cutout.visible).toBe(false)
    expect(cutout.webContents.close).not.toHaveBeenCalled()
    expect(cutout.webContents.loadURL).toHaveBeenCalledTimes(1)
    expect(pageOf(HDR_URL)).not.toBe(cutout)
    expect(runsSentToPanel()).toEqual([{ appId: CUTOUT, running: true, finished: false }])
    expect(runningAppCount()).toBe(1)
  })

  it('shows a kept app again at once without loading it again', async () => {
    const cutout = await runInBackground(CUTOUT)
    const hdr = await openAndLoad(HDR)

    expect(await showAppPage(panelContents(), CUTOUT, PLACEMENT)).toBe('ready')

    expect(cutout.visible).toBe(true)
    expect(cutout.webContents.loadURL).toHaveBeenCalledTimes(1)
    expect(hdr.webContents.close).toHaveBeenCalled()
  })

  it('keeps a running app in the background while a draft opens, and drops the draft on the way back', async () => {
    const cutout = await runInBackground(CUTOUT)
    mocks.drafts.set(DRAFT, { url: DRAFT_URL, accepted: true })

    await showAppPage(panelContents(), DRAFT, PLACEMENT)
    const draft = pageOf(DRAFT_URL)

    expect(draft).not.toBe(cutout)
    expect(cutout.webContents.close).not.toHaveBeenCalled()
    expect(runningAppCount()).toBe(1)

    expect(await showAppPage(panelContents(), CUTOUT, PLACEMENT)).toBe('ready')

    expect(draft.webContents.close).toHaveBeenCalled()
    expect(mocks.drafts.get(DRAFT)?.accepted).toBe(false)
    expect(cutout.visible).toBe(true)
    expect(cutout.webContents.loadURL).toHaveBeenCalledTimes(1)
  })

  it('marks a run that ends in the background as done until its app is opened', async () => {
    const cutout = await runInBackground(CUTOUT)
    await openAndLoad(HDR)

    reportRun(cutout, false)
    expect(runsSentToPanel()).toEqual([{ appId: CUTOUT, running: false, finished: true }])

    await showAppPage(panelContents(), CUTOUT, PLACEMENT)
    expect(runsSentToPanel()).toEqual([])
  })

  it('drops the done mark when a kept page starts another run', async () => {
    const cutout = await runInBackground(CUTOUT)
    await openAndLoad(HDR)
    reportRun(cutout, false)

    reportRun(cutout, true)

    expect(runsSentToPanel()).toEqual([{ appId: CUTOUT, running: true, finished: false }])
  })

  it('does not mark a run done that ends while its page is on screen', async () => {
    const cutout = await runInBackground(CUTOUT)

    reportRun(cutout, false)

    expect(runsSentToPanel()).toEqual([])
  })

  it('tells the title bar which apps are running, by name', async () => {
    const titleBar = new FakeView()
    mocks.windows = new Map([
      [WINDOW_KEY, { window: hostWindow, panelView: panel, titleBarView: titleBar }]
    ])
    await runInBackground(CUTOUT)

    expect(titleBar.webContents.send).toHaveBeenLastCalledWith(TITLE_BAR_APPS_CHANNEL, {
      running: [{ id: CUTOUT, title: 'Remove Background' }],
      ready: []
    })
    expect(runningApps(WINDOW_KEY)).toEqual([{ id: CUTOUT, title: 'Remove Background' }])
  })

  it('tells the title bar which runs ended in the background, until their app is opened', async () => {
    const titleBar = new FakeView()
    mocks.windows = new Map([
      [WINDOW_KEY, { window: hostWindow, panelView: panel, titleBarView: titleBar }]
    ])
    const cutout = await runInBackground(CUTOUT)
    await openAndLoad(HDR)

    reportRun(cutout, false)
    expect(titleBarApps(WINDOW_KEY)).toEqual({
      running: [],
      ready: [{ id: CUTOUT, title: 'Remove Background' }]
    })
    expect(titleBar.webContents.send).toHaveBeenLastCalledWith(
      TITLE_BAR_APPS_CHANNEL,
      titleBarApps(WINDOW_KEY)
    )

    await showAppPage(panelContents(), CUTOUT, PLACEMENT)
    expect(titleBarApps(WINDOW_KEY)).toEqual({ running: [], ready: [] })
  })

  it(`keeps at most ${MAX_BACKGROUND_RUNS} running apps, and loads over a further running app`, async () => {
    await runInBackground(CUTOUT)
    await runInBackground(HDR)
    await runInBackground(SWAP)
    const ads = await runInBackground(ADS)

    await showAppPage(panelContents(), ROOM, PLACEMENT)

    expect(created).toHaveLength(4)
    expect(ads.webContents.loadURL).toHaveBeenLastCalledWith(ROOM_URL)
  })

  it('closes a done page in the background to make room for another running app', async () => {
    const cutout = await runInBackground(CUTOUT)
    await runInBackground(HDR)
    await runInBackground(SWAP)
    reportRun(cutout, false)
    const ads = await runInBackground(ADS)

    await showAppPage(panelContents(), ROOM, PLACEMENT)

    expect(cutout.webContents.close).toHaveBeenCalled()
    expect(ads.visible).toBe(false)
    expect(ads.webContents.close).not.toHaveBeenCalled()
    expect(runningAppCount()).toBe(3)
  })

  it('ignores run reports from a page with no app loaded, and reports that are not true or false', async () => {
    await openCutout()
    reportRun(hostedPage(), true)
    expect(runningAppCount()).toBe(0)

    finishLoading()
    reportRun(hostedPage(), 'yes')
    expect(runningAppCount()).toBe(0)
  })

  it('does not call a run done when its page crashes', async () => {
    const cutout = await runInBackground(CUTOUT)
    await openAndLoad(HDR)

    cutout.webContents.emit('render-process-gone', {}, { reason: 'crashed' })

    expect(runsSentToPanel()).toEqual([])
    expect(runningAppCount()).toBe(0)
  })

  it('stops calling an app ready when its page crashes after the run finished in the background', async () => {
    const cutout = await runInBackground(CUTOUT)
    await openAndLoad(HDR)
    reportRun(cutout, false)
    expect(titleBarApps(WINDOW_KEY).ready).toEqual([{ id: CUTOUT, title: 'Remove Background' }])

    cutout.webContents.emit('render-process-gone', {}, { reason: 'crashed' })

    expect(titleBarApps(WINDOW_KEY)).toEqual({ running: [], ready: [] })
    expect(runsSentToPanel()).toEqual([])
  })

  it('says a switch stops a run only once the open app runs and the background is full of runs', async () => {
    await runInBackground(CUTOUT)
    await runInBackground(HDR)
    await runInBackground(SWAP)
    expect(appSwitchStopsRun(panelContents(), ROOM)).toBeNull()

    await runInBackground(ADS)

    expect(appSwitchStopsRun(panelContents(), ROOM)).toEqual({ appTitle: ADS, otherRuns: 3 })
    expect(appSwitchStopsRun(panelContents(), CUTOUT)).toBeNull()
    expect(appSwitchStopsRun(panelContents(), ADS)).toBeNull()
  })

  it('says a switch keeps the run when a done page in the background can make room', async () => {
    const cutout = await runInBackground(CUTOUT)
    await runInBackground(HDR)
    await runInBackground(SWAP)
    await runInBackground(ADS)

    reportRun(cutout, false)

    expect(appSwitchStopsRun(panelContents(), ROOM)).toBeNull()
  })

  it('forgets a run once its page loads a new document', async () => {
    const cutout = await runInBackground(CUTOUT)

    cutout.webContents.emit('did-navigate', {}, CUTOUT_URL, 200)

    expect(runningAppCount()).toBe(0)
    expect(runsSentToPanel()).toEqual([])
  })

  it('closes a kept page that leaves for the apps list on its own, without closing the open app', async () => {
    const cutout = await runInBackground(CUTOUT)
    await openAndLoad(HDR)
    const leave = navigationEvent()

    cutout.webContents.emit('will-navigate', leave, APPS_URL)

    expect(leave.preventDefault).toHaveBeenCalled()
    expect(cutout.webContents.close).toHaveBeenCalled()
    expect(sentToPanel(APP_PAGE_CLOSED_CHANNEL)).toEqual([])
    expect(runningAppCount()).toBe(0)
  })

  it('closes every page of a window when the window closes', async () => {
    const cutout = await runInBackground(CUTOUT)
    const hdr = await openAndLoad(HDR)

    hostWindow.emit('closed')

    expect(cutout.webContents.close).toHaveBeenCalled()
    expect(hdr.webContents.close).toHaveBeenCalled()
    expect(runningAppCount()).toBe(0)
  })

  it('stops Chromium from slowing down pages that run in the background', async () => {
    let options: unknown = null
    mocks.createView = (given) => {
      options = given
      const view = new FakeView()
      created.push(view)
      return view
    }

    await openCutout()

    expect(options).toMatchObject({ webPreferences: { backgroundThrottling: false } })
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

const HDR = 'sdr-to-hdr'
const HDR_URL = `${APPS_URL}sdr-to-hdr/desktop.html`
const RUN = { name: 'run_started', props: { where: 'cloud' } }

function eventFrom(contents: FakeContents): IpcMainEvent {
  return {
    sender: contents,
    senderFrame: { ...contents.mainFrame, url: contents.url }
  } as unknown as IpcMainEvent
}

function runsSent(): unknown[][] {
  return mocks.capture.mock.calls.filter(([name]) => name === 'comfy.desktop.apps.run_started')
}

describe('the app a hosted page has loaded', () => {
  beforeEach(() => {
    mocks.pages.set(HDR, HDR_URL)
  })

  it('is no app until the page Desktop loads commits, then the app with that document', async () => {
    await openCutout()
    const page = hostedPage().webContents as unknown as WebContents
    expect(loadedAppPage(page)).toBeNull()

    finishLoading()

    expect(loadedAppPage(page)).toEqual({ appId: CUTOUT, document: 1 })
  })

  it('is no app while the next app loads, then the next app once its page commits', async () => {
    await openCutout()
    finishLoading()
    const page = hostedPage().webContents as unknown as WebContents

    await showAppPage(panelContents(), HDR, PLACEMENT)
    expect(loadedAppPage(page)).toBeNull()

    finishLoading(HDR_URL)
    expect(loadedAppPage(page)).toEqual({ appId: HDR, document: 2 })
  })

  it("keeps the app when the page moves within its own address, and drops it when the page goes to another app's", async () => {
    await openCutout()
    finishLoading()
    const page = hostedPage().webContents

    page.emit('did-navigate', {}, `${CUTOUT_URL}?example=dog`, 200)
    expect(loadedAppPage(page as unknown as WebContents)).toEqual({ appId: CUTOUT, document: 2 })

    page.emit('did-navigate', {}, HDR_URL, 200)
    expect(loadedAppPage(page as unknown as WebContents)).toBeNull()
  })

  it('keeps the app while the page moves within its own page, by query or hash', async () => {
    await openCutout()
    finishLoading()
    const page = hostedPage().webContents

    page.emit('did-navigate-in-page', {}, `${CUTOUT_URL}?example=dog`, true)
    page.emit('did-navigate-in-page', {}, `${CUTOUT_URL}#result`, true)

    expect(loadedAppPage(page as unknown as WebContents)).toEqual({ appId: CUTOUT, document: 1 })
  })

  it('keeps the app on the address its page was redirected to, through moves within it', async () => {
    await openCutout()
    const moved = `${APPS_URL}remove-background/v2/desktop.html`
    finishLoading(moved)
    const page = hostedPage().webContents

    page.emit('did-navigate-in-page', {}, `${moved}#result`, true)
    expect(loadedAppPage(page as unknown as WebContents)).toEqual({ appId: CUTOUT, document: 1 })
  })

  it("keeps a hash-route app within its route, and drops it on another app's route", async () => {
    await showAppPage(panelContents(), UPSCALE, PLACEMENT)
    finishLoading(UPSCALE_URL)
    const page = hostedPage().webContents as unknown as WebContents
    const moveTo = (url: string) =>
      hostedPage().webContents.emit('did-navigate-in-page', {}, url, true)

    moveTo(`${UPSCALE_URL}/step-2`)
    expect(loadedAppPage(page)).toEqual({ appId: UPSCALE, document: 1 })

    moveTo(`${APPS_URL}#/upscale-pro`)
    expect(loadedAppPage(page)).toBeNull()

    moveTo(`${APPS_URL}#/other-app`)
    expect(loadedAppPage(page)).toBeNull()
  })

  it.each([
    [`${UPSCALE_URL}?mode=before`, `${UPSCALE_URL}?mode=after`],
    [`${UPSCALE_URL}/`, `${UPSCALE_URL}/step-2`]
  ])('keeps a hash-route app listed at %s while it moves to %s', async (listedUrl, nextUrl) => {
    mocks.pages.set(UPSCALE, listedUrl)
    await showAppPage(panelContents(), UPSCALE, PLACEMENT)
    finishLoading(listedUrl)
    const page = hostedPage().webContents

    page.url = nextUrl
    page.emit('did-navigate-in-page', {}, nextUrl, true)

    expect(loadedAppPage(page as unknown as WebContents)).toEqual({ appId: UPSCALE, document: 1 })
    await trackFromAppsPage(eventFrom(page), RUN)
    expect(runsSent()).toEqual([
      ['comfy.desktop.apps.run_started', { where: 'cloud', app_id: UPSCALE }]
    ])
  })

  it.each([`${UPSCALE_URL}?mode=before`, `${UPSCALE_URL}/`])(
    "drops a hash-route app listed at %s on another app's route and on the list",
    async (listedUrl) => {
      mocks.pages.set(UPSCALE, listedUrl)
      await showAppPage(panelContents(), UPSCALE, PLACEMENT)
      finishLoading(listedUrl)
      const page = hostedPage().webContents as unknown as WebContents
      const moveTo = (url: string) =>
        hostedPage().webContents.emit('did-navigate-in-page', {}, url, true)

      moveTo(`${APPS_URL}#/upscale-pro`)
      expect(loadedAppPage(page)).toBeNull()

      moveTo(listedUrl)
      expect(loadedAppPage(page)).toEqual({ appId: UPSCALE, document: 1 })

      moveTo(`${APPS_URL}#/other-app?mode=before`)
      expect(loadedAppPage(page)).toBeNull()

      moveTo(listedUrl)
      moveTo(`${APPS_URL}#/`)
      expect(loadedAppPage(page)).toBeNull()
    }
  )

  it('is no app for contents Desktop does not host', async () => {
    await openCutout()
    finishLoading()

    expect(loadedAppPage(panelContents())).toBeNull()
    expect(loadedAppPage(new FakeContents() as unknown as WebContents)).toBeNull()
  })
})

describe('usage events from a hosted page that switches apps', () => {
  beforeEach(() => {
    mocks.pages.set(HDR, HDR_URL)
  })

  it('drops what the old page sends while the next app loads, and tags the next page with its own app', async () => {
    await openCutout()
    finishLoading()
    const page = hostedPage().webContents

    await trackFromAppsPage(eventFrom(page), RUN)
    expect(runsSent()).toEqual([
      ['comfy.desktop.apps.run_started', { where: 'cloud', app_id: CUTOUT }]
    ])

    await showAppPage(panelContents(), HDR, PLACEMENT)
    expect(await trackFromAppsPage(eventFrom(page), RUN)).toBe(false)
    expect(runsSent()).toHaveLength(1)

    finishLoading(HDR_URL)
    await trackFromAppsPage(eventFrom(page), RUN)
    expect(runsSent()).toEqual([
      ['comfy.desktop.apps.run_started', { where: 'cloud', app_id: CUTOUT }],
      ['comfy.desktop.apps.run_started', { where: 'cloud', app_id: HDR }]
    ])
  })

  it('tags events again after the person goes back to the list and reopens an app drawn by a hash route', async () => {
    await showAppPage(panelContents(), UPSCALE, PLACEMENT)
    finishLoading(UPSCALE_URL)
    const page = hostedPage().webContents

    page.url = `${APPS_URL}#/`
    page.emit('did-navigate-in-page', {}, page.url, true)
    expect(loadedAppPage(page as unknown as WebContents)).toBeNull()

    await showAppPage(panelContents(), UPSCALE, PLACEMENT)
    expect(await trackFromAppsPage(eventFrom(page), RUN)).toBe(false)

    page.url = UPSCALE_URL
    page.emit('did-navigate-in-page', {}, UPSCALE_URL, true)
    expect(loadedAppPage(page as unknown as WebContents)).toEqual({ appId: UPSCALE, document: 1 })

    await trackFromAppsPage(eventFrom(page), RUN)
    expect(runsSent()).toEqual([
      ['comfy.desktop.apps.run_started', { where: 'cloud', app_id: UPSCALE }]
    ])
  })

  it('takes no app from a hash change that is not the route Desktop is loading', async () => {
    await openCutout()
    finishLoading()
    const page = hostedPage().webContents

    await showAppPage(panelContents(), HDR, PLACEMENT)
    page.emit('did-navigate-in-page', {}, `${CUTOUT_URL}#step-2`, true)
    page.emit('did-navigate-in-page', {}, HDR_URL, false)

    expect(loadedAppPage(page as unknown as WebContents)).toBeNull()
  })

  it('drops an event whose page was replaced while Desktop was checking it', async () => {
    await openCutout()
    finishLoading()
    const page = hostedPage().webContents

    const sending = trackFromAppsPage(eventFrom(page), RUN)
    page.emit('did-navigate', {}, CUTOUT_URL, 200)

    expect(await sending).toBe(false)
    expect(runsSent()).toEqual([])
  })
})

describe('outputs an app page shows', () => {
  const OUTPUTS = {
    items: [
      {
        name: 'cutout-1.png',
        mimeType: 'image/png',
        bytes: new Uint8Array([1]),
        tags: [],
        workflow: true
      },
      {
        name: 'cutout-2.png',
        mimeType: 'image/png',
        bytes: new Uint8Array([2]),
        tags: [],
        workflow: false
      }
    ],
    index: 0
  } as AppOutputs

  function pageContents(): WebContents {
    return hostedPage().webContents as unknown as WebContents
  }

  function shownFromPage(): boolean {
    return showAppOutputs(pageContents(), loadedAppPage(pageContents())!, OUTPUTS)
  }

  function sentToPage(): unknown[][] {
    return hostedPage().webContents.send.mock.calls.filter(
      ([channel]) => channel === APP_OUTPUT_ACTION_CHANNEL
    )
  }

  beforeEach(async () => {
    await openCutout()
    finishLoading()
  })

  it('hands them to the panel with the app they came from, and gives the panel the keyboard', () => {
    expect(shownFromPage()).toBe(true)

    expect(sentToPanel(APP_OUTPUTS_CHANNEL)).toEqual([[APP_OUTPUTS_CHANNEL, CUTOUT, OUTPUTS]])
    expect(panel.webContents.focus).toHaveBeenCalledTimes(1)
  })

  it('leaves the keyboard alone while the window is in the background', () => {
    hostWindow.focused = false

    expect(shownFromPage()).toBe(true)
    expect(panel.webContents.focus).not.toHaveBeenCalled()
  })

  it('shows nothing while the app is not on screen', () => {
    hideAppPage(panelContents())

    expect(shownFromPage()).toBe(false)
    expect(sentToPanel(APP_OUTPUTS_CHANNEL)).toEqual([])
  })

  it('shows nothing from a page that was replaced while Desktop checked it', () => {
    const sentFrom = loadedAppPage(pageContents())!
    finishLoading()

    expect(showAppOutputs(pageContents(), sentFrom, OUTPUTS)).toBe(false)
    expect(sentToPanel(APP_OUTPUTS_CHANNEL)).toEqual([])
  })

  it('shows nothing for contents Desktop does not host', () => {
    const other = new FakeContents() as unknown as WebContents

    expect(showAppOutputs(other, { appId: CUTOUT, document: 1 }, OUTPUTS)).toBe(false)
  })

  it('sends Download and Open workflow back to the page that showed the outputs', () => {
    shownFromPage()

    sendAppOutputAction(panelContents(), { action: 'download', index: 1 })
    sendAppOutputAction(panelContents(), { action: 'open-workflow', index: 0 })

    expect(sentToPage()).toEqual([
      [APP_OUTPUT_ACTION_CHANNEL, { action: 'download', index: 1 }],
      [APP_OUTPUT_ACTION_CHANNEL, { action: 'open-workflow', index: 0 }]
    ])
  })

  it('drops an action before any outputs were shown, and one for an output the page did not send', () => {
    sendAppOutputAction(panelContents(), { action: 'download', index: 0 })
    shownFromPage()
    sendAppOutputAction(panelContents(), { action: 'download', index: 2 })

    expect(sentToPage()).toEqual([])
  })

  it('drops an action once the page that showed the outputs is replaced', () => {
    shownFromPage()
    finishLoading()

    sendAppOutputAction(panelContents(), { action: 'download', index: 0 })

    expect(sentToPage()).toEqual([])
  })

  it('names the file Desktop found for a shown output, only while that page is loaded', () => {
    expect(shownOutputFile(panelContents(), 0)).toBeNull()

    showAppOutputs(pageContents(), loadedAppPage(pageContents())!, OUTPUTS, [
      null,
      '/out/cutout-2.png'
    ])

    expect(shownOutputFile(panelContents(), 0)).toBeNull()
    expect(shownOutputFile(panelContents(), 1)).toBe('/out/cutout-2.png')
    expect(shownOutputFile(panelContents(), 2)).toBeNull()
    expect(shownOutputFile(new FakeContents() as unknown as WebContents, 1)).toBeNull()

    finishLoading()

    expect(shownOutputFile(panelContents(), 1)).toBeNull()
  })

  it('sends Show in folder back to the page like any other action', () => {
    shownFromPage()

    sendAppOutputAction(panelContents(), { action: 'show-in-folder', index: 1 })

    expect(sentToPage()).toEqual([
      [APP_OUTPUT_ACTION_CHANNEL, { action: 'show-in-folder', index: 1 }]
    ])
  })

  it('tells the panel to close the outputs once the page that showed them is replaced', () => {
    shownFromPage()

    finishLoading()

    expect(sentToPanel(APP_OUTPUTS_CHANNEL)).toEqual([
      [APP_OUTPUTS_CHANNEL, CUTOUT, OUTPUTS],
      [APP_OUTPUTS_CHANNEL, CUTOUT, null]
    ])
  })

  it('keeps the outputs open while the page moves within the same document', () => {
    shownFromPage()

    hostedPage().webContents.emit('did-navigate-in-page', {}, `${CUTOUT_URL}#result`, true)

    expect(sentToPanel(APP_OUTPUTS_CHANNEL)).toEqual([[APP_OUTPUTS_CHANNEL, CUTOUT, OUTPUTS]])
  })

  it('takes actions only from the panel of the window the page is in', () => {
    shownFromPage()

    sendAppOutputAction(new FakeContents() as unknown as WebContents, {
      action: 'download',
      index: 0
    })

    expect(sentToPage()).toEqual([])
  })

  it('gives the page the keyboard when the panel asks for it, and not on a plain resize', async () => {
    await openCutout()
    expect(hostedPage().webContents.focus).not.toHaveBeenCalled()

    await openCutout({ ...PLACEMENT, focus: true })

    expect(hostedPage().webContents.focus).toHaveBeenCalledTimes(1)
  })
})
