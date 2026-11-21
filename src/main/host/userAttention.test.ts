import { describe, expect, it, vi, type Mock } from 'vitest'

import { createUserAttention, type AttentionDock, type AttentionWindow } from './userAttention'

function fakeWindow(focused = false): AttentionWindow & {
  focus(): void
  flashFrame: Mock<(flag: boolean) => void>
} {
  const focusListeners = new Set<() => void>()
  let isFocused = focused
  return {
    isFocused: () => isFocused,
    isDestroyed: () => false,
    flashFrame: vi.fn<(flag: boolean) => void>(),
    on: (_event: 'focus', listener: () => void) => {
      focusListeners.add(listener)
    },
    removeListener: (_event: 'focus', listener: () => void) => {
      focusListeners.delete(listener)
    },
    focus() {
      isFocused = true
      for (const listener of [...focusListeners]) listener()
    }
  }
}

function fakeDock(): AttentionDock & {
  bounce: Mock<(type: 'informational') => number>
  cancelBounce: Mock<(id: number) => void>
} {
  return {
    bounce: vi.fn<(type: 'informational') => number>(() => 7),
    cancelBounce: vi.fn<(id: number) => void>()
  }
}

describe('asking for the user when the agent waits on them', () => {
  it('flashes the taskbar once on Windows and Linux when the window is not focused', () => {
    const window = fakeWindow()
    const attention = createUserAttention(window, { platform: 'win32' })

    attention.setNeeded(true)
    attention.setNeeded(true)

    expect(window.flashFrame.mock.calls).toEqual([[true]])
  })

  it('bounces the dock on macOS instead of flashing the frame', () => {
    const window = fakeWindow()
    const dock = fakeDock()
    const attention = createUserAttention(window, { platform: 'darwin', dock })

    attention.setNeeded(true)

    expect(dock.bounce).toHaveBeenCalledExactlyOnceWith('informational')
    expect(window.flashFrame).not.toHaveBeenCalled()
  })

  it('does nothing when the window is already focused', () => {
    const window = fakeWindow(true)
    const dock = fakeDock()

    createUserAttention(window, { platform: 'linux' }).setNeeded(true)
    createUserAttention(window, { platform: 'darwin', dock }).setNeeded(true)

    expect(window.flashFrame).not.toHaveBeenCalled()
    expect(dock.bounce).not.toHaveBeenCalled()
  })

  it('stops flashing when the user focuses the window', () => {
    const window = fakeWindow()
    createUserAttention(window, { platform: 'win32' }).setNeeded(true)

    window.focus()

    expect(window.flashFrame.mock.calls).toEqual([[true], [false]])
  })

  it('cancels the dock bounce when the user focuses the window', () => {
    const window = fakeWindow()
    const dock = fakeDock()
    createUserAttention(window, { platform: 'darwin', dock }).setNeeded(true)

    window.focus()

    expect(dock.cancelBounce).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('stops flashing when nothing is pending any more', () => {
    const window = fakeWindow()
    const attention = createUserAttention(window, { platform: 'win32' })

    attention.setNeeded(true)
    attention.setNeeded(false)

    expect(window.flashFrame.mock.calls).toEqual([[true], [false]])
  })

  it('does not flash again while the same wait is still pending after a focus', () => {
    const window = fakeWindow()
    const attention = createUserAttention(window, { platform: 'win32' })

    attention.setNeeded(true)
    window.focus()
    attention.setNeeded(true)

    expect(window.flashFrame.mock.calls).toEqual([[true], [false]])
  })

  it('flashes again for the next wait', () => {
    const window = fakeWindow()
    const attention = createUserAttention(window, { platform: 'win32' })

    attention.setNeeded(true)
    attention.setNeeded(false)
    attention.setNeeded(true)

    expect(window.flashFrame.mock.calls).toEqual([[true], [false], [true]])
  })

  it('stops flashing when the build is detached from the window', () => {
    const window = fakeWindow()
    const attention = createUserAttention(window, { platform: 'win32' })

    attention.setNeeded(true)
    attention.dispose()
    window.focus()

    expect(window.flashFrame.mock.calls).toEqual([[true], [false]])
  })

  it('leaves a destroyed window alone', () => {
    const window = { ...fakeWindow(), isDestroyed: () => true }
    const attention = createUserAttention(window, { platform: 'win32' })

    attention.setNeeded(true)
    attention.dispose()

    expect(window.flashFrame).not.toHaveBeenCalled()
  })
})
