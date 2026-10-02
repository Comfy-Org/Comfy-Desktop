import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => '', getVersion: () => '1.1.4' }
}))

const { emit } = vi.hoisted(() => ({ emit: vi.fn() }))
vi.mock('../../lib/telemetry', () => ({ emit }))
vi.mock('../../settings', () => ({
  getMirrorConfig: () => ({ pypiMirror: undefined, useChineseMirrors: false }),
  get: () => undefined
}))

import {
  MAX_FAILED_ATTEMPTS,
  detectInstallDrift,
  pruneMarker,
  depsRepairPolicy,
  pausedRepairNote,
  reportDetectedOnly,
  pendingDrift,
  relaxSpecifier,
  reportPausedRepair,
  repairDeps,
  warnIfSitePackagesEmpty,
  type DepsRepairTools
} from './depsRepair'
import type { InstallationRecord } from '../../installations'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deps-repair-'))
  emit.mockClear()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

const isWin = process.platform === 'win32'

function sitePackagesOf(venv: string): string {
  return isWin
    ? path.join(venv, 'Lib', 'site-packages')
    : path.join(venv, 'lib', 'python3.12', 'site-packages')
}

/** Lay out a venv (python + uv + site-packages) and return its site-packages. */
function makeVenv(
  venv: string,
  dists: string[],
  opts: { uv?: boolean; uvDir?: string } = {}
): string {
  const bin = path.join(venv, isWin ? 'Scripts' : 'bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, isWin ? 'python.exe' : 'python3'), '')
  if (opts.uv !== false) {
    const uvDir = opts.uvDir ?? bin
    fs.mkdirSync(uvDir, { recursive: true })
    fs.writeFileSync(path.join(uvDir, isWin ? 'uv.exe' : 'uv'), '')
  }
  const site = sitePackagesOf(venv)
  fs.mkdirSync(site, { recursive: true })
  for (const d of dists) fs.mkdirSync(path.join(site, d))
  return site
}

function writeReqs(installPath: string, reqs: string): void {
  const comfy = path.join(installPath, 'ComfyUI')
  fs.mkdirSync(comfy, { recursive: true })
  fs.writeFileSync(path.join(comfy, 'requirements.txt'), reqs)
}

/** A managed standalone install: venv at ComfyUI/.venv, uv in standalone-env. */
function managedInstall(
  dists: string[],
  reqs: string,
  over: Partial<InstallationRecord> = {},
  dirName = 'managed'
) {
  const installPath = path.join(tmpDir, dirName)
  writeReqs(installPath, reqs)
  const site = makeVenv(path.join(installPath, 'ComfyUI', '.venv'), dists, {
    uvDir: isWin
      ? path.join(installPath, 'standalone-env')
      : path.join(installPath, 'standalone-env', 'bin')
  })
  const inst = {
    id: 'inst-1',
    name: 'ComfyUI',
    createdAt: '2026-09-26T00:00:00.000Z',
    sourceId: 'standalone',
    installPath,
    variant: 'win-nvidia',
    ...over
  } as InstallationRecord
  return { inst, site }
}

/** An adopted install: the legacy venv (with its own uv) at adoptedBaseDir/.venv. */
function adoptedInstall(dists: string[], reqs: string, opts: { uv?: boolean } = {}) {
  const installPath = path.join(tmpDir, 'adopted')
  const baseDir = path.join(tmpDir, 'Documents', 'ComfyUI')
  writeReqs(installPath, reqs)
  const venv = path.join(baseDir, '.venv')
  const site = makeVenv(venv, dists, opts)
  const inst = {
    id: 'inst-2',
    name: 'ComfyUI',
    createdAt: '2026-09-26T00:00:00.000Z',
    sourceId: 'standalone',
    installPath,
    adopted: true,
    adoptedBaseDir: baseDir,
    adoptedPythonPath: path.join(venv, isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python3'),
    variant: 'legacy-uv-py312'
  } as InstallationRecord
  return { inst, site }
}

function tools(over: Partial<DepsRepairTools> = {}): DepsRepairTools & {
  update: ReturnType<typeof vi.fn>
  confirmRepair: ReturnType<typeof vi.fn>
} {
  return {
    mode: 'auto',
    sendOutput: () => {},
    update: vi.fn(async () => {}),
    confirmRepair: vi.fn(async () => true),
    ...over
  } as never
}

/** A uv stub that "installs" by creating dist-info dirs in `site`. */
function fakeUv(site: string, installs: string[], code = 0) {
  return vi.fn(async (_uvPath: string, _args: string[]) => {
    for (const d of installs) fs.mkdirSync(path.join(site, d), { recursive: true })
    return { code, output: code === 0 ? '' : 'error: network unreachable' }
  })
}

const noFreeze = vi.fn(async () => ({}) as Record<string, string>)

const REQS = 'blake3\nsqlalchemy>=2.0.0\ncomfy-aimdo==0.5.5\ntorch\nnumpy>=1.25.0\n'
const SYNCED = [
  'blake3-1.0.dist-info',
  'SQLAlchemy-2.0.36.dist-info',
  'comfy_aimdo-0.5.5.dist-info',
  'numpy-2.1.0.dist-info'
]

describe('pendingDrift', () => {
  it('is null for a venv that satisfies the requirements', () => {
    const { inst } = managedInstall(SYNCED, REQS)
    expect(pendingDrift(inst)).toBeNull()
  })

  it('reports missing and outdated lines, never the torch family', () => {
    const { inst } = managedInstall(['comfy_aimdo-0.4.1.dist-info', 'numpy-2.1.0.dist-info'], REQS)
    const drift = pendingDrift(inst)!
    expect(drift.unsatisfied.map((r) => r.line)).toEqual([
      'blake3',
      'sqlalchemy>=2.0.0',
      'comfy-aimdo==0.5.5'
    ])
  })

  it('checks the adopted legacy venv, not ComfyUI/.venv', () => {
    const { inst } = adoptedInstall(['numpy-2.1.0.dist-info'], 'sqlalchemy>=2.0.0\nnumpy\n')
    expect(pendingDrift(inst)!.unsatisfied.map((r) => r.name)).toEqual(['sqlalchemy'])
  })
})

describe('repairDeps', () => {
  it('asks before touching an adopted venv, and installs into it when accepted', async () => {
    const { inst, site } = adoptedInstall(['numpy-2.1.0.dist-info'], 'sqlalchemy>=2.0.0\n')
    const drift = pendingDrift(inst)!
    const uv = fakeUv(site, ['SQLAlchemy-2.0.36.dist-info'])
    const t = tools({ mode: 'prompt' })

    await expect(repairDeps(inst, drift, t, { freeze: noFreeze, runUvPip: uv })).resolves.toBe(
      'repaired'
    )

    expect(t.confirmRepair).toHaveBeenCalledWith(drift.unsatisfied)
    expect(uv.mock.calls[0]![0]).toBe(
      path.join(
        inst.adoptedBaseDir as string,
        '.venv',
        isWin ? 'Scripts' : 'bin',
        isWin ? 'uv.exe' : 'uv'
      )
    )
    const args = uv.mock.calls[0]![1] as string[]
    expect(args[args.indexOf('--python') + 1]).toBe(inst.adoptedPythonPath)
  })

  it('leaves an adopted venv untouched when the user skips', async () => {
    const { inst } = adoptedInstall(['numpy-2.1.0.dist-info'], 'sqlalchemy>=2.0.0\n')
    const uv = vi.fn()
    const t = tools({ mode: 'prompt', confirmRepair: vi.fn(async () => false) })

    await expect(
      repairDeps(inst, pendingDrift(inst)!, t, { freeze: noFreeze, runUvPip: uv })
    ).resolves.toBe('declined')

    expect(uv).not.toHaveBeenCalled()
    expect(t.update).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({ outcome: 'declined', adopted: true })
    )
  })

  it('asks again on the next launch after a skip (the decline is not remembered)', async () => {
    const { inst } = adoptedInstall(['numpy-2.1.0.dist-info'], 'sqlalchemy>=2.0.0\n')
    const uv = vi.fn()
    const confirm = vi.fn(async () => false)

    for (let launch = 1; launch <= 2; launch++) {
      const drift = pendingDrift(inst)
      expect(drift).not.toBeNull()
      const t = tools({ mode: 'prompt', confirmRepair: confirm })
      await expect(repairDeps(inst, drift!, t, { freeze: noFreeze, runUvPip: uv })).resolves.toBe(
        'declined'
      )
      // Nothing persisted, so nothing can suppress the next launch's prompt.
      expect(t.update).not.toHaveBeenCalled()
    }
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(uv).not.toHaveBeenCalled()
  })

  it('reports a prompt that could not be shown separately from a Skip', async () => {
    const { inst } = adoptedInstall(['numpy-2.1.0.dist-info'], 'sqlalchemy>=2.0.0\n')
    const uv = vi.fn()
    const output: string[] = []
    const t = tools({
      mode: 'prompt',
      sendOutput: (s) => output.push(s),
      confirmRepair: vi.fn(async () => Promise.reject(new Error('adopt-prompt-unavailable')))
    })

    await expect(
      repairDeps(inst, pendingDrift(inst)!, t, { freeze: noFreeze, runUvPip: uv })
    ).resolves.toBe('prompt_unavailable')
    expect(uv).not.toHaveBeenCalled()
    expect(t.update).not.toHaveBeenCalled()
    expect(output.join('')).toContain('Could not show the prompt')
    expect(output.join('')).not.toContain('Skipped')
    expect(emit).toHaveBeenCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({ outcome: 'prompt_unavailable' })
    )
  })

  it('does not prompt when an adopted venv has no uv to install with', async () => {
    const { inst } = adoptedInstall(['numpy-2.1.0.dist-info'], 'sqlalchemy>=2.0.0\n', { uv: false })
    const output: string[] = []
    const t = tools({ mode: 'prompt', sendOutput: (s) => output.push(s) })

    await expect(
      repairDeps(inst, pendingDrift(inst)!, t, { freeze: noFreeze, runUvPip: vi.fn() })
    ).resolves.toBe('no_uv')

    expect(t.confirmRepair).not.toHaveBeenCalled()
    expect(output.join('')).toContain('Copy & Update')
    expect(output.join('')).toContain('sqlalchemy (missing)')
  })

  it('keeps a wildcard pin as written in the constraints (uv rejects >= with a wildcard)', async () => {
    const { inst, site } = managedInstall(
      ['numpy-2.1.0.dist-info', 'av-17.2.dist-info'],
      'blake3\nnumpy\nav==17.*\n'
    )
    let constraintText = ''
    const uv = vi.fn(async (_uvPath: string, args: string[]) => {
      constraintText = fs.readFileSync(
        path.join(inst.installPath, args[args.indexOf('--constraint') + 1]!),
        'utf-8'
      )
      fs.mkdirSync(path.join(site, 'blake3-1.0.dist-info'))
      return { code: 0, output: '' }
    })
    await repairDeps(inst, pendingDrift(inst)!, tools(), { freeze: noFreeze, runUvPip: uv })
    expect(constraintText.split('\n')).toContain('av==17.*')
  })

  it('floors a satisfied local-version pin on its public version', async () => {
    const { inst, site } = managedInstall(
      ['numpy-2.1.0+vendor.dist-info'],
      'blake3\nnumpy==2.1.0+vendor\n'
    )
    let constraintText = ''
    const uv = vi.fn(async (_uvPath: string, args: string[]) => {
      constraintText = fs.readFileSync(
        path.join(inst.installPath, args[args.indexOf('--constraint') + 1]!),
        'utf-8'
      )
      fs.mkdirSync(path.join(site, 'blake3-1.0.dist-info'))
      return { code: 0, output: '' }
    })
    await expect(
      repairDeps(inst, pendingDrift(inst)!, tools(), { freeze: noFreeze, runUvPip: uv })
    ).resolves.toBe('repaired')
    expect(constraintText.split('\n')).toEqual(['numpy>=2.1.0'])
  })

  it('passes the constraints file by bare name, so a spaced install path survives', async () => {
    // uv splits a --constraint value on whitespace; "(1)" installs and Windows
    // account names with spaces put one in every absolute path.
    const { inst, site } = managedInstall(SYNCED.slice(1), REQS, {}, 'My User/ComfyUI (1)')
    let constraintArg = ''
    let cwdAtCall = ''
    let existedAtCall = false
    const uv = vi.fn(async (_uvPath: string, args: string[], cwd: string) => {
      constraintArg = args[args.indexOf('--constraint') + 1]!
      cwdAtCall = cwd
      existedAtCall = fs.existsSync(path.join(cwd, constraintArg))
      fs.mkdirSync(path.join(site, 'blake3-1.0.dist-info'))
      return { code: 0, output: '' }
    })
    await expect(
      repairDeps(inst, pendingDrift(inst)!, tools(), {
        freeze: async () => ({ torch: '2.10.0' }),
        runUvPip: uv
      })
    ).resolves.toBe('repaired')
    expect(constraintArg).toMatch(/^\.deps-repair-constraints-[0-9a-f-]+\.txt$/)
    expect(constraintArg).not.toMatch(/[\s/\\]/)
    expect(cwdAtCall).toBe(inst.installPath)
    expect(existedAtCall).toBe(true)
  })

  it('asks an adopted install only about the packages it will install', async () => {
    const { inst, site } = adoptedInstall(
      ['numpy-2.1.0.dist-info'],
      'torchsde\nkornia\nsqlalchemy>=2.0.0\nnumpy\n'
    )
    const output: string[] = []
    const t = tools({ mode: 'prompt', sendOutput: (s) => output.push(s) })
    const uv = fakeUv(site, ['SQLAlchemy-2.0.36.dist-info'])
    await expect(
      repairDeps(inst, pendingDrift(inst)!, t, { freeze: noFreeze, runUvPip: uv })
    ).resolves.toBe('partial')
    expect(t.confirmRepair.mock.calls[0]![0].map((r: { name: string }) => r.name)).toEqual([
      'sqlalchemy'
    ])
    expect(output.join('')).toContain('Not installing torchsde (needs torch), kornia (needs torch)')
    expect(output.join('')).toContain(
      'Installed the missing or outdated Python packages except torchsde, kornia'
    )
    expect(emit).toHaveBeenCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({ outcome: 'partial', held_back: ['torchsde', 'kornia'] })
    )
  })

  it('does not prompt an adopted install when everything is held back', async () => {
    const { inst } = adoptedInstall(['numpy-2.1.0.dist-info'], 'torchsde\nspandrel\nnumpy\n')
    // Nothing is installable, so no repair is pending at all...
    expect(pendingDrift(inst)).toBeNull()
    // ...and even if one ran, it would neither prompt nor install.
    const t = tools({ mode: 'prompt' })
    const uv = vi.fn()
    await expect(
      repairDeps(inst, detectInstallDrift(inst)!, t, { freeze: noFreeze, runUvPip: uv })
    ).resolves.toBe('torch_missing')
    expect(t.confirmRepair).not.toHaveBeenCalled()
    expect(uv).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({ outcome: 'torch_missing', held_back: ['torchsde', 'spandrel'] })
    )
  })

  it('installs torchsde when torch is there to pin', async () => {
    const { inst, site } = managedInstall(
      ['numpy-2.1.0.dist-info', 'torch-2.10.0.dist-info'],
      'torch\ntorchsde\nnumpy\n'
    )
    const uv = vi.fn(async (_uvPath: string, args: string[]) => {
      expect(args).toContain('torchsde')
      fs.mkdirSync(path.join(site, 'torchsde-0.2.6.dist-info'))
      return { code: 0, output: '' }
    })
    await expect(
      repairDeps(inst, pendingDrift(inst)!, tools(), {
        freeze: async () => ({ torch: '2.10.0+cu128', numpy: '2.1.0' }),
        runUvPip: uv
      })
    ).resolves.toBe('repaired')
  })

  it('holds torchsde back when no torch is installed, without recording it as failed', async () => {
    const { inst, site } = managedInstall(['numpy-2.1.0.dist-info'], 'torchsde\nblake3\nnumpy\n')
    const output: string[] = []
    const uv = vi.fn(async (_uvPath: string, args: string[]) => {
      expect(args).not.toContain('torchsde')
      fs.mkdirSync(path.join(site, 'blake3-1.0.dist-info'))
      return { code: 0, output: '' }
    })
    const t = tools({ sendOutput: (s) => output.push(s) })
    await expect(
      repairDeps(inst, pendingDrift(inst)!, t, { freeze: noFreeze, runUvPip: uv })
    ).resolves.toBe('partial')
    expect(output.join('')).toContain('Not installing torchsde (needs torch)')
    // Held back, not failed: nothing is recorded against it.
    expect(t.update).not.toHaveBeenCalled()
    // Nothing to do until torch is back; then it is pending again.
    expect(pendingDrift(inst)).toBeNull()
    fs.mkdirSync(path.join(site, 'torch-2.10.0.dist-info'))
    expect(pendingDrift(inst)!.unsatisfied.map((r) => r.name)).toEqual(['torchsde'])
  })

  it('starts no repair when torchsde is the only drift and torch is missing', async () => {
    const { inst } = managedInstall(['numpy-2.1.0.dist-info'], 'torchsde\nnumpy\n')
    expect(pendingDrift(inst)).toBeNull()
    const uv = vi.fn()
    await expect(
      repairDeps(inst, detectInstallDrift(inst)!, tools(), { freeze: noFreeze, runUvPip: uv })
    ).resolves.toBe('torch_missing')
    expect(uv).not.toHaveBeenCalled()
  })

  it('holds spandrel back when torch is there but torchvision is not', async () => {
    // spandrel needs torchvision too: with nothing to pin it, uv could pull a
    // default-index (CPU) torchvision.
    const { inst, site } = managedInstall(
      ['numpy-2.1.0.dist-info', 'torch-2.10.0.dist-info'],
      'spandrel\nkornia\nnumpy\n'
    )
    const output: string[] = []
    const uv = perLineUv(site, { kornia: 'kornia-0.8.3.dist-info' })
    await expect(
      repairDeps(inst, pendingDrift(inst)!, tools({ sendOutput: (s) => output.push(s) }), {
        freeze: async () => ({ torch: '2.10.0+cu128', numpy: '2.1.0' }),
        runUvPip: uv
      })
    ).resolves.toBe('partial')
    expect(uv.calls).toEqual([['kornia']])
    expect(output.join('')).toContain('Not installing spandrel (needs torchvision)')
    // With torchvision present it is installable.
    fs.mkdirSync(path.join(site, 'torchvision-0.25.0.dist-info'))
    expect(pendingDrift(inst)!.unsatisfied.map((r) => r.name)).toEqual(['spandrel'])
  })

  it('does not claim a repair it cannot verify', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(1), REQS)
    const withGiveUp = {
      ...inst,
      depsRepairMarker: { reqsHash: 'older', appVersion: '1.1.4', attempts: { x: 1 } }
    } as InstallationRecord
    const output: string[] = []
    const t = tools({ sendOutput: (s) => output.push(s) })
    await expect(
      repairDeps(withGiveUp, pendingDrift(inst)!, t, {
        freeze: noFreeze,
        runUvPip: fakeUv(site, ['blake3-1.0.dist-info']),
        detect: () => null
      })
    ).resolves.toBe('unverified')
    expect(t.update).not.toHaveBeenCalled()
    expect(output.join('')).toContain('Could not verify the environment after installing.')
    expect(output.join('')).not.toContain('Installed')
    expect(emit).toHaveBeenCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({ outcome: 'unverified' })
    )
  })

  it('reports a cancelled launch as cancelled, without telemetry or give-up', async () => {
    const { inst } = managedInstall(SYNCED.slice(1), REQS)
    const abort = new AbortController()
    const uv = vi.fn(async () => {
      abort.abort()
      return { code: 1, output: '' }
    })
    const t = tools({ signal: abort.signal })

    await expect(
      repairDeps(inst, pendingDrift(inst)!, t, { freeze: noFreeze, runUvPip: uv })
    ).resolves.toBe('cancelled')

    expect(t.update).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('pins the installed torch stack so transitive deps cannot swap it', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(1), REQS)
    let constraintPath = ''
    let constraintText = ''
    const uv = vi.fn(async (_uvPath: string, args: string[]) => {
      constraintPath = path.join(inst.installPath, args[args.indexOf('--constraint') + 1]!)
      constraintText = fs.readFileSync(constraintPath, 'utf-8')
      fs.mkdirSync(path.join(site, 'blake3-1.0.dist-info'))
      return { code: 0, output: '' }
    })
    const freeze = vi.fn(async () => ({
      torch: '2.10.0+cu128',
      'nvidia-cublas-cu12': '12.8.4.1',
      numpy: '2.1.0'
    }))

    await expect(
      repairDeps(inst, pendingDrift(inst)!, tools(), { freeze, runUvPip: uv })
    ).resolves.toBe('repaired')

    expect(path.dirname(constraintPath)).toBe(inst.installPath)
    expect(path.basename(constraintPath)).toMatch(/^\.deps-repair-constraints-.+\.txt$/)
    // Protected pins, plus the requirement files' own bounds with == relaxed
    // to >= so a newer install the user chose is never downgraded.
    expect(constraintText.split('\n').sort()).toEqual([
      'comfy-aimdo>=0.5.5',
      'numpy>=1.25.0',
      'nvidia-cublas-cu12==12.8.4.1',
      'sqlalchemy>=2.0.0',
      'torch==2.10.0+cu128'
    ])
    expect(fs.existsSync(constraintPath)).toBe(false)
  })

  it('relaxes ~= to a floor but keeps explicit upper bounds in the constraints', async () => {
    const { inst, site } = managedInstall(
      ['numpy-2.1.0.dist-info', 'pydantic-3.1.0.dist-info', 'av-17.0.dist-info'],
      'blake3\nnumpy\npydantic~=2.0\nav>=17,<18\n'
    )
    let constraintText = ''
    const uv = vi.fn(async (_uvPath: string, args: string[]) => {
      constraintText = fs.readFileSync(
        path.join(inst.installPath, args[args.indexOf('--constraint') + 1]!),
        'utf-8'
      )
      fs.mkdirSync(path.join(site, 'blake3-1.0.dist-info'))
      return { code: 0, output: '' }
    })
    await repairDeps(inst, pendingDrift(inst)!, tools(), { freeze: noFreeze, runUvPip: uv })
    expect(constraintText.split('\n').sort()).toEqual(['av>=17,<18', 'pydantic>=2.0'])
  })

  it('leaves a protected package unpinned when it is itself unsatisfied', async () => {
    const { inst, site } = managedInstall(['numpy-2.1.0.dist-info'], 'setuptools>=70\nnumpy\n')
    let constraintText = ''
    const uv = vi.fn(async (_uvPath: string, args: string[]) => {
      constraintText = fs.readFileSync(
        path.join(inst.installPath, args[args.indexOf('--constraint') + 1]!),
        'utf-8'
      )
      fs.mkdirSync(path.join(site, 'setuptools-75.0.dist-info'))
      return { code: 0, output: '' }
    })
    const freeze = vi.fn(async () => ({ setuptools: '65.0.0', torch: '2.10.0' }))
    await repairDeps(inst, pendingDrift(inst)!, tools(), { freeze, runUvPip: uv })
    expect(constraintText.split('\n').sort()).toEqual(['setuptools>=70', 'torch==2.10.0'])
  })

  it('fails without installing when the installed packages cannot be read', async () => {
    const { inst } = managedInstall(SYNCED.slice(1), REQS)
    const uv = vi.fn()
    const freeze = vi.fn(async () => Promise.reject(new Error('uv pip freeze failed')))

    await expect(
      repairDeps(inst, pendingDrift(inst)!, tools(), { freeze, runUvPip: uv })
    ).resolves.toBe('failed')
    expect(uv).not.toHaveBeenCalled()
  })
})

/** A uv stub that installs line by line: `installs` maps a requirement line to
 *  the dist-info it creates; a line mapped to a number fails with that exit code;
 *  an unmapped line "succeeds" without installing anything (uv accepted it, but
 *  it still reads as unsatisfied). */
function perLineUv(site: string, installs: Record<string, string | number>) {
  const calls: string[][] = []
  const fn = vi.fn(async (_uvPath: string, args: string[]) => {
    const lines = args.slice(2, args.indexOf('--python'))
    calls.push(lines)
    const effect = installs[lines[0]!]
    if (typeof effect === 'number') return { code: effect, output: `error ${effect}` }
    if (effect) fs.mkdirSync(path.join(site, effect), { recursive: true })
    return { code: 0, output: '' }
  })
  return Object.assign(fn, { calls })
}

/** Run `launches` repairs, carrying the record's updates between them like the
 *  launch does; stops early once the drift is suppressed. */
async function launchRepeatedly(
  inst: InstallationRecord,
  uv: ReturnType<typeof perLineUv>,
  launches: number,
  freeze: () => Promise<Record<string, string>> = async () => ({ torch: '2.10.0' })
): Promise<{ record: InstallationRecord; outcomes: string[] }> {
  let record = inst
  const outcomes: string[] = []
  for (let i = 0; i < launches; i++) {
    const drift = pendingDrift(record)
    if (!drift) break
    const t = tools()
    outcomes.push(await repairDeps(record, drift, t, { freeze, runUvPip: uv }))
    for (const [data] of t.update.mock.calls) record = { ...record, ...(data as object) }
  }
  return { record, outcomes }
}

describe('repair marker', () => {
  it('repairs a managed install without asking, one line at a time', async () => {
    const { inst, site } = managedInstall(
      ['numpy-2.1.0.dist-info', 'comfy_aimdo-0.4.1.dist-info'],
      REQS
    )
    const uv = perLineUv(site, {
      blake3: 'blake3-1.0.dist-info',
      'sqlalchemy>=2.0.0': 'SQLAlchemy-2.0.36.dist-info',
      'comfy-aimdo==0.5.5': 'comfy_aimdo-0.5.5.dist-info'
    })
    const t = tools()
    await expect(
      repairDeps(inst, pendingDrift(inst)!, t, {
        freeze: async () => ({ torch: '2.10.0' }),
        runUvPip: uv
      })
    ).resolves.toBe('repaired')
    expect(t.confirmRepair).not.toHaveBeenCalled()
    expect(uv.calls).toEqual([['blake3'], ['sqlalchemy>=2.0.0'], ['comfy-aimdo==0.5.5']])
    const args = uv.mock.calls[0]![1]
    expect(args).toContain('--python')
    expect(args).not.toContain('torch')
    expect(t.update).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({
        outcome: 'repaired',
        adopted: false,
        variant: 'win-nvidia',
        packages: ['blake3', 'sqlalchemy', 'comfy-aimdo'],
        missing_count: 2,
        outdated_count: 1
      })
    )
  })

  it('retries a failing package on later launches, then suppresses it and says so', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(1), REQS)
    const reqsHash = pendingDrift(inst)!.reqsHash
    const { record, outcomes } = await launchRepeatedly(inst, perLineUv(site, { blake3: 2 }), 5)
    expect(outcomes).toEqual(['failed', 'failed', 'failed'])
    expect(record.depsRepairMarker).toEqual({
      reqsHash,
      appVersion: '1.1.4',
      attempts: { blake3: MAX_FAILED_ATTEMPTS }
    })
    expect(emit).toHaveBeenCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({ outcome: 'failed', uv_exit: 2, attempts: MAX_FAILED_ATTEMPTS })
    )
    // Suppressed: no repair, but every launch logs and reports it.
    expect(pendingDrift(record)).toBeNull()
    emit.mockClear()
    const output: string[] = []
    expect(reportPausedRepair(record, (s) => output.push(s))).toBe(true)
    expect(output.join('')).toContain('Automatic repair paused after 3 failed attempts')
    expect(output.join('')).toContain('blake3 (missing)')
    expect(emit).toHaveBeenCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({ outcome: 'paused', packages: ['blake3'] })
    )
    // A new Desktop version, or new requirement files, lift it.
    expect(pendingDrift(record, '1.1.5')).not.toBeNull()
    expect(pausedRepairNote(record, '1.1.5')).toBeNull()
    writeReqs(inst.installPath, REQS + 'alembic\n')
    expect(pendingDrift(record)).not.toBeNull()
  })

  it('does not suppress while the budget remains, or once nothing is missing', () => {
    const { inst } = managedInstall(SYNCED.slice(1), REQS)
    const twice = {
      ...inst,
      depsRepairMarker: {
        reqsHash: pendingDrift(inst)!.reqsHash,
        appVersion: '1.1.4',
        attempts: { blake3: 2 }
      }
    } as InstallationRecord
    expect(pendingDrift(twice)).not.toBeNull()
    expect(pausedRepairNote(twice)).toBeNull()
    const { inst: synced } = managedInstall(SYNCED, REQS, {}, 'synced')
    expect(pausedRepairNote(synced)).toBeNull()
  })

  it('installs what it can when one package is unresolvable', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(2), REQS)
    const uv = perLineUv(site, { blake3: 'blake3-1.0.dist-info', 'sqlalchemy>=2.0.0': 1 })
    const t = tools()
    await expect(
      repairDeps(inst, pendingDrift(inst)!, t, {
        freeze: async () => ({ torch: '2.10.0' }),
        runUvPip: uv
      })
    ).resolves.toBe('partial')
    expect(fs.existsSync(path.join(site, 'blake3-1.0.dist-info'))).toBe(true)
    expect(t.update).toHaveBeenCalledWith({
      depsRepairMarker: expect.objectContaining({ attempts: { sqlalchemy: 1 } })
    })
    expect(emit).toHaveBeenCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({ outcome: 'partial', remaining: ['sqlalchemy'], uv_exit: 1 })
    )
  })

  it('suppresses a stuck package and a failing one together (they share one marker)', async () => {
    // blake3: uv accepts it but it never shows up. sqlalchemy: uv fails.
    const { inst, site } = managedInstall(SYNCED.slice(2), REQS)
    const uv = perLineUv(site, { 'sqlalchemy>=2.0.0': 1 })
    const { record, outcomes } = await launchRepeatedly(inst, uv, 6)
    expect(outcomes).toEqual(['failed', 'failed', 'failed'])
    expect(record.depsRepairMarker).toMatchObject({
      attempts: { blake3: MAX_FAILED_ATTEMPTS, sqlalchemy: MAX_FAILED_ATTEMPTS }
    })
    expect(uv).toHaveBeenCalledTimes(6)
    expect(pendingDrift(record)).toBeNull()
    expect(pausedRepairNote(record)).toContain('Automatic repair paused')
  })

  it('suppresses a stuck package alongside a held-back one, and lifts when torch returns', async () => {
    // No torch: torchsde is held back; blake3 is accepted by uv but never shows up.
    const { inst, site } = managedInstall(['numpy-2.1.0.dist-info'], 'blake3\ntorchsde\nnumpy\n')
    const uv = perLineUv(site, {})
    const { record, outcomes } = await launchRepeatedly(inst, uv, 6, noFreeze)
    expect(outcomes).toEqual(['failed', 'failed', 'failed'])
    expect(uv.calls).toEqual([['blake3'], ['blake3'], ['blake3']])
    expect(record.depsRepairMarker).toMatchObject({ attempts: { blake3: 3 } })
    expect(emit).toHaveBeenCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({ outcome: 'failed', held_back: ['torchsde'] })
    )
    expect(pendingDrift(record)).toBeNull()
    expect(pausedRepairNote(record)).toContain('Automatic repair paused')
    // torch comes back: torchsde is installable now, so the suppression lifts.
    fs.mkdirSync(path.join(site, 'torch-2.10.0.dist-info'))
    expect(pendingDrift(record)!.unsatisfied.map((r) => r.name)).toEqual(['blake3', 'torchsde'])
    expect(pausedRepairNote(record)).toBeNull()
  })

  it('does not report a suppression when only held-back packages remain', () => {
    const { inst } = managedInstall(['numpy-2.1.0.dist-info'], 'blake3\ntorchsde\nnumpy\n')
    const stale = {
      ...inst,
      depsRepairMarker: {
        reqsHash: pendingDrift(inst)!.reqsHash,
        appVersion: '1.1.4',
        attempts: { blake3: MAX_FAILED_ATTEMPTS }
      }
    } as InstallationRecord
    expect(pendingDrift(stale)).toBeNull()
    // blake3 got installed some other way; only the held-back torchsde is left.
    fs.mkdirSync(
      path.join(
        sitePackagesOf(path.join(inst.installPath, 'ComfyUI', '.venv')),
        'blake3-1.0.dist-info'
      )
    )
    expect(pausedRepairNote(stale)).toBeNull()
    expect(pendingDrift(stale)).toBeNull()
  })

  it('stops prompting an adopted install once suppressed', async () => {
    const { inst, site } = adoptedInstall(['numpy-2.1.0.dist-info'], 'sqlalchemy>=2.0.0\nnumpy\n')
    const uv = perLineUv(site, { 'sqlalchemy>=2.0.0': 1 })
    const confirm = vi.fn(async () => true)
    let record = inst
    let prompts = 0
    for (let launch = 0; launch < 5; launch++) {
      const drift = pendingDrift(record)
      if (!drift) continue
      const t = tools({ mode: 'prompt', confirmRepair: confirm })
      await repairDeps(record, drift, t, {
        freeze: async () => ({ torch: '2.10.0' }),
        runUvPip: uv
      })
      prompts = confirm.mock.calls.length
      for (const [data] of t.update.mock.calls) record = { ...record, ...(data as object) }
    }
    expect(prompts).toBe(MAX_FAILED_ATTEMPTS)
    expect(pausedRepairNote(record)).toContain('Automatic repair paused')
  })

  it('still repairs a package that goes missing while another is suppressed', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(2), REQS)
    const suppressedFor = {
      ...inst,
      depsRepairMarker: {
        reqsHash: pendingDrift(inst)!.reqsHash,
        appVersion: '1.1.4',
        attempts: { blake3: MAX_FAILED_ATTEMPTS }
      }
    } as InstallationRecord
    const drift = pendingDrift(suppressedFor)
    expect(drift!.unsatisfied.map((r) => r.name)).toEqual(['blake3', 'sqlalchemy'])
    const uv = perLineUv(site, { blake3: 1, 'sqlalchemy>=2.0.0': 'SQLAlchemy-2.0.36.dist-info' })
    const output: string[] = []
    const t = tools({ sendOutput: (s) => output.push(s) })
    await expect(
      repairDeps(suppressedFor, drift!, t, {
        freeze: async () => ({ torch: '2.10.0' }),
        runUvPip: uv
      })
    ).resolves.toBe('partial')
    expect(fs.existsSync(path.join(site, 'SQLAlchemy-2.0.36.dist-info'))).toBe(true)
    // blake3 has had its attempts: it is skipped (and says so), not retried.
    expect(uv.calls).toEqual([['sqlalchemy>=2.0.0']])
    expect(output.join('')).toContain('Automatic repair paused for blake3')
    const after = { ...suppressedFor } as InstallationRecord
    for (const [data] of t.update.mock.calls) Object.assign(after, data as object)
    expect(after.depsRepairMarker).toMatchObject({ attempts: { blake3: MAX_FAILED_ATTEMPTS } })
    expect(pendingDrift(after)).toBeNull()
  })

  it('gives a package failing for the first time the full budget', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(2), REQS)
    const suppressedFor = {
      ...inst,
      depsRepairMarker: {
        reqsHash: pendingDrift(inst)!.reqsHash,
        appVersion: '1.1.4',
        attempts: { blake3: MAX_FAILED_ATTEMPTS }
      }
    } as InstallationRecord
    const t = tools()
    await repairDeps(suppressedFor, pendingDrift(suppressedFor)!, t, {
      freeze: async () => ({ torch: '2.10.0' }),
      runUvPip: perLineUv(site, { blake3: 1, 'sqlalchemy>=2.0.0': 1 })
    })
    // Counted per package: sqlalchemy starts its own count, blake3 keeps its.
    expect(t.update).toHaveBeenCalledWith({
      depsRepairMarker: expect.objectContaining({
        attempts: { blake3: MAX_FAILED_ATTEMPTS, sqlalchemy: 1 }
      })
    })
  })

  it('clears the marker once nothing is left', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(1), REQS)
    const withMarker = {
      ...inst,
      depsRepairMarker: {
        reqsHash: pendingDrift(inst)!.reqsHash,
        appVersion: '1.1.4',
        attempts: { blake3: 1 }
      }
    } as InstallationRecord
    const t = tools()
    await expect(
      repairDeps(withMarker, pendingDrift(withMarker)!, t, {
        freeze: noFreeze,
        runUvPip: perLineUv(site, { blake3: 'blake3-1.0.dist-info' })
      })
    ).resolves.toBe('repaired')
    expect(t.update).toHaveBeenCalledWith({ depsRepairMarker: null })
  })

  it('judges partial by membership: a repaired package counts even if another broke', async () => {
    // Installing blake3 knocks numpy out; the counts match but blake3 was repaired.
    const { inst, site } = managedInstall(SYNCED.slice(1), REQS)
    const uv = vi.fn(async () => {
      fs.mkdirSync(path.join(site, 'blake3-1.0.dist-info'))
      fs.rmSync(path.join(site, 'numpy-2.1.0.dist-info'), { recursive: true })
      return { code: 0, output: '' }
    })
    await expect(
      repairDeps(inst, pendingDrift(inst)!, tools(), {
        freeze: async () => ({ torch: '2.10.0' }),
        runUvPip: uv
      })
    ).resolves.toBe('partial')
  })

  it('words a uv failure and a still-unsatisfied install differently', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(2), REQS)
    const output: string[] = []
    await repairDeps(inst, pendingDrift(inst)!, tools({ sendOutput: (s) => output.push(s) }), {
      freeze: async () => ({ torch: '2.10.0' }),
      runUvPip: perLineUv(site, { 'sqlalchemy>=2.0.0': 1 })
    })
    const log = output.join('')
    expect(log).toContain('Could not install sqlalchemy (missing).')
    expect(log).toContain('Installed, but still not satisfied: blake3 (missing)')
    expect(log).toContain('Will retry on next launch.')
  })

  it('drops a marker on a launch where nothing is unsatisfied', async () => {
    const { inst } = managedInstall(SYNCED, REQS)
    const withMarker = {
      ...inst,
      depsRepairMarker: { reqsHash: 'x', appVersion: '1.1.4', attempts: { blake3: 3 } }
    } as InstallationRecord
    const update = vi.fn(async () => {})
    const pruned = await pruneMarker(withMarker, update)
    expect(update).toHaveBeenCalledWith({ depsRepairMarker: null })
    expect(pruned.depsRepairMarker).toBeNull()
  })

  it('prunes a recovered package while another keeps the repair suppressed', async () => {
    // blake3 and sqlalchemy both spent; sqlalchemy recovers, blake3 stays missing.
    const { inst, site } = managedInstall(SYNCED.slice(2), REQS)
    const reqsHash = pendingDrift(inst)!.reqsHash
    const marker = { reqsHash, appVersion: '1.1.4', attempts: { blake3: 3, sqlalchemy: 3 } }
    fs.mkdirSync(path.join(site, 'SQLAlchemy-2.0.36.dist-info'))
    const update = vi.fn(async () => {})
    const pruned = await pruneMarker(
      { ...inst, depsRepairMarker: marker } as InstallationRecord,
      update
    )
    expect(update).toHaveBeenCalledWith({
      depsRepairMarker: { reqsHash, appVersion: '1.1.4', attempts: { blake3: 3 } }
    })
    expect(pendingDrift(pruned)).toBeNull()
    // sqlalchemy goes missing again: it gets a fresh attempt.
    fs.rmSync(path.join(site, 'SQLAlchemy-2.0.36.dist-info'), { recursive: true })
    expect(pendingDrift(pruned)!.unsatisfied.map((r) => r.name)).toEqual(['blake3', 'sqlalchemy'])
  })

  it('leaves the marker alone while everything in it is still unsatisfied', async () => {
    const { inst } = managedInstall(SYNCED.slice(1), REQS)
    const withMarker = {
      ...inst,
      depsRepairMarker: { reqsHash: 'x', appVersion: '1.1.4', attempts: { blake3: 2 } }
    } as InstallationRecord
    const update = vi.fn(async () => {})
    expect(await pruneMarker(withMarker, update)).toBe(withMarker)
    expect(update).not.toHaveBeenCalled()
  })

  it('reports the last failing install when several fail', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(2), REQS)
    await repairDeps(inst, pendingDrift(inst)!, tools(), {
      freeze: async () => ({ torch: '2.10.0' }),
      runUvPip: perLineUv(site, { blake3: 2, 'sqlalchemy>=2.0.0': 1 })
    })
    expect(emit).toHaveBeenCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({ outcome: 'failed', uv_exit: 1 })
    )
  })
})

describe('warnIfSitePackagesEmpty', () => {
  it('warns and reports telemetry for a readable but empty site-packages', () => {
    const { inst } = managedInstall([], REQS)
    const output: string[] = []
    expect(pendingDrift(inst)).toBeNull()
    expect(warnIfSitePackagesEmpty(inst, (s) => output.push(s))).toBe(true)
    expect(output.join('')).toContain('no installed Python packages found')
    expect(emit).toHaveBeenCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({ outcome: 'site_packages_empty', adopted: false })
    )
  })

  it('stays quiet for a populated or missing site-packages', () => {
    const { inst } = managedInstall(SYNCED, REQS)
    expect(warnIfSitePackagesEmpty(inst)).toBe(false)
    const missing = { ...inst, installPath: path.join(tmpDir, 'nowhere') } as InstallationRecord
    expect(warnIfSitePackagesEmpty(missing)).toBe(false)
    expect(emit).not.toHaveBeenCalled()
  })
})

describe('relaxSpecifier', () => {
  it('relaxes == and ~= to a floor and keeps everything else', () => {
    expect(relaxSpecifier('==0.5.5')).toBe('>=0.5.5')
    expect(relaxSpecifier('~=2.0')).toBe('>=2.0')
    expect(relaxSpecifier('>=17,<18')).toBe('>=17,<18')
    expect(relaxSpecifier('==1.*')).toBe('==1.*')
    expect(relaxSpecifier('===1.0')).toBe('===1.0')
    expect(relaxSpecifier('>=1.4.2, ~=1.4')).toBe('>=1.4.2,>=1.4')
    // uv rejects a local version label with >=.
    expect(relaxSpecifier('==2.1.0+vendor')).toBe('>=2.1.0')
  })
})

describe('depsRepairPolicy', () => {
  const adopted = (): InstallationRecord => adoptedInstall([], 'blake3\n').inst
  const managed = (): InstallationRecord => managedInstall([], 'blake3\n').inst

  it('repairs managed installs without asking, and asks adopted installs first', () => {
    expect(depsRepairPolicy(managed(), 'auto')).toBe('auto')
    expect(depsRepairPolicy(adopted(), 'auto')).toBe('prompt')
  })

  it('turns every repair off under the kill switch, adopted installs included', () => {
    expect(depsRepairPolicy(managed(), 'off')).toBe('off')
    expect(depsRepairPolicy(adopted(), 'off')).toBe('off')
  })
})

describe('reportDetectedOnly', () => {
  it('logs and reports drift without touching the venv', () => {
    const { inst } = managedInstall(SYNCED.slice(2), REQS)
    const output: string[] = []
    reportDetectedOnly(inst, detectInstallDrift(inst)!, (s) => output.push(s))
    expect(output.join('')).toContain('blake3 (missing), sqlalchemy (missing)')
    expect(output.join('')).toContain('Not repaired automatically')
    expect(emit).toHaveBeenCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({
        outcome: 'detected',
        adopted: false,
        packages: ['blake3', 'sqlalchemy']
      })
    )
  })
})
