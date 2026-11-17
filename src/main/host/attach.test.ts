import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as IpcModule from '../lib/ipc'
import type * as SettingsModule from '../settings'

const mocks = vi.hoisted(() => ({
  stopRunning: vi.fn(async (_id?: string) => {}),
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
vi.mock('../lib/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof IpcModule>()),
  stopRunning: (id?: string) => mocks.stopRunning(id)
}))
vi.mock('../settings', async (importOriginal) => {
  const actual = await importOriginal<typeof SettingsModule>()
  return {
    ...actual,
    get: (key: string) =>
      key === 'keepComfyRunningWhenWindowCloses' ? mocks.keepComfyRunning : actual.get(key)
  }
})
vi.mock('../lib/firebaseAuthIdentity', () => ({
  activateFirebaseAuthReporter: () => {},
  deactivateFirebaseAuthReporter: () => {}
}))
vi.mock('../lib/comfyDownloadManager', () => ({
  attachSessionDownloadHandler: () => {}
}))

import type { InstallationRecord } from '../installations'
import { _runningSessions, type SessionInfo } from '../lib/ipc/shared'
import { attachInstall, setAttachFactories } from './attach'
import { comfyWindows, getEntryByInstallationId, nextWindowKey } from './registry'
import type { ComfyWindowEntry } from './registry'

const STUDIO = 'studio'

function openWindow(): ComfyWindowEntry {
  const contents = {
    isDestroyed: () => false,
    on: () => {},
    off: () => {},
    loadURL: () => {},
    send: () => {},
    session: {}
  }
  const entry = {
    windowKey: nextWindowKey(),
    window: { isFocused: () => false, isDestroyed: () => false, setTitle: () => {} },
    comfyView: { webContents: contents },
    titleBarView: { webContents: { isDestroyed: () => true } },
    installationId: null,
    comfyUrl: '',
    _installCleanup: null
  } as unknown as ComfyWindowEntry
  comfyWindows.set(entry.windowKey, entry)
  return entry
}

function showBuild(entry: ComfyWindowEntry, isLocal: boolean): void {
  const installation = { id: STUDIO, name: 'Studio', sourceId: 'standalone' } as InstallationRecord
  attachInstall(entry, {
    installation,
    comfyUrl: isLocal ? 'http://127.0.0.1:8188' : 'https://cloud.comfy.org',
    isLocal
  })
}

beforeEach(() => {
  comfyWindows.clear()
  _runningSessions.clear()
  mocks.stopRunning.mockClear()
  mocks.keepComfyRunning = undefined
  setAttachFactories({
    comfyZoomResets: new Map(),
    relaunchStates: new Map(),
    computeInstallUpdateAvailable: async () => ({ available: false })
  })
})

describe('closing the window of a build, with keepComfyRunningWhenWindowCloses off', () => {
  beforeEach(() => {
    mocks.keepComfyRunning = false
  })

  it('stops the ComfyUI on this computer', () => {
    _runningSessions.set(STUDIO, { port: 8188, mode: 'window', proc: null } as SessionInfo)
    const entry = openWindow()
    showBuild(entry, true)

    entry._installCleanup?.()

    expect(mocks.stopRunning).toHaveBeenCalledWith(STUDIO)
    expect(_runningSessions.get(STUDIO)?.hadWindow).toBeUndefined()
  })

  it('ends a cloud session', () => {
    const entry = openWindow()
    showBuild(entry, false)

    entry._installCleanup?.()

    expect(mocks.stopRunning).toHaveBeenCalledWith(STUDIO)
  })
})

describe('closing the window of a build', () => {
  it('leaves the ComfyUI on this computer running when keepComfyRunningWhenWindowCloses is absent', () => {
    const entry = openWindow()
    showBuild(entry, true)

    entry._installCleanup?.()

    expect(mocks.stopRunning).not.toHaveBeenCalled()
    expect(entry.installationId).toBeNull()
    expect(getEntryByInstallationId(STUDIO)).toBeUndefined()
  })

  it('leaves the ComfyUI on this computer running when keepComfyRunningWhenWindowCloses is true', () => {
    mocks.keepComfyRunning = true
    const entry = openWindow()
    showBuild(entry, true)

    entry._installCleanup?.()

    expect(mocks.stopRunning).not.toHaveBeenCalled()
  })

  it('remembers that the ComfyUI it leaves running had a window, so Home can open one again', () => {
    _runningSessions.set(STUDIO, { port: 8188, mode: 'console', proc: null } as SessionInfo)
    const entry = openWindow()
    showBuild(entry, true)

    entry._installCleanup?.()

    expect(_runningSessions.get(STUDIO)?.hadWindow).toBe(true)
  })

  it('ends a cloud session, which has nothing to keep running', () => {
    const entry = openWindow()
    showBuild(entry, false)

    entry._installCleanup?.()

    expect(mocks.stopRunning).toHaveBeenCalledWith(STUDIO)
  })
})
