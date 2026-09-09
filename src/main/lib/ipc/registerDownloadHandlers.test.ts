import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findEntryByComfySender: vi.fn(),
  fromWebContents: vi.fn(),
  handle: vi.fn(),
  on: vi.fn(),
  openModelAccessPageWindow: vi.fn(),
  showItemInFolder: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: { handle: mocks.handle, on: mocks.on },
  shell: { showItemInFolder: mocks.showItemInFolder }
}))

vi.mock('../../host/registry', () => ({
  findEntryByComfySender: mocks.findEntryByComfySender
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
  startModelDownload: vi.fn()
}))

vi.mock('../modelAccessPage', () => ({
  openModelAccessPageWindow: mocks.openModelAccessPageWindow
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
