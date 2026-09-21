// @vitest-environment node
import { afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('../git', () => ({
  readGitHead: vi.fn(),
  isGitAvailable: vi.fn(() => false),
  gitClone: vi.fn(),
  gitCheckoutCommit: vi.fn(),
  gitFetchAndCheckout: vi.fn()
}))
vi.mock('../nodes', () => ({
  scanCustomNodes: vi.fn(),
  nodeKey: vi.fn()
}))
vi.mock('../pip', () => ({
  pipFreeze: vi.fn(),
  runUvPip: vi.fn(),
  installFilteredRequirements: vi.fn(),
  getPipIndexArgs: vi.fn(() => [])
}))
vi.mock('../cnr', () => ({
  installCnrNode: vi.fn(),
  switchCnrVersion: vi.fn(),
  isSafePathComponent: vi.fn(() => true)
}))
vi.mock('../pythonEnv', () => ({
  getActiveUvPath: vi.fn(() => '/fake/uv'),
  getActivePythonPath: vi.fn(() => null),
  getActiveVenvDir: vi.fn(() => '/fake/venv')
}))
vi.mock('../../settings', () => ({
  get: vi.fn(),
  getMirrorConfig: vi.fn(() => undefined)
}))

import fs from 'fs'
import {
  isProtectedPackage,
  buildProtectedConstraints,
  protectedPackageDrift,
  describePackageRevert
} from './restore'
import type { RestoreRevertOutcome } from './types'
import { pipFreeze } from '../pip'
import { getActivePythonPath } from '../pythonEnv'
import type { InstallationRecord } from '../../installations'

describe('isProtectedPackage', () => {
  it.each([
    'pip',
    'setuptools',
    'wheel',
    'uv',
    'torch',
    'torchvision',
    'torchaudio',
    'torio',
    'functorch',
    'torch-tensorrt',
    'torch_scatter',
    'nvidia-cublas-cu12',
    'triton',
    'triton-windows',
    'pytorch-triton-rocm',
    'cuda-bindings',
    'Torch',
    'TorchVision',
    // AMD multi-arch stack: rocm-sdk family plus per-arch device overlays,
    // installable only via [device-all] extras against AMD's index.
    'rocm',
    'rocm-sdk-core',
    'rocm-bootstrap',
    'amd-torch-device-gfx1100',
    'amd-torchvision-device-gfx908',
    'amd-torchaudio-device-gfx1200',
    // Intel XPU stack: torch +xpu wheels pull the oneAPI runtime family as
    // plain pip dependencies. Every name observed leaking across vendors in
    // cross-vendor restore validation is pinned here.
    'dpcpp-cpp-rt',
    'intel-cmplr-lib-rt',
    'intel-cmplr-lib-ur',
    'intel-cmplr-lic-rt',
    'intel-opencl-rt',
    'intel-openmp',
    'intel-pti',
    'intel-sycl-rt',
    'mkl',
    'onemkl-license',
    'onemkl-sycl-blas',
    'onemkl-sycl-dft',
    'onemkl-sycl-lapack',
    'onemkl-sycl-rng',
    'onemkl-sycl-sparse',
    'pyelftools',
    'tbb',
    'tcmlib',
    'umf',
    'oneccl-bind-pt',
    'impi-rt',
    'level-zero'
  ])('protects %s', (name) => {
    expect(isProtectedPackage(name)).toBe(true)
  })

  // Ordinary torch-ecosystem deps (no `torch-`/`torch_` separator, not the
  // stack itself) stay pip-managed — protecting them would make snapshots
  // that record them unrestorable, since nothing else reconciles them.
  it.each([
    'numpy',
    'requests',
    'pillow',
    'transformers',
    'safetensors',
    'curl-cffi',
    'torchsde',
    'torchmetrics',
    'torchdiffeq',
    // 'amd' alone is not a protected prefix: ordinary AMD-published libraries
    // must stay snapshot-restorable.
    'amd-quark',
    'amdsmi',
    // Intel/oneAPI protection is exact-name or narrow-prefix: ordinary
    // Intel-published libraries must stay snapshot-restorable, and
    // delimiter-based matching must not swallow lookalike names.
    'mkl-fft',
    'mkl-service',
    'mkl-random',
    'intel-extension-for-pytorch',
    'intelhex',
    'mkldnn',
    'onednn',
    'umap-learn',
    'tbats'
  ])('does not protect %s', (name) => {
    expect(isProtectedPackage(name)).toBe(false)
  })
})

describe('buildProtectedConstraints', () => {
  it('pins only protected packages with plain versions', () => {
    const freeze = {
      torch: '2.4.1+cu121',
      torchvision: '0.19.1+cu121',
      numpy: '1.26.4',
      'nvidia-cublas-cu12': '12.1.3.1'
    }
    expect(buildProtectedConstraints(freeze).sort()).toEqual([
      'nvidia-cublas-cu12==12.1.3.1',
      'torch==2.4.1+cu121',
      'torchvision==0.19.1+cu121'
    ])
  })

  it('skips editable installs and direct references', () => {
    const freeze = {
      // pipFreeze stores direct refs as the bare RHS and editables as `-e ...`
      triton: 'https://example.com/wheels/triton-3.1.0-py3-none-any.whl',
      torchaudio: 'git+https://github.com/pytorch/audio@abc123',
      'torch-custom': '-e git+https://github.com/x/torch-custom@abc#egg=torch-custom',
      torch: '2.4.1'
    }
    expect(buildProtectedConstraints(freeze)).toEqual(['torch==2.4.1'])
  })

  it('returns no pins for an empty or unprotected freeze', () => {
    expect(buildProtectedConstraints({})).toEqual([])
    expect(buildProtectedConstraints({ numpy: '1.26.4' })).toEqual([])
  })
})

describe('protectedPackageDrift', () => {
  const inst = { installPath: '/fake/install' } as InstallationRecord

  const withEnv = (live: Record<string, string>): void => {
    vi.mocked(getActivePythonPath).mockReturnValue('/fake/python')
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.mocked(pipFreeze).mockResolvedValue(live)
  }

  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(getActivePythonPath).mockReturnValue(null)
  })

  it('throws when the python interpreter cannot be found (unknown, not zero)', async () => {
    vi.mocked(getActivePythonPath).mockReturnValue(null)
    await expect(protectedPackageDrift(inst, {})).rejects.toThrow()
  })

  it('throws when uv is missing (unknown, not zero)', async () => {
    vi.mocked(getActivePythonPath).mockReturnValue('/fake/python')
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    await expect(protectedPackageDrift(inst, { torch: '2.4.1' })).rejects.toThrow()
  })

  it('returns [] when every protected package matches the snapshot', async () => {
    withEnv({ torch: '2.4.1+cu121', torchvision: '0.19.1+cu121', numpy: '1.26.4' })
    const drift = await protectedPackageDrift(inst, {
      torch: '2.4.1+cu121',
      torchvision: '0.19.1+cu121',
      numpy: '2.0.0'
    })
    expect(drift).toEqual([])
  })

  it('reports protected packages whose live version differs', async () => {
    withEnv({ torch: '2.6.0+cu126', torchvision: '0.19.1+cu121' })
    const drift = await protectedPackageDrift(inst, {
      torch: '2.4.1+cu121',
      torchvision: '0.19.1+cu121'
    })
    expect(drift).toEqual([{ name: 'torch', target: '2.4.1+cu121', live: '2.6.0+cu126' }])
  })

  it('reports protected packages absent live or absent from the snapshot', async () => {
    withEnv({ torch: '2.4.1', 'nvidia-cublas-cu12': '12.1.3.1' })
    const drift = await protectedPackageDrift(inst, { torch: '2.4.1', torchaudio: '2.4.1' })
    expect(drift).toEqual(
      expect.arrayContaining([
        { name: 'torchaudio', target: '2.4.1', live: null },
        { name: 'nvidia-cublas-cu12', target: null, live: '12.1.3.1' }
      ])
    )
    expect(drift).toHaveLength(2)
  })

  it('treats PEP 503 name variants as the same package (case and separators)', async () => {
    withEnv({ torch: '2.4.1+cu121', 'nvidia-cublas-cu12': '12.1.3.1' })
    const drift = await protectedPackageDrift(inst, {
      Torch: '2.4.1+cu121',
      nvidia_cublas_cu12: '12.1.3.1'
    })
    expect(drift).toEqual([])
  })

  it('ignores drift in unprotected packages', async () => {
    withEnv({ torch: '2.4.1', numpy: '1.26.4', torchsde: '0.2.6' })
    const drift = await protectedPackageDrift(inst, {
      torch: '2.4.1',
      numpy: '2.0.0',
      torchsde: '0.2.5'
    })
    expect(drift).toEqual([])
  })
})

describe('describePackageRevert', () => {
  const outcome = (over: Partial<RestoreRevertOutcome> = {}): RestoreRevertOutcome => ({
    reason: 'failures',
    uninstalled: [],
    keptPreexisting: [],
    restoredFromBackup: false,
    complete: true,
    ...over
  })

  // The no-outcome path is where the phase threw before recording anything: it
  // restores the file backup without checking the result and never uninstalls
  // what the run already installed. It must not read as the most reassuring.
  it('reports an unknown outcome when nothing was recorded', () => {
    expect(describePackageRevert(undefined)).toBe(
      'The state of the package changes is unknown — see the log for details.'
    )
  })

  // Installs ran against these, so "nothing was applied" is not knowable.
  it('does not claim nothing was applied when packages were kept', () => {
    expect(describePackageRevert(outcome({ keptPreexisting: ['aiohttp'] }))).toBe(
      'The package changes this restore made were reverted.'
    )
  })

  // #1514: the old text asserted a revert unconditionally, alongside a revert
  // that had just deleted 94 pre-existing packages.
  it('says so when the revert did not complete, instead of claiming one', () => {
    const text = describePackageRevert(outcome({ complete: false }))
    expect(text).toContain('could not be reverted')
    expect(text).not.toContain('where possible')
  })

  it('says nothing was applied when the revert had nothing to undo', () => {
    expect(describePackageRevert(outcome())).toBe('No package changes were applied.')
  })

  it('claims a revert only when there was something to revert', () => {
    expect(describePackageRevert(outcome({ uninstalled: ['brand-new'] }))).toBe(
      'The package changes this restore made were reverted.'
    )
    expect(describePackageRevert(outcome({ restoredFromBackup: true }))).toBe(
      'The package changes this restore made were reverted.'
    )
  })
})
