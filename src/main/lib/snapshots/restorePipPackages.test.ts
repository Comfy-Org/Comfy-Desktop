import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false }
}))
vi.mock('../git', () => ({
  readGitHead: vi.fn(),
  isGitAvailable: vi.fn(() => false),
  gitClone: vi.fn(),
  gitCheckoutCommit: vi.fn(),
  gitFetchAndCheckout: vi.fn()
}))
vi.mock('../nodes', () => ({
  scanCustomNodes: vi.fn(async () => []),
  nodeKey: vi.fn()
}))
vi.mock('../cnr', () => ({
  installCnrNode: vi.fn(),
  switchCnrVersion: vi.fn(),
  isSafePathComponent: vi.fn(() => true)
}))
vi.mock('../../settings', () => ({
  get: vi.fn(),
  getMirrorConfig: vi.fn(() => undefined)
}))
vi.mock('../pip', () => ({
  pipFreeze: vi.fn(),
  runUvPip: vi.fn(async () => 0),
  installFilteredRequirements: vi.fn(async () => 0),
  getPipIndexArgs: vi.fn(() => [])
}))
vi.mock('../pythonEnv', () => ({
  getActiveUvPath: vi.fn(() => uvBinPath),
  getActivePythonPath: vi.fn(() => '/fake/python'),
  getActiveVenvDir: vi.fn(() => venvDirPath)
}))
vi.mock('../../sources/standalone/envPaths', () => ({
  findSitePackages: vi.fn(() => sitePackagesPath)
}))

import { restorePipPackages, preexistingOnDisk } from './restore'
import { pipFreeze, runUvPip } from '../pip'
import type { Snapshot } from './types'
import type { InstallationRecord } from '../../installations'

let uvBinPath = ''
let venvDirPath = ''
let sitePackagesPath = ''
let tmpRoot = ''

const installation = { id: 'test', installPath: '' } as unknown as InstallationRecord

function installOnDisk(name: string, version: string): void {
  const distInfo = path.join(
    sitePackagesPath,
    `${name.replace(/[-.]+/g, '_')}-${version}.dist-info`
  )
  fs.mkdirSync(distInfo, { recursive: true })
  fs.writeFileSync(path.join(distInfo, 'RECORD'), `${name}/__init__.py,,\n`)
  fs.mkdirSync(path.join(sitePackagesPath, name), { recursive: true })
  fs.writeFileSync(path.join(sitePackagesPath, name, '__init__.py'), '')
}

function snapshotWith(pipPackages: Record<string, string>): Snapshot {
  return {
    version: 2,
    createdAt: new Date().toISOString(),
    trigger: 'manual',
    label: null,
    comfyui: { ref: 'master', commit: 'abc1234', releaseTag: 'v0.36.0', variant: 'nvidia' },
    customNodes: [],
    pipPackages
  }
}

function uvCalls(): string[][] {
  return vi.mocked(runUvPip).mock.calls.map((call) => call[1] as string[])
}

function uninstallArgs(): string[] {
  return uvCalls()
    .filter((args) => args[0] === 'pip' && args[1] === 'uninstall')
    .flatMap((args) => args.slice(2).filter((a) => !a.startsWith('--') && a !== '/fake/python'))
}

const noProgress = (): void => {}

describe('restorePipPackages', () => {
  let output: string[]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(runUvPip).mockResolvedValue(0)
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-pip-'))
    venvDirPath = path.join(tmpRoot, '.venv')
    sitePackagesPath = path.join(venvDirPath, 'lib', 'python3.12', 'site-packages')
    fs.mkdirSync(sitePackagesPath, { recursive: true })
    uvBinPath = path.join(tmpRoot, 'uv')
    fs.writeFileSync(uvBinPath, '')
    installation.installPath = tmpRoot
    output = []
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  const run = (target: Snapshot, signal?: AbortSignal): ReturnType<typeof restorePipPackages> =>
    restorePipPackages(
      tmpRoot,
      installation,
      target,
      noProgress,
      (text) => output.push(text),
      signal
    )

  describe('identity case: live environment already matches the snapshot', () => {
    it('does nothing when the live environment already matches the snapshot', async () => {
      const packages = Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [`pkg-${i}`, `1.${i}.0`])
      )
      for (const [name, version] of Object.entries(packages)) installOnDisk(name, version)
      vi.mocked(pipFreeze).mockResolvedValue({ ...packages })

      const result = await run(snapshotWith({ ...packages }))

      expect(runUvPip).not.toHaveBeenCalled()
      expect(result).toMatchObject({ installed: [], removed: [], changed: [], failed: [] })
      expect(result.revert).toBeUndefined()
      expect(output.join('')).toContain('No package changes needed')
    })
  })

  describe('the revert never uninstalls pre-existing packages', () => {
    const brokenFreezeSetup = (): Snapshot => {
      for (const name of ['aiohttp', 'filelock', 'numpy']) installOnDisk(name, '1.0.0')
      vi.mocked(pipFreeze).mockResolvedValue({ 'ghost-pkg': '9.9.9' })
      return snapshotWith({ aiohttp: '1.0.0', filelock: '1.0.0', numpy: '1.0.0' })
    }

    it('leaves packages that were already on disk alone when the restore fails', async () => {
      const target = brokenFreezeSetup()
      vi.mocked(runUvPip).mockImplementation(async (_uv, args) =>
        (args as string[])[1] === 'uninstall' ? 1 : 0
      )

      const result = await run(target)

      expect(result.failed).toEqual(['ghost-pkg'])
      expect(result.revert).toBeDefined()
      expect(result.revert!.reason).toBe('failures')
      expect(result.revert!.keptPreexisting.sort()).toEqual(['aiohttp', 'filelock', 'numpy'])
      expect(result.revert!.uninstalled).toEqual([])
      for (const name of ['aiohttp', 'filelock', 'numpy']) {
        expect(uninstallArgs()).not.toContain(name)
      }
      for (const name of ['aiohttp', 'filelock', 'numpy']) {
        expect(fs.existsSync(path.join(sitePackagesPath, name, '__init__.py'))).toBe(true)
      }
      expect(output.join('')).toContain('already installed on disk')
    })

    it('leaves them alone when the restore is cancelled, too', async () => {
      const target = brokenFreezeSetup()
      const controller = new AbortController()
      vi.mocked(runUvPip).mockImplementation(async () => {
        controller.abort()
        return 0
      })

      const result = await run(target, controller.signal)

      expect(result.revert?.reason).toBe('cancelled')
      expect(result.revert?.uninstalled).toEqual([])
      for (const name of ['aiohttp', 'filelock', 'numpy']) {
        expect(uninstallArgs()).not.toContain(name)
      }
    })

    it('backs up a disk-detected package whose installed version differs', async () => {
      installOnDisk('aiohttp', '1.0.0')
      const pkgFile = path.join(sitePackagesPath, 'aiohttp', '__init__.py')
      fs.writeFileSync(pkgFile, '# pre-restore 1.0.0\n')
      vi.mocked(pipFreeze).mockResolvedValue({ 'ghost-pkg': '9.9.9' })
      vi.mocked(runUvPip).mockImplementation(async (_uv, args) => {
        const a = args as string[]
        if (a[1] === 'install') {
          fs.writeFileSync(pkgFile, '# snapshot 2.0.0\n')
          return 0
        }
        return 1
      })

      const result = await run(snapshotWith({ aiohttp: '2.0.0' }))

      expect(result.revert!.keptPreexisting).toEqual(['aiohttp'])
      expect(result.revert!.uninstalled).toEqual([])
      expect(fs.readFileSync(pkgFile, 'utf-8')).toBe('# pre-restore 1.0.0\n')
    })

    it('still uninstalls packages the restore genuinely added', async () => {
      installOnDisk('aiohttp', '1.0.0')
      installOnDisk('numpy', '1.0.0')
      vi.mocked(pipFreeze).mockResolvedValue({ 'ghost-pkg': '9.9.9' })
      vi.mocked(runUvPip).mockImplementation(async (_uv, args) =>
        (args as string[])[1] === 'uninstall' && (args as string[]).includes('ghost-pkg') ? 1 : 0
      )

      const result = await run(
        snapshotWith({ aiohttp: '1.0.0', numpy: '1.0.0', 'brand-new': '2.0.0' })
      )

      expect(result.revert!.uninstalled).toEqual(['brand-new'])
      expect(result.revert!.keptPreexisting.sort()).toEqual(['aiohttp', 'numpy'])
      expect(uninstallArgs()).toContain('brand-new')
      expect(uninstallArgs()).not.toContain('aiohttp')
      expect(uninstallArgs()).not.toContain('numpy')
    })
  })

  describe('revert reporting', () => {
    it('reports an incomplete revert instead of asserting a clean one', async () => {
      installOnDisk('ghost-pkg', '9.9.9')
      vi.mocked(pipFreeze).mockResolvedValue({ 'ghost-pkg': '9.9.9' })
      vi.mocked(runUvPip).mockResolvedValue(1)

      const result = await run(snapshotWith({ 'brand-new': '2.0.0' }))

      expect(result.revert!.complete).toBe(false)
      expect(result.errors.some((e) => e.includes('did not fully complete'))).toBe(true)
      expect(result.errors.some((e) => e.includes('reverted to pre-restore state'))).toBe(false)
    })

    it('does not claim a complete revert for a package it could not back up', async () => {
      fs.mkdirSync(path.join(sitePackagesPath, 'legacy_pkg.egg-info'), { recursive: true })
      vi.mocked(pipFreeze).mockResolvedValue({ 'ghost-pkg': '9.9.9' })
      vi.mocked(runUvPip).mockImplementation(async (_uv, args) =>
        (args as string[])[1] === 'uninstall' ? 1 : 0
      )

      const result = await run(snapshotWith({ 'legacy-pkg': '2.0.0' }))

      expect(result.revert!.keptPreexisting).toEqual(['legacy-pkg'])
      expect(result.revert!.uninstalled).toEqual([])
      expect(result.revert!.complete).toBe(false)
      expect(output.join('')).toContain('No backup was captured')
    })

    it('keeps restoring the remaining packages when one entry fails', async () => {
      for (const name of ['alpha', 'omega']) {
        installOnDisk(name, '1.0.0')
        fs.writeFileSync(path.join(sitePackagesPath, name, '__init__.py'), `# live ${name}\n`)
      }
      vi.mocked(pipFreeze).mockResolvedValue({ alpha: '1.0.0', omega: '1.0.0' })
      vi.mocked(runUvPip).mockImplementation(async (_uv, args) => {
        const a = args as string[]
        if (a[1] === 'uninstall') {
          for (const name of ['alpha', 'omega']) {
            fs.rmSync(path.join(sitePackagesPath, name), { recursive: true, force: true })
          }
          return 1
        }
        return 0
      })
      const realCp = fs.promises.cp
      vi.spyOn(fs.promises, 'cp').mockImplementation(async (src, dst, opts) => {
        const target = String(dst)
        if (target.startsWith(sitePackagesPath) && target.includes('alpha')) {
          throw new Error('simulated copy failure')
        }
        return realCp(src as string, dst as string, opts)
      })

      const result = await run(snapshotWith({}))

      expect(fs.readFileSync(path.join(sitePackagesPath, 'omega', '__init__.py'), 'utf-8')).toBe(
        '# live omega\n'
      )
      expect(result.revert!.complete).toBe(false)
      expect(result.revert!.restoredFromBackup).toBe(false)
    })

    it('does not blame an uncaptured backup when no pip work started', async () => {
      fs.mkdirSync(path.join(sitePackagesPath, 'legacy_pkg.egg-info'), { recursive: true })
      vi.mocked(pipFreeze).mockResolvedValue({ 'ghost-pkg': '9.9.9' })
      const controller = new AbortController()
      controller.abort()

      const result = await run(snapshotWith({ 'legacy-pkg': '2.0.0' }), controller.signal)

      expect(result.revert?.reason).toBe('cancelled')
      expect(result.revert?.complete).toBe(true)
      expect(output.join('')).not.toContain('No backup was captured')
    })

    it('reports a clean revert when every step succeeded', async () => {
      installOnDisk('ghost-pkg', '9.9.9')
      vi.mocked(pipFreeze).mockResolvedValue({ 'ghost-pkg': '9.9.9' })
      let installs = 0
      vi.mocked(runUvPip).mockImplementation(async (_uv, args) => {
        const a = args as string[]
        if (a[1] === 'install') {
          installs++
          return 1
        }
        return 0
      })

      const result = await run(snapshotWith({ 'brand-new': '2.0.0' }))

      expect(installs).toBeGreaterThan(0)
      expect(result.failed).toEqual(['brand-new'])
      expect(result.revert!.complete).toBe(true)
      expect(result.revert!.uninstalled).toEqual(['brand-new'])
      expect(result.errors).toContain('Restore reverted to pre-restore state due to failures')
    })
  })
})

describe('preexistingOnDisk', () => {
  let tmp = ''

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preexisting-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const distInfo = (dirName: string): void => {
    fs.mkdirSync(path.join(tmp, `${dirName}.dist-info`), { recursive: true })
  }

  it('reports only the names with a dist-info directory', () => {
    distInfo('aiohttp-3.9.5')
    expect(preexistingOnDisk(tmp, ['aiohttp', 'brand-new'])).toEqual(['aiohttp'])
  })

  it('matches PEP 503 name variants (case and separators)', () => {
    distInfo('typing_extensions-4.12.2')
    distInfo('pillow-11.0.0')
    expect(preexistingOnDisk(tmp, ['typing-extensions', 'Pillow'])).toEqual([
      'typing-extensions',
      'Pillow'
    ])
  })

  it('recognises legacy .egg-info and .egg-link metadata', () => {
    fs.mkdirSync(path.join(tmp, 'oldpkg.egg-info'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'versioned_pkg-1.0-py3.12.egg-info'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'linked_pkg.egg-link'), '/src/linked_pkg\n')
    expect(preexistingOnDisk(tmp, ['oldpkg', 'versioned-pkg', 'linked-pkg', 'absent'])).toEqual([
      'oldpkg',
      'versioned-pkg',
      'linked-pkg'
    ])
  })

  it('keeps hyphens in bare legacy metadata names', () => {
    fs.writeFileSync(path.join(tmp, 'my-package.egg-link'), '/src/my-package\n')
    fs.mkdirSync(path.join(tmp, 'other-thing.egg-info'), { recursive: true })
    expect(preexistingOnDisk(tmp, ['my-package', 'other-thing'])).toEqual([
      'my-package',
      'other-thing'
    ])
  })

  it('treats an always-bare .egg-link stem as the whole name', () => {
    fs.writeFileSync(path.join(tmp, 'foo-2bar.egg-link'), '/src/foo-2bar\n')
    expect(preexistingOnDisk(tmp, ['foo'])).toEqual([])
    expect(preexistingOnDisk(tmp, ['foo-2bar'])).toEqual(['foo-2bar'])
  })

  it('does not match a package against a longer package name', () => {
    distInfo('foo_bar-1.0')
    expect(preexistingOnDisk(tmp, ['foo'])).toEqual([])
    expect(preexistingOnDisk(tmp, ['foo-bar'])).toEqual(['foo-bar'])
  })

  it('ignores non-dist-info entries', () => {
    fs.mkdirSync(path.join(tmp, 'aiohttp'))
    expect(preexistingOnDisk(tmp, ['aiohttp'])).toEqual([])
  })

  it('treats every candidate as pre-existing when site-packages cannot be read', () => {
    expect(preexistingOnDisk(path.join(tmp, 'does-not-exist'), ['aiohttp', 'numpy'])).toEqual([
      'aiohttp',
      'numpy'
    ])
  })

  it('returns an empty list for no candidates', () => {
    expect(preexistingOnDisk(tmp, [])).toEqual([])
  })
})
