import { describe, expect, it, vi, type Mock } from 'vitest'

import {
  createUserAttention,
  type AttentionApp,
  type AttentionDock,
  type AttentionWindow
} from './userAttention'

type Listeners = Map<string, Set<() => void>>

function emit(listeners: Listeners, event: string): void {
  for (const listener of [...(listeners.get(event) ?? [])]) listener()
}

function listen(listeners: Listeners, event: string, listener: () => void): void {
  const set = listeners.get(event) ?? new Set()
  set.add(listener)
  listeners.set(event, set)
}

function fakeWindow(focused = false): AttentionWindow & {
  focus(): void
  blur(): void
  listenerCount(): number
  flashFrame: Mock<(flag: boolean) => void>
} {
  const listeners: Listeners = new Map()
  let isFocused = focused
  return {
    isFocused: () => isFocused,
    isDestroyed: () => false,
    flashFrame: vi.fn<(flag: boolean) => void>(),
    on: (event: string, listener: () => void) => listen(listeners, event, listener),
    removeListener: (event: string, listener: () => void) => listeners.get(event)?.delete(listener),
    focus() {
      isFocused = true
      emit(listeners, 'focus')
    },
    blur() {
      isFocused = false
      emit(listeners, 'blur')
    },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0)
  }
}

function fakeApp(): AttentionApp & { resignActive(): void; listenerCount(): number } {
  const listeners: Listeners = new Map()
  return {
    on: (event, listener) => listen(listeners, event, listener),
    removeListener: (event, listener) => listeners.get(event)?.delete(listener),
    resignActive: () => emit(listeners, 'did-resign-active'),
    listenerCount: () => listeners.get('did-resign-active')?.size ?? 0
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

  it('alerts once when the user leaves a window that was focused when the wait began', () => {
    const window = fakeWindow(true)
    const attention = createUserAttention(window, { platform: 'win32' })

    attention.setNeeded(true)
    expect(window.flashFrame).not.toHaveBeenCalled()

    window.blur()
    window.focus()
    window.blur()

    expect(window.flashFrame.mock.calls).toEqual([[true], [false]])
  })

  it('bounces the dock once Desktop stops being the active app when macOS refused the first bounce', () => {
    const window = fakeWindow()
    const dock = fakeDock()
    const app = fakeApp()
    dock.bounce.mockReturnValueOnce(-1)
    createUserAttention(window, { platform: 'darwin', dock, app }).setNeeded(true)

    app.resignActive()
    app.resignActive()

    expect(dock.bounce).toHaveBeenCalledTimes(2)
    expect(app.listenerCount()).toBe(0)
  })

  it('stops waiting for Desktop to deactivate when the wait ends', () => {
    const window = fakeWindow()
    const dock = fakeDock()
    const app = fakeApp()
    dock.bounce.mockReturnValueOnce(-1)
    const attention = createUserAttention(window, { platform: 'darwin', dock, app })

    attention.setNeeded(true)
    attention.setNeeded(false)
    app.resignActive()

    expect(dock.bounce).toHaveBeenCalledOnce()
    expect(dock.cancelBounce).not.toHaveBeenCalled()
    expect(app.listenerCount()).toBe(0)
  })

  it('removes every window listener when the wait ends', () => {
    const window = fakeWindow(true)
    const attention = createUserAttention(window, { platform: 'win32' })

    attention.setNeeded(true)
    window.blur()
    attention.setNeeded(false)

    expect(window.listenerCount()).toBe(0)
  })
})
