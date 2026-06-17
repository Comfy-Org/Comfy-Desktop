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

  it('resolves the Desktop2 frontend root from the selected Python env', async () => {
    const frontendRoot = path.join(tempDir, 'static-desktop2')
    fs.mkdirSync(frontendRoot)
    mockExecFile((_cmd, _args, _opts, callback) => {
      callback(null, `${frontendRoot}\n`, '')
    })

    await expect(resolveDesktop2FrontendRoot('/python', '/install')).resolves.toBe(frontendRoot)

    expect(mockedExecFile).toHaveBeenCalledWith(
      '/python',
      ['-s', '-c', expect.stringContaining('comfyui_frontend_package')],
      expect.objectContaining({ cwd: '/install', windowsHide: true }),
      expect.any(Function)
    )
  })

  it('returns null when the Desktop2 assets are missing', async () => {
    const frontendRoot = path.join(tempDir, 'static-desktop2')
    mockExecFile((_cmd, _args, _opts, callback) => {
      callback(null, `${frontendRoot}\n`, '')
    })

    await expect(resolveDesktop2FrontendRoot('/python', '/install')).resolves.toBeNull()
  })
})
