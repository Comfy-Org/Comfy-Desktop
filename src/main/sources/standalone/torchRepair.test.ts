import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => '' },
}))

import { getTorchVendorMismatch, repairTorch } from './torchRepair'
import type { InstallationRecord } from '../../installations'

let tmpDir: string

/**
 * Create a managed venv site-packages dir with a torch dist-info of the given
 * version and a `torch/version.py` carrying the given cuda/hip accelerator
 * evidence (the authoritative signal the detector probes).
 */
function makeVenvWithTorch(
  installPath: string,
  torchVersion: string | null,
  accel: { cuda?: string | null; hip?: string | null; rocm?: string | null; xpu?: string | null } = {},
): string {
  const venv = path.join(installPath, 'ComfyUI', '.venv')
  const sitePackages =
    process.platform === 'win32'
      ? path.join(venv, 'Lib', 'site-packages')
      : path.join(venv, 'lib', 'python3.12', 'site-packages')
  fs.mkdirSync(sitePackages, { recursive: true })
  if (torchVersion) {
    fs.mkdirSync(path.join(sitePackages, `torch-${torchVersion}.dist-info`))
    fs.mkdirSync(path.join(sitePackages, 'torch'))
    // Mirror real torch/version.py, which writes type-annotated fields.
    const lit = (v: string | null | undefined): string => (v ? `'${v}'` : 'None')
    fs.writeFileSync(
      path.join(sitePackages, 'torch', 'version.py'),
      [
        `from typing import Optional`,
        `__all__ = ['__version__', 'debug', 'cuda', 'git_version', 'hip', 'rocm', 'xpu']`,
        `__version__ = '${torchVersion}'`,
        `debug = False`,
        `cuda: Optional[str] = ${lit(accel.cuda)}`,
        `git_version = 'abc'`,
        `hip: Optional[str] = ${lit(accel.hip)}`,
        `rocm: Optional[str] = ${lit(accel.rocm)}`,
        `xpu: Optional[str] = ${lit(accel.xpu)}`,
        ``,
      ].join('\n'),
    )
  }
  return sitePackages
}

function install(over: Partial<InstallationRecord> = {}): InstallationRecord {
  return { id: 'i', name: 'i', installPath: tmpDir, sourceId: 'standalone', ...over } as unknown as InstallationRecord
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torch-repair-test-'))
})

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
})

describe('getTorchVendorMismatch', () => {
  it('flags an NVIDIA install running a bare (Windows-bug) torch', () => {
    makeVenvWithTorch(tmpDir, '2.12.0')
    const m = getTorchVendorMismatch(install({ variant: 'win-nvidia' }))
    expect(m).not.toBeNull()
    expect(m!.variantBase).toBe('nvidia')
    expect(m!.expectedFamily).toBe('cu')
    expect(m!.installedTag).toBe('')
  })

  it('flags an NVIDIA install running a +cpu torch', () => {
    makeVenvWithTorch(tmpDir, '2.10.0+cpu')
    const m = getTorchVendorMismatch(install({ variant: 'linux-nvidia' }))
    expect(m).not.toBeNull()
    expect(m!.installedTag).toBe('cpu')
  })

  it('does not flag an NVIDIA install with the correct cu tag (any version)', () => {
    makeVenvWithTorch(tmpDir, '2.10.0+cu128')
    expect(getTorchVendorMismatch(install({ variant: 'win-nvidia' }))).toBeNull()
  })

  it('does not flag a different CUDA minor version (user freedom)', () => {
    makeVenvWithTorch(tmpDir, '2.6.0+cu126')
    expect(getTorchVendorMismatch(install({ variant: 'win-nvidia' }))).toBeNull()
  })

  it('does not flag a bare-versioned but CUDA-capable PyPI wheel (user freedom)', () => {
    // `pip install torch` from PyPI yields a bare version that IS CUDA-enabled;
    // version.py is the only signal that distinguishes it from the bug's CPU torch.
    makeVenvWithTorch(tmpDir, '2.6.0', { cuda: '12.4' })
    expect(getTorchVendorMismatch(install({ variant: 'win-nvidia' }))).toBeNull()
  })

  it('flags a bare-versioned CPU wheel (cuda=None) on an NVIDIA install', () => {
    makeVenvWithTorch(tmpDir, '2.12.0', { cuda: null })
    expect(getTorchVendorMismatch(install({ variant: 'win-nvidia' }))).not.toBeNull()
  })

  it('does not flag an AMD install whose version.py reports hip', () => {
    makeVenvWithTorch(tmpDir, '2.6.0', { hip: '6.2.41134' })
    expect(getTorchVendorMismatch(install({ variant: 'linux-amd' }))).toBeNull()
  })

  it('does not flag an Intel XPU install whose version.py reports xpu (bare version)', () => {
    makeVenvWithTorch(tmpDir, '2.10.0', { xpu: '20250001' })
    expect(getTorchVendorMismatch(install({ variant: 'win-intel-xpu' }))).toBeNull()
  })

  it('flags an Intel XPU install whose torch has no xpu evidence at all', () => {
    makeVenvWithTorch(tmpDir, '2.12.0')
    expect(getTorchVendorMismatch(install({ variant: 'win-intel-xpu' }))).not.toBeNull()
  })

  it('flags an AMD install running CPU torch and accepts rocm', () => {
    makeVenvWithTorch(tmpDir, '2.10.0+cpu')
    expect(getTorchVendorMismatch(install({ variant: 'linux-amd' }))).not.toBeNull()
    fs.rmSync(path.join(tmpDir, 'ComfyUI'), { recursive: true, force: true })
    makeVenvWithTorch(tmpDir, '2.10.0+rocm7.1')
    expect(getTorchVendorMismatch(install({ variant: 'linux-amd' }))).toBeNull()
  })

  it('flags an Intel XPU install running CPU torch and accepts xpu', () => {
    makeVenvWithTorch(tmpDir, '2.10.0+cpu')
    expect(getTorchVendorMismatch(install({ variant: 'win-intel-xpu' }))).not.toBeNull()
    fs.rmSync(path.join(tmpDir, 'ComfyUI'), { recursive: true, force: true })
    makeVenvWithTorch(tmpDir, '2.10.0+xpu')
    expect(getTorchVendorMismatch(install({ variant: 'win-intel-xpu' }))).toBeNull()
  })

  it('never flags CPU or mac/MPS variants', () => {
    makeVenvWithTorch(tmpDir, '2.12.0')
    expect(getTorchVendorMismatch(install({ variant: 'win-cpu' }))).toBeNull()
    expect(getTorchVendorMismatch(install({ variant: 'mac-mps' }))).toBeNull()
  })

  it('skips adopted installs', () => {
    makeVenvWithTorch(tmpDir, '2.12.0')
    expect(getTorchVendorMismatch(install({ variant: 'win-nvidia', adopted: true }))).toBeNull()
  })

  it('returns null when torch cannot be read', () => {
    makeVenvWithTorch(tmpDir, null)
    expect(getTorchVendorMismatch(install({ variant: 'win-nvidia' }))).toBeNull()
  })

  it('returns null when no variant is recorded', () => {
    makeVenvWithTorch(tmpDir, '2.12.0')
    expect(getTorchVendorMismatch(install({}))).toBeNull()
  })
})

describe('repairTorch dispatch', () => {
  const tools = {
    sendProgress: (): void => {},
    update: async (): Promise<void> => {},
  }

  it('routes a verified index-served stack to the pip path, not the bundle', async () => {
    const inst = install({
      variant: 'win-nvidia',
      lastVerifiedTorchStack: {
        stackId: 'pytorch-index:cu128:2.11.0',
        variant: 'win-nvidia',
        pythonVersion: '',
        packages: { torch: '2.11.0+cu128', torchvision: '0.26.0+cu128', torchaudio: '2.11.0+cu128' },
        source: { kind: 'pytorch-index', backend: 'cuda', indexTag: 'cu128' },
      },
    })
    // No venv exists in tmpDir, so the pip path (routed through the journaled
    // stack transaction) fails at its venv check — proving dispatch reached
    // pip instead of the bundle re-download (whose failure message names
    // missing bundle download info).
    const result = await repairTorch(inst, tools)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('installation venv not found')
  })

  it('falls through to the bundle path when no verified index stack exists', async () => {
    const inst = install({ variant: 'win-nvidia' })
    const result = await repairTorch(inst, tools)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('no bundle download info')
  })

  it('honours a caller-supplied verified ref over the (reconciliation-cleared) record', async () => {
    // Launch reconciliation clears lastVerifiedTorchStack when it sees the
    // damaged tuple; the launch path re-supplies the pre-reconciliation ref so
    // repair still targets the stack the user chose.
    const inst = install({ variant: 'win-nvidia' }) // record carries no ref
    const result = await repairTorch(inst, tools, {
      stackId: 'pytorch-index:cu126:2.11.0',
      variant: 'win-nvidia',
      pythonVersion: '',
      packages: { torch: '2.11.0+cu126', torchvision: '0.26.0+cu126', torchaudio: '2.11.0+cu126' },
      source: { kind: 'pytorch-index', backend: 'cuda', indexTag: 'cu126' },
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('installation venv not found')
  })
})
