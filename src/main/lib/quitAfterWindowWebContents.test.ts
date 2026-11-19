import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as QuitGate from './quitAfterWindowWebContents'

const quit = vi.fn()

vi.mock('electron', () => ({ app: { quit } }))

class FakeWebContents extends EventEmitter {
  private destroyed = false

  isDestroyed(): boolean {
    return this.destroyed
  }

  destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

class FakeWindow {
  readonly webContents = new FakeWebContents()
  private destroyed = false

  isDestroyed(): boolean {
    return this.destroyed
  }

  destroyLeavingWebContentsAlive(): void {
    this.destroyed = true
  }
}

function quitEvent(): { preventDefault: ReturnType<typeof vi.fn<() => void>> } {
  return { preventDefault: vi.fn<() => void>() }
}

describe('postponeQuitWhileDestroyedWindowsHaveLiveWebContents', () => {
  let gate: typeof QuitGate

  function openWindow(): FakeWindow {
    const window = new FakeWindow()
    gate.trackWindowWebContents(window as unknown as Electron.BrowserWindow)
    return window
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    quit.mockReset()
    gate = await import('./quitAfterWindowWebContents')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lets the quit go ahead while every window is still open', () => {
    openWindow()
    const event = quitEvent()

    expect(gate.postponeQuitWhileDestroyedWindowsHaveLiveWebContents(event)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('holds the quit while a destroyed window still has its webContents', () => {
    const window = openWindow()
    window.destroyLeavingWebContentsAlive()
    const event = quitEvent()

    expect(gate.postponeQuitWhileDestroyedWindowsHaveLiveWebContents(event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(quit).not.toHaveBeenCalled()
  })

  it('quits once the webContents of every destroyed window is gone', () => {
    const first = openWindow()
    const second = openWindow()
    first.destroyLeavingWebContentsAlive()
    second.destroyLeavingWebContentsAlive()
    gate.postponeQuitWhileDestroyedWindowsHaveLiveWebContents(quitEvent())

    first.webContents.destroy()
    vi.runAllTicks()
    vi.advanceTimersByTime(0)
    expect(quit).not.toHaveBeenCalled()

    second.webContents.destroy()
    vi.advanceTimersByTime(0)
    expect(quit).toHaveBeenCalledOnce()
  })

  it('does not quit in the same turn the last webContents reports destroyed', () => {
    const window = openWindow()
    window.destroyLeavingWebContentsAlive()
    gate.postponeQuitWhileDestroyedWindowsHaveLiveWebContents(quitEvent())

    window.webContents.destroy()

    expect(quit).not.toHaveBeenCalled()
  })

  it('lets the resumed quit go ahead', () => {
    const window = openWindow()
    window.destroyLeavingWebContentsAlive()
    gate.postponeQuitWhileDestroyedWindowsHaveLiveWebContents(quitEvent())
    window.webContents.destroy()
    vi.advanceTimersByTime(0)
    const resumed = quitEvent()

    expect(gate.postponeQuitWhileDestroyedWindowsHaveLiveWebContents(resumed)).toBe(false)
    expect(resumed.preventDefault).not.toHaveBeenCalled()
  })

  it('quits once when the quit is requested again while it is held', () => {
    const window = openWindow()
    window.destroyLeavingWebContentsAlive()
    gate.postponeQuitWhileDestroyedWindowsHaveLiveWebContents(quitEvent())
    gate.postponeQuitWhileDestroyedWindowsHaveLiveWebContents(quitEvent())

    window.webContents.destroy()
    vi.advanceTimersByTime(gate.GIVE_UP_WAITING_FOR_WEB_CONTENTS_MS)

    expect(quit).toHaveBeenCalledOnce()
  })

  it('does not quit when webContents are destroyed and nobody asked to quit', () => {
    const window = openWindow()
    window.destroyLeavingWebContentsAlive()

    window.webContents.destroy()
    vi.advanceTimersByTime(gate.GIVE_UP_WAITING_FOR_WEB_CONTENTS_MS)

    expect(quit).not.toHaveBeenCalled()
  })

  it('stops waiting and quits when a webContents is never destroyed', () => {
    const window = openWindow()
    window.destroyLeavingWebContentsAlive()
    gate.postponeQuitWhileDestroyedWindowsHaveLiveWebContents(quitEvent())

    vi.advanceTimersByTime(gate.GIVE_UP_WAITING_FOR_WEB_CONTENTS_MS)

    expect(quit).toHaveBeenCalledOnce()
    const afterGivingUp = quitEvent()
    expect(gate.postponeQuitWhileDestroyedWindowsHaveLiveWebContents(afterGivingUp)).toBe(false)
    expect(afterGivingUp.preventDefault).not.toHaveBeenCalled()
  })
})
