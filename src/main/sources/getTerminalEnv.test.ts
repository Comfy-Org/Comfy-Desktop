import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import fs from 'fs'

vi.mock('electron', () => ({
  app: { getPath: () => '', isPackaged: false },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: {},
  shell: { openPath: vi.fn().mockResolvedValue('') },
  net: { request: vi.fn() },
}))

import { gitSource } from './git'
import { portable } from './portable'
import { desktop } from './desktop'
import type { InstallationRecord } from '../installations'

function asInstall(record: Record<string, unknown>): InstallationRecord {
  return record as unknown as InstallationRecord
}

describe('gitSource.getTerminalEnv', () => {
  let existsSyncSpy: MockInstance

  beforeEach(() => {
    vi.restoreAllMocks()
    existsSyncSpy = vi.spyOn(fs, 'existsSync')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('activates the tracked venvPath and never references standalone-env', () => {
    const installPath = path.join('repos', 'comfy')
    const venvPath = path.join(installPath, '.venv')
    // resolveVenvPython + findMainPy treat everything as present.
    existsSyncSpy.mockReturnValue(true)

    const env = gitSource.getTerminalEnv!(asInstall({ installPath, venvPath }))
    // Opens on the ComfyUI code folder (where main.py lives) — here installPath.
    expect(env).toEqual({ cwd: installPath, venvDir: venvPath, promptName: '.venv' })
    // No pip override: a git venv ships its own pip; the bug was aliasing pip to
    // a nonexistent standalone-env/uv.exe.
    expect(env?.pip).toBeUndefined()
  })

  it('returns a bare env (plain shell) when no venv is tracked', () => {
    const env = gitSource.getTerminalEnv!(asInstall({ installPath: '/repos/comfy' }))
    expect(env).toEqual({})
  })

  it('returns a bare env when the tracked venv no longer exists on disk', () => {
    existsSyncSpy.mockReturnValue(false)
    const env = gitSource.getTerminalEnv!(
      asInstall({ installPath: '/repos/comfy', venvPath: '/repos/comfy/.venv' }),
    )
    expect(env).toEqual({})
  })
})

describe('desktop.getTerminalEnv', () => {
  let existsSyncSpy: MockInstance

  beforeEach(() => {
    vi.restoreAllMocks()
    existsSyncSpy = vi.spyOn(fs, 'existsSync')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('activates the legacy <installPath>/.venv, not the standalone layout', () => {
    const installPath = path.join('C:', 'ComfyUI')
    existsSyncSpy.mockReturnValue(true)
    const env = desktop.getTerminalEnv!(asInstall({ installPath }))
    expect(env).toEqual({ venvDir: path.join(installPath, '.venv'), promptName: '.venv' })
  })

  it('returns a bare env when the legacy venv is missing', () => {
    existsSyncSpy.mockReturnValue(false)
    const env = desktop.getTerminalEnv!(asInstall({ installPath: path.join('C:', 'ComfyUI') }))
    expect(env).toEqual({})
  })
})

describe('portable.getTerminalEnv', () => {
  let existsSyncSpy: MockInstance

  beforeEach(() => {
    vi.restoreAllMocks()
    existsSyncSpy = vi.spyOn(fs, 'existsSync')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('puts the embedded python on PATH and routes pip through it', () => {
    const root = path.join('C:', 'portable')
    // findPortableRoot succeeds when <installPath>/python_embeded exists.
    existsSyncSpy.mockImplementation((p) => p === path.join(root, 'python_embeded'))

    const env = portable.getTerminalEnv!(asInstall({ installPath: root }))
    const embedded = path.join(root, 'python_embeded')
    expect(env).toEqual({
      // Opens on the ComfyUI code folder, not the portable root.
      cwd: path.join(root, 'ComfyUI'),
      pathPrepends: [embedded, path.join(embedded, 'Scripts')],
      promptName: 'python_embeded',
      pip: { exe: path.join(embedded, 'python.exe'), args: ['-s', '-m', 'pip'] },
    })
    // A portable build has no venv to activate.
    expect(env?.venvDir).toBeUndefined()
  })

  it('returns a bare env (plain shell) when the embedded layout is missing', () => {
    existsSyncSpy.mockReturnValue(false)
    const readdirSpy = vi.spyOn(fs, 'readdirSync').mockReturnValue([])
    const env = portable.getTerminalEnv!(asInstall({ installPath: path.join('C:', 'nope') }))
    expect(env).toEqual({})
    readdirSpy.mockRestore()
  })
})
