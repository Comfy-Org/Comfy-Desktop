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
import { isProtectedPackage, buildProtectedConstraints, protectedPackageDrift } from './restore'
import { pipFreeze } from '../pip'
import { getActivePythonPath } from '../pythonEnv'
import type { InstallationRecord } from '../../installations'

describe('isProtectedPackage', () => {
  it.each([
    'pip', 'setuptools', 'wheel', 'uv',
    'torch', 'torchvision', 'torchaudio', 'torio', 'functorch',
    'torch-tensorrt', 'torch_scatter',
    'nvidia-cublas-cu12', 'triton', 'triton-windows', 'pytorch-triton-rocm',
    'cuda-bindings', 'Torch', 'TorchVision'
  ])('protects %s', (name) => {
    expect(isProtectedPackage(name)).toBe(true)
  })

  // Ordinary torch-ecosystem deps (no `torch-`/`torch_` separator, not the
  // stack itself) stay pip-managed — protecting them would make snapshots
  // that record them unrestorable, since nothing else reconciles them.
  it.each([
    'numpy', 'requests', 'pillow', 'transformers', 'safetensors', 'curl-cffi',
    'torchsde', 'torchmetrics', 'torchdiffeq'
  ])(
    'does not protect %s',
    (name) => {
      expect(isProtectedPackage(name)).toBe(false)
    }
  )
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
      torch: '2.4.1+cu121', torchvision: '0.19.1+cu121', numpy: '2.0.0'
    })
    expect(drift).toEqual([])
  })

  it('reports protected packages whose live version differs', async () => {
    withEnv({ torch: '2.6.0+cu126', torchvision: '0.19.1+cu121' })
    const drift = await protectedPackageDrift(inst, {
      torch: '2.4.1+cu121', torchvision: '0.19.1+cu121'
    })
    expect(drift).toEqual([{ name: 'torch', target: '2.4.1+cu121', live: '2.6.0+cu126' }])
  })

  it('reports protected packages absent live or absent from the snapshot', async () => {
    withEnv({ torch: '2.4.1', 'nvidia-cublas-cu12': '12.1.3.1' })
    const drift = await protectedPackageDrift(inst, { torch: '2.4.1', torchaudio: '2.4.1' })
    expect(drift).toEqual(expect.arrayContaining([
      { name: 'torchaudio', target: '2.4.1', live: null },
      { name: 'nvidia-cublas-cu12', target: null, live: '12.1.3.1' }
    ]))
    expect(drift).toHaveLength(2)
  })

  it('treats PEP 503 name variants as the same package (case and separators)', async () => {
    withEnv({ torch: '2.4.1+cu121', 'nvidia-cublas-cu12': '12.1.3.1' })
    const drift = await protectedPackageDrift(inst, {
      Torch: '2.4.1+cu121', nvidia_cublas_cu12: '12.1.3.1'
    })
    expect(drift).toEqual([])
  })

  it('ignores drift in unprotected packages', async () => {
    withEnv({ torch: '2.4.1', numpy: '1.26.4', torchsde: '0.2.6' })
    const drift = await protectedPackageDrift(inst, { torch: '2.4.1', numpy: '2.0.0', torchsde: '0.2.5' })
    expect(drift).toEqual([])
  })
})
