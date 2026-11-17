import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as SystemModalModule from '../popups/systemModal'
import type * as SettingsModule from '../settings'

const mocks = vi.hoisted(() => ({
  confirmBeforeClosing: false,
  appsBuildRunning: false,
  agrees: true,
  asked: [] as { spec: { message: string; details?: { items: string[] }[] } }[],
  stopAppsBuilds: vi.fn(async () => {}),
  keepComfyRunning: undefined as boolean | undefined
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

vi.mock('../apps/localComfy', () => ({
  hasBuildsRunningForAppsOnly: () => mocks.appsBuildRunning,
  stopEveryBuildRunningForAppsOnly: () => mocks.stopAppsBuilds()
}))
vi.mock('../popups/systemModal', async (importOriginal) => ({
  ...(await importOriginal<typeof SystemModalModule>()),
  openSystemModalAsync: async (options: (typeof mocks.asked)[number]) => {
    mocks.asked.push(options)
    return mocks.agrees
  }
}))
vi.mock('../settings', async (importOriginal) => {
  const actual = await importOriginal<typeof SettingsModule>()
  return {
    ...actual,
    get: (key: string) =>
      key === 'confirmBeforeClosingWindow'
        ? mocks.confirmBeforeClosing
        : key === 'keepComfyRunningWhenWindowCloses'
          ? mocks.keepComfyRunning
          : actual.get(key)
  }
})

import { _runningSessions, type SessionInfo } from '../lib/ipc/shared'
import {
  comfyWindows,
  dropInstallationIndex,
  indexInstallationId,
  nextWindowKey,
  type ComfyWindowEntry
} from './registry'
import {
  closeAllHostWindows,
  confirmAndCloseAllHostWindows,
  confirmAndCloseHostWindow,
  detachOrphanedInstallHosts,
  preClearedClose,
  returnToDashboard
} from './detach'

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

function makeEntry(window: FakeWindow): ComfyWindowEntry {
  return {
    windowKey: nextWindowKey(),
    window: window as unknown as ComfyWindowEntry['window'],
    comfyView: {} as ComfyWindowEntry['comfyView'],
    titleBarView: { webContents: {} } as unknown as ComfyWindowEntry['titleBarView'],
    panelView: null,
    activePanel: 'comfy',
    lastTheme: { bg: '#000', text: '#fff' },
    layoutViews: () => {},
    comfyUrl: '',
    installationId: null,
    constructedPartition: null,
    firstUseMode: 'none',
    titleBarText: '',
    sourceCategory: null,
    previewInstallationId: null,
    coldStartPendingReveal: false,
    _installCleanup: null,
    detachInstall: () => {}
  }
}

beforeEach(() => {
  comfyWindows.clear()
  _runningSessions.clear()
})

afterEach(() => {
  comfyWindows.clear()
  _runningSessions.clear()
  mocks.keepComfyRunning = undefined
})

describe('closeAllHostWindows', () => {
  it('calls close() on every live host window', () => {
    const a = makeWindow()
    const b = makeWindow()
    const c = makeWindow()
    const entryA = makeEntry(a)
    const entryB = makeEntry(b)
    const entryC = makeEntry(c)
    comfyWindows.set(entryA.windowKey, entryA)
    comfyWindows.set(entryB.windowKey, entryB)
    comfyWindows.set(entryC.windowKey, entryC)

    closeAllHostWindows()

    expect(a.closed).toBe(true)
    expect(b.closed).toBe(true)
    expect(c.closed).toBe(true)
  })

  it('skips windows that are already destroyed', () => {
    const live = makeWindow()
    const dead = makeWindow({ destroyed: true })
    const entryLive = makeEntry(live)
    const entryDead = makeEntry(dead)
    comfyWindows.set(entryLive.windowKey, entryLive)
    comfyWindows.set(entryDead.windowKey, entryDead)

    closeAllHostWindows()

    expect(live.closed).toBe(true)
    expect(dead.closed).toBe(false)
  })

  it('is safe to call when no windows are open', () => {
    expect(() => closeAllHostWindows()).not.toThrow()
  })

  it('snapshots the entry list so a synchronous closed-callback delete during iteration does not skip windows', () => {
    const a = makeWindow()
    const b = makeWindow()
    const entryA = makeEntry(a)
    const entryB = makeEntry(b)
    comfyWindows.set(entryA.windowKey, entryA)
    comfyWindows.set(entryB.windowKey, entryB)
    a.close = () => {
      a.closed = true
      comfyWindows.delete(entryA.windowKey)
    }
    b.close = () => {
      b.closed = true
      comfyWindows.delete(entryB.windowKey)
    }

    closeAllHostWindows()

    expect(a.closed).toBe(true)
    expect(b.closed).toBe(true)
  })
})

describe('detachOrphanedInstallHosts', () => {
  function makeInstallEntry(installationId: string | null): ComfyWindowEntry {
    const win = makeWindow()
    const entry = makeEntry(win)
    entry.installationId = installationId
    entry.detachInstall = vi.fn()
    return entry
  }

  it('detaches install-backed entries whose install id is no longer in the registry', () => {
    const live = makeInstallEntry('inst-A')
    const orphan = makeInstallEntry('inst-B')
    comfyWindows.set(live.windowKey, live)
    comfyWindows.set(orphan.windowKey, orphan)

    detachOrphanedInstallHosts(new Set(['inst-A']))

    expect(live.detachInstall).not.toHaveBeenCalled()
    expect(orphan.detachInstall).toHaveBeenCalledTimes(1)
  })

  it('leaves chooser hosts (no installationId) untouched', () => {
    const chooser = makeInstallEntry(null)
    comfyWindows.set(chooser.windowKey, chooser)

    detachOrphanedInstallHosts(new Set())

    expect(chooser.detachInstall).not.toHaveBeenCalled()
  })

  it('skips destroyed windows', () => {
    const dead = makeInstallEntry('inst-X')
    ;(dead.window as unknown as FakeWindow).destroyed = true
    comfyWindows.set(dead.windowKey, dead)

    detachOrphanedInstallHosts(new Set())

    expect(dead.detachInstall).not.toHaveBeenCalled()
  })

  it('is safe when comfyWindows is empty', () => {
    expect(() => detachOrphanedInstallHosts(new Set(['inst-A']))).not.toThrow()
  })
})

describe('preClearedClose', () => {
  it('reports membership for added windows and ignores unknowns', () => {
    const a = makeWindow()
    const b = makeWindow()
    expect(preClearedClose.has(a as unknown as Electron.BrowserWindow)).toBe(false)
    preClearedClose.add(a as unknown as Electron.BrowserWindow)
    expect(preClearedClose.has(a as unknown as Electron.BrowserWindow)).toBe(true)
    expect(preClearedClose.has(b as unknown as Electron.BrowserWindow)).toBe(false)
  })

  it('drops membership on delete()', () => {
    const a = makeWindow()
    preClearedClose.add(a as unknown as Electron.BrowserWindow)
    expect(preClearedClose.delete(a as unknown as Electron.BrowserWindow)).toBe(true)
    expect(preClearedClose.has(a as unknown as Electron.BrowserWindow)).toBe(false)
  })
})

describe('closing the last Desktop window while an app uses a ComfyUI Desktop started for it', () => {
  function openDashboard(): FakeWindow {
    const win = makeWindow()
    const entry = makeEntry(win)
    comfyWindows.set(entry.windowKey, entry)
    return win
  }

  beforeEach(() => {
    mocks.keepComfyRunning = false
    mocks.confirmBeforeClosing = true
    mocks.appsBuildRunning = true
    mocks.agrees = true
    mocks.asked = []
    mocks.stopAppsBuilds.mockClear()
  })

  it('asks first, and Cancel keeps both the window and that ComfyUI', async () => {
    mocks.agrees = false
    const win = openDashboard()

    await confirmAndCloseHostWindow(win as unknown as Electron.BrowserWindow)

    expect(mocks.asked.map((asked) => asked.spec.message)).toEqual([
      'Close this window? This stops ComfyUI and quits Comfy Desktop.'
    ])
    expect(win.closed).toBe(false)
    expect(mocks.stopAppsBuilds).not.toHaveBeenCalled()
  })

  it('stops that ComfyUI and closes once the person agrees', async () => {
    const win = openDashboard()

    await confirmAndCloseHostWindow(win as unknown as Electron.BrowserWindow)

    expect(mocks.stopAppsBuilds).toHaveBeenCalledTimes(1)
    expect(win.closed).toBe(true)
  })
})

describe('closing a window while ComfyUI runs on this computer', () => {
  const realPlatform = process.platform

  function onPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  }

  function comfyRunning(): void {
    _runningSessions.set('studio', {
      port: 8188,
      mode: 'window',
      installationName: 'Studio'
    } as SessionInfo)
  }

  function openWindow(installationId: string | null = null): FakeWindow {
    const win = makeWindow()
    const entry = makeEntry(win)
    entry.installationId = installationId
    entry.sourceCategory = installationId === null ? null : 'local'
    comfyWindows.set(entry.windowKey, entry)
    return win
  }

  beforeEach(() => {
    mocks.keepComfyRunning = false
    mocks.confirmBeforeClosing = true
    mocks.appsBuildRunning = false
    mocks.agrees = true
    mocks.asked = []
    mocks.stopAppsBuilds.mockClear()
    comfyRunning()
  })

  afterEach(() => {
    onPlatform(realPlatform)
  })

  it('with keepComfyRunningWhenWindowCloses off, asks before closing a ComfyUI window while other windows are open', async () => {
    onPlatform('win32')
    mocks.agrees = false
    const win = openWindow('studio')
    openWindow()

    await confirmAndCloseHostWindow(win as unknown as Electron.BrowserWindow)

    expect(mocks.asked.map((asked) => asked.spec.message)).toEqual([
      'Close this window? This stops the running ComfyUI instance.'
    ])
    expect(win.closed).toBe(false)
  })

  it('with keepComfyRunningWhenWindowCloses off, asks before the last ComfyUI window on macOS closes', async () => {
    onPlatform('darwin')
    const win = openWindow('studio')

    await confirmAndCloseHostWindow(win as unknown as Electron.BrowserWindow)

    expect(mocks.asked.map((asked) => asked.spec.message)).toEqual([
      'Close this window? This stops ComfyUI and quits Comfy Desktop.'
    ])
    expect(mocks.stopAppsBuilds).toHaveBeenCalledTimes(1)
    expect(win.closed).toBe(true)
  })

  describe('with keepComfyRunningWhenWindowCloses absent, so on by default', () => {
    beforeEach(() => {
      mocks.keepComfyRunning = undefined
    })

    it('closes a ComfyUI window without asking while other windows are open', async () => {
      onPlatform('win32')
      const win = openWindow('studio')
      openWindow()

      await confirmAndCloseHostWindow(win as unknown as Electron.BrowserWindow)

      expect(mocks.asked).toEqual([])
      expect(win.closed).toBe(true)
    })

    it('closes the last ComfyUI window on macOS without asking, since ComfyUI keeps running', async () => {
      onPlatform('darwin')
      const win = openWindow('studio')

      await confirmAndCloseHostWindow(win as unknown as Electron.BrowserWindow)

      expect(mocks.asked).toEqual([])
      expect(mocks.stopAppsBuilds).not.toHaveBeenCalled()
      expect(win.closed).toBe(true)
    })

    it.each(['win32', 'linux'] as const)(
      'asks on %s before the last window closes, since that stops ComfyUI and quits, and Cancel keeps the window',
      async (platform) => {
        onPlatform(platform)
        mocks.agrees = false
        const win = openWindow()

        await confirmAndCloseHostWindow(win as unknown as Electron.BrowserWindow)

        expect(mocks.asked.map((asked) => asked.spec.message)).toEqual([
          'Close this window? This stops ComfyUI and quits Comfy Desktop.'
        ])
        expect(win.closed).toBe(false)
      }
    )

    it('closes the last window once the person agrees, leaving the stop to quitting', async () => {
      onPlatform('win32')
      const win = openWindow()

      await confirmAndCloseHostWindow(win as unknown as Electron.BrowserWindow)

      expect(mocks.stopAppsBuilds).not.toHaveBeenCalled()
      expect(win.closed).toBe(true)
    })
  })
})

describe('quitting while a ComfyUI runs with no window', () => {
  beforeEach(() => {
    mocks.keepComfyRunning = false
    mocks.agrees = true
    mocks.asked = []
    _runningSessions.set('studio', {
      port: 8188,
      mode: 'window',
      installationName: 'Studio'
    } as SessionInfo)
  })

  it('with keepComfyRunningWhenWindowCloses off, quits without asking, as only windows are counted', async () => {
    const entry = makeEntry(makeWindow())
    comfyWindows.set(entry.windowKey, entry)
    const performQuit = vi.fn()

    await confirmAndCloseAllHostWindows(null, performQuit)

    expect(mocks.asked).toEqual([])
    expect(performQuit).toHaveBeenCalledTimes(1)
  })

  describe('with keepComfyRunningWhenWindowCloses absent, so on by default', () => {
    beforeEach(() => {
      mocks.keepComfyRunning = undefined
    })

    it('warns that quitting stops it, and names it', async () => {
      const entry = makeEntry(makeWindow())
      comfyWindows.set(entry.windowKey, entry)
      const performQuit = vi.fn()

      await confirmAndCloseAllHostWindows(null, performQuit)

      expect(mocks.asked.map((asked) => asked.spec.message)).toEqual([
        'Quit Desktop? This will close the running ComfyUI instance.'
      ])
      expect(mocks.asked[0]?.spec.details?.[0]?.items).toEqual(['Studio'])
      expect(performQuit).toHaveBeenCalledTimes(1)
    })

    it('does not count it as windowless while its window is open', async () => {
      const entry = makeEntry(makeWindow())
      entry.installationId = 'studio'
      entry.sourceCategory = 'local'
      entry.titleBarText = 'Studio'
      comfyWindows.set(entry.windowKey, entry)
      indexInstallationId('studio', entry.windowKey)

      await confirmAndCloseAllHostWindows(null, vi.fn())
      dropInstallationIndex('studio')

      expect(mocks.asked[0]?.spec.details?.[0]?.items).toEqual(['Studio'])
    })
  })
})

describe('returning to the dashboard from a running ComfyUI', () => {
  function openRunningComfy(): ComfyWindowEntry {
    _runningSessions.set('studio', { port: 8188, mode: 'window' } as SessionInfo)
    const entry = makeEntry(makeWindow())
    entry.installationId = 'studio'
    entry.sourceCategory = 'local'
    entry.detachInstall = vi.fn()
    comfyWindows.set(entry.windowKey, entry)
    return entry
  }

  beforeEach(() => {
    mocks.asked = []
    mocks.agrees = false
  })

  it('asks first when the window has no panel to ask, and Cancel keeps it, with keepComfyRunningWhenWindowCloses off', async () => {
    mocks.keepComfyRunning = false
    const entry = openRunningComfy()

    await returnToDashboard(entry.windowKey)

    expect(mocks.asked.map((asked) => asked.spec.message)).toEqual([
      'This will stop the current ComfyUI.'
    ])
    expect(entry.detachInstall).not.toHaveBeenCalled()
  })

  it('leaves it running and does not ask with keepComfyRunningWhenWindowCloses absent', async () => {
    const entry = openRunningComfy()

    await returnToDashboard(entry.windowKey)

    expect(mocks.asked).toEqual([])
    expect(entry.detachInstall).toHaveBeenCalledTimes(1)
  })
})
