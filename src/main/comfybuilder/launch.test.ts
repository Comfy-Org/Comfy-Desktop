// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildLaunchSpec, managerAllowedByPolicy, venvPython } from './launch'

const isWin = process.platform === 'win32'

function layout(
  installPath: string,
  opts: { python?: boolean; main?: boolean } = { python: true, main: true }
): void {
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
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbc-launch-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('venvPython points at the archive venv per platform', () => {
    expect(venvPython(dir)).toBe(
      isWin ? path.join(dir, 'venv', 'python.exe') : path.join(dir, 'venv', 'bin', 'python3')
    )
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
      port: 9001
    })
  })

  it('drops every manager-enabling flag when the build turned the manager off', () => {
    const p = path.join(dir, 'install')
    layout(p)
    const spec = buildLaunchSpec(p, {
      launchArgs: '--enable-manager --cpu --enable-manager-legacy-ui --port 9001',
      managerAllowed: false
    })
    expect(spec?.args).toEqual(['-s', path.join('ComfyUI', 'main.py'), '--cpu', '--port', '9001'])
    expect(spec?.port).toBe(9001)
  })

  it('drops the default manager flag too when the build turned the manager off', () => {
    const p = path.join(dir, 'install')
    layout(p)
    expect(buildLaunchSpec(p, { managerAllowed: false })?.args).toEqual([
      '-s',
      path.join('ComfyUI', 'main.py')
    ])
  })

  it.each([[true], [undefined]])('keeps the manager flag when managerAllowed is %s', (allowed) => {
    const p = path.join(dir, 'install')
    layout(p)
    expect(buildLaunchSpec(p, { managerAllowed: allowed })?.args).toEqual([
      '-s',
      path.join('ComfyUI', 'main.py'),
      '--enable-manager'
    ])
  })

  it.each([
    ['an allowlist (the wizard wrote No)', { mode: 'allowlist' as const }, false],
    ['an allowlist naming packs', { mode: 'allowlist' as const, list: ['KJNodes'] }, false],
    ['an empty blocklist (the wizard wrote Yes)', { mode: 'blocklist' as const, list: [] }, true],
    ['no policy (a snapshot build)', null, true],
    ['an absent policy', undefined, true]
  ])('managerAllowedByPolicy reads %s', (_name, policy, expected) => {
    expect(managerAllowedByPolicy(policy)).toBe(expected)
  })

  it.each([
    ['python missing', { python: false }],
    ['main.py missing', { main: false }]
  ])('returns null when %s', (_name, opts) => {
    const p = path.join(dir, 'install')
    layout(p, opts)
    expect(buildLaunchSpec(p)).toBeNull()
  })
})
