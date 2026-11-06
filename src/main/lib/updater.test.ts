import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as UpdaterModule from './updater'

let mockPlatform = 'linux'
let mockAppImage: string | undefined
let mockIsPackaged = true
let mockExePath = '/opt/Comfy Desktop/comfyui-desktop-2'
let mockAppVersion = '1.0.0'

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mockIsPackaged
    },
    getPath: (name: string) => {
      if (name === 'exe') return mockExePath
      return ''
    },
    getVersion: () => mockAppVersion,
    releaseSingleInstanceLock: vi.fn()
  },
  ipcMain: {
    handle: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

vi.mock('@todesktop/runtime', () => ({
  default: { autoUpdater: null }
}))

vi.mock('electron-updater', () => ({
  autoUpdater: { autoInstallOnAppQuit: true }
}))

vi.mock('../settings', () => ({
  get: vi.fn(),
  set: vi.fn()
}))

vi.mock('./quit-state', () => ({
  clearQuitReason: vi.fn(),
  setQuitReason: vi.fn(),
  getQuitReason: vi.fn(() => 'none'),
  isSessionEnding: vi.fn(() => false)
}))

let sidecarMarker: {
  version: string
  attemptedAt: string
  attemptId?: string
  reportedOutcome?: string
} | null = null
let sidecarPersists = true
let sidecarReadable = true
let sidecarClears = true

vi.mock('./startup-attempt-marker', () => ({
  readStartupAttemptMarker: vi.fn(() => {
    if (!sidecarReadable) return { state: 'unavailable' }
    return sidecarMarker ? { state: 'present', marker: sidecarMarker } : { state: 'absent' }
  }),
  recordStartupAttempt: vi.fn((version: string, attemptId?: string) => {
    if (!sidecarPersists) return false
    sidecarMarker = { version, attemptedAt: new Date().toISOString(), attemptId }
    return true
  }),
  recordStartupAttemptOutcome: vi.fn(
    (
      marker: { version: string; attemptedAt: string; attemptId?: string },
      reportedOutcome: string
    ) => {
      sidecarMarker = { ...marker, reportedOutcome }
    }
  ),
  clearStartupAttemptMarker: vi.fn(() => {
    if (sidecarClears) sidecarMarker = null
  })
}))

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

async function bootUpdater(): Promise<typeof UpdaterModule> {
  const mod = await import('./updater')
  mod.register()
  return mod
}

describe('isSystemPackageInstall (via get-update-capabilities)', { timeout: 30_000 }, () => {
  let registeredHandlers: Record<string, (...args: unknown[]) => unknown>

  beforeEach(async () => {
    registeredHandlers = {}
    const { ipcMain } = await import('electron')
    vi.mocked(ipcMain.handle).mockImplementation(((
      channel: string,
      handler: (...args: unknown[]) => unknown
    ) => {
      registeredHandlers[channel] = handler
    }) as typeof ipcMain.handle)

    mockPlatform = 'linux'
    mockAppImage = undefined
    mockIsPackaged = true
    mockExePath = '/opt/Comfy Desktop/comfyui-desktop-2'

    delete process.env.APPIMAGE
    Object.defineProperty(process, 'platform', { value: mockPlatform, configurable: true })

    vi.resetModules()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform)
  })

  async function getCapabilities(): Promise<{ canAutoUpdate: boolean; systemManaged: boolean }> {
    Object.defineProperty(process, 'platform', { value: mockPlatform, configurable: true })
    if (mockAppImage) {
      process.env.APPIMAGE = mockAppImage
    } else {
      delete process.env.APPIMAGE
    }

    vi.resetModules()
    await bootUpdater()
    const handler = registeredHandlers['get-update-capabilities']!
    return handler() as { canAutoUpdate: boolean; systemManaged: boolean }
  }

  it('detects .deb install under /opt/', async () => {
    mockExePath = '/opt/Comfy Desktop/comfyui-desktop-2'
    const caps = await getCapabilities()
    expect(caps).toEqual({ canAutoUpdate: false, systemManaged: true })
  })

  it('detects .deb install under /usr/', async () => {
    mockExePath = '/usr/lib/comfyui-desktop-2/comfyui-desktop-2'
    const caps = await getCapabilities()
    expect(caps).toEqual({ canAutoUpdate: false, systemManaged: true })
  })

  it('returns standard for AppImage (APPIMAGE env set)', async () => {
    mockAppImage = '/home/user/Comfy-Desktop.AppImage'
    const caps = await getCapabilities()
    expect(caps).toEqual({ canAutoUpdate: true, systemManaged: false })
  })

  it('returns standard for Windows', async () => {
    mockPlatform = 'win32'
    const caps = await getCapabilities()
    expect(caps).toEqual({ canAutoUpdate: true, systemManaged: false })
  })

  it('returns standard for macOS', async () => {
    mockPlatform = 'darwin'
    const caps = await getCapabilities()
    expect(caps).toEqual({ canAutoUpdate: true, systemManaged: false })
  })

  it('returns standard when not packaged (dev mode)', async () => {
    mockIsPackaged = false
    const caps = await getCapabilities()
    expect(caps).toEqual({ canAutoUpdate: true, systemManaged: false })
  })

  it('returns standard for Linux exe under /home/ (manual extract)', async () => {
    mockExePath = '/home/user/apps/comfyui-desktop-2'
    const caps = await getCapabilities()
    expect(caps).toEqual({ canAutoUpdate: true, systemManaged: false })
  })

  it('returns standard for Linux exe under /tmp/ (temp location)', async () => {
    mockExePath = '/tmp/.mount_comfyui/comfyui-desktop-2'
    const caps = await getCapabilities()
    expect(caps).toEqual({ canAutoUpdate: true, systemManaged: false })
  })
})

describe('app-update telemetry dedup (volume regression)', () => {
  let emitTelemetryMock: ReturnType<typeof vi.fn>
  let listeners: Record<string, Array<(...args: unknown[]) => void>>
  let fakeUpdater: { on: typeof vi.fn; checkForUpdates: ReturnType<typeof vi.fn> }
  let isAutoInstallOn: boolean

  beforeEach(async () => {
    vi.resetModules()
    listeners = {}
    emitTelemetryMock = vi.fn()
    isAutoInstallOn = true
    fakeUpdater = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners[event] = listeners[event] || []
        listeners[event].push(cb)
      }) as unknown as typeof vi.fn,
      checkForUpdates: vi.fn(async () => ({ updateInfo: { version: 'unused' } }))
    }
    vi.doMock('@todesktop/runtime', () => ({ default: { autoUpdater: fakeUpdater } }))
    vi.doMock('./telemetry', () => ({
      emit: emitTelemetryMock,
      bucketError: (s: string) => s,
      deriveAppChannel: () => 'stable'
    }))
    vi.doMock('../settings', () => ({
      get: vi.fn((key: string) => (key === 'autoInstallUpdates' ? isAutoInstallOn : undefined))
    }))
  })

  function fire(eventName: string, payload: unknown): void {
    for (const cb of listeners[eventName] || []) cb(payload)
  }

  it('emits comfy.desktop.app_update.available at most once per version (auto-on)', async () => {
    await bootUpdater()

    fire('update-available', { version: '9.9.9' })
    fire('update-available', { version: '9.9.9' })
    fire('update-available', { version: '9.9.9' })

    const availableEmits = emitTelemetryMock.mock.calls.filter(
      (c) => c[0] === 'comfy.desktop.app_update.available'
    )
    expect(availableEmits).toHaveLength(1)
    expect(availableEmits[0]?.[1]).toMatchObject({ version: '9.9.9', auto_update_setting: 'on' })
  })

  it('emits download_started at most once per version (auto-on)', async () => {
    await bootUpdater()

    fire('update-available', { version: '9.9.9' })
    fire('update-downloaded', { version: '9.9.9' })
    fire('update-available', { version: '9.9.9' })
    fire('update-available', { version: '9.9.9' })

    const downloadStartedEmits = emitTelemetryMock.mock.calls.filter(
      (c) => c[0] === 'comfy.desktop.app_update.download_started'
    )
    expect(downloadStartedEmits).toHaveLength(1)
  })

  it('emits download_complete at most once per version even if updater re-fires', async () => {
    await bootUpdater()

    fire('update-downloaded', { version: '9.9.9' })
    fire('update-downloaded', { version: '9.9.9' })
    fire('update-downloaded', { version: '9.9.9' })

    const completeEmits = emitTelemetryMock.mock.calls.filter(
      (c) => c[0] === 'comfy.desktop.app_update.download_complete'
    )
    expect(completeEmits).toHaveLength(1)
  })

  it('does NOT call checkForUpdates from inside update-available (no recursion)', async () => {
    await bootUpdater()

    fire('update-available', { version: '9.9.9' })
    fire('update-available', { version: '9.9.9' })

    expect(fakeUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('new version after old can fire again (dedup is per-version, not absolute)', async () => {
    await bootUpdater()

    fire('update-available', { version: '9.9.9' })
    fire('update-available', { version: '9.9.10' })
    fire('update-downloaded', { version: '9.9.9' })
    fire('update-downloaded', { version: '9.9.10' })

    const availableEmits = emitTelemetryMock.mock.calls.filter(
      (c) => c[0] === 'comfy.desktop.app_update.available'
    )
    const completeEmits = emitTelemetryMock.mock.calls.filter(
      (c) => c[0] === 'comfy.desktop.app_update.download_complete'
    )
    expect(availableEmits).toHaveLength(2)
    expect(completeEmits).toHaveLength(2)
  })

  it('checked event suppressed for auto-* triggers (no signal, only noise)', async () => {
    fakeUpdater.checkForUpdates = vi.fn(async () => ({ updateInfo: { version: '9.9.9' } }))
    const updater = await bootUpdater()

    await updater.runCheck('auto-check')

    const checkedEmits = emitTelemetryMock.mock.calls.filter(
      (c) => c[0] === 'comfy.desktop.app_update.checked'
    )
    expect(checkedEmits).toHaveLength(0)
  })

  it('checked event fires for manual-check trigger when an update is available', async () => {
    fakeUpdater.checkForUpdates = vi.fn(async () => ({ updateInfo: { version: '9.9.9' } }))
    const updater = await bootUpdater()

    await updater.runCheck('manual-check')

    const checkedEmits = emitTelemetryMock.mock.calls.filter(
      (c) => c[0] === 'comfy.desktop.app_update.checked'
    )
    expect(checkedEmits).toHaveLength(1)
    expect(checkedEmits[0]?.[1]).toMatchObject({ trigger: 'manual-check', result: 'available' })
  })
})

describe('app-update state during downloads', () => {
  let listeners: Record<string, Array<(...args: unknown[]) => void>>
  let fakeUpdater: { on: typeof vi.fn; checkForUpdates: ReturnType<typeof vi.fn> }
  let isAutoInstallOn: boolean

  beforeEach(async () => {
    vi.resetModules()
    listeners = {}
    isAutoInstallOn = true
    fakeUpdater = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners[event] = listeners[event] || []
        listeners[event].push(cb)
      }) as unknown as typeof vi.fn,
      checkForUpdates: vi.fn(async () => ({ updateInfo: { version: 'unused' } }))
    }
    vi.doMock('@todesktop/runtime', () => ({ default: { autoUpdater: fakeUpdater } }))
    vi.doMock('./telemetry', () => ({
      emit: vi.fn(),
      bucketError: (s: string) => s,
      deriveAppChannel: () => 'stable'
    }))
    vi.doMock('../settings', () => ({
      get: vi.fn((key: string) => (key === 'autoInstallUpdates' ? isAutoInstallOn : undefined)),
      set: vi.fn()
    }))
  })

  function fire(eventName: string, payload: unknown): void {
    for (const cb of listeners[eventName] || []) cb(payload)
  }

  it('an auto-on background download surfaces as downloading with its version', async () => {
    const updater = await bootUpdater()

    fire('update-available', { version: '9.9.9' })
    expect(updater.getCurrentUpdateState().kind).toBeNull()

    fire('download-progress', { percent: 3 })
    expect(updater.getCurrentUpdateState()).toEqual({
      kind: 'downloading',
      version: '9.9.9',
      autoUpdate: true
    })

    fire('update-downloaded', { version: '9.9.9' })
    expect(updater.getCurrentUpdateState().kind).toBe('ready')
  })

  it('a failed auto-on download returns to the silent idle state', async () => {
    const updater = await bootUpdater()

    fire('update-available', { version: '9.9.9' })
    fire('download-progress', { percent: 3 })
    expect(updater.getCurrentUpdateState().kind).toBe('downloading')

    fire('error', new Error('network blip'))
    expect(updater.getCurrentUpdateState()).toEqual({
      kind: null,
      version: null,
      autoUpdate: true
    })
  })

  it('a failed auto-off download rolls back to available so the user can retry', async () => {
    isAutoInstallOn = false
    const updater = await bootUpdater()

    fire('update-available', { version: '9.9.9' })
    expect(updater.getCurrentUpdateState().kind).toBe('available')

    fire('download-progress', { percent: 3 })
    expect(updater.getCurrentUpdateState()).toEqual({
      kind: 'downloading',
      version: '9.9.9',
      autoUpdate: false
    })

    fire('error', new Error('network blip'))
    expect(updater.getCurrentUpdateState()).toEqual({
      kind: 'available',
      version: '9.9.9',
      autoUpdate: false
    })
  })

  it('progress ticks never downgrade a ready state', async () => {
    const updater = await bootUpdater()

    fire('update-downloaded', { version: '9.9.9' })
    expect(updater.getCurrentUpdateState().kind).toBe('ready')

    fire('download-progress', { percent: 100 })
    expect(updater.getCurrentUpdateState().kind).toBe('ready')
  })
})

describe('startup update install + session-end guard (issue #1065)', () => {
  let settingsStore: Record<string, unknown>
  let listeners: Record<string, Array<(...args: unknown[]) => void>>
  let fakeUpdater: {
    on: ReturnType<typeof vi.fn>
    checkForUpdates: ReturnType<typeof vi.fn>
    restartAndInstall: ReturnType<typeof vi.fn>
  }
  let electronUpdaterMock: { autoInstallOnAppQuit: boolean }
  let emitMock: ReturnType<typeof vi.fn>
  let sessionEnding: boolean
  let readyVersion: string | null
  let quitReason: 'none' | 'user-quit' | 'update-install'

  const originalPlat = Object.getOwnPropertyDescriptor(process, 'platform')!

  beforeEach(() => {
    vi.resetModules()
    settingsStore = {}
    listeners = {}
    sessionEnding = false
    readyVersion = null
    quitReason = 'none'
    sidecarMarker = null
    sidecarPersists = true
    sidecarReadable = true
    sidecarClears = true
    mockAppVersion = '1.0.0'
    delete process.env.E2E
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

    fakeUpdater = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners[event] = listeners[event] || []
        listeners[event].push(cb)
      }) as ReturnType<typeof vi.fn>,
      checkForUpdates: vi.fn(async () => {
        if (readyVersion) {
          for (const cb of listeners['update-downloaded'] || []) cb({ version: readyVersion })
          return { updateInfo: { version: readyVersion } }
        }
        return { updateInfo: null }
      }),
      restartAndInstall: vi.fn()
    }
    electronUpdaterMock = { autoInstallOnAppQuit: true }
    emitMock = vi.fn()

    vi.doMock('@todesktop/runtime', () => ({ default: { autoUpdater: fakeUpdater } }))
    vi.doMock('electron-updater', () => ({ autoUpdater: electronUpdaterMock }))
    vi.doMock('./telemetry', () => ({
      emit: emitMock,
      bucketError: (s: string) => s,
      deriveAppChannel: () => 'stable'
    }))
    vi.doMock('./quit-state', () => ({
      clearQuitReason: vi.fn(),
      setQuitReason: vi.fn(),
      getQuitReason: vi.fn(() => quitReason),
      isSessionEnding: vi.fn(() => sessionEnding)
    }))
    vi.doMock('../settings', () => ({
      get: vi.fn((key: string) => settingsStore[key]),
      set: vi.fn((key: string, value: unknown) => {
        if (value === undefined) delete settingsStore[key]
        else settingsStore[key] = value
      })
    }))
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlat)
  })

  const findEmitCalls = (event: string): unknown[][] =>
    emitMock.mock.calls.filter((c) => c[0] === event)

  it('register() disables install-on-quit by default on Windows when startup install is enabled', async () => {
    await bootUpdater()
    expect(electronUpdaterMock.autoInstallOnAppQuit).toBe(false)
  })

  it('register() keeps install-on-quit when startup install is explicitly opted out', async () => {
    settingsStore['installUpdatesOnStartup'] = false
    await bootUpdater()
    expect(electronUpdaterMock.autoInstallOnAppQuit).toBe(true)
  })

  it('startup install is inert on non-Windows even when the flag is on', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    settingsStore['installUpdatesOnStartup'] = true
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    readyVersion = '1.0.1'
    const updater = await bootUpdater()
    expect(electronUpdaterMock.autoInstallOnAppQuit).toBe(true)
    expect(updater.hasPendingStartupUpdate()).toBe(false)
    expect(await updater.applyPendingUpdateOnStartup()).toBe(false)
    expect(fakeUpdater.restartAndInstall).not.toHaveBeenCalled()
  })

  it('suppressInstallOnQuit() disables install-on-quit for the session-end guard', async () => {
    settingsStore['installUpdatesOnStartup'] = false
    const updater = await bootUpdater()
    expect(electronUpdaterMock.autoInstallOnAppQuit).toBe(true)
    updater.suppressInstallOnQuit()
    expect(electronUpdaterMock.autoInstallOnAppQuit).toBe(false)
  })

  it('startup install is inert when opted out, even with a staged update', async () => {
    settingsStore['installUpdatesOnStartup'] = false
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    readyVersion = '1.0.1'
    const updater = await bootUpdater()
    expect(updater.hasPendingStartupUpdate()).toBe(false)
    expect(await updater.applyPendingUpdateOnStartup()).toBe(false)
    expect(fakeUpdater.restartAndInstall).not.toHaveBeenCalled()
  })

  it('register() disables install-on-quit when auto-install is off (opted out of startup install)', async () => {
    settingsStore['installUpdatesOnStartup'] = false
    settingsStore['autoInstallUpdates'] = false
    const updater = await import('./updater')
    updater.register()
    expect(electronUpdaterMock.autoInstallOnAppQuit).toBe(false)
  })

  it('startup install is inert when auto-install is off, even with a staged update on Windows', async () => {
    settingsStore['autoInstallUpdates'] = false
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    readyVersion = '1.0.1'
    const updater = await import('./updater')
    updater.register()
    expect(updater.hasPendingStartupUpdate()).toBe(false)
    expect(await updater.applyPendingUpdateOnStartup()).toBe(false)
    expect(fakeUpdater.restartAndInstall).not.toHaveBeenCalled()
    expect(findEmitCalls('comfy.desktop.app_update.startup_install_skipped')).toHaveLength(0)
  })

  it('installUpdate() (pill-confirm path) still installs when auto-install is off', async () => {
    settingsStore['autoInstallUpdates'] = false
    const updater = await import('./updater')
    updater.register()
    updater.installUpdate()
    expect(fakeUpdater.restartAndInstall).toHaveBeenCalled()
  })

  it('does not mislabel a later check failure as applying the staged update', async () => {
    await bootUpdater()
    for (const cb of listeners['update-downloaded'] || []) cb({ version: '1.0.1' })
    for (const cb of listeners.error || []) cb(new Error('release feed unavailable'))

    const errors = findEmitCalls('comfy.desktop.app_update.error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.[1]).toMatchObject({
      component: 'desktop_application',
      operation: 'check',
      stage: 'check',
      running_version: '1.0.0',
      target_version: null,
      updater_provider: 'todesktop',
      error_source: 'updater_event',
      setting_use_chinese_mirrors: false,
      error_message: 'release feed unavailable',
      user_initiated: false
    })
  })

  it('attributes an updater error after restartAndInstall to apply_restart', async () => {
    const updater = await bootUpdater()
    for (const cb of listeners['update-downloaded'] || []) cb({ version: '1.0.1' })
    updater.installUpdate()
    for (const cb of listeners.error || []) cb(new TypeError('installer apply failed'))

    const errors = findEmitCalls('comfy.desktop.app_update.error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.[1]).toMatchObject({
      operation: 'apply_restart',
      stage: 'install',
      target_version: '1.0.1',
      error_source: 'updater_event:install_call',
      error_class: 'TypeError',
      error_message: 'installer apply failed',
      user_initiated: true
    })
  })

  it('reports rejected periodic checks even without an updater error event', async () => {
    const updater = await bootUpdater()
    fakeUpdater.checkForUpdates.mockRejectedValueOnce(new Error('request timed out'))

    await expect(updater.runCheck('periodic')).rejects.toThrow('request timed out')

    const errors = findEmitCalls('comfy.desktop.app_update.error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.[1]).toMatchObject({
      operation: 'check',
      stage: 'check',
      target_version: null,
      error_source: 'periodic',
      error_message: 'request timed out',
      user_initiated: false
    })
  })

  it('transitions an automatic check error to download after update-available', async () => {
    const updater = await bootUpdater()
    const failure = new Error('download connection reset')
    fakeUpdater.checkForUpdates.mockImplementationOnce(async () => {
      for (const cb of listeners['update-available'] || []) cb({ version: '1.0.1' })
      for (const cb of listeners.error || []) cb(failure)
      throw failure
    })

    await expect(updater.runCheck('auto-check')).rejects.toThrow('download connection reset')

    const errors = findEmitCalls('comfy.desktop.app_update.error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.[1]).toMatchObject({
      operation: 'download',
      stage: 'download',
      target_version: '1.0.1',
      error_source: 'updater_event:auto-check',
      user_initiated: false
    })
  })

  it('attributes a promise-only automatic download rejection to download', async () => {
    const updater = await bootUpdater()
    fakeUpdater.checkForUpdates.mockImplementationOnce(async () => {
      for (const cb of listeners['update-available'] || []) cb({ version: '1.0.1' })
      throw new Error('download timed out')
    })

    await expect(updater.runCheck('auto-check')).rejects.toThrow('download timed out')

    const errors = findEmitCalls('comfy.desktop.app_update.error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.[1]).toMatchObject({
      operation: 'download',
      stage: 'download',
      target_version: '1.0.1',
      error_source: 'auto-check',
      user_initiated: false
    })
  })

  it('toggling auto-install re-arms / disarms install-on-quit without a restart', async () => {
    settingsStore['installUpdatesOnStartup'] = false
    const updater = await import('./updater')
    updater.register()
    expect(electronUpdaterMock.autoInstallOnAppQuit).toBe(true)

    settingsStore['autoInstallUpdates'] = false
    updater.notifyAutoUpdateChanged()
    expect(electronUpdaterMock.autoInstallOnAppQuit).toBe(false)

    settingsStore['autoInstallUpdates'] = true
    updater.notifyAutoUpdateChanged()
    expect(electronUpdaterMock.autoInstallOnAppQuit).toBe(true)
  })

  it('notifyAutoUpdateChanged() never re-arms install-on-quit after session-end suppression', async () => {
    settingsStore['installUpdatesOnStartup'] = false
    const updater = await import('./updater')
    updater.register()
    expect(electronUpdaterMock.autoInstallOnAppQuit).toBe(true)

    updater.suppressInstallOnQuit()
    expect(electronUpdaterMock.autoInstallOnAppQuit).toBe(false)

    settingsStore['autoInstallUpdates'] = false
    updater.notifyAutoUpdateChanged()
    settingsStore['autoInstallUpdates'] = true
    updater.notifyAutoUpdateChanged()
    expect(electronUpdaterMock.autoInstallOnAppQuit).toBe(false)
  })

  it('register() disables install-on-quit on macOS when auto-install is off', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    settingsStore['autoInstallUpdates'] = false
    const updater = await import('./updater')
    updater.register()
    expect(electronUpdaterMock.autoInstallOnAppQuit).toBe(false)
  })

  it('installUpdate() is a no-op while the OS session is ending', async () => {
    sessionEnding = true
    const updater = await bootUpdater()
    updater.installUpdate()
    expect(fakeUpdater.restartAndInstall).not.toHaveBeenCalled()
  })

  it('installUpdate() shows the NSIS installer UI by default on Windows', async () => {
    const updater = await bootUpdater()
    updater.installUpdate()
    expect(fakeUpdater.restartAndInstall).toHaveBeenCalledWith({ isSilent: false })
  })

  it('installUpdate() installs silently when showInstallerUI is opted out', async () => {
    settingsStore['showInstallerUI'] = false
    const updater = await bootUpdater()
    updater.installUpdate()
    expect(fakeUpdater.restartAndInstall).toHaveBeenCalledWith({ isSilent: true })
  })

  it('installUpdate() ignores showInstallerUI off Windows (isSilent stays true)', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    settingsStore['showInstallerUI'] = true
    const updater = await bootUpdater()
    updater.installUpdate()
    expect(fakeUpdater.restartAndInstall).toHaveBeenCalledWith({ isSilent: true })
  })

  it('hasPendingStartupUpdate() reflects the staged-update markers', async () => {
    const updater = await import('./updater')

    expect(updater.hasPendingStartupUpdate()).toBe(false)

    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    expect(updater.hasPendingStartupUpdate()).toBe(true)

    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.0'
    expect(updater.hasPendingStartupUpdate()).toBe(false)

    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    settingsStore['lastStartupUpdateAttemptVersion'] = '1.0.1'
    expect(updater.hasPendingStartupUpdate()).toBe(false)
  })

  it('applyPendingUpdateOnStartup() installs a staged update and records the attempt', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    readyVersion = '1.0.1'
    const updater = await bootUpdater()

    const installing = await updater.applyPendingUpdateOnStartup()

    expect(installing).toBe(true)
    expect(fakeUpdater.restartAndInstall).toHaveBeenCalledTimes(1)
    expect(settingsStore['lastStartupUpdateAttemptVersion']).toBe('1.0.1')
    const installs = findEmitCalls('comfy.desktop.app_update.startup_install')
    expect(installs).toHaveLength(1)
    expect(installs[0]?.[1]).toMatchObject({
      version: '1.0.1',
      bakFallbacks: expect.any(Number),
      update_attempt_id: expect.any(String)
    })
    expect(sidecarMarker?.attemptId).toBe(
      (installs[0]?.[1] as Record<string, unknown>).update_attempt_id
    )
  })

  it('correlates updater transitions with one privacy-safe attempt id and release context', async () => {
    await bootUpdater()
    for (const cb of listeners['update-available'] || []) cb({ version: '1.0.1' })
    for (const cb of listeners['update-downloaded'] || []) cb({ version: '1.0.1' })

    const available = findEmitCalls('comfy.desktop.app_update.available')[0]?.[1] as Record<
      string,
      unknown
    >
    const complete = findEmitCalls('comfy.desktop.app_update.download_complete')[0]?.[1]
    expect(available).toMatchObject({
      running_version: '1.0.0',
      target_version: '1.0.1',
      app_channel: 'stable',
      platform: 'win32',
      updater_provider: 'todesktop',
      updater_mode: 'packaged',
      update_attempt_id: expect.any(String)
    })
    expect(complete).toMatchObject({ update_attempt_id: available.update_attempt_id })
  })

  it('keeps one attempt id in memory when settings writes are declined', async () => {
    const settings = await import('../settings')
    vi.mocked(settings.set).mockImplementation(() => {})
    await bootUpdater()
    for (const cb of listeners['update-available'] || []) cb({ version: '1.0.1' })
    for (const cb of listeners['update-downloaded'] || []) cb({ version: '1.0.1' })

    const available = findEmitCalls('comfy.desktop.app_update.available')[0]?.[1] as Record<
      string,
      unknown
    >
    expect(findEmitCalls('comfy.desktop.app_update.download_complete')[0]?.[1]).toMatchObject({
      update_attempt_id: available.update_attempt_id
    })
  })

  it('records the accepted quit once with the final quit reason', async () => {
    const updater = await bootUpdater()
    for (const cb of listeners['update-downloaded'] || []) cb({ version: '1.0.1' })
    quitReason = 'user-quit'

    updater.recordProcessExit()
    updater.recordProcessExit()

    const exits = findEmitCalls('comfy.desktop.app_update.process_exit')
    expect(exits).toHaveLength(1)
    expect(exits[0]?.[1]).toMatchObject({
      target_version: '1.0.1',
      quit_reason: 'user-quit',
      download_in_progress: false,
      update_attempt_id: expect.any(String)
    })
  })

  it('emits the staged-update startup decision with marker and updater state', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    readyVersion = null
    const updater = await bootUpdater()
    vi.useFakeTimers()
    try {
      const pending = updater.applyPendingUpdateOnStartup()
      await vi.advanceTimersByTimeAsync(5100)
      await pending
    } finally {
      vi.useRealTimers()
    }
    expect(findEmitCalls('comfy.desktop.app_update.startup_decision')[0]?.[1]).toMatchObject({
      decision: 'install',
      reason: 'ready_check',
      pending_version: '1.0.1',
      updater_state: 'unknown',
      marker_state: 'absent',
      update_attempt_id: expect.any(String),
      bakFallbacks: expect.any(Number)
    })
  })

  it('reports a previous startup status once per launch', async () => {
    sidecarMarker = {
      version: '1.0.1',
      attemptedAt: new Date().toISOString(),
      attemptId: 'attempt-1'
    }
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    const updater = await bootUpdater()

    await updater.applyPendingUpdateOnStartup()
    await updater.applyPendingUpdateOnStartup()

    const outcomes = findEmitCalls('comfy.desktop.app_update.previous_attempt_outcome')
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]?.[1]).toMatchObject({
      update_attempt_id: 'attempt-1',
      target_version: '1.0.1',
      outcome: 'still_pending',
      bakFallbacks: expect.any(Number)
    })
    const correlatedEvents = [
      ...outcomes,
      ...findEmitCalls('comfy.desktop.app_update.startup_decision'),
      ...findEmitCalls('comfy.desktop.app_update.startup_install_skipped')
    ]
    expect(
      new Set(
        correlatedEvents.map((call) => (call[1] as Record<string, unknown>).update_attempt_id)
      )
    ).toEqual(new Set(['attempt-1']))
  })

  it('reports when an old-version relaunch lost its staged-update marker', async () => {
    sidecarMarker = {
      version: '1.0.1',
      attemptedAt: new Date().toISOString(),
      attemptId: 'attempt-rollback'
    }
    const updater = await bootUpdater()

    await updater.applyPendingUpdateOnStartup()

    expect(
      findEmitCalls('comfy.desktop.app_update.previous_attempt_outcome')[0]?.[1]
    ).toMatchObject({
      update_attempt_id: 'attempt-rollback',
      outcome: 'staged_marker_missing'
    })
  })

  it('reports installed after an earlier still-pending observation', async () => {
    sidecarMarker = {
      version: '1.0.1',
      attemptedAt: new Date().toISOString(),
      attemptId: 'attempt-recovered'
    }
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    settingsStore['pendingDesktopUpdateAttemptId'] = 'attempt-recovered'
    settingsStore['pendingDesktopUpdateAttemptVersion'] = '1.0.1'
    const updater = await bootUpdater()

    await updater.applyPendingUpdateOnStartup()
    mockAppVersion = '1.0.1'
    await updater.applyPendingUpdateOnStartup()

    const outcomes = findEmitCalls('comfy.desktop.app_update.previous_attempt_outcome')
    expect(outcomes.map((call) => (call[1] as Record<string, unknown>).outcome)).toEqual([
      'still_pending',
      'installed'
    ])
    expect(outcomes[1]?.[1]).toMatchObject({ update_attempt_id: 'attempt-recovered' })
    expect(settingsStore['pendingDesktopUpdateAttemptId']).toBeUndefined()
    expect(sidecarMarker).toBeNull()
  })

  it('does not repeat installed when marker deletion fails', async () => {
    sidecarMarker = {
      version: '1.0.1',
      attemptedAt: new Date().toISOString(),
      attemptId: 'attempt-installed'
    }
    sidecarClears = false
    mockAppVersion = '1.0.1'
    const updater = await bootUpdater()

    await updater.applyPendingUpdateOnStartup()
    await updater.applyPendingUpdateOnStartup()

    const outcomes = findEmitCalls('comfy.desktop.app_update.previous_attempt_outcome')
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]?.[1]).toMatchObject({
      update_attempt_id: 'attempt-installed',
      outcome: 'installed'
    })
    expect(sidecarMarker).toMatchObject({ reportedOutcome: 'installed' })
  })

  it('applyPendingUpdateOnStartup() holds the install after committing so the countdown plays out', async () => {
    vi.useFakeTimers()
    try {
      settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
      readyVersion = '1.0.1'
      const updater = await import('./updater')
      updater.register()

      const onInstallCommitted = vi.fn()
      const pending = updater.applyPendingUpdateOnStartup({ onInstallCommitted })

      await vi.advanceTimersByTimeAsync(4000)
      expect(onInstallCommitted).toHaveBeenCalledTimes(1)
      expect(fakeUpdater.restartAndInstall).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1200)
      expect(await pending).toBe(true)
      expect(fakeUpdater.restartAndInstall).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('applyPendingUpdateOnStartup() does nothing when no update is staged', async () => {
    const updater = await bootUpdater()
    expect(await updater.applyPendingUpdateOnStartup()).toBe(false)
    expect(fakeUpdater.restartAndInstall).not.toHaveBeenCalled()
  })

  it('applyPendingUpdateOnStartup() does not install when the check cannot confirm a ready update', async () => {
    vi.useFakeTimers()
    try {
      settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
      fakeUpdater.checkForUpdates = vi.fn(async () => ({ updateInfo: { version: '1.0.1' } }))
      const updater = await import('./updater')
      updater.register()
      const pending = updater.applyPendingUpdateOnStartup()
      await vi.advanceTimersByTimeAsync(5100)
      expect(await pending).toBe(false)
      expect(fakeUpdater.restartAndInstall).not.toHaveBeenCalled()
      const skipped = findEmitCalls('comfy.desktop.app_update.startup_install_skipped')
      expect(skipped[0]?.[1]).toMatchObject({ reason: 'not_ready', wait_outcome: 'timeout' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('loop-breaker: a previously-attempted version is not auto-retried', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    settingsStore['lastStartupUpdateAttemptVersion'] = '1.0.1'
    readyVersion = '1.0.1'
    const updater = await bootUpdater()
    expect(await updater.applyPendingUpdateOnStartup()).toBe(false)
    expect(fakeUpdater.restartAndInstall).not.toHaveBeenCalled()
  })

  it('emits startup_install_skipped with the loop_breaker reason', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    settingsStore['lastStartupUpdateAttemptVersion'] = '1.0.1'
    readyVersion = '1.0.1'
    const updater = await bootUpdater()
    await updater.applyPendingUpdateOnStartup()
    const skipped = findEmitCalls('comfy.desktop.app_update.startup_install_skipped')
    expect(skipped).toHaveLength(1)
    expect(skipped[0]?.[1]).toMatchObject({
      reason: 'loop_breaker',
      version: '1.0.1',
      source: 'settings',
      bakFallbacks: expect.any(Number)
    })
  })

  it('emits startup_install_skipped with not_ready when the check cannot confirm a ready update', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    readyVersion = null
    const updater = await bootUpdater()
    expect(await updater.applyPendingUpdateOnStartup()).toBe(false)
    const skipped = findEmitCalls('comfy.desktop.app_update.startup_install_skipped')
    expect(skipped).toHaveLength(1)
    expect(skipped[0]?.[1]).toMatchObject({
      reason: 'not_ready',
      version: '1.0.1',
      wait_outcome: 'check_failed',
      consecutive_not_ready: 1,
      abandoned: false
    })
    expect(settingsStore['pendingDownloadedUpdateVersion']).toBe('1.0.1')
    expect(settingsStore['startupInstallNotReadyVersion']).toBe('1.0.1')
    expect(settingsStore['startupInstallNotReadyCount']).toBe(1)
  })

  it('bails out fast when the staged installer is invalid and a re-download starts', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    fakeUpdater.checkForUpdates = vi.fn(async () => ({ updateInfo: { version: '1.0.1' } }))
    const updater = await bootUpdater()
    const pending = updater.applyPendingUpdateOnStartup()
    for (const cb of listeners['download-progress'] || []) cb({ percent: 1 })
    expect(await pending).toBe(false)
    expect(fakeUpdater.restartAndInstall).not.toHaveBeenCalled()
    expect(settingsStore['lastStartupUpdateAttemptVersion']).toBeUndefined()
    expect(settingsStore['pendingDownloadedUpdateVersion']).toBe('1.0.1')
    const skipped = findEmitCalls('comfy.desktop.app_update.startup_install_skipped')
    expect(skipped).toHaveLength(1)
    expect(skipped[0]?.[1]).toMatchObject({
      reason: 'not_ready',
      version: '1.0.1',
      wait_outcome: 'downloading',
      consecutive_not_ready: 1,
      abandoned: false
    })
  })

  it('abandons the staged version after repeated not-ready boots', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    readyVersion = null
    const updater = await bootUpdater()

    expect(await updater.applyPendingUpdateOnStartup()).toBe(false)
    expect(settingsStore['startupInstallNotReadyCount']).toBe(1)
    expect(settingsStore['pendingDownloadedUpdateVersion']).toBe('1.0.1')

    expect(await updater.applyPendingUpdateOnStartup()).toBe(false)
    expect(settingsStore['startupInstallNotReadyCount']).toBe(2)
    expect(settingsStore['pendingDownloadedUpdateVersion']).toBe('1.0.1')

    expect(await updater.applyPendingUpdateOnStartup()).toBe(false)
    expect(settingsStore['pendingDownloadedUpdateVersion']).toBeUndefined()
    expect(settingsStore['startupInstallNotReadyVersion']).toBeUndefined()
    expect(settingsStore['startupInstallNotReadyCount']).toBeUndefined()

    const skipped = findEmitCalls('comfy.desktop.app_update.startup_install_skipped')
    expect(skipped).toHaveLength(3)
    expect(skipped[2]?.[1]).toMatchObject({
      reason: 'not_ready',
      consecutive_not_ready: 3,
      abandoned: true
    })

    expect(updater.hasPendingStartupUpdate()).toBe(false)
  })

  it('does not abandon a version restaged during the wait', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    settingsStore['startupInstallNotReadyVersion'] = '1.0.1'
    settingsStore['startupInstallNotReadyCount'] = 2
    fakeUpdater.checkForUpdates = vi.fn(async () => {
      for (const cb of listeners['update-downloaded'] || []) cb({ version: '1.0.2' })
      return { updateInfo: { version: '1.0.2' } }
    })
    const updater = await bootUpdater()
    expect(await updater.applyPendingUpdateOnStartup()).toBe(false)
    expect(settingsStore['pendingDownloadedUpdateVersion']).toBe('1.0.2')
    expect(settingsStore['startupInstallNotReadyVersion']).toBeUndefined()
    expect(settingsStore['startupInstallNotReadyCount']).toBeUndefined()
    const skipped = findEmitCalls('comfy.desktop.app_update.startup_install_skipped')
    expect(skipped[0]?.[1]).toMatchObject({
      reason: 'not_ready',
      version: '1.0.1',
      wait_outcome: 'version_mismatch',
      abandoned: false
    })
  })

  it('skips without starting the countdown when the session begins ending during the check', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    fakeUpdater.checkForUpdates = vi.fn(async () => {
      sessionEnding = true
      for (const cb of listeners['update-downloaded'] || []) cb({ version: '1.0.1' })
      return { updateInfo: { version: '1.0.1' } }
    })
    const updater = await bootUpdater()
    const onInstallCommitted = vi.fn()
    expect(await updater.applyPendingUpdateOnStartup({ onInstallCommitted })).toBe(false)
    expect(onInstallCommitted).not.toHaveBeenCalled()
    expect(fakeUpdater.restartAndInstall).not.toHaveBeenCalled()
    expect(settingsStore['lastStartupUpdateAttemptVersion']).toBeUndefined()
    const skipped = findEmitCalls('comfy.desktop.app_update.startup_install_skipped')
    expect(skipped[0]?.[1]).toMatchObject({ reason: 'session_ending', version: '1.0.1' })
  })

  it('a different staged version restarts the not-ready strike count', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.2'
    settingsStore['startupInstallNotReadyVersion'] = '1.0.1'
    settingsStore['startupInstallNotReadyCount'] = 2
    readyVersion = null
    const updater = await bootUpdater()
    expect(await updater.applyPendingUpdateOnStartup()).toBe(false)
    expect(settingsStore['startupInstallNotReadyVersion']).toBe('1.0.2')
    expect(settingsStore['startupInstallNotReadyCount']).toBe(1)
    expect(settingsStore['pendingDownloadedUpdateVersion']).toBe('1.0.2')
  })

  it('clears the not-ready strike counter when the staged update installs', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    settingsStore['startupInstallNotReadyVersion'] = '1.0.1'
    settingsStore['startupInstallNotReadyCount'] = 2
    readyVersion = '1.0.1'
    const updater = await bootUpdater()
    expect(await updater.applyPendingUpdateOnStartup()).toBe(true)
    expect(settingsStore['startupInstallNotReadyVersion']).toBeUndefined()
    expect(settingsStore['startupInstallNotReadyCount']).toBeUndefined()
  })

  it('clears a stale not-ready counter once its version is no longer newer', async () => {
    settingsStore['startupInstallNotReadyVersion'] = '1.0.0'
    settingsStore['startupInstallNotReadyCount'] = 2
    mockAppVersion = '1.0.0'
    const updater = await bootUpdater()
    expect(await updater.applyPendingUpdateOnStartup()).toBe(false)
    expect(settingsStore['startupInstallNotReadyVersion']).toBeUndefined()
    expect(settingsStore['startupInstallNotReadyCount']).toBeUndefined()
  })

  it('clears stale markers once the staged version is actually running', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.0'
    settingsStore['lastStartupUpdateAttemptVersion'] = '1.0.0'
    mockAppVersion = '1.0.0'
    const updater = await bootUpdater()
    await updater.applyPendingUpdateOnStartup()
    expect(settingsStore['pendingDownloadedUpdateVersion']).toBeUndefined()
    expect(settingsStore['lastStartupUpdateAttemptVersion']).toBeUndefined()
  })

  it('loop-breaker trips on the sidecar marker alone when the settings marker was erased (issue #1367)', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    sidecarMarker = { version: '1.0.1', attemptedAt: new Date().toISOString() }
    readyVersion = '1.0.1'
    const updater = await bootUpdater()
    expect(await updater.applyPendingUpdateOnStartup()).toBe(false)
    expect(fakeUpdater.restartAndInstall).not.toHaveBeenCalled()
    const skipped = findEmitCalls('comfy.desktop.app_update.startup_install_skipped')
    expect(skipped).toHaveLength(1)
    expect(skipped[0]?.[1]).toMatchObject({
      reason: 'loop_breaker',
      version: '1.0.1',
      source: 'sidecar',
      bakFallbacks: expect.any(Number)
    })
  })

  it('fails closed - no install - when the sidecar marker cannot be persisted (issue #1367)', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    readyVersion = '1.0.1'
    sidecarPersists = false
    const updater = await bootUpdater()
    expect(await updater.applyPendingUpdateOnStartup()).toBe(false)
    expect(fakeUpdater.restartAndInstall).not.toHaveBeenCalled()
    expect(settingsStore['lastStartupUpdateAttemptVersion']).toBeUndefined()
    const skipped = findEmitCalls('comfy.desktop.app_update.startup_install_skipped')
    expect(skipped).toHaveLength(1)
    expect(skipped[0]?.[1]).toMatchObject({
      reason: 'marker_not_durable',
      version: '1.0.1',
      bakFallbacks: expect.any(Number)
    })
  })

  it('fails closed - no install - when the sidecar marker exists but is unreadable (issue #1367)', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    readyVersion = '1.0.1'
    sidecarReadable = false
    const updater = await bootUpdater()
    expect(updater.hasPendingStartupUpdate()).toBe(false)
    expect(await updater.applyPendingUpdateOnStartup()).toBe(false)
    expect(fakeUpdater.restartAndInstall).not.toHaveBeenCalled()
    const skipped = findEmitCalls('comfy.desktop.app_update.startup_install_skipped')
    expect(skipped).toHaveLength(1)
    expect(skipped[0]?.[1]).toMatchObject({ reason: 'marker_unavailable', version: '1.0.1' })
  })

  it('a failed attempt on one version does not block a newer staged version', async () => {
    settingsStore['lastStartupUpdateAttemptVersion'] = '1.0.1'
    sidecarMarker = { version: '1.0.1', attemptedAt: new Date().toISOString() }
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.2'
    readyVersion = '1.0.2'
    const updater = await bootUpdater()
    expect(await updater.applyPendingUpdateOnStartup()).toBe(true)
    expect(fakeUpdater.restartAndInstall).toHaveBeenCalledTimes(1)
    expect(settingsStore['lastStartupUpdateAttemptVersion']).toBe('1.0.2')
    expect(sidecarMarker?.version).toBe('1.0.2')
  })

  it('an explicit installUpdate() call bypasses the startup loop-breaker', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    settingsStore['lastStartupUpdateAttemptVersion'] = '1.0.1'
    sidecarMarker = { version: '1.0.1', attemptedAt: new Date().toISOString() }
    const updater = await bootUpdater()
    updater.installUpdate()
    expect(fakeUpdater.restartAndInstall).toHaveBeenCalledTimes(1)
  })

  it('records the sidecar marker alongside the settings marker when installing', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.1'
    readyVersion = '1.0.1'
    const updater = await bootUpdater()
    expect(await updater.applyPendingUpdateOnStartup()).toBe(true)
    expect(fakeUpdater.restartAndInstall).toHaveBeenCalledTimes(1)
    expect(settingsStore['lastStartupUpdateAttemptVersion']).toBe('1.0.1')
    expect(sidecarMarker?.version).toBe('1.0.1')
  })

  it('clears a stale sidecar marker once the staged version is actually running', async () => {
    sidecarMarker = { version: '1.0.0', attemptedAt: new Date().toISOString() }
    mockAppVersion = '1.0.0'
    const updater = await bootUpdater()
    await updater.applyPendingUpdateOnStartup()
    expect(sidecarMarker).toBeNull()
  })
})

describe('version guard: reject non-newer offers (issue #1161)', () => {
  let emitMock: ReturnType<typeof vi.fn>
  let listeners: Record<string, Array<(...args: unknown[]) => void>>
  let settingsStore: Record<string, unknown>
  let fakeUpdater: { on: ReturnType<typeof vi.fn>; checkForUpdates: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.resetModules()
    listeners = {}
    settingsStore = {}
    emitMock = vi.fn()
    sidecarMarker = null
    sidecarPersists = true
    sidecarReadable = true
    sidecarClears = true
    mockAppVersion = '1.0.24'
    fakeUpdater = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners[event] = listeners[event] || []
        listeners[event].push(cb)
      }) as ReturnType<typeof vi.fn>,
      checkForUpdates: vi.fn(async () => ({ updateInfo: null }))
    }
    vi.doMock('@todesktop/runtime', () => ({ default: { autoUpdater: fakeUpdater } }))
    vi.doMock('./telemetry', () => ({
      emit: emitMock,
      bucketError: (s: string) => s,
      deriveAppChannel: () => 'stable'
    }))
    vi.doMock('../settings', () => ({
      get: vi.fn((key: string) =>
        key === 'autoInstallUpdates' ? (settingsStore[key] ?? true) : settingsStore[key]
      ),
      set: vi.fn((key: string, value: unknown) => {
        if (value === undefined) delete settingsStore[key]
        else settingsStore[key] = value
      })
    }))
  })

  function fire(eventName: string, payload: unknown): void {
    for (const cb of listeners[eventName] || []) cb(payload)
  }

  const ignoredEmits = (): unknown[][] =>
    emitMock.mock.calls.filter((c) => c[0] === 'comfy.desktop.app_update.ignored_not_newer')

  it('update-downloaded for the SAME version does not stage a pending update', async () => {
    const updater = await bootUpdater()

    fire('update-downloaded', { version: '1.0.24' })

    expect(settingsStore['pendingDownloadedUpdateVersion']).toBeUndefined()
    expect(updater.getCurrentUpdateState().kind).toBeNull()
    expect(ignoredEmits()).toHaveLength(1)
    expect(ignoredEmits()[0]?.[1]).toMatchObject({
      version: '1.0.24',
      current: '1.0.24',
      stage: 'downloaded'
    })
  })

  it('update-downloaded for an OLDER version does not stage a pending update', async () => {
    const updater = await bootUpdater()

    fire('update-downloaded', { version: '1.0.22' })

    expect(settingsStore['pendingDownloadedUpdateVersion']).toBeUndefined()
    expect(updater.getCurrentUpdateState().kind).toBeNull()
  })

  it('update-downloaded for an equal build with different metadata is ignored', async () => {
    const updater = await bootUpdater()

    fire('update-downloaded', { version: '1.0.24+build.7' })

    expect(settingsStore['pendingDownloadedUpdateVersion']).toBeUndefined()
    expect(updater.getCurrentUpdateState().kind).toBeNull()
  })

  it('update-downloaded tolerates a leading "v" on a newer version and stages it', async () => {
    const updater = await bootUpdater()

    fire('update-downloaded', { version: 'v1.0.25' })

    expect(settingsStore['pendingDownloadedUpdateVersion']).toBe('v1.0.25')
    expect(updater.getCurrentUpdateState()).toMatchObject({ kind: 'ready', version: 'v1.0.25' })
  })

  it('update-downloaded ignores a leading "v" on the current version', async () => {
    const updater = await bootUpdater()

    fire('update-downloaded', { version: 'v1.0.24' })

    expect(settingsStore['pendingDownloadedUpdateVersion']).toBeUndefined()
    expect(updater.getCurrentUpdateState().kind).toBeNull()
  })

  it('update-downloaded stages a newer version carrying build metadata', async () => {
    const updater = await bootUpdater()

    fire('update-downloaded', { version: '1.0.25+build.7' })

    expect(settingsStore['pendingDownloadedUpdateVersion']).toBe('1.0.25+build.7')
    expect(updater.getCurrentUpdateState().kind).toBe('ready')
  })

  it('update-downloaded for a genuinely NEWER version stages it', async () => {
    const updater = await bootUpdater()

    fire('update-downloaded', { version: '1.0.25' })

    expect(settingsStore['pendingDownloadedUpdateVersion']).toBe('1.0.25')
    expect(updater.getCurrentUpdateState()).toMatchObject({ kind: 'ready', version: '1.0.25' })
    expect(ignoredEmits()).toHaveLength(0)
  })

  it('update-downloaded for an RC of a HIGHER version stages it (RC support)', async () => {
    const updater = await bootUpdater()

    fire('update-downloaded', { version: '1.0.25-rc.1' })

    expect(settingsStore['pendingDownloadedUpdateVersion']).toBe('1.0.25-rc.1')
    expect(updater.getCurrentUpdateState()).toMatchObject({ kind: 'ready', version: '1.0.25-rc.1' })
  })

  it('update-downloaded for an RC of the CURRENT version is ignored (rc < release)', async () => {
    const updater = await bootUpdater()

    fire('update-downloaded', { version: '1.0.24-rc.1' })

    expect(settingsStore['pendingDownloadedUpdateVersion']).toBeUndefined()
    expect(updater.getCurrentUpdateState().kind).toBeNull()
  })

  it('update-available for a non-newer version is ignored (no available pill/emit)', async () => {
    settingsStore['autoInstallUpdates'] = false
    const updater = await bootUpdater()

    fire('update-available', { version: '1.0.24' })

    expect(updater.getCurrentUpdateState().kind).toBeNull()
    expect(
      emitMock.mock.calls.filter((c) => c[0] === 'comfy.desktop.app_update.available')
    ).toHaveLength(0)
    expect(ignoredEmits()).toHaveLength(1)
  })

  it('runCheck reports a non-newer surfaced version as unavailable', async () => {
    fakeUpdater.checkForUpdates = vi.fn(async () => ({ updateInfo: { version: '1.0.24' } }))
    const updater = await bootUpdater()

    const result = await updater.runCheck('manual-check')

    expect(result).toEqual({ available: false })
    expect(
      emitMock.mock.calls.filter((c) => c[0] === 'comfy.desktop.app_update.checked')
    ).toHaveLength(0)
  })

  it('runCheck reports a newer surfaced version as available', async () => {
    fakeUpdater.checkForUpdates = vi.fn(async () => ({ updateInfo: { version: '1.0.25' } }))
    const updater = await bootUpdater()

    const result = await updater.runCheck('manual-check')

    expect(result).toEqual({ available: true, version: '1.0.25' })
  })

  it('the ignored_not_newer diagnostic is deduped across entry points per version', async () => {
    await bootUpdater()

    fire('update-available', { version: '1.0.24' })
    fire('update-downloaded', { version: '1.0.24' })
    fire('update-available', { version: '1.0.24' })

    expect(ignoredEmits()).toHaveLength(1)
  })

  it('hasPendingStartupUpdate ignores a stale non-newer pending marker', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.20'
    const updater = await bootUpdater()

    expect(updater.hasPendingStartupUpdate()).toBe(false)
  })

  it('applyPendingUpdateOnStartup clears a stale non-newer pending marker', async () => {
    settingsStore['pendingDownloadedUpdateVersion'] = '1.0.20'
    settingsStore['lastStartupUpdateAttemptVersion'] = '1.0.20'
    const updater = await bootUpdater()

    expect(await updater.applyPendingUpdateOnStartup()).toBe(false)
    expect(settingsStore['pendingDownloadedUpdateVersion']).toBeUndefined()
    expect(settingsStore['lastStartupUpdateAttemptVersion']).toBeUndefined()
  })
})
