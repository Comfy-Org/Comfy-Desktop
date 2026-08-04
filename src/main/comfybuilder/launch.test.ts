// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildLaunchSpec, venvPython } from './launch'

const isWin = process.platform === 'win32'

function layout(installPath: string, opts: { python?: boolean; main?: boolean } = { python: true, main: true }): void {
  if (opts.python !== false) {
    fs.mkdirSync(path.dirname(venvPython(installPath)), { recursive: true })
    fs.writeFileSync(venvPython(installPath), '')
  }
  if (opts.main !== false) {
    fs.mkdirSync(path.join(installPath, 'ComfyUI'), { recursive: true })
    fs.writeFileSync(path.join(installPath, 'ComfyUI', 'main.py'), '')
  }
}

describe('launch', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbc-launch-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('venvPython points at the archive venv per platform', () => {
    expect(venvPython(dir)).toBe(isWin ? path.join(dir, 'venv', 'python.exe') : path.join(dir, 'venv', 'bin', 'python3'))
  })

  it.runIf(isWin)('venvPython prefers the staged windows interpreter at venv/base', () => {
    const staged = path.join(dir, 'venv', 'base', 'python.exe')
    fs.mkdirSync(path.dirname(staged), { recursive: true })
    fs.writeFileSync(staged, '')
    // Current archives stage it below the venv root; that placement is what keeps the
    // venv's entry points relocatable (Comfy-Org/cloud#6138).
    expect(venvPython(dir)).toBe(staged)
  })

  it('builds a spec that drives the venv python against ComfyUI/main.py', () => {
    const p = path.join(dir, 'install')
    layout(p)
    const spec = buildLaunchSpec(p, { launchArgs: '--cpu --port 9001' })
    expect(spec).toEqual({
      cmd: venvPython(p),
      args: ['-s', path.join('ComfyUI', 'main.py'), '--cpu', '--port', '9001'],
      cwd: p,
      port: 9001,
    })
  })

  it.each([
    ['python missing', { python: false }],
    ['main.py missing', { main: false }],
  ])('returns null when %s', (_name, opts) => {
    const p = path.join(dir, 'install')
    layout(p, opts)
    expect(buildLaunchSpec(p)).toBeNull()
  })
})
