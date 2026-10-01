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
  pausedRepairNote,
  pendingDrift,
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
  confirmAdoptedRepair: ReturnType<typeof vi.fn>
} {
  return {
    sendOutput: () => {},
    update: vi.fn(async () => {}),
    confirmAdoptedRepair: vi.fn(async () => true),
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

  it('stays quiet once given up on the same requirements, and retries when they change', () => {
    const { inst } = managedInstall([...SYNCED.slice(1)], REQS)
    const drift = pendingDrift(inst)!
    const gaveUp = {
      ...inst,
      depsRepairGaveUp: { reqsHash: drift.reqsHash, packages: ['blake3'], at: 1 }
    }
    expect(pendingDrift(gaveUp as InstallationRecord)).toBeNull()
    writeReqs(inst.installPath, REQS + 'alembic\n')
    expect(pendingDrift(gaveUp as InstallationRecord)).not.toBeNull()
  })
})

describe('repairDeps', () => {
  it('repairs a managed install without asking, installing only the unsatisfied lines', async () => {
    const { inst, site } = managedInstall(
      ['numpy-2.1.0.dist-info', 'comfy_aimdo-0.4.1.dist-info'],
      REQS
    )
    const drift = pendingDrift(inst)!
    const uv = fakeUv(site, [
      'blake3-1.0.dist-info',
      'sqlalchemy-2.0.36.dist-info',
      'comfy_aimdo-0.5.5.dist-info'
    ])
    const t = tools()

    await expect(repairDeps(inst, drift, t, { freeze: noFreeze, runUvPip: uv })).resolves.toBe(
      'repaired'
    )

    expect(t.confirmAdoptedRepair).not.toHaveBeenCalled()
    const args = uv.mock.calls[0]![1] as string[]
    expect(args.slice(0, 5)).toEqual([
      'pip',
      'install',
      'blake3',
      'sqlalchemy>=2.0.0',
      'comfy-aimdo==0.5.5'
    ])
    expect(args).toContain('--python')
    expect(args).not.toContain('torch')
    expect(args).not.toContain('numpy>=1.25.0')
    expect(pendingDrift(inst)).toBeNull()
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

  it('asks before touching an adopted venv, and installs into it when accepted', async () => {
    const { inst, site } = adoptedInstall(['numpy-2.1.0.dist-info'], 'sqlalchemy>=2.0.0\n')
    const drift = pendingDrift(inst)!
    const uv = fakeUv(site, ['SQLAlchemy-2.0.36.dist-info'])
    const t = tools()

    await expect(repairDeps(inst, drift, t, { freeze: noFreeze, runUvPip: uv })).resolves.toBe(
      'repaired'
    )

    expect(t.confirmAdoptedRepair).toHaveBeenCalledWith(drift.unsatisfied)
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
    const t = tools({ confirmAdoptedRepair: vi.fn(async () => false) })

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
      const t = tools({ confirmAdoptedRepair: confirm })
      await expect(repairDeps(inst, drift!, t, { freeze: noFreeze, runUvPip: uv })).resolves.toBe(
        'declined'
      )
      // Nothing persisted, so nothing can suppress the next launch's prompt.
      expect(t.update).not.toHaveBeenCalled()
    }
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(uv).not.toHaveBeenCalled()
  })

  it('treats a prompt that cannot be delivered as a skip', async () => {
    const { inst } = adoptedInstall(['numpy-2.1.0.dist-info'], 'sqlalchemy>=2.0.0\n')
    const uv = vi.fn()
    const t = tools({
      confirmAdoptedRepair: vi.fn(async () => Promise.reject(new Error('adopt-prompt-unavailable')))
    })

    await expect(
      repairDeps(inst, pendingDrift(inst)!, t, { freeze: noFreeze, runUvPip: uv })
    ).resolves.toBe('declined')
    expect(uv).not.toHaveBeenCalled()
  })

  it('does not prompt when an adopted venv has no uv to install with', async () => {
    const { inst } = adoptedInstall(['numpy-2.1.0.dist-info'], 'sqlalchemy>=2.0.0\n', { uv: false })
    const output: string[] = []
    const t = tools({ sendOutput: (s) => output.push(s) })

    await expect(
      repairDeps(inst, pendingDrift(inst)!, t, { freeze: noFreeze, runUvPip: vi.fn() })
    ).resolves.toBe('no_uv')

    expect(t.confirmAdoptedRepair).not.toHaveBeenCalled()
    expect(output.join('')).toContain('Copy & Update')
    expect(output.join('')).toContain('sqlalchemy (missing)')
  })

  it('retries a failed install on later launches, up to a limit per requirement set', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(1), REQS)
    const drift = pendingDrift(inst)!
    let record = inst
    for (let attempt = 1; attempt <= MAX_FAILED_ATTEMPTS; attempt++) {
      expect(pendingDrift(record)).not.toBeNull()
      const t = tools()
      await expect(
        repairDeps(record, drift, t, { freeze: noFreeze, runUvPip: fakeUv(site, [], 2) })
      ).resolves.toBe('failed')
      expect(t.update).toHaveBeenCalledWith({
        depsRepairFailures: { reqsHash: drift.reqsHash, count: attempt, appVersion: '1.1.4' }
      })
      record = { ...record, ...(t.update.mock.calls[0]![0] as object) } as InstallationRecord
    }
    expect(emit).toHaveBeenLastCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({ outcome: 'failed', uv_exit: 2, attempts: MAX_FAILED_ATTEMPTS })
    )
    // Budget spent: no more uv runs, but the pause is logged on every launch.
    expect(pendingDrift(record)).toBeNull()
    expect(pausedRepairNote(record)).toContain('Automatic repair paused after 3 failed attempts')
    expect(pausedRepairNote(record)).toContain('blake3 (missing)')
    // A new Desktop version resets the budget...
    expect(pendingDrift(record, '1.1.5')).not.toBeNull()
    expect(pausedRepairNote(record, '1.1.5')).toBeNull()
    // ...and so do new requirement files.
    writeReqs(inst.installPath, REQS + 'alembic\n')
    expect(pendingDrift(record)).not.toBeNull()
    expect(pausedRepairNote(record)).toBeNull()
  })

  it('has no paused note while the budget remains or nothing is missing', () => {
    const { inst } = managedInstall(SYNCED.slice(1), REQS)
    const drift = pendingDrift(inst)!
    const twice = {
      ...inst,
      depsRepairFailures: { reqsHash: drift.reqsHash, count: 2, appVersion: '1.1.4' }
    } as InstallationRecord
    expect(pausedRepairNote(twice)).toBeNull()
    const { inst: synced } = managedInstall(SYNCED, REQS, {}, 'synced')
    expect(pausedRepairNote(synced)).toBeNull()
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

  it('retries one line at a time when the batch fails, installing what it can', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(2), REQS)
    const drift = pendingDrift(inst)!
    const calls: string[][] = []
    const uv = vi.fn(async (_uvPath: string, args: string[]) => {
      const lines = args.slice(2, args.indexOf('--python'))
      calls.push(lines)
      // sqlalchemy is unresolvable; everything else installs on its own.
      if (lines.includes('sqlalchemy>=2.0.0')) return { code: 1, output: 'no solution' }
      for (const line of lines) {
        if (line === 'blake3') fs.mkdirSync(path.join(site, 'blake3-1.0.dist-info'))
      }
      return { code: 0, output: '' }
    })
    const t = tools()
    await expect(
      repairDeps(inst, drift, t, { freeze: async () => ({ torch: '2.10.0' }), runUvPip: uv })
    ).resolves.toBe('partial')
    expect(calls).toEqual([['blake3', 'sqlalchemy>=2.0.0'], ['blake3'], ['sqlalchemy>=2.0.0']])
    expect(t.update).toHaveBeenCalledWith({
      depsRepairGaveUp: {
        reqsHash: drift.reqsHash,
        packages: ['sqlalchemy'],
        at: expect.any(Number)
      }
    })
    expect(t.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ depsRepairFailures: expect.anything() })
    )
    expect(emit).toHaveBeenCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({
        outcome: 'partial',
        installed: ['blake3'],
        remaining: ['sqlalchemy']
      })
    )
  })

  it('installs torchsde when torch is there to pin', async () => {
    const { inst, site } = managedInstall(['numpy-2.1.0.dist-info'], 'torch\ntorchsde\nnumpy\n')
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

  it('holds torchsde back when no torch is installed, without giving up on it', async () => {
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
    ).resolves.toBe('repaired')
    expect(output.join('')).toContain('Not installing torchsde: PyTorch is not installed')
    expect(t.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ depsRepairGaveUp: expect.anything() })
    )
    // Still pending, so it installs once the torch repair has put torch back.
    expect(pendingDrift(inst)!.unsatisfied.map((r) => r.name)).toEqual(['torchsde'])
  })

  it('runs no install when torchsde is the only drift and torch is missing', async () => {
    const { inst } = managedInstall(['numpy-2.1.0.dist-info'], 'torchsde\nnumpy\n')
    const uv = vi.fn()
    await expect(
      repairDeps(inst, pendingDrift(inst)!, tools(), { freeze: noFreeze, runUvPip: uv })
    ).resolves.toBe('torch_missing')
    expect(uv).not.toHaveBeenCalled()
  })

  it('clears the failure count once an install succeeds', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(1), REQS)
    const drift = pendingDrift(inst)!
    const failedOnce = {
      ...inst,
      depsRepairFailures: { reqsHash: drift.reqsHash, count: 1 }
    } as InstallationRecord
    const t = tools()
    await repairDeps(failedOnce, drift, t, {
      freeze: noFreeze,
      runUvPip: fakeUv(site, ['blake3-1.0.dist-info'])
    })
    expect(t.update).toHaveBeenCalledWith({ depsRepairFailures: null })
  })

  it('does not claim a repair it cannot verify', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(1), REQS)
    const withGiveUp = {
      ...inst,
      depsRepairGaveUp: { reqsHash: 'older', packages: ['x'], at: 1 }
    } as InstallationRecord
    const t = tools()
    await expect(
      repairDeps(withGiveUp, pendingDrift(inst)!, t, {
        freeze: noFreeze,
        runUvPip: fakeUv(site, ['blake3-1.0.dist-info']),
        detect: () => null
      })
    ).resolves.toBe('unverified')
    expect(t.update).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({ outcome: 'unverified' })
    )
  })

  it('gives up on these requirements when uv succeeds but they still read as unsatisfied', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(1), REQS)
    const drift = pendingDrift(inst)!
    const uv = fakeUv(site, []) // exits 0 but nothing shows up in site-packages
    const t = tools()

    await expect(repairDeps(inst, drift, t, { freeze: noFreeze, runUvPip: uv })).resolves.toBe(
      'still_unsatisfied'
    )

    expect(t.update).toHaveBeenCalledWith({
      depsRepairGaveUp: { reqsHash: drift.reqsHash, packages: ['blake3'], at: expect.any(Number) }
    })
    const updated = { ...inst, ...(t.update.mock.calls[0]![0] as object) } as InstallationRecord
    expect(pendingDrift(updated)).toBeNull()
  })

  it('clears an earlier give-up once a repair succeeds', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(1), REQS)
    const drift = pendingDrift(inst)!
    const withOldGiveUp = {
      ...inst,
      depsRepairGaveUp: { reqsHash: 'older', at: 1 }
    } as InstallationRecord
    const t = tools()

    await repairDeps(withOldGiveUp, drift, t, {
      freeze: noFreeze,
      runUvPip: fakeUv(site, ['blake3-1.0.dist-info'])
    })

    expect(t.update).toHaveBeenCalledWith({ depsRepairGaveUp: null })
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

  it('does not let a give-up suppress drift in other packages', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(1), REQS)
    const drift = pendingDrift(inst)!
    const t = tools()
    await repairDeps(inst, drift, t, { freeze: noFreeze, runUvPip: fakeUv(site, []) })
    const updated = { ...inst, ...(t.update.mock.calls[0]![0] as object) } as InstallationRecord
    expect(pendingDrift(updated)).toBeNull()

    fs.rmSync(path.join(site, 'SQLAlchemy-2.0.36.dist-info'), { recursive: true })
    expect(pendingDrift(updated)!.unsatisfied.map((r) => r.name)).toEqual(['blake3', 'sqlalchemy'])
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
