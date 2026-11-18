import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const loadHandlers: Array<() => void> = []
  const webContents = {
    once: vi.fn((_event: string, handler: () => void) => {
      loadHandlers.push(handler)
    }),
    executeJavaScript: vi.fn(async () => {})
  }
  const window = {
    webContents,
    isDestroyed: vi.fn(() => false),
    focus: vi.fn(),
    on: vi.fn(),
    loadURL: vi.fn(async (_url: string) => {}),
    setTitle: vi.fn(),
    destroy: vi.fn()
  }
  return {
    BrowserWindow: vi.fn(function () {
      return window
    }),
    getInstallation: vi.fn(),
    loadHandlers,
    window
  }
})

vi.mock('electron', () => ({ BrowserWindow: mocks.BrowserWindow }))
vi.mock('../installations', () => ({ get: mocks.getInstallation }))

import { closeAllLogsPopouts, openLogsPopout } from './logsPopoutWindow'

describe('logsPopoutWindow', () => {
  beforeEach(() => {
    closeAllLogsPopouts()
    vi.clearAllMocks()
    mocks.loadHandlers.length = 0
    mocks.window.isDestroyed.mockReturnValue(false)
  })

  it('keeps installation names out of the logs window HTML', async () => {
    const name = '</title><script>window.pwned = 1</script>'
    mocks.getInstallation.mockResolvedValue({ name })

    await openLogsPopout('install-a')

    const url = mocks.window.loadURL.mock.calls[0]?.[0]
    if (!url) throw new Error('Expected logs popout URL')
    const html = decodeURIComponent(url.slice(url.indexOf(',') + 1))
    expect(html).toContain('<title>Comfy Logs</title>')
    expect(html).not.toContain(name)
  })

  it('shows the build name in the window title once the page loads', async () => {
    mocks.getInstallation.mockResolvedValue({ name: 'My build' })

    await openLogsPopout('install-a')
    for (const handler of mocks.loadHandlers) handler()

    expect(mocks.window.setTitle).toHaveBeenCalledWith('Comfy Logs — My build')
  })
})
