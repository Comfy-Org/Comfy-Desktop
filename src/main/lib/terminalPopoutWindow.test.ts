import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const webContents = {
    once: vi.fn(),
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
    webContents,
    window
  }
})

vi.mock('electron', () => ({ BrowserWindow: mocks.BrowserWindow }))
vi.mock('../installations', () => ({ get: mocks.getInstallation }))

import { closeAllTerminalPopouts, openTerminalPopout } from './terminalPopoutWindow'

describe('terminalPopoutWindow', () => {
  beforeEach(() => {
    closeAllTerminalPopouts()
    vi.clearAllMocks()
    mocks.window.isDestroyed.mockReturnValue(false)
  })

  it('keeps installation names out of the privileged renderer HTML', async () => {
    const name = '</title><script>window.__comfyDesktopTerminal.write("whoami")</script>'
    mocks.getInstallation.mockResolvedValue({ name })

    await openTerminalPopout('install-a')

    const url = mocks.window.loadURL.mock.calls[0]?.[0]
    if (!url) throw new Error('Expected terminal popout URL')
    const html = decodeURIComponent(url.slice(url.indexOf(',') + 1))
    expect(html).toContain('<title>Comfy Terminal</title>')
    expect(html).not.toContain(name)
    expect(mocks.BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        })
      })
    )
  })
})
