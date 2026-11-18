import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

vi.mock('electron', () => ({ screen: {} }))

vi.mock('fs', () => ({
  default: {
    readFileSync: () => {
      throw new Error('ENOENT')
    },
    promises: { mkdir: vi.fn(async () => {}), writeFile: vi.fn(async () => {}) }
  }
}))

vi.mock('./paths', () => ({ configDir: () => '/config' }))

import { getSavedBounds, saveWindowBounds } from './windowState'

function fakeWindow(opts: {
  maximized: boolean
  bounds: Electron.Rectangle
  normalBounds: Electron.Rectangle
}): BrowserWindow {
  return {
    isMaximized: () => opts.maximized,
    getBounds: () => opts.bounds,
    getNormalBounds: () => opts.normalBounds
  } as unknown as BrowserWindow
}

beforeEach(() => {
  vi.useFakeTimers()
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
})
