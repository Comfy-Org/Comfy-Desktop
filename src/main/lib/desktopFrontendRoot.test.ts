// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, execFile: vi.fn() }
})

import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  hasFrontEndRootArg,
  isLocalComfyPythonLaunch,
  resolveDesktop2FrontendRoot
} from './desktopFrontendRoot'

const mockedExecFile = vi.mocked(execFile)

function mockExecFile(
  cb: (
    cmd: string,
    args: string[],
    opts: Record<string, unknown>,
    callback: (err: Error | null, stdout: string, stderr: string) => void
  ) => void
): void {
  mockedExecFile.mockImplementation(cb as never)
}

describe('isLocalComfyPythonLaunch', () => {
  it('matches local ComfyUI python launches', () => {
    expect(
      isLocalComfyPythonLaunch({
        cmd: '/python',
        args: ['-s', 'main.py'],
        cwd: '/ComfyUI'
      })
    ).toBe(true)
  })

  it('rejects external app launches', () => {
    expect(
      isLocalComfyPythonLaunch({
        cmd: '/Applications/ComfyUI.app',
        args: [],
        cwd: '/Applications',
        skipSharedPaths: true
      })
    ).toBe(false)
  })
})

describe('hasFrontEndRootArg', () => {
  it('detects a user-supplied front-end-root', () => {
    expect(hasFrontEndRootArg(['-s', 'main.py', '--front-end-root', '/custom'])).toBe(true)
    expect(hasFrontEndRootArg(['-s', 'main.py', '--front-end-root=/custom'])).toBe(true)
  })

  it('returns false when no front-end-root is present', () => {
    expect(hasFrontEndRootArg(['-s', 'main.py', '--port', '8188'])).toBe(false)
  })
})

describe('resolveDesktop2FrontendRoot', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop2-fe-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('prefers the Desktop2 frontend root when it exists', async () => {
    const desktop2Root = path.join(tempDir, 'static-desktop2')
    fs.mkdirSync(path.join(tempDir, 'static'))
    fs.mkdirSync(desktop2Root)
    mockExecFile((_cmd, _args, _opts, callback) => {
      callback(null, `${tempDir}\n`, '')
    })

    await expect(resolveDesktop2FrontendRoot('/python', '/install')).resolves.toBe(desktop2Root)

    expect(mockedExecFile).toHaveBeenCalledWith(
      '/python',
      ['-s', '-c', expect.stringContaining('resources.files("comfyui_frontend_package")')],
      expect.objectContaining({ cwd: '/install', windowsHide: true }),
      expect.any(Function)
    )
  })

  it('uses the packaged static frontend when the Desktop2 root is absent', async () => {
    const frontendRoot = path.join(tempDir, 'static')
    fs.mkdirSync(frontendRoot)
    mockExecFile((_cmd, _args, _opts, callback) => {
      callback(null, `${tempDir}\n`, '')
    })

    await expect(resolveDesktop2FrontendRoot('/python', '/install')).resolves.toBe(frontendRoot)
  })

  it('returns null when packaged frontend assets are missing', async () => {
    mockExecFile((_cmd, _args, _opts, callback) => {
      callback(null, `${tempDir}\n`, '')
    })

    await expect(resolveDesktop2FrontendRoot('/python', '/install')).resolves.toBeNull()
  })
})
