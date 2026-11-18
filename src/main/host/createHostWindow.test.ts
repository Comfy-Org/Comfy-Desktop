import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import type * as SettingsModule from '../settings'

const mocks = vi.hoisted(() => ({
  appsBuildRunning: false,
  stopAppsBuilds: vi.fn(async () => {}),
  keepComfyRunning: undefined as boolean | undefined,
  cursor: { x: 0, y: 0 },
  displays: [] as Electron.Rectangle[]
}))

vi.mock('electron', () => {
  const span = (a0: number, a1: number, b0: number, b1: number): number =>
    Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
  const overlap = (a: Electron.Rectangle, b: Electron.Rectangle): number =>
    span(a.x, a.x + a.width, b.x, b.x + b.width) * span(a.y, a.y + a.height, b.y, b.y + b.height)
  const displayAt = (point: Electron.Point) =>
    mocks.displays.find((d) => overlap(d, { ...point, width: 1, height: 1 }) > 0) ??
    mocks.displays[0]
  const largestOverlap = (rect: Electron.Rectangle): Electron.Rectangle =>
    mocks.displays.reduce((best, d) => (overlap(d, rect) > overlap(best, rect) ? d : best))
  return {
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
    nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
    screen: {
      getCursorScreenPoint: () => mocks.cursor,
      getDisplayNearestPoint: (point: Electron.Point) => ({ workArea: displayAt(point) }),
      getDisplayMatching: (rect: Electron.Rectangle) => ({ workArea: largestOverlap(rect) })
    }
  }
})

vi.mock('../lib/windowState', () => ({
  getSavedBounds: () => undefined,
  getWindowOptions: vi.fn(),
  saveWindowBounds: vi.fn()
}))

vi.mock('../apps/localComfy', () => ({
  hasBuildsRunningForAppsOnly: () => mocks.appsBuildRunning,
  stopEveryBuildRunningForAppsOnly: () => mocks.stopAppsBuilds()
}))
vi.mock('../settings', async (importOriginal) => {
  const actual = await importOriginal<typeof SettingsModule>()
  return {
    ...actual,
    get: (key: string) =>
      key === 'confirmBeforeClosingWindow'
        ? true
        : key === 'keepComfyRunningWhenWindowCloses'
          ? mocks.keepComfyRunning
          : actual.get(key)
  }
})

import type { InstallationRecord } from '../installations'
import { _beginLaunch, _endLaunch, _runningSessions, type SessionInfo } from '../lib/ipc/shared'
import { comfyWindows, nextWindowKey, type ComfyWindowEntry } from './registry'
import {
  buildFirebaseAuthForwardedError,
  cascadeOffsetForCollisions,
  closeQuitsDesktop,
  closeStopsLocalComfy,
  desktopStaysWithoutWindows,
  confirmHostWindowClose,
  type CloseConsultResult,
  type CloseWindowChoice,
  expectedPartitionFor,
  installCloseNeedsConfirm,
  isWindowLayoutable,
  placeHostWindow,
  shouldBailAfterCloseChoice,
  shouldBailAfterConsult,
  quitsOnceEveryWindowClosed,
  shouldShowInstallCloseConfirm
} from './createHostWindow'

describe('buildFirebaseAuthForwardedError', () => {
  it.each([
    ['desktop_login_code', 'firebase-desktop-login-code-failed'],
    ['loopback_bridge', 'firebase-loopback-bridge-failed']
  ] as const)('labels the %s flow without forwarding raw error text', (flow, source) => {
    const forwarded = buildFirebaseAuthForwardedError({
      provider: 'google.com',
      error_class: 'DesktopLoginCodeError',
      error_bucket: 'other',
      flow,
      retried_poll_errors: 2
    })

    expect(forwarded).toEqual({
      source,
      message: 'Firebase sign-in failed',
      level: 'warn',
      context: {
        origin: 'main-process',
        provider: 'google.com',
        error_class: 'DesktopLoginCodeError',
        error_bucket: 'other',
        flow,
        retried_poll_errors: 2
      }
    })
    expect(forwarded.context).not.toHaveProperty('error')
  })
})

function makeInstallation(overrides: Partial<InstallationRecord> = {}): InstallationRecord {
  return {
    id: 'inst-test',
    name: 'Test Install',
    sourceId: 'standalone',
    installPath: '/tmp/test',
    state: 'ready',
    ...overrides
  } as unknown as InstallationRecord
}

describe('expectedPartitionFor', () => {
  it('returns persist:shared by default', () => {
    expect(expectedPartitionFor(makeInstallation())).toBe('persist:shared')
  })

  it('returns a per-install bucket when browserPartition is "unique"', () => {
    const inst = makeInstallation({ id: 'abc-123' } as Partial<InstallationRecord>)
    ;(inst as unknown as { browserPartition: string }).browserPartition = 'unique'
    expect(expectedPartitionFor(inst)).toBe('persist:abc-123')
  })

  it('still returns persist:shared when browserPartition is set to a non-"unique" value', () => {
    const inst = makeInstallation()
    ;(inst as unknown as { browserPartition: string }).browserPartition = 'shared'
    expect(expectedPartitionFor(inst)).toBe('persist:shared')
  })

  it('encodes the install id verbatim — no escaping or normalisation', () => {
    const inst = makeInstallation({ id: 'with spaces & symbols' } as Partial<InstallationRecord>)
    ;(inst as unknown as { browserPartition: string }).browserPartition = 'unique'
    expect(expectedPartitionFor(inst)).toBe('persist:with spaces & symbols')
  })
})

describe('cascadeOffsetForCollisions', () => {
  it('returns the input unchanged when no x/y is set (centered window)', () => {
    const opts = { width: 1280, height: 900 }
    expect(cascadeOffsetForCollisions(opts, [{ x: 100, y: 100 }])).toEqual(opts)
  })

  it('returns the input unchanged when no existing windows collide', () => {
    const opts = { x: 200, y: 300, width: 1280, height: 900 }
    expect(cascadeOffsetForCollisions(opts, [{ x: 999, y: 999 }])).toEqual(opts)
  })

  it('offsets by 30px when one existing window matches the origin', () => {
    const opts = { x: 100, y: 100, width: 1280, height: 900 }
    expect(cascadeOffsetForCollisions(opts, [{ x: 100, y: 100 }])).toEqual({
      x: 130,
      y: 130,
      width: 1280,
      height: 900
    })
  })

  it('cascades past chains of pre-cascaded windows', () => {
    const opts = { x: 100, y: 100, width: 1280, height: 900 }
    const existing = [
      { x: 100, y: 100 },
      { x: 130, y: 130 },
      { x: 160, y: 160 }
    ]
    expect(cascadeOffsetForCollisions(opts, existing)).toEqual({
      x: 190,
      y: 190,
      width: 1280,
      height: 900
    })
  })

  it('skips destroyed/empty origin lists cleanly', () => {
    const opts = { x: 50, y: 50, width: 800, height: 600 }
    expect(cascadeOffsetForCollisions(opts, [])).toEqual(opts)
  })
})

describe('placeHostWindow', () => {
  const laptop = { x: 0, y: 33, width: 1512, height: 889 }

  it('waits to maximize a hidden window on a small screen until the window is revealed', () => {
    mocks.displays = [laptop]
    mocks.cursor = { x: 100, y: 100 }
    expect(placeHostWindow('inst-new', true, null, [])).toMatchObject({
      maximizeNow: false,
      maximizeOnReveal: true
    })
  })

  it('maximizes a window that is shown as it is built on a small screen right away', () => {
    mocks.displays = [laptop]
    mocks.cursor = { x: 100, y: 100 }
    expect(placeHostWindow('inst-new', false, null, [])).toMatchObject({
      maximizeNow: true,
      maximizeOnReveal: false
    })
  })
})

describe('shouldBailAfterConsult', () => {
  it('bails when the renderer aborted and no force-close override is set', () => {
    expect(shouldBailAfterConsult('aborted', false)).toBe(true)
  })

  it('does not bail when the renderer aborted but the caller pre-cleared the close', () => {
    expect(shouldBailAfterConsult('aborted', true)).toBe(false)
  })

  it('does not bail when the renderer cleared (no overlay / user confirmed)', () => {
    expect(shouldBailAfterConsult('cleared', false)).toBe(false)
    expect(shouldBailAfterConsult('cleared', true)).toBe(false)
  })

  it('does not bail when the renderer deferred — main owns the close-confirm', () => {
    expect(shouldBailAfterConsult('defer', false)).toBe(false)
    expect(shouldBailAfterConsult('defer', true)).toBe(false)
  })
})

describe('installCloseNeedsConfirm', () => {
  it('confirms when enabled and the close kills a local session or is the last install window', () => {
    expect(installCloseNeedsConfirm(true, true, false)).toBe(true)
    expect(installCloseNeedsConfirm(true, false, true)).toBe(true)
  })

  it('skips when the confirm preference is off, regardless of kill/last-window state', () => {
    expect(installCloseNeedsConfirm(false, true, true)).toBe(false)
  })

  it('skips when nothing is at risk (non-last, no local session)', () => {
    expect(installCloseNeedsConfirm(true, false, false)).toBe(false)
  })
})

describe('shouldShowInstallCloseConfirm', () => {
  it('shows the modal for a host that would kill a local session on a defer consult', () => {
    expect(shouldShowInstallCloseConfirm(true, 'defer', true, false, false)).toBe(true)
  })

  it('shows the modal for the last install window even with no local session at risk (closing quits)', () => {
    expect(shouldShowInstallCloseConfirm(true, 'defer', false, false, true)).toBe(true)
  })

  it('skips the modal when the confirm preference is off, even for a last install window killing a local session', () => {
    expect(shouldShowInstallCloseConfirm(false, 'defer', true, false, true)).toBe(false)
    expect(shouldShowInstallCloseConfirm(false, 'defer', false, false, true)).toBe(false)
  })

  it('skips the modal when the caller pre-cleared the close', () => {
    expect(shouldShowInstallCloseConfirm(true, 'defer', true, true, true)).toBe(false)
  })

  it('skips the modal for a non-last cloud/remote-backed host (no local session at risk)', () => {
    expect(shouldShowInstallCloseConfirm(true, 'defer', false, false, false)).toBe(false)
  })

  it('skips the modal on a cleared or aborted consult', () => {
    expect(shouldShowInstallCloseConfirm(true, 'cleared', true, false, true)).toBe(false)
    expect(shouldShowInstallCloseConfirm(true, 'aborted', true, false, true)).toBe(false)
  })
})

describe('isWindowLayoutable', () => {
  it('is true for a live, non-minimized window', () => {
    expect(isWindowLayoutable({ isDestroyed: () => false, isMinimized: () => false })).toBe(true)
  })

  it('is false while minimized — minimized windows report a bogus content size, so laying out collapses the child views', () => {
    expect(isWindowLayoutable({ isDestroyed: () => false, isMinimized: () => true })).toBe(false)
  })

  it('is false for a destroyed window', () => {
    expect(isWindowLayoutable({ isDestroyed: () => true, isMinimized: () => false })).toBe(false)
  })

  it('is false for a destroyed window even if it never reports minimized', () => {
    expect(isWindowLayoutable({ isDestroyed: () => true, isMinimized: () => true })).toBe(false)
  })
})

describe('shouldBailAfterCloseChoice', () => {
  it('bails when the user cancelled the close-confirm modal', () => {
    expect(shouldBailAfterCloseChoice('cancel', false)).toBe(true)
  })

  it('does not bail when the user chose to close', () => {
    expect(shouldBailAfterCloseChoice('close', false)).toBe(false)
  })

  it('does not bail when a force-close lands mid-modal even on user cancel', () => {
    expect(shouldBailAfterCloseChoice('cancel', true)).toBe(false)
  })
})

describe('confirmHostWindowClose', () => {
  interface FakeWindow {
    destroyed: boolean
    isDestroyed: () => boolean
  }

  function openDashboard(installationId: string | null = null): {
    win: FakeWindow
    entry: ComfyWindowEntry
  } {
    const win: FakeWindow = { destroyed: false, isDestroyed: () => win.destroyed }
    const entry = {
      windowKey: nextWindowKey(),
      window: win,
      panelView: null,
      lastTheme: { bg: '#000', text: '#fff' },
      installationId,
      sourceCategory: installationId === null ? null : 'local'
    } as unknown as ComfyWindowEntry
    comfyWindows.set(entry.windowKey, entry)
    return { win, entry }
  }

  const realPlatform = process.platform

  function onPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  }

  function comfyRunning(): void {
    _runningSessions.set('studio', { port: 8188, mode: 'window' } as SessionInfo)
  }

  function comfyStarting(): void {
    const launch = _beginLaunch('studio')
    onTestFinished(() => _endLaunch('studio', launch))
  }

  function closeEffects(answer: CloseWindowChoice = 'close'): {
    asked: { quitsDesktop: boolean; stopsLocalComfy: boolean }[]
    fx: Parameters<typeof confirmHostWindowClose>[2]
    consults: ((result: CloseConsultResult) => void)[]
  } {
    const consults: ((result: CloseConsultResult) => void)[] = []
    const asked: { quitsDesktop: boolean; stopsLocalComfy: boolean }[] = []
    const fx = {
      preClearedClose: new WeakSet<Electron.BrowserWindow>(),
      consultPanelRendererClose: () =>
        new Promise<CloseConsultResult>((resolve) => consults.push(resolve)),
      confirmCloseInstanceWindow: async (
        _window: Electron.BrowserWindow,
        quitsDesktop: boolean,
        stopsLocalComfy: boolean
      ): Promise<CloseWindowChoice> => {
        asked.push({ quitsDesktop, stopsLocalComfy })
        return answer
      }
    }
    return { asked, fx, consults }
  }

  async function closeBothWindows({
    fx,
    consults
  }: ReturnType<typeof closeEffects>): Promise<void> {
    const first = openDashboard()
    const second = openDashboard()

    const closingFirst = confirmHostWindowClose(
      first.win as unknown as Electron.BrowserWindow,
      first.entry.windowKey,
      fx
    )
    const closingSecond = confirmHostWindowClose(
      second.win as unknown as Electron.BrowserWindow,
      second.entry.windowKey,
      fx
    )
    consults[0]?.('defer')
    expect(await closingFirst).toBe(true)
    first.win.destroyed = true
    consults[1]?.('defer')

    expect(await closingSecond).toBe(true)
  }

  afterEach(() => {
    comfyWindows.clear()
    _runningSessions.clear()
    onPlatform(realPlatform)
    mocks.appsBuildRunning = false
    mocks.keepComfyRunning = undefined
    mocks.stopAppsBuilds.mockClear()
  })

  beforeEach(() => {
    mocks.keepComfyRunning = false
  })

  it('asks before the last window closes when another window closed while this one was being checked', async () => {
    mocks.appsBuildRunning = true
    const effects = closeEffects()

    await closeBothWindows(effects)

    expect(effects.asked).toEqual([{ quitsDesktop: true, stopsLocalComfy: true }])
    expect(mocks.stopAppsBuilds).toHaveBeenCalledTimes(1)
  })

  it('with keepComfyRunningWhenWindowCloses off, asks before the last ComfyUI window on macOS closes', async () => {
    onPlatform('darwin')
    comfyRunning()
    const only = openDashboard('studio')
    const { asked, fx, consults } = closeEffects()

    const closing = confirmHostWindowClose(
      only.win as unknown as Electron.BrowserWindow,
      only.entry.windowKey,
      fx
    )
    consults[0]?.('defer')

    expect(await closing).toBe(true)
    expect(asked).toEqual([{ quitsDesktop: true, stopsLocalComfy: true }])
    expect(mocks.stopAppsBuilds).toHaveBeenCalledTimes(1)
  })

  describe('with keepComfyRunningWhenWindowCloses absent, so on by default', () => {
    beforeEach(() => {
      mocks.keepComfyRunning = undefined
    })

    it('asks before the last window closes when another window closed while this one was being checked', async () => {
      onPlatform('win32')
      comfyRunning()
      const effects = closeEffects()

      await closeBothWindows(effects)

      expect(effects.asked).toEqual([{ quitsDesktop: true, stopsLocalComfy: true }])
      expect(mocks.stopAppsBuilds).not.toHaveBeenCalled()
    })

    it('closes the last ComfyUI window on macOS without asking, since ComfyUI keeps running', async () => {
      onPlatform('darwin')
      comfyRunning()
      const only = openDashboard('studio')
      const { asked, fx, consults } = closeEffects()

      const closing = confirmHostWindowClose(
        only.win as unknown as Electron.BrowserWindow,
        only.entry.windowKey,
        fx
      )
      consults[0]?.('defer')

      expect(await closing).toBe(true)
      expect(asked).toEqual([])
    })

    it.each(['win32', 'linux'] as const)(
      'on %s, asks before the last window closes while its build starts, and keeps the window when declined',
      async (platform) => {
        onPlatform(platform)
        comfyStarting()
        const only = openDashboard()
        const { asked, fx, consults } = closeEffects('cancel')

        const closing = confirmHostWindowClose(
          only.win as unknown as Electron.BrowserWindow,
          only.entry.windowKey,
          fx
        )
        consults[0]?.('defer')

        expect(await closing).toBe(false)
        expect(asked).toEqual([{ quitsDesktop: true, stopsLocalComfy: true }])
      }
    )

    it('closes the last window on macOS without asking while its build starts, since the start keeps going', async () => {
      onPlatform('darwin')
      comfyStarting()
      const only = openDashboard('studio')
      const { asked, fx, consults } = closeEffects()

      const closing = confirmHostWindowClose(
        only.win as unknown as Electron.BrowserWindow,
        only.entry.windowKey,
        fx
      )
      consults[0]?.('defer')

      expect(await closing).toBe(true)
      expect(asked).toEqual([])
    })
  })
})

describe('whether closing the last window quits Desktop', () => {
  const realPlatform = process.platform

  afterEach(() => {
    _runningSessions.clear()
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
  })

  it.each([
    ['darwin', 'nothing', true],
    ['darwin', 'running', false],
    ['darwin', 'starting', false],
    ['win32', 'starting', true],
    ['linux', 'running', true]
  ] as const)(
    'on %s with a local ComfyUI %s, the close confirmation and the last-window quit agree: quits %s',
    (platform, comfy, quits) => {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true })
      if (comfy === 'running') {
        _runningSessions.set('studio', { port: 8188, mode: 'window' } as SessionInfo)
      }
      if (comfy === 'starting') {
        const launch = _beginLaunch('studio')
        onTestFinished(() => _endLaunch('studio', launch))
      }

      expect(closeQuitsDesktop(true)).toBe(quits)
      expect(quitsOnceEveryWindowClosed()).toBe(quits)
      expect(desktopStaysWithoutWindows()).toBe(!quits)
    }
  )
})

describe('closeStopsLocalComfy', () => {
  const realPlatform = process.platform
  const localWindow = {
    installationId: 'studio',
    sourceCategory: 'local'
  } as unknown as ComfyWindowEntry

  afterEach(() => {
    _runningSessions.clear()
    mocks.appsBuildRunning = false
    mocks.keepComfyRunning = undefined
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
  })

  beforeEach(() => {
    mocks.keepComfyRunning = false
  })

  it.each([
    ['darwin', true],
    ['darwin', false],
    ['win32', false]
  ] as const)(
    'with keepComfyRunningWhenWindowCloses off, on %s, says closing a local ComfyUI window stops it (last window %s)',
    (platform, isLastWindow) => {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true })

      expect(closeStopsLocalComfy(localWindow, isLastWindow)).toBe(true)
    }
  )

  it('says closing the last window stops a ComfyUI an app started, and not otherwise', () => {
    mocks.appsBuildRunning = true

    expect(closeStopsLocalComfy(null, true)).toBe(true)
    expect(closeStopsLocalComfy(null, false)).toBe(false)
  })

  describe('with keepComfyRunningWhenWindowCloses absent, so on by default', () => {
    beforeEach(() => {
      mocks.keepComfyRunning = undefined
    })

    it.each([
      ['win32', true, true, true],
      ['linux', true, true, true],
      ['win32', false, true, false],
      ['win32', true, false, false],
      ['darwin', true, true, false]
    ] as const)(
      'on %s, with the last window closing %s and ComfyUI running %s, says %s',
      (platform, isLastWindow, running, stops) => {
        Object.defineProperty(process, 'platform', { value: platform, configurable: true })
        if (running) _runningSessions.set('studio', { port: 8188, mode: 'window' } as SessionInfo)

        expect(closeStopsLocalComfy(localWindow, isLastWindow)).toBe(stops)
      }
    )

    it('does not count a cloud session as a ComfyUI on this computer', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      _runningSessions.set('cloud', {
        port: 0,
        url: 'https://cloud.comfy.org',
        mode: 'window'
      } as SessionInfo)

      expect(closeStopsLocalComfy(null, true)).toBe(false)
    })

    it.each(['cloud', 'remote'])(
      'does not count a %s connection still starting as a ComfyUI on this computer',
      (connection) => {
        const launch = _beginLaunch(connection, { local: false })
        onTestFinished(() => _endLaunch(connection, launch))

        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
        expect(closeStopsLocalComfy(null, true)).toBe(false)

        Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
        expect(desktopStaysWithoutWindows()).toBe(false)
        expect(quitsOnceEveryWindowClosed()).toBe(true)
      }
    )
  })
})

describe('quitsOnceEveryWindowClosed', () => {
  const realPlatform = process.platform

  afterEach(() => {
    _runningSessions.clear()
    mocks.keepComfyRunning = undefined
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
  })

  beforeEach(() => {
    mocks.keepComfyRunning = false
  })

  it.each(['darwin', 'win32', 'linux'] as const)(
    'on %s, with keepComfyRunningWhenWindowCloses off, quits only when no ComfyUI runs',
    (platform) => {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true })
      expect(quitsOnceEveryWindowClosed()).toBe(true)

      _runningSessions.set('studio', { port: 8188, mode: 'window' } as SessionInfo)

      expect(quitsOnceEveryWindowClosed()).toBe(false)
    }
  )

  describe('with keepComfyRunningWhenWindowCloses absent, so on by default', () => {
    beforeEach(() => {
      mocks.keepComfyRunning = undefined
      _runningSessions.set('studio', { port: 8188, mode: 'window' } as SessionInfo)
    })

    it.each(['win32', 'linux'] as const)('on %s, quits with ComfyUI running', (platform) => {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true })

      expect(quitsOnceEveryWindowClosed()).toBe(true)
    })

    it('on macOS, stays open while ComfyUI runs', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

      expect(quitsOnceEveryWindowClosed()).toBe(false)
    })
  })
})
