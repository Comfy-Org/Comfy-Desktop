// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

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

import { isProtectedPackage, buildProtectedConstraints } from './restore'

describe('isProtectedPackage', () => {
  it.each([
    'pip', 'setuptools', 'wheel', 'uv',
    'torch', 'torchvision', 'torchaudio', 'torchsde',
    'torch-tensorrt', 'torch_scatter',
    'nvidia-cublas-cu12', 'triton', 'triton-windows', 'cuda-bindings',
    'Torch', 'TorchVision'
  ])('protects %s', (name) => {
    expect(isProtectedPackage(name)).toBe(true)
  })

  it.each(['numpy', 'requests', 'pillow', 'transformers', 'safetensors', 'curl-cffi'])(
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
