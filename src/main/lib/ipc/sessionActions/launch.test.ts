import { describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Stub the electron surface ../shared touches so the test needs no runtime.
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en',
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
}))

import { desktopFeatureFlags, handleLaunch, isCrashedExit } from './launch'
import { sourceMap } from '../shared'
import type { InstallationRecord } from '../shared'
import type { LaunchCommand } from '../../../types/sources'

const installOf = (sourceId: string) => ({ sourceId }) as InstallationRecord

describe('desktopFeatureFlags', () => {
  it('always injects the unconditional desktop flags', () => {
    const flags = desktopFeatureFlags(installOf('standalone'), false)
    expect(flags.show_signin_button).toBe('true')
    expect(flags.supports_terminal).toBe('true')
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
    expect(desktopFeatureFlags(installOf('portable'), true)).not.toHaveProperty(
      'enable_telemetry'
    )
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

describe('handleLaunch - adopted CPU-only PyTorch', () => {
  function makeAdoptedMismatch(): { inst: InstallationRecord; cleanup: () => void } {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adopted-launch-'))
    const installPath = path.join(tmpRoot, 'wrapper')
    const adoptedBaseDir = path.join(tmpRoot, 'legacy')
    const venvDir = path.join(adoptedBaseDir, '.venv')
    const pythonPath = process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'python.exe')
      : path.join(venvDir, 'bin', 'python')
    const sitePackages = process.platform === 'win32'
      ? path.join(venvDir, 'Lib', 'site-packages')
      : path.join(venvDir, 'lib', 'python3.12', 'site-packages')
    fs.mkdirSync(path.join(installPath, 'ComfyUI'), { recursive: true })
    fs.writeFileSync(path.join(installPath, 'ComfyUI', 'main.py'), '')
    fs.mkdirSync(path.dirname(pythonPath), { recursive: true })
    fs.writeFileSync(pythonPath, '')
    fs.mkdirSync(path.join(sitePackages, 'torch-2.12.0.dist-info'), { recursive: true })
    fs.mkdirSync(path.join(sitePackages, 'torch'), { recursive: true })
    fs.writeFileSync(
      path.join(sitePackages, 'torch', 'version.py'),
      "cuda = None\nhip = None\nrocm = None\nxpu = None\n",
    )
    return {
      inst: {
        id: `adopted-mismatch-${path.basename(tmpRoot)}`,
        name: 'Adopted mismatch',
        createdAt: new Date(0).toISOString(),
        sourceId: 'standalone',
        installPath,
        status: 'installed',
        adopted: true,
        adoptedBaseDir,
        adoptedPythonPath: pythonPath,
        adoptedSelectedDevice: 'nvidia',
        launchArgs: '--enable-manager',
      },
      cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
    }
  }

  const event = {
    sender: { isDestroyed: () => false, send: vi.fn() },
  } as unknown as Electron.IpcMainInvokeEvent

  it('blocks an unconfirmed GPU launch before spawning the mismatched environment', async () => {
    const { inst, cleanup } = makeAdoptedMismatch()
    try {
      const result = await handleLaunch({
        event,
        installationId: inst.id,
        inst,
        actionData: undefined,
      })

      expect(result.ok).toBe(false)
      expect(result.message).toBe('desktop.adoptedTorchMismatchBlocked')
    } finally {
      cleanup()
    }
  })

  it('adds --cpu after the user has accepted the fallback', async () => {
    const { inst, cleanup } = makeAdoptedMismatch()
    const source = sourceMap['standalone']!
    const originalGetLaunchCommand = source.getLaunchCommand
    const launchCmd: LaunchCommand = {
      cmd: path.join(inst.installPath, 'missing-python.exe'),
      args: ['-s', path.join('ComfyUI', 'main.py'), '--enable-manager', '--lowvram'],
      cwd: inst.installPath,
      port: 8000,
    }
    source.getLaunchCommand = () => launchCmd
    try {
      await handleLaunch({
        event,
        installationId: inst.id,
        inst: { ...inst, adoptedCpuFallback: true },
        actionData: undefined,
      })

      expect(launchCmd.args).toContain('--cpu')
      expect(launchCmd.args).not.toContain('--lowvram')
    } finally {
      source.getLaunchCommand = originalGetLaunchCommand
      cleanup()
    }
  })
})
