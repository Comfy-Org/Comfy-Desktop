import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  fromWebContents: vi.fn(),
  findEntryByComfySender: vi.fn(),
  getInstallation: vi.fn(),
  startAssetDownload: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: { handle: mocks.handle }
}))

vi.mock('../../host/registry', () => ({
  findEntryByComfySender: mocks.findEntryByComfySender
}))

vi.mock('../../installations', () => ({ get: mocks.getInstallation }))

vi.mock('../../settings', () => ({
  get: () => '/outputs',
  defaults: { outputDir: '/outputs' }
}))

vi.mock('../comfyDownloadManager', () => ({ startAssetDownload: mocks.startAssetDownload }))

import { assetUrlCheckFor, registerAssetDownloadHandlers } from './registerAssetDownloadHandlers'

type Handler = (event: { sender: unknown }, payload: Record<string, unknown>) => Promise<boolean>

function sender(url: string) {
  return { getURL: () => url }
}

function downloadAsset(senderUrl: string, payload: Record<string, unknown>): Promise<boolean> {
  const call = mocks.handle.mock.calls.find(([name]) => name === 'desktop2-download-asset')
  expect(call).toBeDefined()
  return (call![1] as Handler)({ sender: sender(senderUrl) }, payload)
}

const REMOTE = 'http://192.168.1.20:8188'

describe('desktop2-download-asset URL validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fromWebContents.mockReturnValue({ id: 3 })
    mocks.findEntryByComfySender.mockReturnValue({
      installationId: 'inst-1',
      comfyUrl: `${REMOTE}/`,
      sourceCategory: 'remote'
    })
    mocks.getInstallation.mockResolvedValue({ id: 'inst-1' })
    mocks.startAssetDownload.mockResolvedValue(true)
    registerAssetDownloadHandlers({ findInstallationIdForWindow: () => 'inst-1' })
  })

  it('starts a download from the attached ComfyUI server and passes the policy on', async () => {
    const url = `${REMOTE}/api/view?filename=a.png&type=output`
    await expect(
      downloadAsset(`${REMOTE}/`, { url, filename: 'a.png', authToken: 'tok' })
    ).resolves.toBe(true)
    expect(mocks.startAssetDownload).toHaveBeenCalledTimes(1)
    const [, startedUrl, filename, outputDir, authToken, , options] =
      mocks.startAssetDownload.mock.calls[0]!
    expect([startedUrl, filename, outputDir, authToken]).toEqual([url, 'a.png', '/outputs', 'tok'])
    expect(options.validateUrl(url)).toBe(true)
    expect(options.validateUrl('https://elsewhere.example/a.png')).toBe(false)
  })

  it.each([
    ['instance metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['another LAN host', 'http://192.168.1.21:8188/api/view?filename=a.png'],
    ['another port on the same host', 'http://192.168.1.20:8189/api/view?filename=a.png'],
    ['a public host', 'https://attacker.example/collect'],
    ['a loopback service', 'http://127.0.0.1:11434/api/tags'],
    ['a file URL', 'file:///etc/passwd'],
    ['embedded credentials', 'http://user:pw@192.168.1.20:8188/api/view?filename=a.png'],
    ['a host that only starts with the server host', 'http://192.168.1.20.evil.example:8188/x']
  ])('refuses %s', async (_label, url) => {
    await expect(downloadAsset(`${REMOTE}/`, { url, filename: 'a.png' })).resolves.toBe(false)
    expect(mocks.startAssetDownload).not.toHaveBeenCalled()
  })

  it.each([
    ['url', { url: 7, filename: 'a.png' }],
    ['filename', { url: `${REMOTE}/api/view?filename=a.png`, filename: ['a.png'] }],
    ['authToken', { url: `${REMOTE}/api/view?filename=a.png`, filename: 'a.png', authToken: 1 }]
  ])('refuses a non-string %s', async (_field, payload) => {
    await expect(downloadAsset(`${REMOTE}/`, payload)).resolves.toBe(false)
    expect(mocks.startAssetDownload).not.toHaveBeenCalled()
  })
})

describe('assetUrlCheckFor', () => {
  beforeEach(() => vi.clearAllMocks())

  it('allows only the sender origin when the sender is not a registered ComfyUI view', () => {
    mocks.findEntryByComfySender.mockReturnValue(undefined)
    const check = assetUrlCheckFor(sender('http://127.0.0.1:8188/') as never)
    expect(check('http://127.0.0.1:8188/api/view?filename=a.png')).toBe(true)
    expect(check('http://127.0.0.1:8189/api/view?filename=a.png')).toBe(false)
  })

  it('allows nothing from a sender with no http(s) origin', () => {
    mocks.findEntryByComfySender.mockReturnValue(undefined)
    const check = assetUrlCheckFor(sender('file:///index.html') as never)
    expect(check('file:///etc/passwd')).toBe(false)
    expect(check('http://127.0.0.1:8188/api/view')).toBe(false)
  })

  it('allows first-party cloud hosts for a cloud session', () => {
    mocks.findEntryByComfySender.mockReturnValue({
      comfyUrl: 'https://cloud.comfy.org/',
      sourceCategory: 'cloud'
    })
    const check = assetUrlCheckFor(sender('https://cloud.comfy.org/') as never)
    expect(check('https://cloud.comfy.org/api/view?filename=a.png')).toBe(true)
    expect(check('https://stagingcloud.comfy.org/api/view?filename=a.png')).toBe(true)
    expect(check('https://storage.googleapis.com/bucket/a.png')).toBe(false)
    expect(check('http://cloud.comfy.org/api/view?filename=a.png')).toBe(false)
  })

  it('does not extend the cloud allowance to remote sessions', () => {
    mocks.findEntryByComfySender.mockReturnValue({
      comfyUrl: `${REMOTE}/`,
      sourceCategory: 'remote'
    })
    const check = assetUrlCheckFor(sender(`${REMOTE}/`) as never)
    expect(check('https://cloud.comfy.org/api/view?filename=a.png')).toBe(false)
  })
})
