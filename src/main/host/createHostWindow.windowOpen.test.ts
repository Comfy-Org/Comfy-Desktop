import { beforeEach, describe, expect, it, vi } from 'vitest'

type WindowOpenHandler = (details: { url: string }) => {
  action: 'allow' | 'deny'
  overrideBrowserWindowOptions?: Electron.BrowserWindowConstructorOptions
}
type Listener = (...args: unknown[]) => void

const { openExternal, downloadURL, capture, captured } = vi.hoisted(() => ({
  openExternal: vi.fn(() => Promise.resolve()),
  downloadURL: vi.fn(),
  capture: vi.fn(),
  captured: {
    handler: null as WindowOpenHandler | null,
    listeners: new Map<string, Listener>(),
    sessionListeners: new Map<string, Listener>()
  }
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en'
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: { openExternal },
  WebContentsView: class {
    webContents = {
      session: {
        downloadURL,
        on: (event: string, listener: Listener) => {
          captured.sessionListeners.set(event, listener)
        },
        off: (event: string) => {
          captured.sessionListeners.delete(event)
        }
      },
      on: (event: string, listener: Listener) => {
        captured.listeners.set(event, listener)
      },
      setWindowOpenHandler: (handler: WindowOpenHandler) => {
        captured.handler = handler
      }
    }
    setBackgroundColor = vi.fn()
  },
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

vi.mock('../lib/contextMenu', () => ({ attachContextMenu: vi.fn() }))
vi.mock('../lib/firebaseAuthIdentity', () => ({ trackFirebaseAuthReporter: vi.fn() }))
vi.mock('../lib/telemetry', () => ({ capture }))
vi.mock('../lib/comfyDownloadManager', () => ({
  attachSessionDownloadHandler: vi.fn(),
  detachWindowDownloads: vi.fn(),
  getDownloadsTrayState: vi.fn()
}))

import type { BrowserWindow } from 'electron'
import { buildComfyView } from './createHostWindow'

function openHandler(): WindowOpenHandler {
  buildComfyView({} as BrowserWindow, {}, 1)
  if (!captured.handler) throw new Error('setWindowOpenHandler was not called')
  return captured.handler
}

/** Fake child BrowserWindow that records its own webContents listeners. */
function makeChild() {
  const listeners = new Map<string, Listener>()
  const onceListeners = new Map<string, Listener>()
  const webContents = {
    on: vi.fn((event: string, listener: Listener) => listeners.set(event, listener)),
    once: vi.fn((event: string, listener: Listener) => onceListeners.set(event, listener)),
    off: vi.fn((event: string) => listeners.delete(event))
  }
  const windowOnce = new Map<string, Listener[]>()
  return {
    window: {
      setIcon: vi.fn(),
      show: vi.fn(),
      removeMenu: vi.fn(),
      close: vi.fn(),
      isDestroyed: () => false,
      once: vi.fn((event: string, listener: Listener) =>
        windowOnce.set(event, [...(windowOnce.get(event) ?? []), listener])
      ),
      webContents
    },
    listeners,
    onceListeners,
    fireClosed: () => windowOnce.get('closed')?.forEach((listener) => listener())
  }
}

/** Reserve a blank tab, create its child, then have the page navigate it to `url`. */
function reserveAndNavigate(url: string) {
  openHandler()({ url: 'about:blank' })
  const child = makeChild()
  captured.listeners.get('did-create-window')?.(child.window)
  const event = { preventDefault: vi.fn() }
  child.listeners.get('will-navigate')?.(event, url)
  return { child, event }
}

describe('comfyView window-open handler', () => {
  beforeEach(() => {
    vi.useRealTimers()
    captured.handler = null
    captured.listeners.clear()
    captured.sessionListeners.clear()
    openExternal.mockClear()
    downloadURL.mockClear()
    capture.mockClear()
  })

  // Issue #1729: the frontend reserves a blank tab (`window.open('', '_blank')`)
  // and navigates it to the billing portal afterwards. Denying the reservation
  // made window.open return null (reported as a blocked pop-up) and handed
  // `about:blank` to the OS shell.
  it('allows the about:blank tab reservation as a hidden, preload-free child window', () => {
    const result = openHandler()({ url: 'about:blank' })

    // Hidden: "Manage billing" awaits the portal URL before navigating, and an
    // empty window must not sit on screen meanwhile.
    expect(result).toEqual({
      action: 'allow',
      overrideBrowserWindowOptions: { show: false, webPreferences: { preload: undefined } }
    })
  })

  it('never hands about:blank to the OS shell', () => {
    openHandler()({ url: 'about:blank' })

    expect(openExternal).not.toHaveBeenCalled()
  })

  it('still sends other unrecognised URLs to the system browser', () => {
    const result = openHandler()({ url: 'https://example.com/docs' })

    expect(result).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('does not treat about:blank look-alikes as the reservation', () => {
    const result = openHandler()({ url: 'about:blank#https://evil.example.com' })

    expect(result).toEqual({ action: 'deny' })
  })

  describe('reserved tab navigation', () => {
    it('hands the billing portal to the system browser and closes the blank child', () => {
      const { child, event } = reserveAndNavigate('https://billing.stripe.com/p/session/test')

      expect(event.preventDefault).toHaveBeenCalled()
      expect(openExternal).toHaveBeenCalledWith('https://billing.stripe.com/p/session/test')
      expect(child.window.close).toHaveBeenCalled()
      expect(child.window.show).not.toHaveBeenCalled()
    })

    it('keeps checkout in the system browser, with the checkout telemetry', () => {
      const { child, event } = reserveAndNavigate('https://checkout.comfy.org/session/abc')

      expect(event.preventDefault).toHaveBeenCalled()
      expect(openExternal).toHaveBeenCalledWith('https://checkout.comfy.org/session/abc')
      expect(capture).toHaveBeenCalledWith(
        'comfy.desktop.billing.checkout_opened',
        expect.objectContaining({ source: 'system_browser' })
      )
      expect(child.window.close).toHaveBeenCalled()
    })

    it('routes a download URL to the downloads tray', () => {
      const url = 'https://app.comfy.org/api/exports/abc/workflow.zip'
      const { child, event } = reserveAndNavigate(url)

      expect(event.preventDefault).toHaveBeenCalled()
      expect(downloadURL).toHaveBeenCalledWith(url)
      expect(openExternal).not.toHaveBeenCalled()
      expect(child.window.close).toHaveBeenCalled()
    })

    it('lets a blob: URL load in the child, showing it only once the page has loaded', () => {
      const { child, event } = reserveAndNavigate('blob:https://cloud.comfy.org/1234-abcd')

      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(openExternal).not.toHaveBeenCalled()
      expect(child.window.close).not.toHaveBeenCalled()
      // Still on about:blank at will-navigate — showing now would flash it.
      expect(child.window.show).not.toHaveBeenCalled()

      child.onceListeners.get('did-finish-load')?.()

      expect(child.window.show).toHaveBeenCalled()
    })

    it('closes the hidden child when its navigation turns into a download', () => {
      const { child } = reserveAndNavigate('blob:https://cloud.comfy.org/1234-abcd')

      captured.sessionListeners.get('will-download')?.({}, {}, child.window.webContents)

      expect(child.window.close).toHaveBeenCalled()
      expect(child.window.show).not.toHaveBeenCalled()
    })

    it('ignores downloads started by other webContents', () => {
      const { child } = reserveAndNavigate('blob:https://cloud.comfy.org/1234-abcd')

      captured.sessionListeners.get('will-download')?.({}, {}, { other: true })

      expect(child.window.close).not.toHaveBeenCalled()
    })

    it('stops watching for downloads once the child is closed', () => {
      const { child } = reserveAndNavigate('blob:https://cloud.comfy.org/1234-abcd')

      child.fireClosed()

      expect(captured.sessionListeners.has('will-download')).toBe(false)
    })

    it('closes the hidden child when its main-frame navigation fails', () => {
      const { child } = reserveAndNavigate('blob:https://cloud.comfy.org/1234-abcd')

      child.listeners.get('did-fail-load')?.({}, -2, 'FAILED', 'blob:x', true)

      expect(child.window.close).toHaveBeenCalled()
    })

    it('ignores sub-frame load failures', () => {
      const { child } = reserveAndNavigate('blob:https://cloud.comfy.org/1234-abcd')

      child.listeners.get('did-fail-load')?.({}, -2, 'FAILED', 'https://ads.example/', false)

      expect(child.window.close).not.toHaveBeenCalled()
    })

    it('stops watching for downloads once the page has loaded and is shown', () => {
      const { child } = reserveAndNavigate('blob:https://cloud.comfy.org/1234-abcd')

      child.onceListeners.get('did-finish-load')?.()

      expect(captured.sessionListeners.has('will-download')).toBe(false)
    })

    it('closes a reservation the page abandons before navigating it', () => {
      vi.useFakeTimers()
      openHandler()({ url: 'about:blank' })
      const child = makeChild()
      captured.listeners.get('did-create-window')?.(child.window)

      vi.advanceTimersByTime(60_000)

      expect(child.window.close).toHaveBeenCalled()
    })

    it('closes a hidden child whose destination never finishes loading', () => {
      vi.useFakeTimers()
      const { child } = reserveAndNavigate('blob:https://cloud.comfy.org/1234-abcd')

      vi.advanceTimersByTime(60_000)

      expect(child.window.close).toHaveBeenCalled()
      expect(child.window.show).not.toHaveBeenCalled()
    })

    it('leaves a revealed child alone after the timeout', () => {
      vi.useFakeTimers()
      const { child } = reserveAndNavigate('blob:https://cloud.comfy.org/1234-abcd')
      child.onceListeners.get('did-finish-load')?.()

      vi.advanceTimersByTime(60_000)

      expect(child.window.close).not.toHaveBeenCalled()
    })

    it('stops watching for load failures once the page has loaded and is shown', () => {
      const { child } = reserveAndNavigate('blob:https://cloud.comfy.org/1234-abcd')

      child.onceListeners.get('did-finish-load')?.()

      expect(child.listeners.has('did-fail-load')).toBe(false)
    })

    it('blocks non-web schemes without handing them to the OS', () => {
      const { child, event } = reserveAndNavigate('file:///etc/passwd')

      expect(event.preventDefault).toHaveBeenCalled()
      expect(openExternal).not.toHaveBeenCalled()
      expect(child.window.close).toHaveBeenCalled()
    })

    it('only gates the first navigation off about:blank', () => {
      const { child } = reserveAndNavigate('https://accounts.google.com/o/oauth2/auth')

      expect(child.listeners.has('will-navigate')).toBe(false)
    })

    it('does not gate children opened from allowlisted URLs', () => {
      openHandler()({ url: 'https://accounts.google.com/o/oauth2/auth' })
      const child = makeChild()
      captured.listeners.get('did-create-window')?.(child.window)

      expect(child.listeners.has('will-navigate')).toBe(false)
    })
  })
})
