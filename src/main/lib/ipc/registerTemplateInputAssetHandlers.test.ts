import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  getInstallation: vi.fn(),
  handle: vi.fn(),
  resolveAvailability: vi.fn(),
  resolveSnapshot: vi.fn(),
  resolveInputDir: vi.fn(),
  getActiveAssetDownload: vi.fn(),
  startManagedAssetDownload: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: { handle: mocks.handle }
}))

vi.mock('../../installations', () => ({
  get: mocks.getInstallation
}))

vi.mock('../../sources/standalone/templateInputAssets', () => ({
  resolveTemplateInputAssetAvailability: mocks.resolveAvailability,
  resolveTemplateInputAssetSnapshot: mocks.resolveSnapshot,
  resolveInputDir: mocks.resolveInputDir
}))

vi.mock('../comfyDownloadManager', () => ({
  getActiveAssetDownload: mocks.getActiveAssetDownload,
  startManagedAssetDownload: mocks.startManagedAssetDownload
}))

import { registerTemplateInputAssetHandlers } from './registerTemplateInputAssetHandlers'

type IpcHandler = (event: { sender: object }, payload: Record<string, unknown>) => Promise<unknown>

function handler(channel: string): IpcHandler {
  const call = mocks.handle.mock.calls.find(([name]) => name === channel)
  expect(call).toBeDefined()
  return call![1] as IpcHandler
}

describe('registerTemplateInputAssetHandlers', () => {
  const sender = {}
  const win = { webContents: sender }
  const installation = { id: 'install-1', sourceId: 'standalone' }
  const declaredAsset = {
    assetId: 'sample-asset',
    filename: 'sample.png',
    url: 'https://example.com/sample.png'
  }

  function getAssets(templateId = 'template-1') {
    return handler('desktop2-get-template-input-assets')({ sender }, { templateId })
  }

  function downloadAsset(assetId = declaredAsset.assetId, templateId = 'template-1') {
    return handler('desktop2-download-template-input-asset')({ sender }, { templateId, assetId })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fromWebContents.mockReturnValue(win)
    mocks.getInstallation.mockResolvedValue(installation)
    mocks.resolveInputDir.mockReturnValue('/comfy/input')
    const options = {
      findInstallationIdForWindow: () => 'install-1',
      isLocalInstallation: (candidate: { sourceId?: unknown }) =>
        candidate.sourceId === 'standalone'
    }
    registerTemplateInputAssetHandlers(options)
  })

  it('registers only template-scoped metadata and download channels', () => {
    expect(mocks.handle.mock.calls.map(([name]) => name)).toEqual([
      'desktop2-get-template-input-assets',
      'desktop2-download-template-input-asset'
    ])
  })

  it('returns template-scoped preview metadata, local availability, and active state', async () => {
    mocks.resolveSnapshot.mockResolvedValue([
      {
        assetId: 'sample.png',
        filename: 'sample.png',
        mediaType: 'image',
        previewUrl: 'https://example.com/sample.png',
        url: 'https://example.com/sample.png'
      }
    ])
    mocks.resolveAvailability.mockResolvedValue([{ filename: 'sample.png', status: 'missing' }])
    mocks.getActiveAssetDownload.mockReturnValue({
      id: 'download-1',
      url: 'https://example.com/sample.png',
      filename: 'sample.png',
      progress: 0.25,
      receivedBytes: 25,
      totalBytes: 100,
      status: 'downloading'
    })

    await expect(getAssets()).resolves.toEqual([
      {
        assetId: 'sample.png',
        filename: 'sample.png',
        mediaType: 'image',
        previewUrl: 'https://example.com/sample.png',
        availability: 'missing',
        activeDownload: {
          downloadId: 'download-1',
          filename: 'sample.png',
          progress: 0.25,
          receivedBytes: 25,
          totalBytes: 100,
          status: 'downloading'
        }
      }
    ])
    expect(mocks.resolveSnapshot).toHaveBeenCalledWith(installation, 'template-1')
    expect(mocks.resolveAvailability).toHaveBeenCalledWith(installation, ['sample.png'])
    expect(mocks.getActiveAssetDownload).toHaveBeenCalledWith(
      'https://example.com/sample.png',
      'sample.png',
      '/comfy/input'
    )
  })

  it('rejects invalid template metadata requests before resolving files', async () => {
    await expect(getAssets('../template-1')).resolves.toBeNull()
    expect(mocks.resolveSnapshot).not.toHaveBeenCalled()
  })

  it('does not claim there are no inputs when template metadata is unavailable', async () => {
    mocks.resolveSnapshot.mockResolvedValue(null)

    await expect(getAssets()).resolves.toBeNull()
    await expect(downloadAsset()).resolves.toEqual({
      status: 'not-started',
      reason: 'unavailable'
    })
    expect(mocks.resolveAvailability).not.toHaveBeenCalled()
    expect(mocks.startManagedAssetDownload).not.toHaveBeenCalled()
  })

  it('fails closed when the sender is not bound to an installation', async () => {
    mocks.fromWebContents.mockReturnValue(null)

    await expect(getAssets()).resolves.toBeNull()
    await expect(downloadAsset()).resolves.toEqual({
      status: 'not-started',
      reason: 'unavailable'
    })
  })

  it('fails closed for a remote installation even when the sender is bound', async () => {
    mocks.getInstallation.mockResolvedValue({ id: 'cloud', sourceId: 'cloud' })

    await expect(getAssets()).resolves.toBeNull()
    await expect(downloadAsset()).resolves.toEqual({
      status: 'not-started',
      reason: 'unavailable'
    })
    expect(mocks.resolveSnapshot).not.toHaveBeenCalled()
  })

  it('does not accept an asset id that the template does not declare', async () => {
    mocks.resolveSnapshot.mockResolvedValue([
      {
        assetId: 'declared-asset',
        filename: 'declared.png',
        url: 'https://example.com/declared.png'
      }
    ])

    await expect(downloadAsset('other-asset')).resolves.toEqual({
      status: 'not-started',
      reason: 'not-declared'
    })
    expect(mocks.startManagedAssetDownload).not.toHaveBeenCalled()
  })

  it('reports an exact file already present without creating a duplicate', async () => {
    mocks.resolveSnapshot.mockResolvedValue([declaredAsset])
    mocks.resolveAvailability.mockResolvedValue([{ filename: 'sample.png', status: 'present' }])

    await expect(downloadAsset()).resolves.toEqual({ status: 'already-present' })
    expect(mocks.startManagedAssetDownload).not.toHaveBeenCalled()
  })

  it('hands a missing declared asset to the exact input-dir download owner', async () => {
    mocks.resolveSnapshot.mockResolvedValue([declaredAsset])
    mocks.resolveAvailability.mockResolvedValue([{ filename: 'sample.png', status: 'missing' }])
    mocks.startManagedAssetDownload.mockResolvedValue({
      status: 'accepted',
      downloadId: 'download-1'
    })
    mocks.getActiveAssetDownload.mockReturnValue({
      id: 'download-1',
      url: 'https://example.com/sample.png',
      filename: 'sample.png',
      progress: 0,
      status: 'pending'
    })

    await expect(downloadAsset()).resolves.toEqual({
      status: 'accepted',
      download: {
        downloadId: 'download-1',
        filename: 'sample.png',
        progress: 0,
        status: 'pending'
      }
    })
    expect(mocks.startManagedAssetDownload).toHaveBeenCalledWith(
      win,
      declaredAsset.url,
      declaredAsset.filename,
      '/comfy/input',
      undefined,
      sender,
      { existingFilePolicy: 'skip' }
    )
  })

  it('does not dispatch when filesystem availability is unknown', async () => {
    mocks.resolveSnapshot.mockResolvedValue([declaredAsset])
    mocks.resolveAvailability.mockResolvedValue([{ filename: 'sample.png', status: 'unknown' }])

    await expect(downloadAsset()).resolves.toEqual({ status: 'not-started', reason: 'unavailable' })
    expect(mocks.startManagedAssetDownload).not.toHaveBeenCalled()
  })
})
