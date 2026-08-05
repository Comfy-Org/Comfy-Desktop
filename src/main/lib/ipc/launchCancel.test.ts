import { afterEach, describe, expect, it, vi } from 'vitest'

// Stub the electron surface ./shared touches so the test needs no runtime.
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

import {
  _beginLaunch,
  _endLaunch,
  _hasActiveLaunch,
  _operationAborts,
  cancelAll,
  cancelLaunching,
  _test_addRunningSession,
  _test_clearRunningSessions
} from './shared'

const INSTALL = 'install-under-test'

afterEach(() => {
  // Drain shared state so cases stay independent. Each test ends the
  // launches it begins (ownership-guarded), so only these two can leak.
  _operationAborts.delete(INSTALL)
  _test_clearRunningSessions()
  expect(_hasActiveLaunch(INSTALL)).toBe(false)
})

describe('cancelAll', () => {
  it('flushes running-session telemetry synchronously before process teardown', () => {
    const flushTelemetry = vi.fn()
    _test_addRunningSession(INSTALL, 'install-under-test-name', flushTelemetry)

    cancelAll()

    expect(flushTelemetry).toHaveBeenCalledOnce()
  })
})

describe('launch tracking (_beginLaunch/_endLaunch/_hasActiveLaunch)', () => {
  it('tracks a launch from begin to end', () => {
    expect(_hasActiveLaunch(INSTALL)).toBe(false)
    const launch = _beginLaunch(INSTALL)
    expect(_hasActiveLaunch(INSTALL)).toBe(true)
    _endLaunch(INSTALL, launch)
    expect(_hasActiveLaunch(INSTALL)).toBe(false)
  })

  it('is idempotent: a second end is a no-op', () => {
    const launch = _beginLaunch(INSTALL)
    _endLaunch(INSTALL, launch)
    _endLaunch(INSTALL, launch)
    expect(_hasActiveLaunch(INSTALL)).toBe(false)
  })

  it('a stale end cannot remove a newer launch (generation safety)', () => {
    const stale = _beginLaunch(INSTALL)
    _endLaunch(INSTALL, stale)
    const fresh = _beginLaunch(INSTALL)
    // A leftover cleanup path from the stale generation fires late:
    _endLaunch(INSTALL, stale)
    expect(_hasActiveLaunch(INSTALL)).toBe(true)
    _endLaunch(INSTALL, fresh)
    expect(_hasActiveLaunch(INSTALL)).toBe(false)
  })
})

describe('cancelLaunching', () => {
  it('returns false when no launch is in flight', async () => {
    await expect(cancelLaunching(INSTALL)).resolves.toBe(false)
  })

  it('returns false for a registered (running) session - restart owns that via stopRunning', async () => {
    const launch = _beginLaunch(INSTALL)
    _test_addRunningSession(INSTALL, 'install-under-test-name')
    try {
      await expect(cancelLaunching(INSTALL)).resolves.toBe(false)
      expect(launch.abort.signal.aborted).toBe(false)
    } finally {
      _test_clearRunningSessions()
      _endLaunch(INSTALL, launch)
    }
  })

  it('never aborts a non-launch operation holding the _operationAborts slot', async () => {
    const otherOp = new AbortController()
    _operationAborts.set(INSTALL, otherOp)
    try {
      await expect(cancelLaunching(INSTALL)).resolves.toBe(false)
      expect(otherOp.signal.aborted).toBe(false)
    } finally {
      _operationAborts.delete(INSTALL)
    }
  })

  it('aborts an in-flight launch and resolves true once it settles', async () => {
    const launch = _beginLaunch(INSTALL)
    // Simulate the handler: unwind (endLaunch) only after the abort fires.
    launch.abort.signal.addEventListener(
      'abort',
      () => {
        setTimeout(() => _endLaunch(INSTALL, launch), 10)
      },
      { once: true }
    )

    await expect(cancelLaunching(INSTALL)).resolves.toBe(true)
    expect(launch.abort.signal.aborted).toBe(true)
    expect(_hasActiveLaunch(INSTALL)).toBe(false)
  })

  it('cancels a pre-marker launch: no launching marker, no _operationAborts entry needed', async () => {
    // The regression: before the launch claims _operationAborts or sets the
    // launching marker, cancelLaunching must still find and abort it.
    const launch = _beginLaunch(INSTALL)
    expect(_operationAborts.has(INSTALL)).toBe(false)
    launch.abort.signal.addEventListener('abort', () => _endLaunch(INSTALL, launch), { once: true })
    await expect(cancelLaunching(INSTALL)).resolves.toBe(true)
  })

  it('times out when the cancelled launch never settles', async () => {
    const launch = _beginLaunch(INSTALL)
    try {
      await expect(cancelLaunching(INSTALL, 100)).rejects.toThrow(/Timed out/)
    } finally {
      _endLaunch(INSTALL, launch)
    }
  })
})
