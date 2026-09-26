import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => '' }
}))

const { emit } = vi.hoisted(() => ({ emit: vi.fn() }))
vi.mock('../../lib/telemetry', () => ({ emit }))
vi.mock('../../settings', () => ({
  getMirrorConfig: () => ({ pypiMirror: undefined, useChineseMirrors: false }),
  get: () => undefined
}))

import { pendingDrift, repairDeps, type DepsRepairTools } from './depsRepair'
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
function managedInstall(dists: string[], reqs: string, over: Partial<InstallationRecord> = {}) {
  const installPath = path.join(tmpDir, 'managed')
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
    const gaveUp = { ...inst, depsRepairGaveUp: { reqsHash: drift.reqsHash, at: 1 } }
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

    await expect(repairDeps(inst, drift, t, { runUvPip: uv })).resolves.toBe('repaired')

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

    await expect(repairDeps(inst, drift, t, { runUvPip: uv })).resolves.toBe('repaired')

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

    await expect(repairDeps(inst, pendingDrift(inst)!, t, { runUvPip: uv })).resolves.toBe(
      'declined'
    )

    expect(uv).not.toHaveBeenCalled()
    expect(t.update).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({ outcome: 'declined', adopted: true })
    )
  })

  it('treats a prompt that cannot be delivered as a skip', async () => {
    const { inst } = adoptedInstall(['numpy-2.1.0.dist-info'], 'sqlalchemy>=2.0.0\n')
    const uv = vi.fn()
    const t = tools({
      confirmAdoptedRepair: vi.fn(async () => Promise.reject(new Error('adopt-prompt-unavailable')))
    })

    await expect(repairDeps(inst, pendingDrift(inst)!, t, { runUvPip: uv })).resolves.toBe(
      'declined'
    )
    expect(uv).not.toHaveBeenCalled()
  })

  it('does not prompt when an adopted venv has no uv to install with', async () => {
    const { inst } = adoptedInstall(['numpy-2.1.0.dist-info'], 'sqlalchemy>=2.0.0\n', { uv: false })
    const output: string[] = []
    const t = tools({ sendOutput: (s) => output.push(s) })

    await expect(repairDeps(inst, pendingDrift(inst)!, t, { runUvPip: vi.fn() })).resolves.toBe(
      'no_uv'
    )

    expect(t.confirmAdoptedRepair).not.toHaveBeenCalled()
    expect(output.join('')).toContain('Copy & Update')
    expect(output.join('')).toContain('sqlalchemy (missing)')
  })

  it('does not give up on a failed install, so the next launch retries', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(1), REQS)
    const uv = fakeUv(site, [], 2)
    const t = tools()

    await expect(repairDeps(inst, pendingDrift(inst)!, t, { runUvPip: uv })).resolves.toBe('failed')

    expect(t.update).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(
      'comfy.desktop.deps_repair',
      expect.objectContaining({ outcome: 'failed', uv_exit: 2 })
    )
    expect(pendingDrift(inst)).not.toBeNull()
  })

  it('gives up on these requirements when uv succeeds but they still read as unsatisfied', async () => {
    const { inst, site } = managedInstall(SYNCED.slice(1), REQS)
    const drift = pendingDrift(inst)!
    const uv = fakeUv(site, []) // exits 0 but nothing shows up in site-packages
    const t = tools()

    await expect(repairDeps(inst, drift, t, { runUvPip: uv })).resolves.toBe('still_unsatisfied')

    expect(t.update).toHaveBeenCalledWith({
      depsRepairGaveUp: { reqsHash: drift.reqsHash, at: expect.any(Number) }
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

    await repairDeps(withOldGiveUp, drift, t, { runUvPip: fakeUv(site, ['blake3-1.0.dist-info']) })

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

    await expect(repairDeps(inst, pendingDrift(inst)!, t, { runUvPip: uv })).resolves.toBe(
      'cancelled'
    )

    expect(t.update).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })
})
