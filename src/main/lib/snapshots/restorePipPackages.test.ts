// @vitest-environment node
/**
 * Regression tests for the restore revert that deleted pre-existing packages
 * (seen in #1514: an unmodified install went from 100 packages to 6 and
 * ComfyUI no longer booted).
 *
 * The install step had been a no-op — every package was already present — but
 * the failure handler "reverted" those installs by uninstalling them. The
 * trigger there was a mangled package list, but the defect is independent of
 * how the list went wrong: the revert now only uninstalls packages that were
 * provably absent from site-packages before the restore began.
 */
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

// Paths the mocked env accessors hand back; assigned per test in beforeEach.
let uvBinPath = ''
let venvDirPath = ''
let sitePackagesPath = ''
let tmpRoot = ''

const installation = { id: 'test', installPath: '' } as unknown as InstallationRecord

/** Write a package's `.dist-info` directory, as an installed package has. */
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

/** Every `uv pip <verb>` invocation the run made, as recorded arg arrays. */
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
    /**
     * The #1514 shape, reproduced without depending on bug A: the freeze
     * under-reports what is installed, so packages that are in fact present
     * are planned as fresh installs. A later removal failure then triggers the
     * revert. Those packages must survive it.
     */
    const brokenFreezeSetup = (): Snapshot => {
      for (const name of ['aiohttp', 'filelock', 'numpy']) installOnDisk(name, '1.0.0')
      // The freeze sees none of the installed packages, only an extra one.
      vi.mocked(pipFreeze).mockResolvedValue({ 'ghost-pkg': '9.9.9' })
      return snapshotWith({ aiohttp: '1.0.0', filelock: '1.0.0', numpy: '1.0.0' })
    }

    it('leaves packages that were already on disk alone when the restore fails', async () => {
      const target = brokenFreezeSetup()
      // Installs succeed (they are no-ops in reality); every removal fails,
      // exactly as uv rejected the mangled names in the bug report.
      vi.mocked(runUvPip).mockImplementation(async (_uv, args) =>
        (args as string[])[1] === 'uninstall' ? 1 : 0
      )

      const result = await run(target)

      expect(result.failed).toEqual(['ghost-pkg'])
      expect(result.revert).toBeDefined()
      expect(result.revert!.reason).toBe('failures')
      // The three pre-existing packages are recognised and spared...
      expect(result.revert!.keptPreexisting.sort()).toEqual(['aiohttp', 'filelock', 'numpy'])
      expect(result.revert!.uninstalled).toEqual([])
      // ...and no uv invocation ever names them as an uninstall target.
      for (const name of ['aiohttp', 'filelock', 'numpy']) {
        expect(uninstallArgs()).not.toContain(name)
      }
      // Their files are still in site-packages.
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

    // The backup gap both reviewers flagged: a package the freeze omits is
    // planned as new, so the install overwrites the copy already on disk. Not
    // uninstalling it is not the same as putting its original version back —
    // only the backup does that, so it has to be backed up despite not
    // appearing in the freeze.
    it('backs up a disk-detected package whose installed version differs', async () => {
      installOnDisk('aiohttp', '1.0.0')
      const pkgFile = path.join(sitePackagesPath, 'aiohttp', '__init__.py')
      fs.writeFileSync(pkgFile, '# pre-restore 1.0.0\n')
      vi.mocked(pipFreeze).mockResolvedValue({ 'ghost-pkg': '9.9.9' })
      vi.mocked(runUvPip).mockImplementation(async (_uv, args) => {
        const a = args as string[]
        // The install really does overwrite the copy already on disk — that is
        // the whole reason it needs backing up.
        if (a[1] === 'install') {
          fs.writeFileSync(pkgFile, '# snapshot 2.0.0\n')
          return 0
        }
        return 1 // every uninstall fails, tipping the restore into its revert
      })

      // The snapshot wants a different version of the package already on disk.
      const result = await run(snapshotWith({ aiohttp: '2.0.0' }))

      expect(result.revert!.keptPreexisting).toEqual(['aiohttp'])
      expect(result.revert!.uninstalled).toEqual([])
      // Not uninstalling it is not enough: the revert has to put the
      // pre-restore version's files back, which only the backup can do.
      expect(fs.readFileSync(pkgFile, 'utf-8')).toBe('# pre-restore 1.0.0\n')
    })

    it('still uninstalls packages the restore genuinely added', async () => {
      // `brand-new` has no dist-info on disk, so it really is new; the other
      // two predate the restore. Only the new one may be rolled back.
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
      // Both the removal and the revert's uninstall fail.
      vi.mocked(runUvPip).mockResolvedValue(1)

      const result = await run(snapshotWith({ 'brand-new': '2.0.0' }))

      expect(result.revert!.complete).toBe(false)
      expect(result.errors.some((e) => e.includes('did not fully complete'))).toBe(true)
      expect(result.errors.some((e) => e.includes('reverted to pre-restore state'))).toBe(false)
    })

    it('does not claim a complete revert for a package it could not back up', async () => {
      // Legacy metadata only: `findPackageEntries` locates `.dist-info`, so
      // nothing is captured and the install's effect on it cannot be undone.
      fs.mkdirSync(path.join(sitePackagesPath, 'legacy_pkg.egg-info'), { recursive: true })
      vi.mocked(pipFreeze).mockResolvedValue({ 'ghost-pkg': '9.9.9' })
      vi.mocked(runUvPip).mockImplementation(async (_uv, args) =>
        (args as string[])[1] === 'uninstall' ? 1 : 0
      )

      const result = await run(snapshotWith({ 'legacy-pkg': '2.0.0' }))

      // Still never uninstalled — that part holds...
      expect(result.revert!.keptPreexisting).toEqual(['legacy-pkg'])
      expect(result.revert!.uninstalled).toEqual([])
      // ...but the revert is honest that it could not restore it.
      expect(result.revert!.complete).toBe(false)
      expect(output.join('')).toContain('No backup was captured')
    })

    // The restore loop deletes each destination before copying over it, so
    // letting one failure abort would leave the earlier entries deleted and the
    // later ones never restored — a revert that destroys more than it repairs.
    it('keeps restoring the remaining packages when one entry fails', async () => {
      for (const name of ['alpha', 'omega']) {
        installOnDisk(name, '1.0.0')
        fs.writeFileSync(path.join(sitePackagesPath, name, '__init__.py'), `# live ${name}\n`)
      }
      // Both are extras the snapshot does not have, so both get backed up and
      // are removal targets; the removal then fails and tips it into a revert.
      vi.mocked(pipFreeze).mockResolvedValue({ alpha: '1.0.0', omega: '1.0.0' })
      vi.mocked(runUvPip).mockImplementation(async (_uv, args) => {
        const a = args as string[]
        if (a[1] === 'uninstall') {
          // Simulate uv having deleted the files before reporting failure.
          for (const name of ['alpha', 'omega']) {
            fs.rmSync(path.join(sitePackagesPath, name), { recursive: true, force: true })
          }
          return 1
        }
        return 0
      })
      // One entry fails on the way BACK into site-packages (not while the
      // backup is being taken); the rest must still be restored.
      const realCp = fs.promises.cp
      vi.spyOn(fs.promises, 'cp').mockImplementation(async (src, dst, opts) => {
        const target = String(dst)
        if (target.startsWith(sitePackagesPath) && target.includes('alpha')) {
          throw new Error('simulated copy failure')
        }
        return realCp(src as string, dst as string, opts)
      })

      const result = await run(snapshotWith({}))

      // omega came back despite alpha failing...
      expect(fs.readFileSync(path.join(sitePackagesPath, 'omega', '__init__.py'), 'utf-8')).toBe(
        '# live omega\n'
      )
      // ...and the failure is reported rather than papered over.
      expect(result.revert!.complete).toBe(false)
      expect(result.revert!.restoredFromBackup).toBe(false)
    })

    // Cancelling between taking the backup and the first pip call leaves
    // nothing to revert, so an uncaptured backup is not a failure to revert.
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
        // The bulk install fails, then each single install fails, so the phase
        // reports failures; every uninstall (removal + revert) succeeds.
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

  // Legacy setuptools metadata still marks an installed distribution. Missing
  // it would put a pre-existing package back on the revert's uninstall list.
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

  // The bare legacy forms carry the raw name, hyphens and all. Splitting at the
  // first hyphen would read `my-package.egg-link` as `my`, miss the package,
  // and put it back on the revert's uninstall list.
  it('keeps hyphens in bare legacy metadata names', () => {
    fs.writeFileSync(path.join(tmp, 'my-package.egg-link'), '/src/my-package\n')
    fs.mkdirSync(path.join(tmp, 'other-thing.egg-info'), { recursive: true })
    expect(preexistingOnDisk(tmp, ['my-package', 'other-thing'])).toEqual([
      'my-package',
      'other-thing'
    ])
  })

  // `.egg-link` always names the distribution outright, so the version branch
  // must not apply to it: `foo-2bar.egg-link` is `foo-2bar`, not `foo` at
  // version `2bar`.
  it('treats an always-bare .egg-link stem as the whole name', () => {
    fs.writeFileSync(path.join(tmp, 'foo-2bar.egg-link'), '/src/foo-2bar\n')
    expect(preexistingOnDisk(tmp, ['foo'])).toEqual([])
    expect(preexistingOnDisk(tmp, ['foo-2bar'])).toEqual(['foo-2bar'])
  })

  // A longer distribution name must not be mistaken for a version of a
  // shorter one — only a digit can follow the separator.
  it('does not match a package against a longer package name', () => {
    distInfo('foo_bar-1.0')
    expect(preexistingOnDisk(tmp, ['foo'])).toEqual([])
    expect(preexistingOnDisk(tmp, ['foo-bar'])).toEqual(['foo-bar'])
  })

  it('ignores non-dist-info entries', () => {
    fs.mkdirSync(path.join(tmp, 'aiohttp'))
    expect(preexistingOnDisk(tmp, ['aiohttp'])).toEqual([])
  })

  // "Can't tell" must never read as "nothing was installed before" — that is
  // the reading that uninstalls the user's environment (#1514).
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
