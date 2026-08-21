import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
  sendSync: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
    send: mocks.send,
    sendSync: mocks.sendSync
  }
}))

import './comfyPreload'
import type { LegacyTerminalBridge } from './comfyPreload'
import type { ComfyDesktop2BridgeImplementation } from '../types/comfyDesktopBridge'

type TemplateInputRef = { templateId: string; assetId: string }
type TemplateInputDownload = {
  downloadId: string
  filename: string
  progress: number
  status: 'pending' | 'downloading' | 'completed' | 'error'
  error?: string
}
type TemplateInputProgress = TemplateInputDownload & {
  templateInputs: TemplateInputRef[]
}

type HostedFrontendBridge = ComfyDesktop2BridgeImplementation & {
  getTemplateInputAssets: (templateId: string) => Promise<
    | {
        assetId: string
        filename: string
        mediaType: 'image' | 'video' | 'audio'
        previewUrl: string
        availability: 'present' | 'missing' | 'unknown'
        activeDownload?: TemplateInputDownload
      }[]
    | null
  >
  downloadTemplateInputAsset: (
    templateId: string,
    assetId: string
  ) => Promise<
    | { status: 'already-present' }
    | { status: 'accepted' | 'joined'; download: TemplateInputDownload }
    | { status: 'not-started'; reason: string }
  >
  onTemplateInputDownloadProgress: (callback: (data: TemplateInputProgress) => void) => () => void
  Terminal: LegacyTerminalBridge
}

function hostedBridge(): HostedFrontendBridge {
  return mocks.exposeInMainWorld.mock.calls[0]![1] as HostedFrontendBridge
}

function downloadProgressHandler(): (event: unknown, progress: Record<string, unknown>) => void {
  const call = mocks.on.mock.calls.find(([channel]) => channel === 'desktop2-download-progress')
  expect(call).toBeDefined()
  return call![1] as (event: unknown, progress: Record<string, unknown>) => void
}

describe('comfyPreload model access bridge', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.on.mockClear()
    mocks.removeListener.mockClear()
  })

  it('forwards the repository URL through the desktop2 IPC contract', async () => {
    const bridge = hostedBridge()
    const url = 'https://huggingface.co/black-forest-labs/FLUX.1-dev'
    mocks.invoke.mockResolvedValueOnce(true)

    await expect(bridge.openModelAccessPage(url)).resolves.toBe(true)

    expect(mocks.exposeInMainWorld).toHaveBeenCalledWith('__comfyDesktop2', expect.any(Object))
    expect(mocks.invoke).toHaveBeenCalledWith('desktop2-open-model-access-page', { url })
  })

  it('exposes only a navigation request for the hosted terminal', async () => {
    const bridge = hostedBridge()
    mocks.invoke.mockResolvedValueOnce(true)

    await expect(bridge.openTerminal()).resolves.toBe(true)

    expect(mocks.invoke).toHaveBeenCalledWith('desktop2-open-terminal')
  })

  it('redirects legacy terminal calls without invoking PTY channels', async () => {
    const bridge = hostedBridge()
    mocks.invoke.mockResolvedValue(true)

    await bridge.Terminal.subscribe()
    await bridge.Terminal.write('whoami\r')
    await bridge.Terminal.resize(120, 40)
    await bridge.Terminal.restart()
    await bridge.Terminal.restore()
    await bridge.Terminal.openPopout()
    expect(bridge.Terminal.onOutput(() => {})).toEqual(expect.any(Function))
    expect(bridge.Terminal.onExited(() => {})).toEqual(expect.any(Function))

    const invokedChannels = mocks.invoke.mock.calls.map(([channel]) => channel)
    expect(invokedChannels).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^terminal-/)])
    )
    expect(mocks.invoke).toHaveBeenCalledTimes(3)
    expect(mocks.invoke).toHaveBeenCalledWith('desktop2-open-terminal')
    expect(mocks.invoke).toHaveBeenCalledWith('desktop2-open-terminal-popout')
  })
})

describe('comfyPreload template input asset bridge', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.on.mockClear()
    mocks.removeListener.mockClear()
  })

  it('uses the admission snapshot when pending progress races ahead of the invoke response', async () => {
    const bridge = hostedBridge()
    const callback = vi.fn()
    const unsubscribe = bridge.onTemplateInputDownloadProgress(callback)
    mocks.invoke.mockImplementationOnce(async () => {
      downloadProgressHandler()(
        {},
        {
          id: 'download-1',
          filename: 'sample.png',
          progress: 0,
          status: 'pending'
        }
      )
      return {
        status: 'accepted',
        download: {
          downloadId: 'download-1',
          filename: 'sample.png',
          progress: 0,
          status: 'pending'
        }
      }
    })

    await expect(bridge.downloadTemplateInputAsset('template-a', 'asset-a')).resolves.toMatchObject(
      { status: 'accepted' }
    )

    expect(mocks.invoke).toHaveBeenCalledWith('desktop2-download-template-input-asset', {
      templateId: 'template-a',
      assetId: 'asset-a'
    })
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenLastCalledWith({
      downloadId: 'download-1',
      filename: 'sample.png',
      progress: 0,
      status: 'pending',
      templateInputs: [{ templateId: 'template-a', assetId: 'asset-a' }]
    })
    unsubscribe()
  })

  it('keeps every template consumer on a shared download through completion, then cleans it up', async () => {
    const bridge = hostedBridge()
    const callback = vi.fn()
    const unsubscribe = bridge.onTemplateInputDownloadProgress(callback)
    mocks.invoke
      .mockResolvedValueOnce({
        status: 'accepted',
        download: {
          downloadId: 'shared-download',
          filename: 'sample.png',
          progress: 0,
          status: 'pending'
        }
      })
      .mockResolvedValueOnce({
        status: 'joined',
        download: {
          downloadId: 'shared-download',
          filename: 'sample.png',
          progress: 0.4,
          status: 'downloading'
        }
      })

    await bridge.downloadTemplateInputAsset('template-a', 'asset-a')
    await bridge.downloadTemplateInputAsset('template-b', 'asset-b')

    expect(callback).toHaveBeenLastCalledWith({
      downloadId: 'shared-download',
      filename: 'sample.png',
      progress: 0.4,
      status: 'downloading',
      templateInputs: [
        { templateId: 'template-a', assetId: 'asset-a' },
        { templateId: 'template-b', assetId: 'asset-b' }
      ]
    })

    const progress = downloadProgressHandler()
    progress(
      {},
      {
        id: 'shared-download',
        url: 'https://example.com/sample.png',
        filename: 'sample.png',
        progress: 1,
        status: 'completed'
      }
    )
    expect(callback).toHaveBeenLastCalledWith({
      downloadId: 'shared-download',
      filename: 'sample.png',
      progress: 1,
      status: 'completed',
      templateInputs: [
        { templateId: 'template-a', assetId: 'asset-a' },
        { templateId: 'template-b', assetId: 'asset-b' }
      ]
    })
    const callsAfterCompletion = callback.mock.calls.length
    progress(
      {},
      {
        id: 'shared-download',
        filename: 'sample.png',
        progress: 0.5,
        status: 'downloading'
      }
    )
    expect(callback).toHaveBeenCalledTimes(callsAfterCompletion)
    unsubscribe()
  })

  it('binds a domain retry to its new download id and ignores the completed attempt', async () => {
    const bridge = hostedBridge()
    const callback = vi.fn()
    const unsubscribe = bridge.onTemplateInputDownloadProgress(callback)
    mocks.invoke
      .mockResolvedValueOnce({
        status: 'accepted',
        download: {
          downloadId: 'failed-download',
          filename: 'sample.png',
          progress: 0.6,
          status: 'downloading'
        }
      })
      .mockResolvedValueOnce({
        status: 'accepted',
        download: {
          downloadId: 'retry-download',
          filename: 'sample.png',
          progress: 0,
          status: 'pending'
        }
      })

    await bridge.downloadTemplateInputAsset('template-a', 'asset-a')
    const progress = downloadProgressHandler()
    progress(
      {},
      {
        id: 'failed-download',
        filename: 'sample.png',
        progress: 0.6,
        status: 'error',
        error: 'network error'
      }
    )
    await bridge.downloadTemplateInputAsset('template-a', 'asset-a')
    const callsAfterRetry = callback.mock.calls.length
    progress(
      {},
      {
        id: 'failed-download',
        filename: 'sample.png',
        progress: 1,
        status: 'completed'
      }
    )
    expect(callback).toHaveBeenCalledTimes(callsAfterRetry)

    progress(
      {},
      {
        id: 'retry-download',
        filename: 'sample.png',
        progress: 0.25,
        status: 'downloading'
      }
    )
    expect(callback).toHaveBeenLastCalledWith({
      downloadId: 'retry-download',
      filename: 'sample.png',
      progress: 0.25,
      status: 'downloading',
      templateInputs: [{ templateId: 'template-a', assetId: 'asset-a' }]
    })
    unsubscribe()
  })

  it('reconnects progress identity from the active snapshots returned on reopen', async () => {
    const bridge = hostedBridge()
    const callback = vi.fn()
    const unsubscribe = bridge.onTemplateInputDownloadProgress(callback)
    mocks.invoke.mockResolvedValueOnce([
      {
        assetId: 'asset-a',
        filename: 'sample.png',
        mediaType: 'image',
        previewUrl: 'https://example.com/sample.png',
        availability: 'missing',
        activeDownload: {
          downloadId: 'active-download',
          filename: 'sample.png',
          progress: 0.2,
          status: 'downloading'
        }
      }
    ])

    await expect(bridge.getTemplateInputAssets('template-a')).resolves.toHaveLength(1)
    expect(mocks.invoke).toHaveBeenCalledWith('desktop2-get-template-input-assets', {
      templateId: 'template-a'
    })

    downloadProgressHandler()(
      {},
      {
        id: 'active-download',
        filename: 'sample.png',
        progress: 0.5,
        status: 'downloading'
      }
    )
    expect(callback).toHaveBeenLastCalledWith({
      downloadId: 'active-download',
      filename: 'sample.png',
      progress: 0.5,
      status: 'downloading',
      templateInputs: [{ templateId: 'template-a', assetId: 'asset-a' }]
    })
    unsubscribe()
  })

  it('shares one IPC listener and removes it when the last subscriber leaves', () => {
    const bridge = hostedBridge()
    const unsubscribeA = bridge.onTemplateInputDownloadProgress(() => {})
    const unsubscribeB = bridge.onTemplateInputDownloadProgress(() => {})
    const registration = mocks.on.mock.calls.find(
      ([channel]) => channel === 'desktop2-download-progress'
    )

    expect(registration).toBeDefined()
    expect(
      mocks.on.mock.calls.filter(([channel]) => channel === 'desktop2-download-progress')
    ).toHaveLength(1)
    unsubscribeA()
    expect(mocks.removeListener).not.toHaveBeenCalled()
    unsubscribeB()
    expect(mocks.removeListener).toHaveBeenCalledWith(
      'desktop2-download-progress',
      registration![1]
    )
  })
})
