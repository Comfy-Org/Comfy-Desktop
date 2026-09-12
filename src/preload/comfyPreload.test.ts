import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ComfyDesktop2BridgeImplementation,
  ComfyDownloadProgress,
  ComfyTemplateInputAssetDownload,
  TerminalRestore
} from '../types/comfyDesktopBridge'

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

type HostedFrontendBridge = Omit<ComfyDesktop2BridgeImplementation, 'Terminal'> & {
  Terminal: ComfyDesktop2BridgeImplementation['Terminal'] & {
    restore: () => Promise<TerminalRestore>
  }
}

function hostedBridge(): HostedFrontendBridge {
  return mocks.exposeInMainWorld.mock.calls[0]![1] as HostedFrontendBridge
}

function downloadProgressHandler(): (event: unknown, progress: ComfyDownloadProgress) => void {
  const call = mocks.on.mock.calls.find(([channel]) => channel === 'desktop2-download-progress')
  expect(call).toBeDefined()
  return call![1] as (event: unknown, progress: ComfyDownloadProgress) => void
}

const sampleUrl = 'https://example.com/sample.png'

function downloadSnapshot(
  downloadId: string,
  status: ComfyDownloadProgress['status'] = 'pending',
  progress = 0
): ComfyTemplateInputAssetDownload {
  return { downloadId, filename: 'sample.png', progress, status }
}

function downloadProgress(
  id: string,
  status: ComfyDownloadProgress['status'] = 'pending',
  progress = 0,
  error?: string
): ComfyDownloadProgress {
  return {
    id,
    url: sampleUrl,
    filename: 'sample.png',
    progress,
    status,
    ...(error === undefined ? {} : { error })
  }
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
      downloadProgressHandler()({}, downloadProgress('download-1'))
      return {
        status: 'accepted',
        download: downloadSnapshot('download-1')
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
      ...downloadSnapshot('download-1'),
      templateInputs: [{ templateId: 'template-a', assetId: 'asset-a' }]
    })
    unsubscribe()
  })

  it('replays terminal progress that races ahead of the invoke response', async () => {
    const bridge = hostedBridge()
    const callback = vi.fn()
    const unsubscribe = bridge.onTemplateInputDownloadProgress(callback)
    mocks.invoke.mockImplementationOnce(async () => {
      downloadProgressHandler()({}, downloadProgress('download-1', 'completed', 1))
      return {
        status: 'accepted',
        download: downloadSnapshot('download-1')
      }
    })

    await bridge.downloadTemplateInputAsset('template-a', 'asset-a')

    expect(callback).toHaveBeenCalledExactlyOnceWith({
      ...downloadSnapshot('download-1', 'completed', 1),
      templateInputs: [{ templateId: 'template-a', assetId: 'asset-a' }]
    })
    const callsAfterCompletion = callback.mock.calls.length
    downloadProgressHandler()({}, downloadProgress('download-1', 'downloading', 0.5))
    expect(callback).toHaveBeenCalledTimes(callsAfterCompletion)
    unsubscribe()
  })

  it('keeps every template consumer on a shared download through completion, then cleans it up', async () => {
    const bridge = hostedBridge()
    const callback = vi.fn()
    const unsubscribe = bridge.onTemplateInputDownloadProgress(callback)
    mocks.invoke
      .mockResolvedValueOnce({
        status: 'accepted',
        download: downloadSnapshot('shared-download')
      })
      .mockResolvedValueOnce({
        status: 'joined',
        download: downloadSnapshot('shared-download', 'downloading', 0.4)
      })

    await bridge.downloadTemplateInputAsset('template-a', 'asset-a')
    await bridge.downloadTemplateInputAsset('template-b', 'asset-b')

    expect(callback).toHaveBeenLastCalledWith({
      ...downloadSnapshot('shared-download', 'downloading', 0.4),
      templateInputs: [
        { templateId: 'template-a', assetId: 'asset-a' },
        { templateId: 'template-b', assetId: 'asset-b' }
      ]
    })

    const progress = downloadProgressHandler()
    progress({}, downloadProgress('shared-download', 'completed', 1))
    expect(callback).toHaveBeenLastCalledWith({
      ...downloadSnapshot('shared-download', 'completed', 1),
      templateInputs: [
        { templateId: 'template-a', assetId: 'asset-a' },
        { templateId: 'template-b', assetId: 'asset-b' }
      ]
    })
    const callsAfterCompletion = callback.mock.calls.length
    progress({}, downloadProgress('shared-download', 'downloading', 0.5))
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
        download: downloadSnapshot('failed-download', 'downloading', 0.6)
      })
      .mockResolvedValueOnce({
        status: 'accepted',
        download: downloadSnapshot('retry-download')
      })

    await bridge.downloadTemplateInputAsset('template-a', 'asset-a')
    const progress = downloadProgressHandler()
    progress({}, downloadProgress('failed-download', 'error', 0.6, 'network error'))
    await bridge.downloadTemplateInputAsset('template-a', 'asset-a')
    const callsAfterRetry = callback.mock.calls.length
    progress({}, downloadProgress('failed-download', 'completed', 1))
    expect(callback).toHaveBeenCalledTimes(callsAfterRetry)

    progress({}, downloadProgress('retry-download', 'downloading', 0.25))
    expect(callback).toHaveBeenLastCalledWith({
      ...downloadSnapshot('retry-download', 'downloading', 0.25),
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
          ...downloadSnapshot('active-download', 'downloading', 0.2)
        }
      }
    ])

    await expect(bridge.getTemplateInputAssets('template-a')).resolves.toHaveLength(1)
    expect(mocks.invoke).toHaveBeenCalledWith('desktop2-get-template-input-assets', {
      templateId: 'template-a'
    })

    downloadProgressHandler()({}, downloadProgress('active-download', 'downloading', 0.5))
    expect(callback).toHaveBeenLastCalledWith({
      ...downloadSnapshot('active-download', 'downloading', 0.5),
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
