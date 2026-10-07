import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { installPathRoots } from './pathRoots'
import { scrubPaths } from '../../shared/piiScrub'

describe('installPathRoots', () => {
  const made: string[] = []
  afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('has no roots without an install path', () => {
    expect(installPathRoots(undefined)).toEqual([])
    expect(installPathRoots('')).toEqual([])
  })

  it('maps the ComfyUI checkout and the install base to their tokens', () => {
    const base = path.join(os.tmpdir(), 'no-such-install-e3f1c9')
    const roots = installPathRoots(base)
    expect(roots).toEqual([
      { path: path.join(base, 'ComfyUI'), token: '<comfyui>' },
      { path: base, token: '<install>' }
    ])
    expect(scrubPaths(path.join(base, 'ComfyUI', 'main.py'), roots)).toBe('<comfyui>/main.py')
    expect(scrubPaths(path.join(base, '.venv', 'x.py'), roots)).toBe('<install>/.venv/x.py')
  })

  it.skipIf(process.platform === 'win32')(
    'also lists the resolved form of a symlinked install',
    () => {
      const real = fs.mkdtempSync(path.join(os.tmpdir(), 'install-real-'))
      const linkParent = fs.mkdtempSync(path.join(os.tmpdir(), 'install-link-'))
      made.push(real, linkParent)
      fs.mkdirSync(path.join(real, 'ComfyUI'))
      const link = path.join(linkParent, 'install')
      fs.symlinkSync(real, link)
      const roots = installPathRoots(link)
      expect(scrubPaths(path.join(fs.realpathSync(real), 'ComfyUI', 'a.py'), roots)).toBe(
        '<comfyui>/a.py'
      )
    }
  )
})
