import { beforeEach, describe, expect, it, vi } from 'vitest'

interface PageEvent {
  sender: object
  senderFrame: object
}
type DownloadAsset = (event: PageEvent, payload: Record<string, unknown>) => Promise<boolean>

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  fromWebContents: vi.fn(),
  getInstallation: vi.fn(),
  startAssetDownload: vi.fn(),
  getSetting: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: { handle: mocks.handle }
}))
vi.mock('../../installations', () => ({ get: mocks.getInstallation }))
vi.mock('../../settings', () => ({
  get: mocks.getSetting,
  defaults: { outputDir: '/default/output' }
}))
vi.mock('../comfyDownloadManager', () => ({ startAssetDownload: mocks.startAssetDownload }))
vi.mock('../../host/registry', () => ({
  findEntryByComfySender: () => ({ installationId: 'inst-remote', comfyUrl: INSTALL_URL }),
  findEntryByTitleBarSender: () => null,
  isPanelSender: () => false
}))
vi.mock('../../apps/appsPages', () => ({ isAppsPageSender: () => false }))
vi.mock('../embeddedSession', () => ({ isTrustedSender: () => false }))
vi.mock('../logsPopoutWindow', () => ({ findLogsPopoutInstallationIdBySender: () => null }))

import { registerAssetDownloadHandlers } from './registerAssetDownloadHandlers'

const INSTALL_URL = 'https://comfy.example.test'
const OUTPUT = { url: `${INSTALL_URL}/api/view?filename=fox.png`, filename: 'fox.png' }
const window = { id: 'window' }

function comfyViewShowing(url: string): PageEvent {
  const mainFrame = { processId: 3, routingId: 1, url }
  return { sender: { mainFrame }, senderFrame: mainFrame }
}

function downloadAsset(): DownloadAsset {
  const call = mocks.handle.mock.calls.find(([name]) => name === 'desktop2-download-asset')
  expect(call).toBeDefined()
  return call![1] as DownloadAsset
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fromWebContents.mockReturnValue(window)
  mocks.getInstallation.mockResolvedValue({ id: 'inst-remote', sourceId: 'remote' })
  mocks.getSetting.mockReturnValue('/shared/output')
  mocks.startAssetDownload.mockResolvedValue(true)
  registerAssetDownloadHandlers({ findInstallationIdForWindow: () => 'inst-remote' })
})

describe("saving an output into the install's output folder", () => {
  it("happens when the install's own page asks", async () => {
    const page = comfyViewShowing(`${INSTALL_URL}/`)

    await expect(downloadAsset()(page, OUTPUT)).resolves.toBe(true)

    expect(mocks.startAssetDownload).toHaveBeenCalledExactlyOnceWith(
      window,
      OUTPUT.url,
      OUTPUT.filename,
      '/shared/output',
      undefined,
      page.sender
    )
  })

  it.each([
    ['another site the view was sent to', 'https://elsewhere.example.test/'],
    ['a look-alike of the install', 'https://comfy.example.test.elsewhere.example.test/'],
    ['the splash shown while ComfyUI restarts', 'data:text/html,splash']
  ])('does not happen for %s', async (_what, url) => {
    expect(await downloadAsset()(comfyViewShowing(url), OUTPUT)).toBe(false)

    expect(mocks.startAssetDownload).not.toHaveBeenCalled()
    expect(mocks.getInstallation).not.toHaveBeenCalled()
  })
})
