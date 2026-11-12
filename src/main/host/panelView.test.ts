import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en'
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

import { ipcMain } from 'electron'
import { _runningSessions } from '../lib/ipc/shared'
import {
  comfyWindows,
  computeBodyMode,
  indexInstallationId,
  nextWindowKey,
  type ComfyWindowEntry
} from './registry'
import {
  openAnnouncement,
  prewarmAttachedPanel,
  refreshComfyTabBody,
  registerPanelViewIpc,
  setActivePanel
} from './panelView'

interface FakeWindow {
  destroyed: boolean
  focused: boolean
  isDestroyed: () => boolean
  isFocused: () => boolean
}

function makeWindow(opts: { destroyed?: boolean; focused?: boolean } = {}): FakeWindow {
  const win: FakeWindow = {
    destroyed: opts.destroyed ?? false,
    focused: opts.focused ?? false,
    isDestroyed: () => win.destroyed,
    isFocused: () => win.focused
  }
  return win
}

interface FakeWebContents {
  destroyed: boolean
  sent: { channel: string; args: unknown[] }[]
  isDestroyed: () => boolean
  send: (channel: string, ...args: unknown[]) => void
  focus: () => void
  isLoadingMainFrame: () => boolean
}

function makeWc(): FakeWebContents {
  const wc: FakeWebContents = {
    destroyed: false,
    sent: [],
    isDestroyed: () => wc.destroyed,
    send: (channel, ...args) => {
      wc.sent.push({ channel, args })
    },
    focus: () => {},
    isLoadingMainFrame: () => false
  }
  return wc
}

function makeEntry(
  opts: {
    installationId?: string | null
    activePanel?: ComfyWindowEntry['activePanel']
    destroyed?: boolean
  } = {}
): {
  entry: ComfyWindowEntry
  titleBarWc: FakeWebContents
  layoutCalls: number
} {
  const window = makeWindow({ destroyed: opts.destroyed })
  const titleBarWc = makeWc()
  const counters = { layout: 0 }
  const entry: ComfyWindowEntry = {
    windowKey: nextWindowKey(),
    window: window as unknown as ComfyWindowEntry['window'],
    comfyView: { webContents: makeWc() } as unknown as ComfyWindowEntry['comfyView'],
    titleBarView: { webContents: titleBarWc } as unknown as ComfyWindowEntry['titleBarView'],
    panelView: null,
    activePanel: opts.activePanel ?? 'comfy',
    lastTheme: { bg: '#000', text: '#fff' },
    layoutViews: () => {
      counters.layout += 1
    },
    comfyUrl: '',
    installationId: opts.installationId ?? null,
    constructedPartition: null,
    firstUseMode: 'none',
    titleBarText: '',
    sourceCategory: null,
    previewInstallationId: null,
    coldStartPendingReveal: false,
    _installCleanup: null,
    detachInstall: () => {}
  }
  return {
    entry,
    titleBarWc,
    get layoutCalls(): number {
      return counters.layout
    }
  }
}

beforeEach(() => {
  comfyWindows.clear()
  _runningSessions.clear()
})

afterEach(() => {
  comfyWindows.clear()
  _runningSessions.clear()
})

describe('setActivePanel', () => {
  it('no-ops when the requested panel is already active', () => {
    const fixture = makeEntry({ activePanel: 'feedback' })
    comfyWindows.set(fixture.entry.windowKey, fixture.entry)
    setActivePanel(fixture.entry.windowKey, 'feedback')
    expect(fixture.layoutCalls).toBe(0)
    expect(fixture.titleBarWc.sent).toHaveLength(0)
  })

  it.each(['performance-test', 'benchmarks'] as const)(
    'reasserts an already-active %s page so a stale dashboard renderer can recover',
    (panel) => {
      const fixture = makeEntry({ activePanel: panel })
      const panelWc = makeWc()
      fixture.entry.panelView = {
        webContents: panelWc
      } as unknown as ComfyWindowEntry['panelView']
      comfyWindows.set(fixture.entry.windowKey, fixture.entry)

      setActivePanel(fixture.entry.windowKey, panel)

      expect(fixture.layoutCalls).toBe(1)
      expect(panelWc.sent).toContainEqual({
        channel: 'panel-switch',
        args: [{ panel, installationId: '' }]
      })
      expect(fixture.titleBarWc.sent).toContainEqual({
        channel: 'comfy-titlebar:panel-changed',
        args: [panel]
      })
    }
  )

  it('no-ops when the windowKey does not resolve to an entry', () => {
    expect(() => setActivePanel(999_999, 'feedback')).not.toThrow()
  })

  it('no-ops when the host window has been destroyed', () => {
    const fixture = makeEntry({ activePanel: 'comfy', destroyed: true })
    comfyWindows.set(fixture.entry.windowKey, fixture.entry)
    setActivePanel(fixture.entry.windowKey, 'feedback')
    expect(fixture.layoutCalls).toBe(0)
    expect(fixture.entry.activePanel).toBe('comfy')
  })

  it('prewarms the attached panel hidden by resetting a progress host to comfy', () => {
    const fixture = makeEntry({ installationId: 'inst-A', activePanel: 'progress' })
    fixture.entry.panelView = {
      webContents: makeWc()
    } as unknown as ComfyWindowEntry['panelView']
    comfyWindows.set(fixture.entry.windowKey, fixture.entry)
    indexInstallationId('inst-A', fixture.entry.windowKey)
    _runningSessions.set('inst-A', {} as never)

    expect(computeBodyMode(fixture.entry), 'starts stranded on progress').toBe('progress')

    prewarmAttachedPanel(fixture.entry)

    expect(fixture.entry.activePanel).toBe('comfy')
    expect(computeBodyMode(fixture.entry), 'panel hidden, ComfyUI visible').toBe('comfy')
    expect(fixture.layoutCalls, 'the prewarm lays the views out').toBeGreaterThan(0)
  })
})

describe('comfy-window:navigate-panel', () => {
  function makeWindowWithPanel(opts: Parameters<typeof makeEntry>[0]) {
    const fixture = makeEntry(opts)
    const panelWc = makeWc()
    fixture.entry.panelView = {
      webContents: panelWc,
      setBackgroundColor: () => {}
    } as unknown as ComfyWindowEntry['panelView']
    comfyWindows.set(fixture.entry.windowKey, fixture.entry)
    return { entry: fixture.entry, panelWc, titleBarWc: fixture.titleBarWc }
  }

  function navigate(sender: unknown, page: unknown): void {
    registerPanelViewIpc()
    const registered = vi
      .mocked(ipcMain.on)
      .mock.calls.find(([channel]) => channel === 'comfy-window:navigate-panel')
    const listener = registered?.[1] as (event: { sender: unknown }, page: unknown) => void
    listener({ sender }, page)
  }

  it.each([
    ['chooser', 'comfy', 'benchmarks'],
    ['apps', 'comfy', 'benchmarks'],
    ['assets', 'comfy', 'benchmarks'],
    ['benchmarks', 'benchmarks', 'comfy'],
    ['performance-test', 'performance-test', 'comfy']
  ] as const)('opens %s in a dashboard window', (page, panel, startingPanel) => {
    const { entry, panelWc } = makeWindowWithPanel({
      installationId: null,
      activePanel: startingPanel
    })

    navigate(panelWc, page)

    expect(entry.activePanel).toBe(panel)
    expect(panelWc.sent.at(-1)?.channel).toBe('panel-switch')
  })

  it('leaves an install-backed window on its current panel', () => {
    const { entry, panelWc } = makeWindowWithPanel({
      installationId: 'install-1',
      activePanel: 'comfy'
    })

    navigate(panelWc, 'benchmarks')

    expect(entry.activePanel).toBe('comfy')
  })

  it("opens tools from a build window's Home tab, and goes back to Home from the sidebar", () => {
    const { entry, panelWc } = makeWindowWithPanel({
      installationId: 'install-1',
      activePanel: 'home'
    })

    navigate(panelWc, 'benchmarks')
    expect(entry.activePanel).toBe('benchmarks')

    navigate(panelWc, 'chooser')
    expect(entry.activePanel).toBe('home')
    expect(computeBodyMode(entry)).toBe('chooser')
  })

  it('goes back to Home when Feedback opened from the Home tab closes', () => {
    const { entry, panelWc } = makeWindowWithPanel({
      installationId: 'install-1',
      activePanel: 'home'
    })
    _runningSessions.set('install-1', {} as never)

    setActivePanel(entry.windowKey, 'feedback')
    registerPanelViewIpc()
    const closeCurrent = vi
      .mocked(ipcMain.on)
      .mock.calls.find(
        ([channel]) => channel === 'comfy-window:close-current-panel'
      )?.[1] as (event: { sender: unknown }) => void
    closeCurrent({ sender: panelWc })

    expect(entry.activePanel).toBe('home')
    expect(computeBodyMode(entry)).toBe('chooser')

    setActivePanel(entry.windowKey, 'comfy')
    setActivePanel(entry.windowKey, 'feedback')
    closeCurrent({ sender: panelWc })
    expect(entry.activePanel).toBe('comfy')
  })

  it.each(['feedback', 'new-install', undefined])('ignores the unknown page %s', (page) => {
    const { entry, panelWc } = makeWindowWithPanel({ installationId: null, activePanel: 'comfy' })

    navigate(panelWc, page)

    expect(entry.activePanel).toBe('comfy')
  })

  it('ignores a sender that is not a panel', () => {
    const { entry, titleBarWc } = makeWindowWithPanel({
      installationId: null,
      activePanel: 'comfy'
    })

    navigate(titleBarWc, 'benchmarks')

    expect(entry.activePanel).toBe('comfy')
  })
})

describe("What's New", () => {
  function makeWindowWithPanel(opts: Parameters<typeof makeEntry>[0]) {
    const fixture = makeEntry({ installationId: 'install-1', ...opts })
    const panelWc = makeWc()
    const focusPanel = vi.spyOn(panelWc, 'focus')
    ;(fixture.entry.window as unknown as FakeWindow).focused = true
    fixture.entry.panelView = {
      webContents: panelWc,
      setBackgroundColor: () => {}
    } as unknown as ComfyWindowEntry['panelView']
    comfyWindows.set(fixture.entry.windowKey, fixture.entry)
    return { fixture, entry: fixture.entry, panelWc, focusPanel }
  }

  function close(sender: unknown): void {
    registerPanelViewIpc()
    const registered = vi
      .mocked(ipcMain.on)
      .mock.calls.find(([channel]) => channel === 'comfy-window:close-announcement')
    const listener = registered?.[1] as (event: { sender: unknown }) => void
    listener({ sender })
  }

  function channels(wc: FakeWebContents): string[] {
    return wc.sent.map(({ channel }) => channel)
  }

  it.each([
    ['the performance tests page', null, 'performance-test'],
    ['the benchmarks page', null, 'benchmarks'],
    ['the dashboard', null, 'comfy'],
    ['the stopped-instance page', 'install-1', 'comfy'],
    ['a progress takeover', 'install-1', 'progress'],
    ['an install wizard', 'install-1', 'new-install']
  ] as const)('leaves %s in place when opened and closed', (_name, installationId, activePanel) => {
    const { fixture, entry, panelWc } = makeWindowWithPanel({ installationId, activePanel })
    const before = computeBodyMode(entry)

    openAnnouncement(entry.windowKey)

    expect(entry.activePanel, 'opening does not navigate').toBe(activePanel)
    expect(computeBodyMode(entry)).toBe(before)
    expect(channels(panelWc)).toEqual(['comfy-panel:open-announcement'])
    expect(fixture.titleBarWc.sent, 'the title bar keeps its current page').toHaveLength(0)

    close(panelWc)

    expect(entry.activePanel, 'closing does not navigate').toBe(activePanel)
    expect(channels(panelWc)).toEqual(['comfy-panel:open-announcement'])
  })

  it('moves keyboard focus into the panel when it opens over a page', () => {
    const { entry, focusPanel } = makeWindowWithPanel({
      installationId: null,
      activePanel: 'performance-test'
    })

    openAnnouncement(entry.windowKey)

    expect(focusPanel).toHaveBeenCalledTimes(1)
  })

  describe('over a running canvas', () => {
    function makeRunningWindow() {
      const window = makeWindowWithPanel({ installationId: 'install-1', activePanel: 'comfy' })
      _runningSessions.set('install-1', {} as never)
      return window
    }

    it('shows the panel over the canvas, then hides it again on close', () => {
      const { entry, panelWc } = makeRunningWindow()
      expect(computeBodyMode(entry), 'the canvas is showing').toBe('comfy')

      openAnnouncement(entry.windowKey)

      expect(entry.activePanel).toBe('announcement')
      expect(entry.pendingOverlayReveal, 'waits for the modal to paint').toBe(true)
      expect(channels(panelWc)).toEqual(['panel-switch', 'comfy-panel:open-announcement'])

      close(panelWc)

      expect(entry.activePanel).toBe('comfy')
      expect(computeBodyMode(entry), 'the canvas is showing again').toBe('comfy')
    })

    it('shows the stopped page on close if the instance stopped underneath', () => {
      const { entry, panelWc } = makeRunningWindow()

      openAnnouncement(entry.windowKey)
      _runningSessions.delete('install-1')
      close(panelWc)

      expect(computeBodyMode(entry)).toBe('comfy-lifecycle')
    })

    it('keeps a wizard that opened underneath when closed', () => {
      const { entry, panelWc } = makeRunningWindow()

      openAnnouncement(entry.windowKey)
      setActivePanel(entry.windowKey, 'new-install')
      close(panelWc)

      expect(entry.activePanel).toBe('new-install')
    })
  })

  it('ignores a close from a sender that is not a panel', () => {
    const { fixture, entry } = makeWindowWithPanel({ activePanel: 'announcement' })

    close(fixture.titleBarWc)

    expect(entry.activePanel).toBe('announcement')
  })

  it('no-ops opening when the window is gone', () => {
    expect(() => openAnnouncement(999_999)).not.toThrow()
    const { entry, panelWc } = makeWindowWithPanel({ destroyed: true, activePanel: 'comfy' })

    openAnnouncement(entry.windowKey)

    expect(panelWc.sent).toHaveLength(0)
  })
})

describe('refreshComfyTabBody', () => {
  it('no-ops when the install id does not resolve to an entry', () => {
    expect(() => refreshComfyTabBody('does-not-exist')).not.toThrow()
  })

  it('no-ops when the host window is destroyed', () => {
    const fixture = makeEntry({ installationId: 'inst-1', destroyed: true })
    comfyWindows.set(fixture.entry.windowKey, fixture.entry)
    indexInstallationId('inst-1', fixture.entry.windowKey)
    refreshComfyTabBody('inst-1')
    expect(fixture.layoutCalls).toBe(0)
  })

  it('no-ops when the entry is currently parked on a non-comfy panel', () => {
    const fixture = makeEntry({ installationId: 'inst-1', activePanel: 'feedback' })
    comfyWindows.set(fixture.entry.windowKey, fixture.entry)
    indexInstallationId('inst-1', fixture.entry.windowKey)
    refreshComfyTabBody('inst-1')
    expect(fixture.layoutCalls).toBe(0)
  })
})
