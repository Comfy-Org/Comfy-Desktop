import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  isPanel: true,
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
  hideAppPage: vi.fn(),
  showAppPage: vi.fn()
}))
vi.mock('../../apps/appsCatalog', () => ({ listApps: vi.fn(async () => []) }))
vi.mock('../../apps/appsConfig', () => ({ areAppsEnabled: vi.fn(async () => true) }))
vi.mock('../../host/registry', () => ({ isPanelSender: () => mocks.isPanel }))
vi.mock('../telemetry', () => ({ sendSurveyResponse: mocks.sendSurveyResponse }))

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
