import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Stub the electron surface ../shared touches so the test needs no runtime.
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

// Override only the model-download startup gate; everything else in the
// download manager stays real (it is already part of launch.ts's graph).
const modelStartup = vi.hoisted(() => ({
  impl: null as null | (() => Promise<{ safe: boolean; unsafePaths: string[] }>)
}))
vi.mock('../../comfyDownloadManager', async (importOriginal) => {
  const actual = await importOriginal<typeof ComfyDownloadManagerModule>()
  return {
    ...actual,
    initializeModelDownloads: () =>
      modelStartup.impl ? modelStartup.impl() : actual.initializeModelDownloads()
  }
})

import {
  desktopFeatureFlags,
  handleLaunch,
  isCrashedExit,
  onProcessTerminated,
  _cleanupFailedLaunchSetup
} from './launch'
import type { ActionContext } from './types'
import type * as ComfyDownloadManagerModule from '../../comfyDownloadManager'
import {
  _getLaunchingInstallationIds,
  _markLaunching,
  _operationAborts,
  _pendingPorts,
  _reservePort
} from '../shared'
import type { ChildProcess, InstallationRecord } from '../shared'

const installOf = (sourceId: string) => ({ sourceId }) as InstallationRecord

describe('desktopFeatureFlags', () => {
  it('always injects the unconditional desktop flags', () => {
    const flags = desktopFeatureFlags(installOf('standalone'), false)
    expect(flags.show_signin_button).toBe('true')
    expect(flags.supports_terminal).toBe('false')
  })

  it('injects enable_telemetry only for standalone installs that opted in', () => {
    expect(desktopFeatureFlags(installOf('standalone'), true).enable_telemetry).toBe('true')
  })

  it('omits enable_telemetry when telemetry is disabled (default off)', () => {
    expect(desktopFeatureFlags(installOf('standalone'), false)).not.toHaveProperty(
      'enable_telemetry'
    )
  })

  it('omits enable_telemetry for non-standalone installs even when opted in', () => {
    expect(desktopFeatureFlags(installOf('portable'), true)).not.toHaveProperty('enable_telemetry')
    expect(desktopFeatureFlags(installOf('git'), true)).not.toHaveProperty('enable_telemetry')
  })
})

describe('isCrashedExit', () => {
  it('treats a clean exit (code 0, no signal) as not crashed', () => {
    expect(isCrashedExit(0, null)).toBe(false)
  })

  it('treats a non-zero exit code (Linux/macOS normal crash) as crashed', () => {
    expect(isCrashedExit(1, null)).toBe(true)
    expect(isCrashedExit(137, null)).toBe(true)
  })

  it('treats a POSIX signal-only kill (code null, signal set) as crashed', () => {
    // SIGKILL via `kill -9` or OOM: Node hands back null code + signal.
    expect(isCrashedExit(null, 'SIGKILL')).toBe(true)
    expect(isCrashedExit(null, 'SIGTERM')).toBe(true)
  })

  it('treats both code and signal present (signal-with-code path) as crashed', () => {
    expect(isCrashedExit(137, 'SIGKILL')).toBe(true)
  })

  it('treats Windows TerminateProcess (numeric code, null signal) as crashed', () => {
    // Windows force-kill reports a large unsigned code; signal is always null.
    expect(isCrashedExit(4294967295, null)).toBe(true)
    expect(isCrashedExit(0xc0000005, null)).toBe(true)
  })
})

describe('onProcessTerminated', () => {
  it('prefers close and invokes the callback once', () => {
    const proc = new EventEmitter() as unknown as ChildProcess
    const callback = vi.fn()
    onProcessTerminated(proc, callback)

    proc.emit('exit', 1, null)
    proc.emit('close', 2, 'SIGTERM')
    proc.emit('close', 3, null)

    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith(2, 'SIGTERM')
  })

  it('handles rejected async termination callbacks', async () => {
    const proc = new EventEmitter() as unknown as ChildProcess
    const failure = new Error('callback failed')
    const callback = vi.fn(async () => Promise.reject(failure))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      onProcessTerminated(proc, callback)
      proc.emit('close', 1, null)

      expect(callback).toHaveBeenCalledOnce()
      await vi.waitFor(() =>
        expect(consoleError).toHaveBeenCalledWith('Process termination callback failed:', failure)
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  it('falls back to exit when inherited pipes prevent close', () => {
    vi.useFakeTimers()
    try {
      const proc = new EventEmitter() as unknown as ChildProcess
      const callback = vi.fn()
      onProcessTerminated(proc, callback)

      proc.emit('exit', null, 'SIGKILL')
      expect(callback).not.toHaveBeenCalled()
      vi.runAllTimers()

      expect(callback).toHaveBeenCalledOnce()
      expect(callback).toHaveBeenCalledWith(null, 'SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('_cleanupFailedLaunchSetup', () => {
  const INSTALL = 'cleanup-under-test'
  const PORT = 59_311

  afterEach(() => {
    _operationAborts.delete(INSTALL)
    _pendingPorts.delete(PORT)
  })

  it('releases the port, clears the launching marker, frees the slot, and aborts', () => {
    const abort = new AbortController()
    _reservePort(PORT, 'Cleanup Test')
    _markLaunching(INSTALL, 'Cleanup Test')
    _operationAborts.set(INSTALL, abort)

    _cleanupFailedLaunchSetup(INSTALL, abort, { port: PORT })

    expect(_pendingPorts.has(PORT)).toBe(false)
    expect(_getLaunchingInstallationIds()).not.toContain(INSTALL)
    expect(_operationAborts.has(INSTALL)).toBe(false)
    expect(abort.signal.aborted).toBe(true)
  })

  it('ends the log stream when one was opened', () => {
    const end = vi.fn()
    _cleanupFailedLaunchSetup(INSTALL, new AbortController(), { logStream: { end } })
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('never evicts an operation slot a newer operation already claimed', () => {
    const stale = new AbortController()
    const newer = new AbortController()
    _operationAborts.set(INSTALL, newer)

    _cleanupFailedLaunchSetup(INSTALL, stale)

    expect(_operationAborts.get(INSTALL)).toBe(newer)
    expect(newer.signal.aborted).toBe(false)
    expect(stale.signal.aborted).toBe(true)
  })

  it('is safe when nothing was acquired yet', () => {
    expect(() => _cleanupFailedLaunchSetup(INSTALL, new AbortController())).not.toThrow()
  })
})

describe('handleLaunch model-download startup gate (#1322)', () => {
  const ctxFor = (installationId: string): ActionContext => ({
    event: { sender: { send: vi.fn() } } as unknown as Electron.IpcMainInvokeEvent,
    installationId,
    // An unknown source makes runLaunch fail at the FIRST check after the
    // gate, proving how far a safe pass proceeded without spawning anything.
    inst: installOf('not-a-real-source'),
    actionData: {}
  })

  afterEach(() => {
    modelStartup.impl = null
  })

  it('blocks the launch while incomplete files are visible under final model names', async () => {
    modelStartup.impl = async () => ({
      safe: false,
      unsafePaths: ['C:\\models\\checkpoints\\broken.safetensors']
    })
    const res = await handleLaunch(ctxFor('gate-unsafe-paths'))
    expect(res.ok).toBe(false)
    // Uninitialized test i18n returns the key; a loaded locale returns the
    // interpolated message - accept either surface of the same branch.
    expect(res.message).toMatch(/modelDownloadsUnsafe|could not be quarantined/)
    expect(res.message).not.toMatch(/unknownSource|unrecognized source/)
  })

  it('blocks the launch when the startup pass itself could not certify safety', async () => {
    modelStartup.impl = async () => ({ safe: false, unsafePaths: [] })
    const res = await handleLaunch(ctxFor('gate-unsafe-nopaths'))
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/modelDownloadsStartupFailed|startup check failed/)
  })

  it('lets a safe pass proceed beyond the gate', async () => {
    modelStartup.impl = async () => ({ safe: true, unsafePaths: [] })
    const res = await handleLaunch(ctxFor('gate-safe'))
    expect(res.ok).toBe(false)
    // Failure comes from the NEXT check (unknown source), not the gate.
    expect(res.message).toMatch(/unknownSource|unrecognized source/)
  })

  it('releases the operation slot after a gate-blocked launch', async () => {
    modelStartup.impl = async () => ({ safe: false, unsafePaths: [] })
    await handleLaunch(ctxFor('gate-slot-release'))
    expect(_operationAborts.has('gate-slot-release')).toBe(false)
  })
})
