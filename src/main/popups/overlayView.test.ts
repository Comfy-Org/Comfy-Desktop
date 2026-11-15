import type { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ views: [] as unknown[] }))

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  class FakeContents extends Emitter {
    readonly ipc = new Emitter()
    readonly loaded: string[] = []
    readonly setWindowOpenHandler = vi.fn()
    getURL(): string {
      return this.loaded.at(-1) ?? ''
    }
    async loadURL(url: string): Promise<void> {
      this.loaded.push(url)
    }
  }
  return {
    WebContentsView: class {
      readonly webContents = new FakeContents()
      readonly setBackgroundColor = vi.fn()
      constructor(readonly options?: unknown) {
        mocks.views.push(this)
      }
    }
  }
})

import { createOverlayView, OVERLAY_PRESSED_SCRIPT } from './overlayView'

interface FakeOverlay {
  options: { webPreferences: Record<string, unknown> }
  webContents: EventEmitter & {
    ipc: EventEmitter
    loaded: string[]
    setWindowOpenHandler: ReturnType<typeof vi.fn>
  }
}

function overlay(onPressed: () => void = () => {}): FakeOverlay {
  return createOverlayView(
    `<button onclick="${OVERLAY_PRESSED_SCRIPT}">x</button>`,
    onPressed
  ) as unknown as FakeOverlay
}

beforeEach(() => {
  mocks.views.length = 0
})

describe('a dimming overlay', () => {
  it('runs its page without Node, isolated and sandboxed, behind a small preload', () => {
    const { options } = overlay()

    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    })
    expect(String(options.webPreferences['preload'])).toMatch(/overlayPreload\.js$/)
  })

  it('shows the page it was given', () => {
    const { webContents } = overlay()

    expect(decodeURIComponent(webContents.loaded[0]!)).toBe(
      'data:text/html;charset=utf-8,<button onclick="window.comfyOverlay.pressed()">x</button>'
    )
  })

  it('tells only its own owner when it is pressed', () => {
    const firstPressed = vi.fn()
    const secondPressed = vi.fn()
    const first = overlay(firstPressed)
    overlay(secondPressed)

    first.webContents.ipc.emit('comfy-overlay:pressed', {})

    expect(firstPressed).toHaveBeenCalledTimes(1)
    expect(secondPressed).not.toHaveBeenCalled()
  })

  it('cannot be sent to another page or open a window', () => {
    const { webContents } = overlay()
    const event = { preventDefault: vi.fn() }

    webContents.emit('will-navigate', event, 'https://elsewhere.example.test/')

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(webContents.setWindowOpenHandler).toHaveBeenCalledTimes(1)
  })
})
