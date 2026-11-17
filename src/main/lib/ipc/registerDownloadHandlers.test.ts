import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findEntryByComfySender: vi.fn(),
  fromWebContents: vi.fn(),
  handle: vi.fn(),
  on: vi.fn(),
  openModelAccessPageWindow: vi.fn(),
  showItemInFolder: vi.fn(),
  getDeviceId: vi.fn(),
  getIdClass: vi.fn(),
  startModelDownload: vi.fn(),
  pauseModelDownload: vi.fn(),
  resumeModelDownload: vi.fn(),
  cancelModelDownload: vi.fn(),
  panel: { id: 'panel' }
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: { handle: mocks.handle, on: mocks.on },
  shell: { showItemInFolder: mocks.showItemInFolder }
}))

vi.mock('../../host/registry', () => ({
  findEntryByComfySender: mocks.findEntryByComfySender,
  findEntryByTitleBarSender: () => null,
  isPanelSender: (sender: unknown) => sender === mocks.panel
}))

vi.mock('../../apps/appsPages', () => ({ isAppsPageSender: () => false }))
vi.mock('../embeddedSession', () => ({ isTrustedSender: () => false }))
vi.mock('../logsPopoutWindow', () => ({ findLogsPopoutInstallationIdBySender: () => null }))

vi.mock('../comfyDownloadManager', () => ({
  cancelModelDownload: mocks.cancelModelDownload,
  clearFinishedDownloads: vi.fn(),
  dismissRecentDownload: vi.fn(),
  getAllDownloads: vi.fn(),
  getDownloadThumbnail: vi.fn(),
  pauseModelDownload: mocks.pauseModelDownload,
  resumeModelDownload: mocks.resumeModelDownload,
  retryDownload: vi.fn(),
  startModelDownload: mocks.startModelDownload
}))

vi.mock('../modelAccessPage', () => ({
  openModelAccessPageWindow: mocks.openModelAccessPageWindow
}))

vi.mock('../deviceId', () => ({
  getDeviceId: mocks.getDeviceId,
  getIdClass: mocks.getIdClass
}))

import { registerDownloadHandlers } from './registerDownloadHandlers'

type PageEvent = { sender: unknown; senderFrame: unknown }
type IpcHandler = (event: PageEvent, payload?: Record<string, unknown>) => unknown

const INSTALL_URL = 'http://127.0.0.1:8188'
const MODEL = {
  url: 'https://huggingface.co/black-forest-labs/FLUX.1-dev/resolve/main/flux.safetensors',
  filename: 'flux.safetensors',
  directory: 'checkpoints'
}
const FROM_PANEL: PageEvent = { sender: mocks.panel, senderFrame: null }

function handler(channel: string): IpcHandler {
  const call = mocks.handle.mock.calls.find(([name]) => name === channel)
  expect(call).toBeDefined()
  return call![1] as IpcHandler
}

function comfyViewShowing(url: string): PageEvent {
  const mainFrame = { processId: 3, routingId: 1, url }
  return { sender: { id: 7, mainFrame }, senderFrame: mainFrame }
}

function attachInstall(): void {
  mocks.findEntryByComfySender.mockReturnValue({
    installationId: 'inst-1',
    comfyUrl: INSTALL_URL,
    sourceCategory: 'local'
  })
}

describe('registerDownloadHandlers model access bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    attachInstall()
    registerDownloadHandlers()
  })

  it('forwards the sender, URL, and handler result', async () => {
    const event = comfyViewShowing(`${INSTALL_URL}/`)
    const url = 'https://huggingface.co/black-forest-labs/FLUX.1-dev'
    mocks.openModelAccessPageWindow.mockResolvedValueOnce(true)

    await expect(handler('desktop2-open-model-access-page')(event, { url })).resolves.toBe(true)

    expect(mocks.openModelAccessPageWindow).toHaveBeenCalledWith(event.sender, url)
  })
})

describe('registerDownloadHandlers model downloads', () => {
  const window = { id: 'window' }

  beforeEach(() => {
    vi.clearAllMocks()
    attachInstall()
    mocks.fromWebContents.mockReturnValue(window)
    mocks.startModelDownload.mockResolvedValue(true)
    mocks.pauseModelDownload.mockReturnValue(true)
    mocks.resumeModelDownload.mockReturnValue(true)
    mocks.cancelModelDownload.mockReturnValue(true)
    registerDownloadHandlers()
  })

  it("start when the install's own page asks", async () => {
    const event = comfyViewShowing(`${INSTALL_URL}/`)

    await expect(handler('desktop2-download-model')(event, MODEL)).resolves.toBe(true)

    expect(mocks.startModelDownload).toHaveBeenCalledExactlyOnceWith(
      window,
      MODEL.url,
      MODEL.filename,
      MODEL.directory,
      event.sender
    )
  })

  it.each([
    ['another site the view was sent to', comfyViewShowing('https://elsewhere.example.test/')],
    ['another port on this computer', comfyViewShowing('http://127.0.0.1:9000/')],
    ['the splash shown while ComfyUI restarts', comfyViewShowing('data:text/html,splash')]
  ])('are out of reach for %s', async (_what, event) => {
    expect(await handler('desktop2-download-model')(event, MODEL)).toBe(false)
    expect(await handler('desktop2-open-model-access-page')(event, { url: MODEL.url })).toBe(false)
    expect(await handler('model-download-pause')(event, { url: MODEL.url })).toBe(false)
    expect(await handler('model-download-resume')(event, { url: MODEL.url })).toBe(false)
    expect(await handler('model-download-cancel')(event, { url: MODEL.url })).toBe(false)

    expect(mocks.startModelDownload).not.toHaveBeenCalled()
    expect(mocks.openModelAccessPageWindow).not.toHaveBeenCalled()
    expect(mocks.pauseModelDownload).not.toHaveBeenCalled()
    expect(mocks.resumeModelDownload).not.toHaveBeenCalled()
    expect(mocks.cancelModelDownload).not.toHaveBeenCalled()
  })

  it("can be paused, resumed and cancelled from the install's page and from Desktop's panel", async () => {
    const page = comfyViewShowing(`${INSTALL_URL}/`)

    expect(await handler('model-download-pause')(page, { url: MODEL.url })).toBe(true)
    expect(await handler('model-download-resume')(FROM_PANEL, { ref: 'download-1' })).toBe(true)
    expect(await handler('model-download-cancel')(FROM_PANEL, { ref: 'download-1' })).toBe(true)

    expect(mocks.pauseModelDownload).toHaveBeenCalledExactlyOnceWith(MODEL.url)
    expect(mocks.resumeModelDownload).toHaveBeenCalledExactlyOnceWith('download-1')
    expect(mocks.cancelModelDownload).toHaveBeenCalledExactlyOnceWith('download-1')
  })
})

describe('registerDownloadHandlers remote flag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerDownloadHandlers()
  })

  function askIsRemote(event: PageEvent, sourceCategory: string): unknown {
    mocks.findEntryByComfySender.mockReturnValue({
      installationId: 'inst-1',
      comfyUrl: INSTALL_URL,
      sourceCategory
    })
    const asked: SyncIpcEvent = { ...event }
    onHandler('desktop2-is-remote')(asked)
    return asked.returnValue
  }

  it.each([
    ['cloud', true],
    ['remote', true],
    ['local', false]
  ])("tells a %s install's page whether its server is elsewhere", (sourceCategory, expected) => {
    expect(askIsRemote(comfyViewShowing(`${INSTALL_URL}/`), sourceCategory)).toBe(expected)
  })

  it('answers a page from another site without saying anything about the install', () => {
    expect(askIsRemote(comfyViewShowing('https://elsewhere.example.test/'), 'cloud')).toBe(false)
  })
})

type SyncIpcEvent = { sender: unknown; senderFrame: unknown; returnValue?: unknown }

const CLOUD_URL = 'https://cloud.comfy.org/'

function onHandler(channel: string): (event: SyncIpcEvent) => void {
  const call = mocks.on.mock.calls.find(([name]) => name === channel)
  expect(call).toBeDefined()
  return call![1] as (event: SyncIpcEvent) => void
}

type FrameShape = 'main' | 'subframe' | 'missing'

function requestInstallId({ url = CLOUD_URL, frame = 'main' as FrameShape } = {}): unknown {
  const mainFrame = { processId: 3, routingId: 1, url }
  const senderFrames = {
    main: { processId: 3, routingId: 1, url },
    subframe: { processId: 3, routingId: 2, url },
    missing: null
  }
  const event: SyncIpcEvent = {
    sender: { id: 7, mainFrame },
    senderFrame: senderFrames[frame]
  }
  onHandler('desktop2-get-install-id')(event)
  return event.returnValue
}

describe('registerDownloadHandlers install id bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerDownloadHandlers()
  })

  it('answers a cloud page with the machine-derived id', () => {
    mocks.findEntryByComfySender.mockReturnValue({ sourceCategory: 'cloud' })
    mocks.getIdClass.mockReturnValue('machine_derived')
    mocks.getDeviceId.mockReturnValue('install-abc')

    expect(requestInstallId()).toBe('install-abc')
  })

  it.for(['remote', 'local', null])('withholds the id from a %s page', (sourceCategory) => {
    mocks.findEntryByComfySender.mockReturnValue({ sourceCategory })
    mocks.getIdClass.mockReturnValue('machine_derived')
    mocks.getDeviceId.mockReturnValue('install-abc')

    expect(requestInstallId()).toBeUndefined()
  })

  it('withholds the id once a cloud view has navigated off the trusted cloud origin', () => {
    mocks.findEntryByComfySender.mockReturnValue({ sourceCategory: 'cloud' })
    mocks.getIdClass.mockReturnValue('machine_derived')
    mocks.getDeviceId.mockReturnValue('install-abc')

    expect(requestInstallId({ url: 'https://example.com/' })).toBeUndefined()
  })

  it('withholds the id from a subframe of a cloud page', () => {
    mocks.findEntryByComfySender.mockReturnValue({ sourceCategory: 'cloud' })
    mocks.getIdClass.mockReturnValue('machine_derived')
    mocks.getDeviceId.mockReturnValue('install-abc')

    expect(requestInstallId({ frame: 'subframe' })).toBeUndefined()
  })

  it('withholds the id when the sending frame is gone', () => {
    mocks.findEntryByComfySender.mockReturnValue({ sourceCategory: 'cloud' })
    mocks.getIdClass.mockReturnValue('machine_derived')
    mocks.getDeviceId.mockReturnValue('install-abc')

    expect(requestInstallId({ frame: 'missing' })).toBeUndefined()
  })

  it('withholds the id from an unregistered sender', () => {
    mocks.findEntryByComfySender.mockReturnValue(null)
    mocks.getIdClass.mockReturnValue('machine_derived')

    expect(requestInstallId()).toBeUndefined()
  })

  it.for(['random_fallback', 'placeholder_fallback'])(
    'withholds a %s id rather than sending one that changes every launch',
    (idClass) => {
      mocks.findEntryByComfySender.mockReturnValue({ sourceCategory: 'cloud' })
      mocks.getIdClass.mockReturnValue(idClass)
      mocks.getDeviceId.mockReturnValue('random-per-launch')

      expect(requestInstallId()).toBeUndefined()
    }
  )
})
