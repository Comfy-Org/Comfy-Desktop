import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

type Listener = (...args: unknown[]) => void

const mocks = vi.hoisted(() => ({
  createBrowserWindow: vi.fn(),
  findEntryByComfySender: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor(options: unknown) {
      return mocks.createBrowserWindow(options)
    }
  }
}))

vi.mock('../host/registry', () => ({
  findEntryByComfySender: mocks.findEntryByComfySender
}))

import { isModelAccessPageUrl, openModelAccessPageWindow } from './modelAccessPage'

function createSession(id = 'comfy-session') {
  return {
    id,
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn()
  }
}

describe('isModelAccessPageUrl', () => {
  it('allows HTTPS Hugging Face pages', () => {
    expect(isModelAccessPageUrl('https://huggingface.co/black-forest-labs/FLUX.1-dev')).toBe(true)
  })

  it.each([
    'http://huggingface.co/black-forest-labs/FLUX.1-dev',
    'https://huggingface.co.evil.com/model',
    'https://huggingface.co@evil.com/model',
    'https://huggingface.co:8443/model',
    'https://huggingface.co/spaces/attacker/app',
    'https://huggingface.co/datasets/organization/repository',
    'https://huggingface.co/login/callback',
    'https://huggingface.co/settings/tokens',
    'https://huggingface.co/owner/repository/resolve/main/model.safetensors',
    'not a url'
  ])('rejects unsafe model access URL %s', (url) => {
    expect(isModelAccessPageUrl(url)).toBe(false)
  })
})

describe('openModelAccessPageWindow', () => {
  const url = 'https://huggingface.co/black-forest-labs/FLUX.1-dev'
  const parentListeners = new Map<string, Listener>()
  const accessWindowListeners = new Map<string, Listener>()
  const webContentsListeners = new Map<string, Listener>()
  let windowOpenHandler: ((details: { url: string }) => { action: string }) | undefined
  let session: ReturnType<typeof createSession>
  let parent: {
    isDestroyed: ReturnType<typeof vi.fn>
    once: ReturnType<typeof vi.fn>
    removeListener: ReturnType<typeof vi.fn>
  }
  let accessWindow: {
    webContents: {
      on: ReturnType<typeof vi.fn>
      setWindowOpenHandler: ReturnType<typeof vi.fn>
    }
    once: ReturnType<typeof vi.fn>
    loadURL: ReturnType<typeof vi.fn>
    isDestroyed: ReturnType<typeof vi.fn>
    show: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    parentListeners.clear()
    accessWindowListeners.clear()
    webContentsListeners.clear()
    windowOpenHandler = undefined
    session = createSession()

    parent = {
      isDestroyed: vi.fn(() => false),
      once: vi.fn((event: string, listener: Listener) => {
        parentListeners.set(event, listener)
      }),
      removeListener: vi.fn()
    }
    accessWindow = {
      webContents: {
        on: vi.fn((event: string, listener: Listener) => {
          webContentsListeners.set(event, listener)
        }),
        setWindowOpenHandler: vi.fn((handler: (details: { url: string }) => { action: string }) => {
          windowOpenHandler = handler
        })
      },
      once: vi.fn((event: string, listener: Listener) => {
        accessWindowListeners.set(event, listener)
      }),
      loadURL: vi.fn(() => Promise.resolve()),
      isDestroyed: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn()
    }

    mocks.findEntryByComfySender.mockReturnValue({ window: parent })
    mocks.createBrowserWindow.mockReturnValue(accessWindow)
  })

  it('opens the access page with the calling Comfy view session and safe preferences', async () => {
    await expect(
      openModelAccessPageWindow({ session } as unknown as WebContents, url)
    ).resolves.toBe(true)
    expect(mocks.createBrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        parent,
        show: false,
        webPreferences: {
          session,
          preload: undefined,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      })
    )
    expect(accessWindow.loadURL).toHaveBeenCalledWith(url)

    accessWindowListeners.get('ready-to-show')?.()
    expect(accessWindow.show).toHaveBeenCalledOnce()
  })

  it('focuses an existing access window for the same sender and repository', async () => {
    const sender = { session } as unknown as WebContents
    await openModelAccessPageWindow(sender, url)

    await expect(openModelAccessPageWindow(sender, url)).resolves.toBe(true)

    expect(mocks.createBrowserWindow).toHaveBeenCalledOnce()
    expect(accessWindow.loadURL).toHaveBeenCalledOnce()
    expect(accessWindow.focus).toHaveBeenCalledOnce()
  })

  it('does not reuse an access window from another Comfy sender session', async () => {
    await openModelAccessPageWindow({ session: createSession('a') } as unknown as WebContents, url)

    await expect(
      openModelAccessPageWindow({ session: createSession('b') } as unknown as WebContents, url)
    ).resolves.toBe(true)

    expect(mocks.createBrowserWindow).toHaveBeenCalledTimes(2)
    expect(accessWindow.focus).not.toHaveBeenCalled()
  })

  it('destroys the access window when its Comfy host closes', async () => {
    await openModelAccessPageWindow({ session } as unknown as WebContents, url)

    parentListeners.get('closed')?.()

    expect(accessWindow.destroy).toHaveBeenCalledOnce()
  })

  it('cleans up after Electron destroys the access window web contents', async () => {
    await openModelAccessPageWindow({ session } as unknown as WebContents, url)
    Object.defineProperty(accessWindow, 'webContents', {
      configurable: true,
      get: () => {
        throw new TypeError('Object has been destroyed')
      }
    })

    expect(() => accessWindowListeners.get('closed')?.()).not.toThrow()
    expect(parent.removeListener).toHaveBeenCalledWith('closed', expect.any(Function))
  })

  it('keeps the access window when the initial navigation is superseded', async () => {
    accessWindow.loadURL.mockRejectedValueOnce(new Error('ERR_ABORTED (-3)'))

    await expect(
      openModelAccessPageWindow({ session } as unknown as WebContents, url)
    ).resolves.toBe(true)

    expect(accessWindow.destroy).not.toHaveBeenCalled()
  })

  it('does not trigger browser fallback after the user closes a loading access window', async () => {
    accessWindow.loadURL.mockRejectedValueOnce(new Error('ERR_ABORTED (-3)'))
    accessWindow.isDestroyed.mockReturnValue(true)

    await expect(
      openModelAccessPageWindow({ session } as unknown as WebContents, url)
    ).resolves.toBe(true)
  })

  it('returns false and destroys the window when its initial load fails', async () => {
    accessWindow.loadURL.mockRejectedValueOnce(new Error('ERR_NAME_NOT_RESOLVED'))

    await expect(
      openModelAccessPageWindow({ session } as unknown as WebContents, url)
    ).resolves.toBe(false)

    expect(accessWindow.destroy).toHaveBeenCalledOnce()
  })

  it('allows Hugging Face navigation and blocks other origins', async () => {
    await openModelAccessPageWindow({ session } as unknown as WebContents, url)
    const externalUrl = 'https://example.com/phishing'
    const externalEvent = { preventDefault: vi.fn() }
    const spaceEvent = { preventDefault: vi.fn() }
    const settingsEvent = { preventDefault: vi.fn() }
    const logoutEvent = { preventDefault: vi.fn() }

    webContentsListeners.get('will-navigate')?.(externalEvent, externalUrl)
    webContentsListeners.get('will-navigate')?.(
      spaceEvent,
      'https://huggingface.co/spaces/attacker/app'
    )
    webContentsListeners.get('will-navigate')?.(
      settingsEvent,
      'https://huggingface.co/settings/profile'
    )
    webContentsListeners.get('will-redirect')?.(logoutEvent, 'https://huggingface.co/logout')

    expect(externalEvent.preventDefault).toHaveBeenCalledOnce()
    expect(spaceEvent.preventDefault).not.toHaveBeenCalled()
    expect(settingsEvent.preventDefault).not.toHaveBeenCalled()
    expect(logoutEvent.preventDefault).not.toHaveBeenCalled()
  })

  it('denies new Electron windows', async () => {
    await openModelAccessPageWindow({ session } as unknown as WebContents, url)

    expect(windowOpenHandler?.({ url: 'https://example.com/docs' })).toEqual({ action: 'deny' })
    expect(windowOpenHandler?.({ url: 'https://huggingface.co/login' })).toEqual({ action: 'deny' })
  })

  it('denies browser permissions only for the embedded access window', async () => {
    await openModelAccessPageWindow({ session } as unknown as WebContents, url)
    const checkPermission = session.setPermissionCheckHandler.mock.calls[0]![0] as (
      contents: unknown,
      permission: string,
      requestingOrigin: string,
      details: { embeddingOrigin: string }
    ) => boolean
    const requestPermission = session.setPermissionRequestHandler.mock.calls[0]![0] as (
      contents: unknown,
      permission: string,
      callback: (allowed: boolean) => void
    ) => void
    const accessCallback = vi.fn()
    const comfyCallback = vi.fn()
    const unknownCallback = vi.fn()

    expect(
      checkPermission(accessWindow.webContents, 'media', 'https://huggingface.co', {
        embeddingOrigin: 'https://huggingface.co'
      })
    ).toBe(false)
    expect(
      checkPermission(null, 'notifications', 'https://huggingface.co', {
        embeddingOrigin: 'https://huggingface.co'
      })
    ).toBe(false)
    expect(
      checkPermission(null, 'media', 'https://attacker.hf.space', {
        embeddingOrigin: 'https://huggingface.co'
      })
    ).toBe(false)
    expect(
      checkPermission({}, 'media', 'http://127.0.0.1:8188', {
        embeddingOrigin: 'http://127.0.0.1:8188'
      })
    ).toBe(true)
    requestPermission(accessWindow.webContents, 'media', accessCallback)
    requestPermission({}, 'media', comfyCallback)
    requestPermission(null, 'notifications', unknownCallback)

    expect(accessCallback).toHaveBeenCalledWith(false)
    expect(comfyCallback).toHaveBeenCalledWith(true)
    expect(unknownCallback).toHaveBeenCalledWith(false)
  })

  it('rejects untrusted URLs before creating a window', async () => {
    await expect(
      openModelAccessPageWindow({ session } as unknown as WebContents, 'https://example.com/model')
    ).resolves.toBe(false)
    expect(mocks.findEntryByComfySender).not.toHaveBeenCalled()
    expect(mocks.createBrowserWindow).not.toHaveBeenCalled()
  })

  it('rejects requests from an unavailable Comfy host', async () => {
    mocks.findEntryByComfySender.mockReturnValue(null)

    await expect(
      openModelAccessPageWindow({ session } as unknown as WebContents, url)
    ).resolves.toBe(false)

    expect(mocks.createBrowserWindow).not.toHaveBeenCalled()
  })

  it('rejects requests from a destroyed Comfy host', async () => {
    parent.isDestroyed.mockReturnValue(true)

    await expect(
      openModelAccessPageWindow({ session } as unknown as WebContents, url)
    ).resolves.toBe(false)

    expect(mocks.createBrowserWindow).not.toHaveBeenCalled()
  })
})
