import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'

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

import { _runningSessions } from '../lib/ipc/shared'
import {
  bodyLayout,
  comfyWindows,
  computeBodyMode,
  indexInstallationId,
  nextWindowKey,
  type ComfyWindowEntry
} from './registry'
import {
  destroyPanelView,
  navigateToPanel,
  openPanelModal,
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
  close: () => void
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
    close: () => {},
    isLoadingMainFrame: () => false
  }
  return wc
}

function makeEntry(
  opts: {
    installationId?: string | null
    activePanel?: ComfyWindowEntry['activePanel']
    destroyed?: boolean
    withPanel?: boolean
  } = {}
): {
  entry: ComfyWindowEntry
  titleBarWc: FakeWebContents
  panelWc: FakeWebContents
  layoutCalls: number
  panelBackground: string | undefined
} {
  const window = makeWindow({ destroyed: opts.destroyed })
  const titleBarWc = makeWc()
  const panelWc = makeWc()
  const counters = { layout: 0 }
  const panel = { background: undefined as string | undefined }
  const entry: ComfyWindowEntry = {
    windowKey: nextWindowKey(),
    window: window as unknown as ComfyWindowEntry['window'],
    comfyView: { webContents: makeWc() } as unknown as ComfyWindowEntry['comfyView'],
    titleBarView: { webContents: titleBarWc } as unknown as ComfyWindowEntry['titleBarView'],
    panelView: opts.withPanel
      ? ({
          webContents: panelWc,
          setBackgroundColor: (color: string) => {
            panel.background = color
          }
        } as unknown as ComfyWindowEntry['panelView'])
      : null,
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
    panelWc,
    get layoutCalls(): number {
      return counters.layout
    },
    get panelBackground(): string | undefined {
      return panel.background
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
  vi.useRealTimers()
})

describe('setActivePanel', () => {
  it('no-ops when the requested panel is already active', () => {
    const fixture = makeEntry({ activePanel: 'mcp-setup' })
    comfyWindows.set(fixture.entry.windowKey, fixture.entry)
    setActivePanel(fixture.entry.windowKey, 'mcp-setup')
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
    expect(() => setActivePanel(999_999, 'mcp-setup')).not.toThrow()
  })

  it('no-ops when the host window has been destroyed', () => {
    const fixture = makeEntry({ activePanel: 'comfy', destroyed: true })
    comfyWindows.set(fixture.entry.windowKey, fixture.entry)
    setActivePanel(fixture.entry.windowKey, 'mcp-setup')
    expect(fixture.layoutCalls).toBe(0)
    expect(fixture.entry.activePanel).toBe('comfy')
  })

  // After a chooser-pick in-place attach the picker leaves the host on
  // 'progress'; prewarmAttachedPanel must reset it to 'comfy' so the rebuilt
  // panel stays hidden instead of covering the just-attached canvas.
  it('prewarms the attached panel hidden by resetting a progress host to comfy', () => {
    const fixture = makeEntry({ installationId: 'inst-A', activePanel: 'progress' })
    // A pre-set panelView makes the real ensurePanelView short-circuit, so the
    // helper runs without constructing an Electron WebContentsView.
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
    const fixture = makeEntry({ installationId: 'inst-1', activePanel: 'mcp-setup' })
    comfyWindows.set(fixture.entry.windowKey, fixture.entry)
    indexInstallationId('inst-1', fixture.entry.windowKey)
    refreshComfyTabBody('inst-1')
    // No layout pass since the entry isn't on the comfy pill.
    expect(fixture.layoutCalls).toBe(0)
  })
})

describe('title-bar modals', () => {
  type Fixture = ReturnType<typeof makeEntry>

  function register(opts: NonNullable<Parameters<typeof makeEntry>[0]>, running = false): Fixture {
    const fixture = makeEntry({ ...opts, withPanel: true })
    comfyWindows.set(fixture.entry.windowKey, fixture.entry)
    if (opts.installationId) {
      indexInstallationId(opts.installationId, fixture.entry.windowKey)
      if (running) _runningSessions.set(opts.installationId, {} as never)
    }
    return fixture
  }

  function open(fixture: Fixture): void {
    openPanelModal(fixture.entry.windowKey, 'announcement', 'comfy-panel:open-announcement', {})
  }

  function sendFromPanel(fixture: Fixture, channel: string, ...args: unknown[]): void {
    vi.mocked(ipcMain.on).mockClear()
    registerPanelViewIpc()
    const handler = vi.mocked(ipcMain.on).mock.calls.find(([c]) => c === channel)?.[1]
    if (!handler) throw new Error(`No handler for ${channel}`)
    handler({ sender: fixture.panelWc } as never, ...args)
  }

  const panelChannels = (fixture: Fixture): string[] => fixture.panelWc.sent.map((m) => m.channel)

  it.each([
    { activePanel: 'comfy', installationId: null },
    { activePanel: 'comfy', installationId: 'inst-A' },
    { activePanel: 'performance-test', installationId: null },
    { activePanel: 'benchmarks', installationId: null },
    { activePanel: 'new-install', installationId: null },
    { activePanel: 'track', installationId: 'inst-A' },
    { activePanel: 'progress', installationId: 'inst-A' }
  ] as const)(
    'opens and closes over $activePanel (install $installationId) without navigating',
    ({ activePanel, installationId }) => {
      const fixture = register({ activePanel, installationId })
      const mode = computeBodyMode(fixture.entry)

      open(fixture)
      expect(fixture.entry.panelModal).toBe('announcement')
      expect(bodyLayout(fixture.entry)).toEqual({ panel: true, canvas: false })
      sendFromPanel(fixture, 'comfy-window:close-panel-modal', 'announcement')

      expect(fixture.entry.panelModal).toBeUndefined()
      expect(fixture.entry.activePanel).toBe(activePanel)
      expect(computeBodyMode(fixture.entry)).toBe(mode)
      expect(panelChannels(fixture)).toEqual([
        'comfy-panel:open-announcement',
        'comfy-panel:dismiss-modal'
      ])
      expect(fixture.titleBarWc.sent).toEqual([])
    }
  )

  it('shows over a running canvas only once the renderer has painted it', () => {
    const fixture = register({ installationId: 'inst-A' }, true)

    open(fixture)
    expect(bodyLayout(fixture.entry)).toEqual({ panel: false, canvas: true })
    sendFromPanel(fixture, 'comfy-window:overlay-ready')
    expect(bodyLayout(fixture.entry)).toEqual({ panel: true, canvas: true })

    sendFromPanel(fixture, 'comfy-window:close-panel-modal', 'announcement')
    expect(bodyLayout(fixture.entry)).toEqual({ panel: false, canvas: true })
    expect(panelChannels(fixture)).not.toContain('panel-switch')
  })

  it('shows over a running canvas after 400ms if the paint ack never arrives', () => {
    vi.useFakeTimers()
    const fixture = register({ installationId: 'inst-A' }, true)

    open(fixture)
    vi.advanceTimersByTime(399)
    expect(bodyLayout(fixture.entry).panel).toBe(false)
    vi.advanceTimersByTime(1)
    expect(bodyLayout(fixture.entry)).toEqual({ panel: true, canvas: true })
  })

  it('leaves the stopped page showing when the instance stops before the paint ack', () => {
    vi.useFakeTimers()
    const fixture = register({ installationId: 'inst-A' }, true)

    open(fixture)
    _runningSessions.delete('inst-A')
    expect(bodyLayout(fixture.entry)).toEqual({ panel: true, canvas: false })
    sendFromPanel(fixture, 'comfy-window:close-panel-modal', 'announcement')

    expect(computeBodyMode(fixture.entry)).toBe('comfy-lifecycle')
    expect(bodyLayout(fixture.entry)).toEqual({ panel: true, canvas: false })
    expect(fixture.entry.pendingOverlayReveal).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('closes when the window navigates, before the new page is sent', () => {
    const fixture = register({ activePanel: 'performance-test' })

    open(fixture)
    navigateToPanel(fixture.entry.windowKey, 'benchmarks')

    expect(fixture.entry.panelModal).toBeUndefined()
    expect(panelChannels(fixture)).toEqual([
      'comfy-panel:open-announcement',
      'comfy-panel:dismiss-modal',
      'panel-switch'
    ])
  })

  it('closes when a title-bar pill picks the page already showing', () => {
    const fixture = register({ installationId: 'inst-A' }, true)
    open(fixture)
    sendFromPanel(fixture, 'comfy-window:overlay-ready')

    vi.mocked(ipcMain.on).mockClear()
    registerPanelViewIpc()
    const setPanel = vi.mocked(ipcMain.on).mock.calls.find(([c]) => c === 'comfy-window:set-panel')
    setPanel?.[1]({ sender: fixture.titleBarWc } as never, { panel: 'comfy' })

    expect(fixture.entry.panelModal).toBeUndefined()
    expect(bodyLayout(fixture.entry)).toEqual({ panel: false, canvas: true })
    expect(panelChannels(fixture)).toContain('comfy-panel:dismiss-modal')
  })

  it('answers a close that arrives after navigation without changing the new page', () => {
    const fixture = register({ activePanel: 'performance-test' })
    open(fixture)
    navigateToPanel(fixture.entry.windowKey, 'benchmarks')
    const layoutCalls = fixture.layoutCalls

    sendFromPanel(fixture, 'comfy-window:close-panel-modal', 'announcement')

    expect(fixture.entry.activePanel).toBe('benchmarks')
    expect(fixture.layoutCalls).toBe(layoutCalls)
    expect(panelChannels(fixture).at(-1)).toBe('comfy-panel:dismiss-modal')
  })

  it('stays open, still showing, when a finished operation returns the page to the canvas', () => {
    const fixture = register({ installationId: 'inst-A', activePanel: 'progress' }, true)
    open(fixture)

    sendFromPanel(fixture, 'comfy-window:close-current-panel')

    expect(fixture.entry.activePanel).toBe('comfy')
    expect(fixture.entry.panelModal).toBe('announcement')
    expect(bodyLayout(fixture.entry), 'no reveal hold for a modal on screen').toEqual({
      panel: true,
      canvas: true
    })
    expect(fixture.panelBackground).toBe('#00000000')
    expect(panelChannels(fixture)).toEqual(['comfy-panel:open-announcement', 'panel-switch'])
  })

  it('stays open when a relaunch reasserts the canvas', () => {
    const fixture = register({ installationId: 'inst-A' }, true)
    open(fixture)
    sendFromPanel(fixture, 'comfy-window:overlay-ready')

    setActivePanel(fixture.entry.windowKey, 'comfy')

    expect(fixture.entry.panelModal).toBe('announcement')
    expect(panelChannels(fixture)).not.toContain('comfy-panel:dismiss-modal')
  })

  it('stays open and turns the panel see-through when the instance starts under it', () => {
    const fixture = register({ installationId: 'inst-A' })
    open(fixture)
    expect(computeBodyMode(fixture.entry)).toBe('comfy-lifecycle')

    _runningSessions.set('inst-A', {} as never)
    refreshComfyTabBody('inst-A')

    expect(fixture.entry.panelModal).toBe('announcement')
    expect(bodyLayout(fixture.entry)).toEqual({ panel: true, canvas: true })
    expect(fixture.panelBackground).toBe('#00000000')
    expect(panelChannels(fixture)).toEqual(['comfy-panel:open-announcement', 'panel-switch'])
  })

  it('ignores a close for an unknown modal', () => {
    const fixture = register({ activePanel: 'benchmarks' })
    open(fixture)

    sendFromPanel(fixture, 'comfy-window:close-panel-modal', 'not-a-modal')

    expect(fixture.entry.panelModal).toBe('announcement')
    expect(panelChannels(fixture)).toEqual(['comfy-panel:open-announcement'])
  })

  it("swaps What's New for Feedback in place without hiding the panel", () => {
    const fixture = register({ installationId: 'inst-A' }, true)
    open(fixture)
    sendFromPanel(fixture, 'comfy-window:overlay-ready')

    openPanelModal(fixture.entry.windowKey, 'feedback', 'comfy-panel:open-feedback', {
      source: 'titlebar'
    })

    expect(fixture.entry.panelModal).toBe('feedback')
    expect(bodyLayout(fixture.entry)).toEqual({ panel: true, canvas: true })
    expect(panelChannels(fixture)).toEqual([
      'comfy-panel:open-announcement',
      'comfy-panel:open-feedback'
    ])
    sendFromPanel(fixture, 'comfy-window:close-panel-modal', 'announcement')
    expect(fixture.entry.panelModal, 'a stale close leaves Feedback open').toBe('feedback')

    sendFromPanel(fixture, 'comfy-window:close-panel-modal', 'feedback')
    expect(fixture.entry.panelModal).toBeUndefined()
    expect(bodyLayout(fixture.entry)).toEqual({ panel: false, canvas: true })
  })

  it('forgets the modal and its pending reveal when its renderer is destroyed', () => {
    vi.useFakeTimers()
    const fixture = register({ installationId: 'inst-A' }, true)
    open(fixture)

    destroyPanelView(fixture.entry)

    expect(fixture.entry.panelModal).toBeUndefined()
    expect(fixture.entry.pendingOverlayReveal).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(bodyLayout(fixture.entry)).toEqual({ panel: false, canvas: true })
  })
})
