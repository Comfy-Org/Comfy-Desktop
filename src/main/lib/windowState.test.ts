import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

vi.mock('electron', () => ({ screen: {} }))

const fsMocks = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn()
}))

vi.mock('fs', () => ({
  default: {
    readFileSync: () => {
      throw new Error('ENOENT')
    },
    mkdirSync: fsMocks.mkdirSync,
    writeFileSync: fsMocks.writeFileSync
  }
}))

vi.mock('./paths', () => ({ configDir: () => '/config' }))

import { flushWindowStateSync, getSavedBounds, saveWindowBounds } from './windowState'

function fakeWindow(opts: {
  maximized: boolean
  fullScreen?: boolean
  bounds: Electron.Rectangle
  normalBounds: Electron.Rectangle
}): BrowserWindow {
  return {
    isMaximized: () => opts.maximized,
    isFullScreen: () => opts.fullScreen === true,
    getBounds: () => opts.bounds,
    getNormalBounds: () => opts.normalBounds
  } as unknown as BrowserWindow
}

function writtenState(): Record<string, unknown> {
  const calls = fsMocks.writeFileSync.mock.calls
  return JSON.parse(calls[calls.length - 1]![1] as string)
}

beforeEach(() => {
  vi.useFakeTimers()
  fsMocks.mkdirSync.mockClear()
  fsMocks.writeFileSync.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('saveWindowBounds', () => {
  it('keeps the smaller size to unmaximize to when a new window opens maximized', () => {
    const laptop = fakeWindow({
      maximized: true,
      bounds: { x: 0, y: 33, width: 1512, height: 889 },
      normalBounds: { x: 114, y: 93, width: 1285, height: 756 }
    })
    saveWindowBounds('inst-new-maximized', laptop)
    expect(getSavedBounds('inst-new-maximized')).toEqual({
      x: 114,
      y: 93,
      width: 1285,
      height: 756,
      maximized: true
    })
  })

  it('saves the current size of a window that is not maximized', () => {
    const desktop = fakeWindow({
      maximized: false,
      bounds: { x: 200, y: 100, width: 1400, height: 800 },
      normalBounds: { x: 0, y: 0, width: 1024, height: 700 }
    })
    saveWindowBounds('inst-normal', desktop)
    expect(getSavedBounds('inst-normal')).toEqual({
      x: 200,
      y: 100,
      width: 1400,
      height: 800,
      maximized: false
    })
  })

  it('keeps the last windowed size while the window is in full screen', () => {
    const windowed = { x: 50, y: 60, width: 1300, height: 850 }
    saveWindowBounds(
      'inst-fullscreen',
      fakeWindow({ maximized: false, bounds: windowed, normalBounds: windowed })
    )
    const fullScreen = { x: 0, y: 0, width: 2560, height: 1440 }
    saveWindowBounds(
      'inst-fullscreen',
      fakeWindow({ maximized: false, fullScreen: true, bounds: fullScreen, normalBounds: windowed })
    )
    expect(getSavedBounds('inst-fullscreen')).toEqual({ ...windowed, maximized: false })
  })

  it('writes the file 500 ms after the last change, in one synchronous write', () => {
    const first = { x: 10, y: 20, width: 900, height: 700 }
    const second = { x: 30, y: 40, width: 1000, height: 750 }
    saveWindowBounds(
      'inst-debounce',
      fakeWindow({ maximized: false, bounds: first, normalBounds: first })
    )
    saveWindowBounds(
      'inst-debounce',
      fakeWindow({ maximized: false, bounds: second, normalBounds: second })
    )
    vi.advanceTimersByTime(499)
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(1)
    expect(writtenState()['inst-debounce']).toEqual({ ...second, maximized: false })
  })

  it('writes a change made just before quit when flushed, and nothing after', () => {
    const bounds = { x: 70, y: 80, width: 1100, height: 760 }
    saveWindowBounds('inst-quit', fakeWindow({ maximized: false, bounds, normalBounds: bounds }))
    flushWindowStateSync()
    expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(1)
    expect(writtenState()['inst-quit']).toEqual({ ...bounds, maximized: false })
    vi.advanceTimersByTime(1000)
    expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(1)
  })
})
