import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { restoreParentWindow } from './restoreParentWindow'

function fakeWindow(overrides: { isDestroyed?: boolean; isMinimized?: boolean } = {}) {
  return {
    isDestroyed: vi.fn(() => overrides.isDestroyed ?? false),
    isMinimized: vi.fn(() => overrides.isMinimized ?? false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn()
  }
}

describe('restoreParentWindow', () => {
  it('restores, shows and focuses a minimized window', () => {
    const win = fakeWindow({ isMinimized: true })

    restoreParentWindow(win as unknown as BrowserWindow)

    expect(win.restore).toHaveBeenCalledTimes(1)
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)
  })

  it('skips restore for a window that is not minimized', () => {
    const win = fakeWindow()

    restoreParentWindow(win as unknown as BrowserWindow)

    expect(win.restore).not.toHaveBeenCalled()
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for a destroyed window', () => {
    const win = fakeWindow({ isDestroyed: true })

    restoreParentWindow(win as unknown as BrowserWindow)

    expect(win.restore).not.toHaveBeenCalled()
    expect(win.show).not.toHaveBeenCalled()
    expect(win.focus).not.toHaveBeenCalled()
  })

  it('is a no-op without a window', () => {
    expect(() => restoreParentWindow(undefined)).not.toThrow()
  })
})
