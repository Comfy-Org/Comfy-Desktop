import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import { TID } from '../../../../shared/testIds'
import type { TerminalRestore } from '../../types/ipc'
import ConsoleTerminalPane from './ConsoleTerminalPane.vue'

// The PTY lives in main; this pane is a thin xterm view. We mock xterm so the
// tests assert the wiring (subscribe on mount, exit banner + restart) rather
// than terminal rendering, which needs a real canvas.

let selectionText = ''

const fakeTerminal = {
  loadAddon: vi.fn(),
  open: vi.fn(),
  onData: vi.fn(() => ({ dispose: vi.fn() })),
  attachCustomKeyEventHandler: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  reset: vi.fn(),
  dispose: vi.fn(),
  selectAll: vi.fn(),
  paste: vi.fn(),
  hasSelection: vi.fn(() => selectionText.length > 0),
  getSelection: vi.fn(() => selectionText),
  element: {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  },
  cols: 80,
  rows: 30
}

/** Pull the handler registered via `attachCustomKeyEventHandler`. */
function keyHandler(): (e: Partial<KeyboardEvent>) => boolean {
  const call = fakeTerminal.attachCustomKeyEventHandler.mock.calls[0]
  return call[0] as (e: Partial<KeyboardEvent>) => boolean
}

function keyEvent(over: Partial<KeyboardEvent>): Partial<KeyboardEvent> {
  return {
    type: 'keydown',
    key: 'a',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...over
  }
}

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function (this: unknown) {
    return fakeTerminal
  })
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function (this: unknown) {
    return { fit: vi.fn(), proposeDimensions: vi.fn() }
  })
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

const messages = {
  en: {
    console: {
      sessionEnded: 'Console session ended',
      restartSession: 'Restart console',
      shellLabel: 'Shell',
      copy: 'Copy',
      paste: 'Paste',
      selectAll: 'Select All'
    }
  }
} as const

function createTestI18n() {
  return createI18n({ legacy: false, locale: 'en', messages })
}

let exitCallbacks: Array<(data: { installationId: string }) => void> = []
let outputCallbacks: Array<
  (data: { installationId: string; data: string }) => void
> = []

function makeRestore(overrides: Partial<TerminalRestore> = {}): TerminalRestore {
  return { buffer: [], size: { cols: 80, rows: 30 }, exited: false, ...overrides }
}

function setupApi(subscribeRestore: TerminalRestore = makeRestore()): void {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    platform: 'win32',
    terminalSubscribe: vi.fn().mockResolvedValue(subscribeRestore),
    terminalUnsubscribe: vi.fn().mockResolvedValue(undefined),
    terminalWrite: vi.fn().mockResolvedValue(undefined),
    terminalResize: vi.fn().mockResolvedValue(undefined),
    terminalRestart: vi.fn().mockResolvedValue(makeRestore()),
    onTerminalOutput: vi.fn(
      (cb: (data: { installationId: string; data: string }) => void) => {
        outputCallbacks.push(cb)
        return () => {}
      }
    ),
    onTerminalExited: vi.fn((cb: (data: { installationId: string }) => void) => {
      exitCallbacks.push(cb)
      return () => {}
    })
  }
}

function mountPane(): VueWrapper {
  return mount(ConsoleTerminalPane, {
    props: { installationId: 'install-A' },
    global: { plugins: [createTestI18n()] }
  }) as VueWrapper
}

describe('comfyUISettings/ConsoleTerminalPane', () => {
  const clipboard = {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue('pasted')
  }

  beforeEach(() => {
    exitCallbacks = []
    outputCallbacks = []
    selectionText = ''
    vi.clearAllMocks()
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    }
    Object.defineProperty(navigator, 'clipboard', {
      value: clipboard,
      configurable: true
    })
    setupApi()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('subscribes to the install console on mount', async () => {
    const w = mountPane()
    await flushPromises()
    expect(window.api.terminalSubscribe).toHaveBeenCalledWith('install-A')
    expect(w.find(`[data-testid="${TID.consoleSessionEnded}"]`).exists()).toBe(false)
  })

  it('shows the restart banner on exit and respawns on click', async () => {
    const w = mountPane()
    await flushPromises()

    exitCallbacks.forEach((cb) => cb({ installationId: 'install-A' }))
    await flushPromises()
    expect(w.find(`[data-testid="${TID.consoleSessionEnded}"]`).exists()).toBe(true)

    await w.find(`[data-testid="${TID.consoleRestart}"]`).trigger('click')
    await flushPromises()
    expect(window.api.terminalRestart).toHaveBeenCalledWith('install-A')
    expect(w.find(`[data-testid="${TID.consoleSessionEnded}"]`).exists()).toBe(false)
  })

  it('clears the session-ended banner when output resumes', async () => {
    const w = mountPane()
    await flushPromises()

    exitCallbacks.forEach((cb) => cb({ installationId: 'install-A' }))
    await flushPromises()
    expect(w.find(`[data-testid="${TID.consoleSessionEnded}"]`).exists()).toBe(true)

    outputCallbacks.forEach((cb) =>
      cb({ installationId: 'install-A', data: 'fresh prompt' })
    )
    await flushPromises()
    expect(w.find(`[data-testid="${TID.consoleSessionEnded}"]`).exists()).toBe(false)
  })

  it('re-asserts its size to the shared PTY on focus even when local dims are unchanged', async () => {
    const w = mountPane()
    await flushPromises()

    const host = w.find(`[data-testid="${TID.consoleTerminal}"]`)
      .element as HTMLElement
    Object.defineProperty(host, 'offsetParent', {
      value: document.body,
      configurable: true
    })
    vi.mocked(window.api.terminalResize).mockClear()

    const focusHandler = fakeTerminal.element.addEventListener.mock.calls.find(
      ([event]) => event === 'focusin'
    )?.[1] as () => void
    focusHandler()

    expect(window.api.terminalResize).toHaveBeenCalledWith('install-A', 80, 30)
  })

  it('ignores exit events for other installations', async () => {
    const w = mountPane()
    await flushPromises()

    exitCallbacks.forEach((cb) => cb({ installationId: 'other-install' }))
    await flushPromises()
    expect(w.find(`[data-testid="${TID.consoleSessionEnded}"]`).exists()).toBe(false)
  })

  it('shows the banner immediately when restored session was already exited', async () => {
    setupApi(makeRestore({ exited: true }))
    const w = mountPane()
    await flushPromises()
    expect(w.find(`[data-testid="${TID.consoleSessionEnded}"]`).exists()).toBe(true)
  })

  describe('copy/paste', () => {
    it('Ctrl+C copies the selection and swallows the key (Windows)', async () => {
      selectionText = 'hello'
      mountPane()
      await flushPromises()

      const result = keyHandler()(keyEvent({ key: 'c', ctrlKey: true }))
      await flushPromises()

      expect(result).toBe(false)
      expect(clipboard.writeText).toHaveBeenCalledWith('hello')
    })

    it('Ctrl+C with no selection passes through (lets SIGINT reach the shell)', async () => {
      selectionText = ''
      mountPane()
      await flushPromises()

      const result = keyHandler()(keyEvent({ key: 'c', ctrlKey: true }))
      await flushPromises()

      expect(result).toBe(true)
      expect(clipboard.writeText).not.toHaveBeenCalled()
    })

    it('Ctrl+V swallows the keydown and lets xterm paste natively (no double paste)', async () => {
      mountPane()
      await flushPromises()

      const result = keyHandler()(keyEvent({ key: 'v', ctrlKey: true }))
      await flushPromises()

      // Returns false so no stray ^V reaches the PTY, but does NOT paste
      // manually — xterm's native paste event handles it, so writing here too
      // would double-paste.
      expect(result).toBe(false)
      expect(fakeTerminal.paste).not.toHaveBeenCalled()
      expect(window.api.terminalWrite).not.toHaveBeenCalled()
    })

    // ContextMenu teleports to <body>, so query the document rather than the wrapper.
    it('right-click opens a menu whose Copy item writes the selection', async () => {
      selectionText = 'pick me'
      const w = mountPane()
      await flushPromises()

      await w.find(`[data-testid="${TID.consoleTerminal}"]`).trigger('contextmenu')
      const copyItem = document.body.querySelector<HTMLButtonElement>(
        `[data-testid="${TID.contextMenuItem('copy')}"]`
      )
      expect(copyItem).not.toBeNull()

      copyItem!.click()
      await flushPromises()
      expect(clipboard.writeText).toHaveBeenCalledWith('pick me')
    })

    it('right-click Paste writes the clipboard into the terminal via paste()', async () => {
      const w = mountPane()
      await flushPromises()

      await w.find(`[data-testid="${TID.consoleTerminal}"]`).trigger('contextmenu')
      const pasteItem = document.body.querySelector<HTMLButtonElement>(
        `[data-testid="${TID.contextMenuItem('paste')}"]`
      )
      expect(pasteItem).not.toBeNull()

      pasteItem!.click()
      await flushPromises()
      expect(fakeTerminal.paste).toHaveBeenCalledWith('pasted')
    })

    it('disables the Copy menu item when nothing is selected', async () => {
      selectionText = ''
      const w = mountPane()
      await flushPromises()

      await w.find(`[data-testid="${TID.consoleTerminal}"]`).trigger('contextmenu')
      const copyItem = document.body.querySelector(
        `[data-testid="${TID.contextMenuItem('copy')}"]`
      )
      expect(copyItem?.classList.contains('disabled')).toBe(true)
    })
  })
})
