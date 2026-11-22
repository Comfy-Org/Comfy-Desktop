import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  isPanel: true,
  isGlobalSettings: true,
  canPasteDrafts: vi.fn(async () => true),
  closeDraftPages: vi.fn(),
  acceptDraft: vi.fn(async (_sender: unknown, _token: unknown) => null),
  draftsStillAllowed: vi.fn(async () => true),
  openPastedDraft: vi.fn(async (_address: unknown) => ({ kind: 'asked' })),
  sendSurveyResponse: vi.fn(
    async (_surveyId: string, _questionId: string, _response: string) => true
  )
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
    on: vi.fn()
  }
}))
vi.mock('../../apps/appPageView', () => ({
  captureAppPage: vi.fn(),
  closeDraftPages: mocks.closeDraftPages,
  hideAppPage: vi.fn(),
  showAppPage: vi.fn()
}))
vi.mock('../../apps/appsCatalog', () => ({ listApps: vi.fn(async () => []) }))
vi.mock('../../apps/appsConfig', () => ({ areAppsEnabled: vi.fn(async () => true) }))
vi.mock('../../host/registry', () => ({ isPanelSender: () => mocks.isPanel }))
vi.mock('../../popups/titlePopup', () => ({
  isGlobalSettingsSender: () => mocks.isGlobalSettings
}))
vi.mock('../../apps/draftApps', () => ({ draftCards: () => [] }))
vi.mock('../../apps/draftLinks', () => ({
  acceptDraft: mocks.acceptDraft,
  canPasteDrafts: mocks.canPasteDrafts,
  draftsStillAllowed: mocks.draftsStillAllowed,
  openPastedDraft: mocks.openPastedDraft
}))
vi.mock('../telemetry', () => ({ sendSurveyResponse: mocks.sendSurveyResponse }))

import { cloudAuthEvents } from '../cloudAuthEvents'
import { registerAppsHandlers } from './registerAppsHandlers'

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

describe('a Cloud account change', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    cloudAuthEvents.removeAllListeners()
    registerAppsHandlers()
  })

  it('closes every draft app once they are no longer allowed, so the next account is asked again', async () => {
    mocks.draftsStillAllowed.mockResolvedValueOnce(false)

    cloudAuthEvents.emit('changed')
    await vi.waitFor(() => expect(mocks.closeDraftPages).toHaveBeenCalledTimes(1))

    expect(mocks.draftsStillAllowed).toHaveBeenCalledOnce()
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
