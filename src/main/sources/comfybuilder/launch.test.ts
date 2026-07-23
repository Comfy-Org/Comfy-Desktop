// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => os.tmpdir(), getName: () => 'test', getVersion: () => '0', on: vi.fn() },
}))

import { getLaunchCommand, postInstall, builderPythonPath } from './launch'
import type { InstallationRecord } from '../../installations'

const isWin = process.platform === 'win32'

function makeInstall(installPath: string, extra: Partial<InstallationRecord> = {}): InstallationRecord {
  return { id: 'i', name: 'n', createdAt: new Date(0).toISOString(), installPath, sourceId: 'comfybuilder', ...extra }
}

/** Lay down the archive's `venv/` python + `ComfyUI/main.py`. */
function layoutInstall(installPath: string): void {
  const pyDir = path.dirname(builderPythonPath(installPath))
  fs.mkdirSync(pyDir, { recursive: true })
  fs.writeFileSync(builderPythonPath(installPath), '')
  fs.mkdirSync(path.join(installPath, 'ComfyUI'), { recursive: true })
  fs.writeFileSync(path.join(installPath, 'ComfyUI', 'main.py'), '')
}

describe('comfybuilder launch', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-launch-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('builderPythonPath points at the archive venv per platform', () => {
    const p = builderPythonPath(dir)
    expect(p).toBe(isWin ? path.join(dir, 'venv', 'python.exe') : path.join(dir, 'venv', 'bin', 'python3'))
  })

  it('getLaunchCommand drives the venv python against ComfyUI/main.py', () => {
    const installPath = path.join(dir, 'install')
    layoutInstall(installPath)
    const cmd = getLaunchCommand(makeInstall(installPath, { launchArgs: '--cpu --port 9001' }))
    expect(cmd?.cmd).toBe(builderPythonPath(installPath))
    expect(cmd?.args).toEqual(['-s', path.join('ComfyUI', 'main.py'), '--cpu', '--port', '9001'])
    expect(cmd?.cwd).toBe(installPath)
    expect(cmd?.port).toBe(9001)
  })

  it('returns null when the venv python is missing', () => {
    const installPath = path.join(dir, 'install')
    fs.mkdirSync(path.join(installPath, 'ComfyUI'), { recursive: true })
    fs.writeFileSync(path.join(installPath, 'ComfyUI', 'main.py'), '')
    expect(getLaunchCommand(makeInstall(installPath))).toBeNull()
  })

  it('returns null when ComfyUI/main.py is missing', () => {
    const installPath = path.join(dir, 'install')
    const pyDir = path.dirname(builderPythonPath(installPath))
    fs.mkdirSync(pyDir, { recursive: true })
    fs.writeFileSync(builderPythonPath(installPath), '')
    expect(getLaunchCommand(makeInstall(installPath))).toBeNull()
  })

  it('postInstall is a no-op that resolves (no env rebuild)', async () => {
    const installPath = path.join(dir, 'install')
    layoutInstall(installPath)
    await expect(postInstall(makeInstall(installPath), { sendProgress: vi.fn(), update: async () => {} })).resolves.toBeUndefined()
  })
})
