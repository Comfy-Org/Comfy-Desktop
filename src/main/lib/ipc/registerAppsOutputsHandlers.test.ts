import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, request: unknown) => Promise<boolean>
interface LoadedPage {
  appId: string
  document: number
}

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  isAppsPage: true,
  appsEnabled: true,
  page: { appId: 'remove-background', document: 1 } as LoadedPage | null,
  showAppOutputs: vi.fn((_contents: unknown, _sentFrom: unknown, _outputs: unknown) => true)
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler)
  }
}))
vi.mock('../../apps/appsConfig', () => ({ areAppsEnabled: async () => mocks.appsEnabled }))
vi.mock('../../apps/appsPages', () => ({ isAppsPageSender: () => mocks.isAppsPage }))
vi.mock('../../apps/appPageView', () => ({
  loadedAppPage: () => mocks.page,
  showAppOutputs: mocks.showAppOutputs
}))

import {
  APPS_OUTPUTS_SHOW_CHANNEL,
  registerAppsOutputsHandlers
} from './registerAppsOutputsHandlers'

const SENDER = {}
const EVENT = { sender: SENDER, senderFrame: {} }
const REQUEST = {
  items: [
    { name: 'cutout.png', mimeType: 'image/png', bytes: new Uint8Array([1]), workflow: true }
  ],
  index: 0
}

function showOutput(request: unknown = REQUEST): Promise<boolean> {
  const handler = mocks.handlers.get(APPS_OUTPUTS_SHOW_CHANNEL)
  if (!handler) throw new Error('No handler for showOutput')
  return handler(EVENT, request)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.isAppsPage = true
  mocks.appsEnabled = true
  mocks.page = { appId: 'remove-background', document: 1 }
  mocks.showAppOutputs.mockReturnValue(true)
  registerAppsOutputsHandlers()
})

describe('showOutput from the hosted Apps page', () => {
  it('answers on the channel the Apps preload invokes', () => {
    expect(APPS_OUTPUTS_SHOW_CHANNEL).toBe('apps-outputs:show')
  })

  it('shows the checked outputs for the app page that sent them', async () => {
    expect(await showOutput()).toBe(true)

    expect(mocks.showAppOutputs).toHaveBeenCalledExactlyOnceWith(
      SENDER,
      { appId: 'remove-background', document: 1 },
      {
        items: [
          {
            name: 'cutout.png',
            mimeType: 'image/png',
            bytes: new Uint8Array([1]),
            tags: [],
            workflow: true
          }
        ],
        index: 0
      }
    )
  })

  it('says so when Desktop does not show them', async () => {
    mocks.showAppOutputs.mockReturnValue(false)

    expect(await showOutput()).toBe(false)
  })

  it('refuses a request it cannot show', async () => {
    await expect(showOutput({ items: [], index: 0 })).rejects.toThrow(
      'Desktop cannot show these outputs.'
    )
    expect(mocks.showAppOutputs).not.toHaveBeenCalled()
  })

  it('shows nothing for a sender that is not the hosted Apps page, or while Apps is off', async () => {
    mocks.isAppsPage = false
    expect(await showOutput()).toBe(false)

    mocks.isAppsPage = true
    mocks.appsEnabled = false
    expect(await showOutput()).toBe(false)

    mocks.appsEnabled = true
    mocks.page = null
    expect(await showOutput()).toBe(false)

    expect(mocks.showAppOutputs).not.toHaveBeenCalled()
  })
})
