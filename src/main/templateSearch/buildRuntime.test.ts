import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ activePython: vi.fn((): string | null => null) }))

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))
vi.mock('../lib/pythonEnv', () => ({
  getActivePythonPath: mocks.activePython,
  getActiveVenvDir: () => '/standalone/.venv'
}))

import type { InstallationRecord } from '../installations'
import { buildRuntime } from './buildRuntime'

let root: string

function touch(file: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '')
  return file
}

const BUILD = { id: 'b', installPath: '/i/b' } as InstallationRecord

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-runtime-'))
  mocks.activePython.mockReturnValue(null)
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('buildRuntime', () => {
  it("uses the Python of the venv the build's source names", () => {
    const venv = path.join(root, 'venv')
    const python =
      process.platform === 'win32'
        ? touch(path.join(venv, 'Scripts', 'python.exe'))
        : touch(path.join(venv, 'bin', 'python3'))
    expect(buildRuntime(BUILD, { venvDir: venv })?.python).toBe(python)
  })

  it('has no runtime for a venv that has no Python', () => {
    expect(buildRuntime(BUILD, { venvDir: path.join(root, 'empty') })).toBeNull()
  })

  it('uses an embedded Python the source runs pip with', () => {
    const python = touch(path.join(root, 'python_embeded', 'python.exe'))
    expect(buildRuntime(BUILD, { pip: { exe: python, args: ['-s', '-m', 'pip'] } })?.python).toBe(
      python
    )
  })

  it('does not take a pip launcher that is not a Python', () => {
    const uv = touch(path.join(root, 'uv'))
    mocks.activePython.mockReturnValue('/standalone/.venv/bin/python3')
    expect(buildRuntime(BUILD, { pip: { exe: uv, args: ['pip'] } })?.python).toBe(
      '/standalone/.venv/bin/python3'
    )
  })

  it('falls back to the standalone Python when the source says nothing', () => {
    mocks.activePython.mockReturnValue('/standalone/.venv/bin/python3')
    expect(buildRuntime(BUILD, null)?.python).toBe('/standalone/.venv/bin/python3')
    mocks.activePython.mockReturnValue(null)
    expect(buildRuntime(BUILD, null)).toBeNull()
  })
})
