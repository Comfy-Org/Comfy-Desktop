import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hideTitlePopup: vi.fn(),
  preClearedClose: new WeakSet<object>()
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en'
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  shell: {},
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))
vi.mock('../popups/titlePopup', () => ({
  hideTitlePopupForParent: (parent: unknown) => mocks.hideTitlePopup(parent)
}))
vi.mock('./detach', () => ({ preClearedClose: mocks.preClearedClose }))

import { closeBuildWindow } from './closeBuildWindow'
import {
  nextWindowKey,
  registerHostEntry,
  unregisterHostEntry,
  type ComfyWindowEntry
} from './registry'

interface FakeWindow {
  destroyed: boolean
  closed: boolean
  isDestroyed: () => boolean
  close: () => void
}

function makeWindow(opts: { destroyed?: boolean } = {}): FakeWindow {
  const win: FakeWindow = {
    destroyed: opts.destroyed ?? false,
    closed: false,
    isDestroyed: () => win.destroyed,
    close: () => {
      win.closed = true
    }
  }
  return win
}

const STOP = { skipConfirm: true, keepDesktopOpen: true }
let opened: ComfyWindowEntry[] = []

function open(win: FakeWindow, installationId: string | null) {
  const returnsToHome = vi.fn()
  const entry = {
    windowKey: nextWindowKey(),
    window: win,
    installationId,
    detachInstall: returnsToHome
  } as unknown as ComfyWindowEntry
  registerHostEntry(entry)
  opened.push(entry)
  return { win, returnsToHome }
}

function openBuildWindow(installationId: string, win = makeWindow()) {
  return open(win, installationId)
}

function openHome(win = makeWindow()): FakeWindow {
  return open(win, null).win
}

function skipsTheClosePrompt(win: FakeWindow): boolean {
  return mocks.preClearedClose.has(win)
}

beforeEach(() => {
  mocks.hideTitlePopup.mockClear()
})

afterEach(() => {
  for (const entry of opened) unregisterHostEntry(entry)
  opened = []
})

describe('closing a build window once its ComfyUI has stopped', () => {
  it('returns the only Desktop window to Home instead of closing it', () => {
    const { win, returnsToHome } = openBuildWindow('build-A')

    expect(closeBuildWindow('build-A', STOP)).toBe(true)

    expect(returnsToHome).toHaveBeenCalledTimes(1)
    expect(win.closed).toBe(false)
    expect(skipsTheClosePrompt(win)).toBe(false)
    expect(mocks.hideTitlePopup).toHaveBeenCalledExactlyOnceWith(win)
  })

  it('closes the build window without asking while Home is open in another window', () => {
    const { win, returnsToHome } = openBuildWindow('build-A')
    const home = openHome()

    expect(closeBuildWindow('build-A', STOP)).toBe(true)

    expect(win.closed).toBe(true)
    expect(skipsTheClosePrompt(win)).toBe(true)
    expect(returnsToHome).not.toHaveBeenCalled()
    expect(home.closed).toBe(false)
  })

  it('counts only windows that are still open when deciding it is the last one', () => {
    const { win, returnsToHome } = openBuildWindow('build-A')
    openHome(makeWindow({ destroyed: true }))

    expect(closeBuildWindow('build-A', STOP)).toBe(true)

    expect(returnsToHome).toHaveBeenCalledTimes(1)
    expect(win.closed).toBe(false)
  })

  it('closes the only window for a caller that does not ask to keep Desktop open', () => {
    const { win, returnsToHome } = openBuildWindow('build-A')

    expect(closeBuildWindow('build-A', { skipConfirm: true })).toBe(true)

    expect(win.closed).toBe(true)
    expect(returnsToHome).not.toHaveBeenCalled()
  })

  it('leaves the close prompt in place when the caller does not skip it', () => {
    const { win } = openBuildWindow('build-A')
    openHome()

    expect(closeBuildWindow('build-A')).toBe(true)

    expect(win.closed).toBe(true)
    expect(skipsTheClosePrompt(win)).toBe(false)
  })

  it('reports that a build with no window had nothing to close', () => {
    const home = openHome()

    expect(closeBuildWindow('build-A', STOP)).toBe(false)

    expect(home.closed).toBe(false)
  })

  it('reports nothing to close for a build whose window is already gone', () => {
    const { returnsToHome } = openBuildWindow('build-A', makeWindow({ destroyed: true }))

    expect(closeBuildWindow('build-A', STOP)).toBe(false)

    expect(returnsToHome).not.toHaveBeenCalled()
  })
})
