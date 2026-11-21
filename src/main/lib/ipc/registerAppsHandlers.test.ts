import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  listeners: new Map<string, Handler>(),
  isPanel: true,
  isAppsPage: true,
  titleBarEntry: null as unknown,
  running: [] as { id: string; title: string }[],
  ready: [] as { id: string; title: string }[],
  noteAppPageRunning: vi.fn(),
  appRuns: vi.fn(() => [{ appId: 'remove-background', running: true, finished: false }]),
  appSwitchStopsRun: vi.fn(() => ({ appTitle: 'Remove Background', otherRuns: 3 })),
  popup: vi.fn(),
  menuItems: [] as { label: string; click: () => void }[],
  sendSurveyResponse: vi.fn(
    async (_surveyId: string, _questionId: string, _response: string) => true
  )
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
    on: (channel: string, handler: Handler) => mocks.listeners.set(channel, handler)
  },
  Menu: {
    buildFromTemplate: (items: { label: string; click: () => void }[]) => {
      mocks.menuItems = items
      return { popup: mocks.popup }
    }
  }
}))
vi.mock('../../apps/appPageView', () => ({
  appRuns: mocks.appRuns,
  appSwitchStopsRun: mocks.appSwitchStopsRun,
  captureAppPage: vi.fn(),
  hideAppPage: vi.fn(),
  noteAppPageRunning: mocks.noteAppPageRunning,
  showAppPage: vi.fn(),
  titleBarApps: () => ({ running: mocks.running, ready: mocks.ready })
}))
vi.mock('../../apps/appsPages', () => ({ isAppsPageSender: () => mocks.isAppsPage }))
vi.mock('../../apps/appsCatalog', () => ({ listApps: vi.fn(async () => []) }))
vi.mock('../../apps/appsConfig', () => ({ areAppsEnabled: vi.fn(async () => true) }))
vi.mock('../../host/registry', () => ({
  isPanelSender: () => mocks.isPanel,
  findEntryByTitleBarSender: () => mocks.titleBarEntry
}))
vi.mock('../telemetry', () => ({ sendSurveyResponse: mocks.sendSurveyResponse }))
vi.mock('../i18n', () => ({
  t: (key: string, params: { app?: string } = {}) =>
    key === 'titleBar.appReady' ? `${params.app} is ready` : key
}))

import { OPEN_RUNNING_APP_CHANNEL, registerAppsHandlers } from './registerAppsHandlers'

const SURVEY_ID = '01a1f22e-d672-0000-a5ce-85d8a1d81406'
const QUESTION_ID = '0f16a789-5c8e-4871-b44e-ec11c54b8c9b'

function sendRequest(text: unknown): Promise<unknown> {
  const handler = mocks.handlers.get('apps:send-request')
  if (!handler) throw new Error('No handler for apps:send-request')
  return Promise.resolve(handler({ sender: {} }, text))
}

describe('apps:send-request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.isPanel = true
    mocks.sendSurveyResponse.mockResolvedValue(true)
    registerAppsHandlers()
  })

  it('sends the trimmed request as the app request survey answer', async () => {
    expect(await sendRequest('  An app that colors line art  ')).toBe(true)

    expect(mocks.sendSurveyResponse).toHaveBeenCalledExactlyOnceWith(
      SURVEY_ID,
      QUESTION_ID,
      'An app that colors line art'
    )
  })

  it('reports that PostHog did not take the answer', async () => {
    mocks.sendSurveyResponse.mockResolvedValue(false)

    expect(await sendRequest('An app that colors line art')).toBe(false)
  })

  it('cuts the request to 500 characters', async () => {
    await sendRequest('x'.repeat(800))

    expect(mocks.sendSurveyResponse).toHaveBeenCalledWith(SURVEY_ID, QUESTION_ID, 'x'.repeat(500))
  })

  it.each([
    ['an empty string', ''],
    ['only spaces', '   \n\t'],
    ['a number', 42],
    ['an object', { text: 'An app' }],
    ['nothing', undefined]
  ])('returns false and sends nothing for %s', async (_label, text) => {
    expect(await sendRequest(text)).toBe(false)

    expect(mocks.sendSurveyResponse).not.toHaveBeenCalled()
  })

  it('ignores requests from outside the Desktop panel', async () => {
    mocks.isPanel = false

    expect(await sendRequest('An app that colors line art')).toBe(false)
    expect(mocks.sendSurveyResponse).not.toHaveBeenCalled()
  })
})

describe('runs of apps kept open', () => {
  const panelSend = vi.fn()
  const hostWindow = { isDestroyed: () => false }
  const REMOVE_BACKGROUND = { id: 'remove-background', title: 'Remove Background' }
  const HDR = { id: 'sdr-to-hdr', title: 'SDR to HDR' }

  function listener(channel: string): Handler {
    const handler = mocks.listeners.get(channel)
    if (!handler) throw new Error(`No listener for ${channel}`)
    return handler
  }

  function clickRunningApps(anchor: unknown = { x: 812.4, y: 36 }): void {
    void listener('comfy-titlebar:click-running-apps')({ sender: {} }, { anchor })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.listeners.clear()
    mocks.isPanel = true
    mocks.isAppsPage = true
    mocks.running = []
    mocks.ready = []
    mocks.titleBarEntry = {
      id: 7,
      entry: {
        window: hostWindow,
        panelView: { webContents: { send: panelSend, isDestroyed: () => false } }
      }
    }
    registerAppsHandlers()
  })

  it('hands the panel the runs of its window', async () => {
    const handler = mocks.handlers.get('apps:get-runs')

    expect(await handler?.({ sender: {} })).toEqual([
      { appId: 'remove-background', running: true, finished: false }
    ])
    mocks.isPanel = false
    expect(await handler?.({ sender: {} })).toEqual([])
  })

  it('asks the page host whether opening an app stops a run, for the panel only', async () => {
    const handler = mocks.handlers.get('apps:switch-stops-run')
    const sender = {}

    expect(await handler?.({ sender }, 'sdr-to-hdr')).toEqual({
      appTitle: 'Remove Background',
      otherRuns: 3
    })
    expect(mocks.appSwitchStopsRun).toHaveBeenCalledWith(sender, 'sdr-to-hdr')
    mocks.isPanel = false
    expect(await handler?.({ sender }, 'sdr-to-hdr')).toBeNull()
  })

  it('takes a run report only from an app page', () => {
    const sender = {}
    listener('apps-page:running')({ sender, senderFrame: {} }, true)
    expect(mocks.noteAppPageRunning).toHaveBeenCalledExactlyOnceWith(sender, true)

    mocks.isAppsPage = false
    listener('apps-page:running')({ sender, senderFrame: {} }, false)
    expect(mocks.noteAppPageRunning).toHaveBeenCalledTimes(1)
  })

  it('opens the one running app when its title bar indicator is clicked', () => {
    mocks.running = [REMOVE_BACKGROUND]

    clickRunningApps()

    expect(panelSend).toHaveBeenCalledExactlyOnceWith(
      OPEN_RUNNING_APP_CHANNEL,
      REMOVE_BACKGROUND.id
    )
    expect(mocks.popup).not.toHaveBeenCalled()
  })

  it('lists two or more running apps under the indicator, and opens the one picked', () => {
    mocks.running = [REMOVE_BACKGROUND, HDR]

    clickRunningApps()

    expect(mocks.menuItems.map((item) => item.label)).toEqual(['Remove Background', 'SDR to HDR'])
    expect(mocks.popup).toHaveBeenCalledExactlyOnceWith({ window: hostWindow, x: 812, y: 36 })
    mocks.menuItems[1]?.click()
    expect(panelSend).toHaveBeenCalledExactlyOnceWith(OPEN_RUNNING_APP_CHANNEL, HDR.id)
  })

  it('opens the one app whose run ended, and lists ready apps after running ones', () => {
    mocks.ready = [HDR]
    clickRunningApps()
    expect(panelSend).toHaveBeenCalledExactlyOnceWith(OPEN_RUNNING_APP_CHANNEL, HDR.id)

    mocks.running = [REMOVE_BACKGROUND]
    clickRunningApps()
    expect(mocks.menuItems.map((item) => item.label)).toEqual([
      'Remove Background',
      'SDR to HDR is ready'
    ])
  })

  it('does nothing for a click from outside a title bar, or with nothing running', () => {
    clickRunningApps()
    mocks.running = [REMOVE_BACKGROUND]
    mocks.titleBarEntry = null
    clickRunningApps()

    expect(panelSend).not.toHaveBeenCalled()
  })
})
