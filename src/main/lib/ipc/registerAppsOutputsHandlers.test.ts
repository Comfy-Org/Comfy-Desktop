import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, request: unknown) => Promise<boolean>
type Listener = (event: unknown, raw: unknown) => void
type FindFile = (file: unknown, bytes: Uint8Array) => Promise<string | null>
interface LoadedPage {
  appId: string
  document: number
}

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  listeners: new Map<string, Listener>(),
  findFile: vi.fn<FindFile>(async () => null),
  shownFile: null as string | null,
  sendAppOutputAction: vi.fn(),
  shownOutputFile: vi.fn((_panel: unknown, _index: number) => mocks.shownFile),
  revealOutputFile: vi.fn(async (_file: string) => true),
  isAppsPage: true,
  appsEnabled: true,
  page: { appId: 'remove-background', document: 1 } as LoadedPage | null,
  showAppOutputs: vi.fn(
    (_contents: unknown, _sentFrom: unknown, _outputs: unknown, _files: unknown) => true
  )
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
    on: (channel: string, listener: Listener) => mocks.listeners.set(channel, listener)
  }
}))
vi.mock('../../apps/appsConfig', () => ({ areAppsEnabled: async () => mocks.appsEnabled }))
vi.mock('../../apps/appsPages', () => ({ isAppsPageSender: () => mocks.isAppsPage }))
vi.mock('../../apps/appPageView', () => ({
  loadedAppPage: () => mocks.page,
  showAppOutputs: mocks.showAppOutputs,
  sendAppOutputAction: mocks.sendAppOutputAction,
  shownOutputFile: mocks.shownOutputFile
}))
vi.mock('../../apps/localComfy', () => ({ pageBuildId: () => 'apps-build' }))
vi.mock('../../installations', () => ({ get: async (id: string) => ({ id }) }))
vi.mock('../outputFolders', () => ({
  comfyOutputPath: (_build: unknown, file: unknown, bytes: Uint8Array) =>
    mocks.findFile(file, bytes),
  revealOutputFile: mocks.revealOutputFile
}))

import {
  APPS_OUTPUT_ACTION_CHANNEL,
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
  mocks.listeners.clear()
  mocks.shownFile = null
  mocks.findFile.mockResolvedValue(null)
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
      },
      [null]
    )
  })

  it('shows where Desktop found the ComfyUI file the page named, and keeps the path for Show in folder', async () => {
    mocks.findFile.mockResolvedValue('/outputs/apps/cutout_00001_.png')

    await showOutput({
      items: [
        {
          ...REQUEST.items[0],
          savedOn: 'computer',
          comfyFile: { filename: 'cutout_00001_.png', subfolder: 'apps', type: 'output' }
        }
      ],
      index: 0
    })

    expect(mocks.findFile).toHaveBeenCalledExactlyOnceWith(
      { filename: 'cutout_00001_.png', subfolder: 'apps' },
      new Uint8Array([1])
    )
    const [, , outputs, files] = mocks.showAppOutputs.mock.calls[0]!
    expect(outputs).toMatchObject({ items: [{ savedOn: 'computer', folder: '/outputs/apps' }] })
    expect(files).toEqual(['/outputs/apps/cutout_00001_.png'])
  })

  it('shows nothing from a request that a newer one replaced while Desktop looked for its files', async () => {
    let finishFirst: (file: string | null) => void = () => {}
    mocks.findFile.mockImplementationOnce(
      () => new Promise<string | null>((resolve) => (finishFirst = resolve))
    )
    const withFile = {
      items: [
        {
          ...REQUEST.items[0],
          savedOn: 'computer',
          comfyFile: { filename: 'a.png', type: 'output' }
        }
      ],
      index: 0
    }

    const first = showOutput(withFile)
    await vi.waitFor(() => expect(mocks.findFile).toHaveBeenCalledTimes(1))
    expect(await showOutput()).toBe(true)
    finishFirst('/outputs/a.png')

    expect(await first).toBe(false)
    expect(mocks.showAppOutputs).toHaveBeenCalledTimes(1)
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

describe('an output action from the panel', () => {
  const PANEL_EVENT = { sender: {} }

  function takeAction(raw: unknown): void {
    const listener = mocks.listeners.get(APPS_OUTPUT_ACTION_CHANNEL)
    if (!listener) throw new Error('No listener for output actions')
    listener(PANEL_EVENT, raw)
  }

  it('listens on the channel the panel sends on', () => {
    expect(APPS_OUTPUT_ACTION_CHANNEL).toBe('apps:output-action')
  })

  it('shows a file Desktop found in its folder itself, and does not send it to the page', () => {
    mocks.shownFile = '/outputs/apps/cutout_00001_.png'

    takeAction({ action: 'show-in-folder', index: 0 })

    expect(mocks.shownOutputFile).toHaveBeenCalledWith(PANEL_EVENT.sender, 0)
    expect(mocks.revealOutputFile).toHaveBeenCalledExactlyOnceWith(
      '/outputs/apps/cutout_00001_.png'
    )
    expect(mocks.sendAppOutputAction).not.toHaveBeenCalled()
  })

  it('sends Show in folder to the page when Desktop found no file for that output', () => {
    takeAction({ action: 'show-in-folder', index: 0 })

    expect(mocks.revealOutputFile).not.toHaveBeenCalled()
    expect(mocks.sendAppOutputAction).toHaveBeenCalledExactlyOnceWith(PANEL_EVENT.sender, {
      action: 'show-in-folder',
      index: 0
    })
  })

  it('sends Download to the page even when Desktop found the file', () => {
    mocks.shownFile = '/outputs/apps/cutout_00001_.png'

    takeAction({ action: 'download', index: 0 })

    expect(mocks.revealOutputFile).not.toHaveBeenCalled()
    expect(mocks.sendAppOutputAction).toHaveBeenCalledExactlyOnceWith(PANEL_EVENT.sender, {
      action: 'download',
      index: 0
    })
  })

  it('drops an action it cannot read', () => {
    takeAction({ action: 'delete', index: 0 })

    expect(mocks.revealOutputFile).not.toHaveBeenCalled()
    expect(mocks.sendAppOutputAction).not.toHaveBeenCalled()
  })
})
