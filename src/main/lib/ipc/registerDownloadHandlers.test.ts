import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findEntryByComfySender: vi.fn(),
  findInstallationIdByComfySender: vi.fn(),
  subscribeToInstallationModelJobs: vi.fn(),
  fromWebContents: vi.fn(),
  handle: vi.fn(),
  on: vi.fn(),
  openModelAccessPageWindow: vi.fn(),
  showItemInFolder: vi.fn(),
  getDeviceId: vi.fn(),
  getIdClass: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: { handle: mocks.handle, on: mocks.on },
  shell: { showItemInFolder: mocks.showItemInFolder }
}))

vi.mock('../../host/registry', () => ({
  findEntryByComfySender: mocks.findEntryByComfySender,
  findInstallationIdByComfySender: mocks.findInstallationIdByComfySender
}))

vi.mock('../comfyDownloadManager', () => ({
  cancelModelDownload: vi.fn(),
  clearFinishedDownloads: vi.fn(),
  dismissRecentDownload: vi.fn(),
  getAllDownloads: vi.fn(),
  getDownloadThumbnail: vi.fn(),
  pauseModelDownload: vi.fn(),
  resumeModelDownload: vi.fn(),
  retryDownload: vi.fn(),
  startModelDownload: vi.fn(),
  subscribeToInstallationModelJobs: mocks.subscribeToInstallationModelJobs
}))

vi.mock('../modelAccessPage', () => ({
  openModelAccessPageWindow: mocks.openModelAccessPageWindow
}))

vi.mock('../deviceId', () => ({
  getDeviceId: mocks.getDeviceId,
  getIdClass: mocks.getIdClass
}))

import { registerDownloadHandlers } from './registerDownloadHandlers'

type IpcHandler = (
  event: { sender: unknown },
  payload?: { url?: unknown }
) => boolean | Promise<boolean>

function handler(channel: string): IpcHandler {
  const call = mocks.handle.mock.calls.find(([name]) => name === channel)
  expect(call).toBeDefined()
  return call![1] as IpcHandler
}

describe('registerDownloadHandlers model access bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerDownloadHandlers()
  })

  it('forwards the sender, URL, and handler result', async () => {
    const sender = { id: 42 }
    const url = 'https://huggingface.co/black-forest-labs/FLUX.1-dev'
    mocks.openModelAccessPageWindow.mockResolvedValueOnce(true)

    await expect(handler('desktop2-open-model-access-page')({ sender }, { url })).resolves.toBe(
      true
    )

    expect(mocks.openModelAccessPageWindow).toHaveBeenCalledWith(sender, url)
  })
})

describe('registerDownloadHandlers model download snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerDownloadHandlers()
  })

  const COMFY_URL = 'http://127.0.0.1:8188/'

  function listModelDownloads({
    url = COMFY_URL,
    frame = 'main'
  }: { url?: string; frame?: 'main' | 'subframe' } = {}): { sender: unknown; result: unknown } {
    const mainFrame = { processId: 3, routingId: 1, url }
    const sender = { id: 9, mainFrame }
    const senderFrame = frame === 'main' ? mainFrame : { processId: 3, routingId: 2, url }
    const call = mocks.handle.mock.calls.find(([name]) => name === 'desktop2-list-model-downloads')
    expect(call).toBeDefined()
    const result = (call![1] as (event: { sender: unknown; senderFrame: unknown }) => unknown)({
      sender,
      senderFrame
    })
    return { sender, result }
  }

  it("subscribes the sender to its installation's jobs and returns their snapshot", () => {
    const snapshot = [{ id: 'job-1', url: 'https://host.example/a', status: 'paused' }]
    mocks.findEntryByComfySender.mockReturnValue({ comfyUrl: COMFY_URL })
    mocks.findInstallationIdByComfySender.mockReturnValue('install-a')
    mocks.subscribeToInstallationModelJobs.mockReturnValue(snapshot)

    const { sender, result } = listModelDownloads({ url: `${COMFY_URL}?workflow=a` })

    expect(result).toBe(snapshot)
    expect(mocks.subscribeToInstallationModelJobs).toHaveBeenCalledWith('install-a', sender)
  })

  it.for([null, ''])(
    'returns no jobs to a sender whose installation resolves to %j',
    (installationId) => {
      mocks.findEntryByComfySender.mockReturnValue({ comfyUrl: COMFY_URL })
      mocks.findInstallationIdByComfySender.mockReturnValue(installationId)

      expect(listModelDownloads().result).toEqual([])
      expect(mocks.subscribeToInstallationModelJobs).not.toHaveBeenCalled()
    }
  )

  it.for([
    {
      case: 'a page that navigated to another origin',
      url: 'https://evil.example/',
      frame: 'main'
    },
    {
      case: 'a page on another port of the same host',
      url: 'http://127.0.0.1:9999/',
      frame: 'main'
    },
    { case: 'a subframe of the installation page', url: COMFY_URL, frame: 'subframe' }
  ] as const)('returns no jobs to $case', ({ url, frame }) => {
    mocks.findEntryByComfySender.mockReturnValue({ comfyUrl: COMFY_URL })
    mocks.findInstallationIdByComfySender.mockReturnValue('install-a')
    mocks.subscribeToInstallationModelJobs.mockReturnValue([{ id: 'job-1' }])

    expect(listModelDownloads({ url, frame }).result).toEqual([])
    expect(mocks.subscribeToInstallationModelJobs).not.toHaveBeenCalled()
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
