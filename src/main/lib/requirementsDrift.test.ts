import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => '' }
}))

import {
  compareReleases,
  detectRequirementsDrift,
  envRootForPython,
  findUnsatisfiedRequirements,
  normalizeDistName,
  comfyuiDirForLaunch,
  shellQuote,
  parseRequirementLine,
  readInstalledDists,
  unmanagedRequirementsWarning
} from './requirementsDrift'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reqs-drift-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function makeSitePackages(root: string, entries: string[]): string {
  const site =
    process.platform === 'win32'
      ? path.join(root, 'Lib', 'site-packages')
      : path.join(root, 'lib', 'python3.12', 'site-packages')
  fs.mkdirSync(site, { recursive: true })
  for (const entry of entries) fs.mkdirSync(path.join(site, entry))
  return site
}

function makeComfy(reqs: string, managerReqs?: string): string {
  const dir = path.join(tmpDir, 'ComfyUI')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'requirements.txt'), reqs)
  if (managerReqs !== undefined) {
    fs.writeFileSync(path.join(dir, 'manager_requirements.txt'), managerReqs)
  }
  return dir
}

const installedOf = (entries: Record<string, string | null>): Map<string, string | null> =>
  new Map(Object.entries(entries))

describe('parseRequirementLine', () => {
  it('reads the name and the minimum version from ==, >= and ~=', () => {
    expect(parseRequirementLine('comfy-aimdo==0.5.5')).toEqual({
      line: 'comfy-aimdo==0.5.5',
      name: 'comfy-aimdo',
      minVersion: '0.5.5',
      specifier: '==0.5.5'
    })
    expect(parseRequirementLine('SQLAlchemy>=2.0.0')?.minVersion).toBe('2.0.0')
    expect(parseRequirementLine('pydantic~=2.0')?.minVersion).toBe('2.0')
    expect(parseRequirementLine('numpy >= 1.25.0')?.minVersion).toBe('1.25.0')
  })

  it('treats an unversioned or upper-bound-only line as presence-only', () => {
    expect(parseRequirementLine('blake3')).toEqual({
      line: 'blake3',
      name: 'blake3',
      minVersion: null,
      specifier: ''
    })
    expect(parseRequirementLine('av<18')?.minVersion).toBeNull()
  })

  it('strips extras and inline comments but keeps the line uv receives', () => {
    expect(parseRequirementLine('uvicorn[standard]>=0.20  # server')).toEqual({
      line: 'uvicorn[standard]>=0.20',
      name: 'uvicorn',
      minVersion: '0.20',
      specifier: '>=0.20'
    })
  })

  it('skips lines it cannot evaluate safely', () => {
    for (const line of [
      '',
      '# comment',
      '#non essential dependencies:',
      '-r other.txt',
      '--extra-index-url https://example.com',
      'pywin32; sys_platform == "win32"',
      'pkg @ https://example.com/pkg.whl',
      'git+https://github.com/x/y',
      'pkg===weird thing'
    ]) {
      expect(parseRequirementLine(line)).toBeNull()
    }
  })

  it('takes the highest of several floors on one line', () => {
    expect(parseRequirementLine('pkg>=1.4.2,~=1.4')?.minVersion).toBe('1.4.2')
    expect(parseRequirementLine('pkg~=1.4,>=1.4.2')?.minVersion).toBe('1.4.2')
  })

  it('ignores wildcard pins as a floor', () => {
    expect(parseRequirementLine('pkg==1.*')?.minVersion).toBeNull()
  })

  it('skips the torch stack, which the torch repair owns', () => {
    for (const line of ['torch', 'torchvision', 'torchaudio>=2']) {
      expect(parseRequirementLine(line)).toBeNull()
    }
  })

  it('checks torchsde: it is an ordinary requirement that crashes the boot when missing', () => {
    expect(parseRequirementLine('torchsde')?.name).toBe('torchsde')
    expect(
      findUnsatisfiedRequirements('torch\ntorchsde\n', installedOf({ torch: '2.10.0' })).map(
        (r) => r.name
      )
    ).toEqual(['torchsde'])
  })
})

describe('normalizeDistName', () => {
  it('follows PEP 503', () => {
    expect(normalizeDistName('Comfy_Aimdo')).toBe('comfy-aimdo')
    expect(normalizeDistName('zope.interface')).toBe('zope-interface')
    expect(normalizeDistName('a__-.b')).toBe('a-b')
  })
})

describe('compareReleases', () => {
  it('compares numeric release segments', () => {
    expect(compareReleases('0.5.5', '0.5.5')).toBe(0)
    expect(compareReleases('0.4.9', '0.5.5')).toBeLessThan(0)
    expect(compareReleases('0.10.0', '0.9')).toBeGreaterThan(0)
    expect(compareReleases('2.0', '2.0.0')).toBe(0)
  })

  it('returns null when either side has no numeric release', () => {
    expect(compareReleases('dev', '1.0')).toBeNull()
    expect(compareReleases('1.0', 'unknown')).toBeNull()
  })
})

describe('readInstalledDists', () => {
  it('reads dist-info and egg-info names and versions', () => {
    const site = makeSitePackages(tmpDir, [
      'comfy_aimdo-0.4.1.dist-info',
      'SQLAlchemy-2.0.36.dist-info',
      'legacy_pkg-1.2-py3.12.egg-info',
      'editable_pkg.egg-info',
      'comfy_aimdo',
      '__pycache__'
    ])
    const dists = readInstalledDists(site)
    expect(dists.get('comfy-aimdo')).toBe('0.4.1')
    expect(dists.get('sqlalchemy')).toBe('2.0.36')
    expect(dists.get('legacy-pkg')).toBe('1.2')
    expect(dists.has('editable-pkg')).toBe(true)
    expect(dists.get('editable-pkg')).toBeNull()
    expect(dists.size).toBe(4)
  })

  it('keeps the newest version when stale metadata leaves two', () => {
    const site = makeSitePackages(tmpDir, ['blake3-1.0.4.dist-info', 'blake3-0.9.0.dist-info'])
    expect(readInstalledDists(site).get('blake3')).toBe('1.0.4')
  })

  it('returns an empty map for an unreadable dir', () => {
    expect(readInstalledDists(path.join(tmpDir, 'missing')).size).toBe(0)
  })
})

describe('findUnsatisfiedRequirements', () => {
  it('flags a missing package', () => {
    const out = findUnsatisfiedRequirements('sqlalchemy>=2.0.0\n', installedOf({}))
    expect(out).toEqual([
      {
        line: 'sqlalchemy>=2.0.0',
        name: 'sqlalchemy',
        minVersion: '2.0.0',
        specifier: '>=2.0.0',
        reason: 'missing'
      }
    ])
  })

  it('flags an install older than an == pin (the comfy_aimdo.storage case)', () => {
    const out = findUnsatisfiedRequirements(
      'comfy-aimdo==0.5.5\n',
      installedOf({ 'comfy-aimdo': '0.4.1' })
    )
    expect(out).toEqual([
      {
        line: 'comfy-aimdo==0.5.5',
        name: 'comfy-aimdo',
        minVersion: '0.5.5',
        specifier: '==0.5.5',
        reason: 'outdated',
        installed: '0.4.1'
      }
    ])
  })

  it('never flags an install newer than a pin', () => {
    const out = findUnsatisfiedRequirements(
      'comfyui-frontend-package==1.53.6\n',
      installedOf({ 'comfyui-frontend-package': '1.60.0' })
    )
    expect(out).toEqual([])
  })

  it('treats an unknown installed version as satisfied', () => {
    const out = findUnsatisfiedRequirements('pkg>=2\n', installedOf({ pkg: null }))
    expect(out).toEqual([])
  })

  it('matches names across _ / - / case differences', () => {
    const out = findUnsatisfiedRequirements(
      'comfy_kitchen==0.2.35\nPyYAML\n',
      installedOf({ 'comfy-kitchen': '0.2.35', pyyaml: '6.0' })
    )
    expect(out).toEqual([])
  })
})

describe('detectRequirementsDrift', () => {
  it('checks requirements.txt and manager_requirements.txt together', () => {
    const comfy = makeComfy('blake3\nfilelock\ntorch\n', 'comfyui_manager==4.2.2\n')
    const site = makeSitePackages(tmpDir, [
      'filelock-3.0.dist-info',
      'comfyui_manager-4.1.0.dist-info'
    ])
    const drift = detectRequirementsDrift(comfy, site)
    expect(drift?.unsatisfied.map((r) => [r.name, r.reason])).toEqual([
      ['blake3', 'missing'],
      ['comfyui-manager', 'outdated']
    ])
  })

  it('reports nothing unsatisfied for a synced venv', () => {
    const comfy = makeComfy('blake3\nsqlalchemy>=2.0.0\n')
    const site = makeSitePackages(tmpDir, ['blake3-1.0.dist-info', 'SQLAlchemy-2.0.36.dist-info'])
    expect(detectRequirementsDrift(comfy, site)?.unsatisfied).toEqual([])
  })

  it('keys the hash on the requirement files, not the installed state', () => {
    const comfy = makeComfy('blake3\n')
    const site = makeSitePackages(tmpDir, ['other-1.0.dist-info'])
    const before = detectRequirementsDrift(comfy, site)!.reqsHash
    fs.mkdirSync(path.join(site, 'blake3-1.0.dist-info'))
    expect(detectRequirementsDrift(comfy, site)!.reqsHash).toBe(before)
    fs.writeFileSync(path.join(comfy, 'requirements.txt'), 'blake3\nalembic\n')
    expect(detectRequirementsDrift(comfy, site)!.reqsHash).not.toBe(before)
  })

  it('returns null without evidence to check against', () => {
    const comfy = makeComfy('blake3\n')
    expect(detectRequirementsDrift(comfy, null)).toBeNull()
    expect(detectRequirementsDrift(comfy, path.join(tmpDir, 'nope'))).toBeNull()
    // An empty site-packages is an unreadable venv, not one missing everything.
    expect(detectRequirementsDrift(comfy, makeSitePackages(tmpDir, []))).toBeNull()
    fs.rmSync(path.join(comfy, 'requirements.txt'))
    expect(detectRequirementsDrift(comfy, makeSitePackages(tmpDir, ['x-1.dist-info']))).toBeNull()
  })
})

describe('envRootForPython', () => {
  it('resolves a venv root from Scripts/ or bin/, and an embedded dir as itself', () => {
    expect(envRootForPython(path.join('/v', '.venv', 'Scripts', 'python.exe'))).toBe(
      path.join('/v', '.venv')
    )
    expect(envRootForPython(path.join('/v', '.venv', 'bin', 'python3'))).toBe(
      path.join('/v', '.venv')
    )
    expect(envRootForPython(path.join('/p', 'python_embeded', 'python.exe'))).toBe(
      path.join('/p', 'python_embeded')
    )
  })
})

describe('unmanagedRequirementsWarning', () => {
  it('suggests uv when the environment has no pip (a uv-created venv)', () => {
    const comfy = makeComfy('sqlalchemy>=2.0.0\n')
    const venv = path.join(tmpDir, '.venv')
    makeSitePackages(venv, ['filelock-3.0.dist-info'])
    const python = path.join(venv, process.platform === 'win32' ? 'Scripts' : 'bin', 'python3')
    const warning = unmanagedRequirementsWarning(python, comfy)
    expect(warning).toContain(
      `uv pip install --python ${shellQuote(python)} -r ${shellQuote(path.join(comfy, 'requirements.txt'))}`
    )
    // uv may not be installed either: seeding pip is the fallback.
    expect(warning).toContain('or, without uv:')
    expect(warning).toContain(`${shellQuote(python)} -m ensurepip`)
  })

  it('names the unsatisfied requirements and the exact pip command', () => {
    const comfy = makeComfy('sqlalchemy>=2.0.0\nfilelock\n')
    const venv = path.join(tmpDir, '.venv')
    makeSitePackages(venv, ['filelock-3.0.dist-info', 'pip-24.0.dist-info'])
    const python =
      process.platform === 'win32'
        ? path.join(venv, 'Scripts', 'python.exe')
        : path.join(venv, 'bin', 'python3')
    const warning = unmanagedRequirementsWarning(python, comfy)
    expect(warning).toContain('sqlalchemy (missing)')
    expect(warning).not.toContain('filelock')
    expect(warning).toContain(
      `${shellQuote(python)} -m pip install -r ${shellQuote(path.join(comfy, 'requirements.txt'))}`
    )
  })

  it('adds -s for an isolated (portable) interpreter', () => {
    const comfy = makeComfy('blake3\n')
    const embedded = path.join(tmpDir, 'python_embeded')
    const site = path.join(embedded, 'Lib', 'site-packages')
    fs.mkdirSync(path.join(site, 'x-1.dist-info'), { recursive: true })
    fs.mkdirSync(path.join(site, 'pip-24.0.dist-info'))
    const python = path.join(embedded, 'python.exe')
    const warning = unmanagedRequirementsWarning(python, comfy, { isolated: true })
    if (process.platform === 'win32') {
      expect(warning).toContain(`& ${shellQuote(python)} -s -m pip install -r`)
    } else {
      // findSitePackages only knows the Windows embedded layout on win32.
      expect(warning).toBeNull()
    }
  })

  it('returns null when everything is satisfied', () => {
    const comfy = makeComfy('blake3\n')
    const venv = path.join(tmpDir, '.venv')
    makeSitePackages(venv, ['blake3-1.0.dist-info'])
    expect(unmanagedRequirementsWarning(path.join(venv, 'bin', 'python3'), comfy)).toBeNull()
  })

  it('checks manager_requirements.txt only when the launch enables Manager', () => {
    const comfy = makeComfy('blake3\n', 'comfyui_manager==4.2.2\n')
    const venv = path.join(tmpDir, '.venv')
    makeSitePackages(venv, ['blake3-1.0.dist-info', 'pip-24.0.dist-info'])
    const python = path.join(venv, process.platform === 'win32' ? 'Scripts' : 'bin', 'python3')
    // Without --enable-manager, a missing Manager is no reason to warn.
    expect(unmanagedRequirementsWarning(python, comfy)).toBeNull()
    expect(unmanagedRequirementsWarning(python, comfy, { withManager: true })).toContain(
      `-m pip install -r ${shellQuote(path.join(comfy, 'requirements.txt'))} -r ${shellQuote(path.join(comfy, 'manager_requirements.txt'))}`
    )
  })
})

describe('unmanagedRequirementsWarning: environments it must judge carefully', () => {
  const pythonIn = (venv: string): string =>
    path.join(venv, process.platform === 'win32' ? 'Scripts' : 'bin', 'python3')

  it('warns about an empty environment instead of saying nothing', () => {
    const comfy = makeComfy('blake3\n')
    const venv = path.join(tmpDir, '.venv')
    makeSitePackages(venv, [])
    const warning = unmanagedRequirementsWarning(pythonIn(venv), comfy)
    expect(warning).toContain('no installed Python packages found')
    expect(warning).toContain('uv pip install --python')
  })

  it('checks the torch stack too, since nothing repairs it here', () => {
    const comfy = makeComfy('torch\nblake3\n')
    const venv = path.join(tmpDir, '.venv')
    makeSitePackages(venv, ['blake3-1.0.dist-info', 'pip-24.0.dist-info'])
    expect(unmanagedRequirementsWarning(pythonIn(venv), comfy)).toContain('torch (missing)')
  })

  it('stays out of a venv that inherits the system site-packages', () => {
    const comfy = makeComfy('blake3\n')
    const venv = path.join(tmpDir, '.venv')
    makeSitePackages(venv, ['pip-24.0.dist-info'])
    fs.writeFileSync(
      path.join(venv, 'pyvenv.cfg'),
      'home = /usr/bin\ninclude-system-site-packages = true\n'
    )
    expect(unmanagedRequirementsWarning(pythonIn(venv), comfy)).toBeNull()
  })

  it('writes a PowerShell command on Windows', () => {
    const comfy = makeComfy('blake3\n')
    const venv = path.join(tmpDir, '.venv')
    makeSitePackages(venv, ['pip-24.0.dist-info'])
    const python = pythonIn(venv)
    const warning = unmanagedRequirementsWarning(python, comfy, { platform: 'win32' })
    expect(warning).toContain('In PowerShell, run:')
    expect(warning).toContain(`& ${shellQuote(python, 'win32')} -m pip install -r`)
  })

  it('strips control characters from what it logs', () => {
    const comfy = makeComfy('blake3\n')
    const venv = path.join(tmpDir, 'ev\u001b[31mil')
    makeSitePackages(venv, ['pip-24.0.dist-info'])
    const warning = unmanagedRequirementsWarning(pythonIn(venv), comfy)!
    expect(warning).not.toContain('\u001b')
    expect(warning).toContain('ev[31mil')
  })
})

describe('comfyuiDirForLaunch', () => {
  it('resolves a git launch (relative main.py in the checkout)', () => {
    const cwd = path.join('/g', 'ComfyUI')
    expect(comfyuiDirForLaunch({ cwd, args: ['-s', 'main.py', '--port', '1'] })).toBe(cwd)
  })

  it('resolves a portable launch (root cwd, absolute ComfyUI/main.py)', () => {
    const root = path.join('/p', 'ComfyUI_windows_portable')
    expect(
      comfyuiDirForLaunch({ cwd: root, args: ['-s', path.join(root, 'ComfyUI', 'main.py')] })
    ).toBe(path.join(root, 'ComfyUI'))
  })

  it('returns null without a main.py argument', () => {
    expect(comfyuiDirForLaunch({ cwd: '/x', args: ['main.py'] })).toBeNull()
    expect(comfyuiDirForLaunch({ args: ['-s', 'main.py'] })).toBeNull()
    // The token after -s must be a main.py, not a flag or another file.
    expect(comfyuiDirForLaunch({ cwd: '/x', args: ['-s', '--port', '1'] })).toBeNull()
    expect(comfyuiDirForLaunch({ cwd: '/x', args: ['-s', 'other.py'] })).toBeNull()
  })
})

describe('shellQuote', () => {
  it('single-quotes on POSIX so $, backticks and backslashes stay literal', () => {
    expect(shellQuote('/a/$(rm -rf x)/`id`/b\\c', 'linux')).toBe("'/a/$(rm -rf x)/`id`/b\\c'")
    expect(shellQuote("/it's/here", 'darwin')).toBe("'/it'\\''s/here'")
  })

  it('uses literal PowerShell single quotes on Windows', () => {
    expect(shellQuote('C:\\Program Files\\py.exe', 'win32')).toBe("'C:\\Program Files\\py.exe'")
    // $ and backticks are inert in single quotes; an embedded ' is doubled.
    expect(shellQuote("C:\\$(calc)\\`x\\it's", 'win32')).toBe("'C:\\$(calc)\\`x\\it''s'")
  })
})
