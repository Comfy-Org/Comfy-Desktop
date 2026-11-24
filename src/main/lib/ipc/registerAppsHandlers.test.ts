import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  listeners: new Map<string, Handler>(),
  isPanel: true,
  isGlobalSettings: true,
  canPasteDrafts: vi.fn(async () => true),
  closeDraftPages: vi.fn(),
  acceptDraft: vi.fn(async (_sender: unknown, _token: unknown) => null),
  draftsStillAllowed: vi.fn(async () => true),
  currentDrafts: vi.fn((): readonly unknown[] => []),
  draftCards: vi.fn((): unknown[] => []),
  listApps: vi.fn(async (): Promise<unknown[]> => []),
  openPastedDraft: vi.fn(async (_address: unknown) => ({ kind: 'asked' })),
  isAppsPage: true,
  titleBarEntry: null as unknown,
  running: [] as { id: string; title: string }[],
  ready: [] as { id: string; title: string }[],
  noteAppPageRunning: vi.fn(),
  appRuns: vi.fn(() => [{ appId: 'remove-background', running: true, finished: false }]),
  appSwitchStopsRun: vi.fn(() => ({ appTitle: 'Remove Background', otherRuns: 3 })),
  closeAppPage: vi.fn(),
  openRunningAppsMenu: vi.fn(),
  sendSurveyResponse: vi.fn(
    async (_surveyId: string, _questionId: string, _response: string) => true
  )
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
    on: (channel: string, handler: Handler) => mocks.listeners.set(channel, handler)
  }
}))
vi.mock('../../apps/appPageView', () => ({
  appRuns: mocks.appRuns,
  appSwitchStopsRun: mocks.appSwitchStopsRun,
  captureAppPage: vi.fn(),
  closeAppPage: mocks.closeAppPage,
  closeDraftPages: mocks.closeDraftPages,
  hideAppPage: vi.fn(),
  noteAppPageRunning: mocks.noteAppPageRunning,
  showAppPage: vi.fn(),
  titleBarApps: () => ({ running: mocks.running, ready: mocks.ready })
}))
vi.mock('../../apps/appsPages', () => ({ isAppsPageSender: () => mocks.isAppsPage }))
vi.mock('../../apps/appsCatalog', () => ({
  listApps: mocks.listApps,
  pictureForListedApp: (id: string) =>
    id === 'remove-background' ? 'https://comfy.org/rb.webp' : null
}))
vi.mock('../../host/registry', () => ({
  isPanelSender: () => mocks.isPanel,
  findEntryByTitleBarSender: () => mocks.titleBarEntry
}))
vi.mock('../../popups/titlePopup', () => ({
  isGlobalSettingsSender: () => mocks.isGlobalSettings,
  openRunningAppsMenu: mocks.openRunningAppsMenu
}))
vi.mock('../../apps/draftApps', () => ({
  currentDrafts: mocks.currentDrafts,
  draftCards: mocks.draftCards
}))
vi.mock('../../apps/draftLinks', () => ({
  acceptDraft: mocks.acceptDraft,
  canPasteDrafts: mocks.canPasteDrafts,
  draftsStillAllowed: mocks.draftsStillAllowed,
  openPastedDraft: mocks.openPastedDraft
}))
vi.mock('../telemetry', () => ({ sendSurveyResponse: mocks.sendSurveyResponse }))

import { cloudAuthEvents } from '../cloudAuthEvents'
import { registerAppsHandlers } from './registerAppsHandlers'
import { OPEN_RUNNING_APP_CHANNEL } from '../../../types/ipc'

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
    cloudAuthEvents.removeAllListeners()
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

describe('pasting a draft app address in Desktop settings', () => {
  function call(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = mocks.handlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return Promise.resolve(handler({ sender: {} }, ...args))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.isGlobalSettings = true
    cloudAuthEvents.removeAllListeners()
    registerAppsHandlers()
  })

  it('tells Desktop settings whether it takes a pasted address', async () => {
    expect(await call('apps:can-paste-draft')).toBe(true)
  })

  it('opens the pasted address through the draft link checks', async () => {
    const address = 'http://localhost:4321/apps/depth-swap/'
    expect(await call('apps:open-pasted-draft', address)).toEqual({ kind: 'asked' })
    expect(mocks.openPastedDraft).toHaveBeenCalledExactlyOnceWith(address)
  })

  it('answers nothing to a page other than Desktop settings', async () => {
    mocks.isGlobalSettings = false

    expect(await call('apps:can-paste-draft')).toBe(false)
    expect(await call('apps:open-pasted-draft', 'http://localhost:4321/apps/x/')).toBeNull()
    expect(mocks.canPasteDrafts).not.toHaveBeenCalled()
    expect(mocks.openPastedDraft).not.toHaveBeenCalled()
  })
})

describe('listing apps for the panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.isPanel = true
    cloudAuthEvents.removeAllListeners()
    registerAppsHandlers()
  })

  it('lists the drafts open when the catalog answers, not when the panel asked', async () => {
    const dropped = { id: 'draft-dropped', title: 'Dropped' }
    const listed = { id: 'remove-background', title: 'Remove Background' }
    let answerCatalog: (apps: unknown[]) => void = () => {}
    mocks.draftCards.mockReturnValue([dropped])
    mocks.listApps.mockReturnValueOnce(
      new Promise<unknown[]>((resolve) => {
        answerCatalog = resolve
      })
    )

    const answer = Promise.resolve(mocks.handlers.get('apps:list')?.({ sender: {} }))
    await settle()
    mocks.draftCards.mockReturnValue([])
    answerCatalog([listed])

    expect(await answer).toEqual([listed])
  })
})

describe('accepting a draft app', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    cloudAuthEvents.removeAllListeners()
    registerAppsHandlers()
  })

  it('passes the token of the question the person answered', async () => {
    const sender = { id: 'panel' }
    await mocks.handlers.get('apps:accept-draft')?.({ sender }, 'question-1')

    expect(mocks.acceptDraft).toHaveBeenCalledExactlyOnceWith(sender, 'question-1')
  })
})

function laterAnswer(): { promise: Promise<boolean>; resolve: (allowed: boolean) => void } {
  let resolve: (allowed: boolean) => void = () => {}
  const promise = new Promise<boolean>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('a Cloud account change', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.currentDrafts.mockReset().mockReturnValue([])
    mocks.draftsStillAllowed.mockReset().mockResolvedValue(true)
    mocks.handlers.clear()
    cloudAuthEvents.removeAllListeners()
    registerAppsHandlers()
  })

  it('closes every draft app once they are no longer allowed, so the next account is asked again', async () => {
    const drafts = [{ id: 'draft-a' }, { id: 'draft-b' }]
    mocks.currentDrafts.mockReturnValueOnce(drafts)
    mocks.draftsStillAllowed.mockResolvedValueOnce(false)

    cloudAuthEvents.emit('changed')
    await vi.waitFor(() => expect(mocks.closeDraftPages).toHaveBeenCalledTimes(1))

    expect(mocks.draftsStillAllowed).toHaveBeenCalledOnce()
    expect(mocks.closeDraftPages).toHaveBeenCalledWith(drafts)
  })

  it('closes only the drafts it checked, not one opened while it was checking', async () => {
    const checked = { id: 'draft-old-account' }
    const opened = { id: 'draft-new-account' }
    const answer = laterAnswer()
    mocks.currentDrafts.mockReturnValueOnce([checked]).mockReturnValueOnce([checked, opened])
    mocks.draftsStillAllowed.mockReturnValueOnce(answer.promise)

    cloudAuthEvents.emit('changed')
    answer.resolve(false)
    await vi.waitFor(() => expect(mocks.closeDraftPages).toHaveBeenCalledTimes(1))

    expect(mocks.closeDraftPages).toHaveBeenCalledWith([checked])
  })

  it('drops the answer of a check that a later account change replaced', async () => {
    const stale = laterAnswer()
    mocks.currentDrafts.mockReturnValueOnce([{ id: 'draft-old-account' }])
    mocks.currentDrafts.mockReturnValueOnce([{ id: 'draft-new-account' }])
    mocks.draftsStillAllowed.mockReturnValueOnce(stale.promise)
    mocks.draftsStillAllowed.mockResolvedValueOnce(true)

    cloudAuthEvents.emit('changed')
    cloudAuthEvents.emit('changed')
    await settle()
    stale.resolve(false)
    await settle()

    expect(mocks.draftsStillAllowed).toHaveBeenCalledTimes(2)
    expect(mocks.closeDraftPages).not.toHaveBeenCalled()
  })

  it('closes the drafts the latest account change found no longer allowed', async () => {
    const stale = laterAnswer()
    const latest = [{ id: 'draft-old-account' }, { id: 'draft-opened-before-the-change' }]
    mocks.currentDrafts.mockReturnValueOnce([{ id: 'draft-old-account' }])
    mocks.currentDrafts.mockReturnValueOnce(latest)
    mocks.draftsStillAllowed.mockReturnValueOnce(stale.promise)
    mocks.draftsStillAllowed.mockResolvedValueOnce(false)

    cloudAuthEvents.emit('changed')
    cloudAuthEvents.emit('changed')
    await vi.waitFor(() => expect(mocks.closeDraftPages).toHaveBeenCalledTimes(1))
    stale.resolve(false)
    await settle()

    expect(mocks.closeDraftPages).toHaveBeenCalledExactlyOnceWith(latest)
  })

  it('closes every draft app when Desktop cannot tell whether they are still allowed', async () => {
    mocks.draftsStillAllowed.mockRejectedValueOnce(new Error('offline'))

    cloudAuthEvents.emit('changed')

    await vi.waitFor(() => expect(mocks.closeDraftPages).toHaveBeenCalledTimes(1))
  })

  it('keeps an open draft while it is still allowed, as after a failed workspace switch', async () => {
    mocks.draftsStillAllowed.mockResolvedValueOnce(true)

    cloudAuthEvents.emit('changed')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mocks.draftsStillAllowed).toHaveBeenCalledOnce()

    expect(mocks.closeDraftPages).not.toHaveBeenCalled()
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
    cloudAuthEvents.removeAllListeners()
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

  it('closes an app page when the panel says go back to all apps, for the panel only', () => {
    const sender = {}

    listener('apps:close-page')({ sender }, 'depth-swap')
    expect(mocks.closeAppPage).toHaveBeenCalledWith(sender, 'depth-swap')

    mocks.isPanel = false
    listener('apps:close-page')({ sender }, 'depth-swap')
    expect(mocks.closeAppPage).toHaveBeenCalledTimes(1)
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
    expect(mocks.openRunningAppsMenu).not.toHaveBeenCalled()
  })

  it('lists two or more running apps with their pictures in the title bar menu', () => {
    mocks.running = [REMOVE_BACKGROUND, HDR]

    clickRunningApps()

    expect(mocks.openRunningAppsMenu).toHaveBeenCalledExactlyOnceWith(
      7,
      [
        { ...REMOVE_BACKGROUND, picture: 'https://comfy.org/rb.webp', state: 'running' },
        { ...HDR, picture: null, state: 'running' }
      ],
      { x: 812, y: 36 }
    )
    expect(panelSend).not.toHaveBeenCalled()
  })

  it('opens the one app whose run ended, and lists ready apps after running ones', () => {
    mocks.ready = [HDR]
    clickRunningApps()
    expect(panelSend).toHaveBeenCalledExactlyOnceWith(OPEN_RUNNING_APP_CHANNEL, HDR.id)

    mocks.running = [REMOVE_BACKGROUND]
    clickRunningApps()
    expect(mocks.openRunningAppsMenu.mock.lastCall?.[1]).toEqual([
      { ...REMOVE_BACKGROUND, picture: 'https://comfy.org/rb.webp', state: 'running' },
      { ...HDR, picture: null, state: 'ready' }
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
