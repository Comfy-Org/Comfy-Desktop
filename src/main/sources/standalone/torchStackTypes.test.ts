import { describe, it, expect, afterEach } from 'vitest'
import {
  publicVersion, torchLocalTag, stackVersionMatches, torchIndexUrlFor,
  torchTupleReacquirable, accelBaseForTag, torchTupleMatches, torchPackageTuplesEqual,
} from './torchStackTypes'

const realPlatform = process.platform
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform })
}
afterEach(() => setPlatform(realPlatform))

describe('publicVersion / torchLocalTag', () => {
  it('splits a PEP 440 local tag', () => {
    expect(publicVersion('2.10.0+cu130')).toBe('2.10.0')
    expect(torchLocalTag('2.10.0+cu130')).toBe('cu130')
  })

  it('handles untagged versions', () => {
    expect(publicVersion('2.10.0')).toBe('2.10.0')
    expect(torchLocalTag('2.10.0')).toBe('')
    expect(torchLocalTag(null)).toBe('')
  })
})

describe('stackVersionMatches', () => {
  it('requires equal local tags when both sides carry one', () => {
    expect(stackVersionMatches('2.10.0+cu128', '2.10.0+cu130')).toBe(false)
    expect(stackVersionMatches('2.10.0+cu130', '2.10.0+cu130')).toBe(true)
  })

  it('compares public versions when either side omits the tag', () => {
    expect(stackVersionMatches('2.10.0+cu130', '2.10.0')).toBe(true)
    expect(stackVersionMatches('2.10.0', '2.10.0+cu130')).toBe(true)
    expect(stackVersionMatches('2.10.0', '2.10.0')).toBe(true)
  })

  it('never matches different public versions', () => {
    expect(stackVersionMatches('2.9.1+cu130', '2.10.0+cu130')).toBe(false)
    expect(stackVersionMatches('2.9.1', '2.10.0')).toBe(false)
  })
})

describe('torchIndexUrlFor / torchTupleReacquirable', () => {
  it('derives the pytorch.org index from known tags', () => {
    expect(torchIndexUrlFor({ torch: '2.10.0+cu130' })).toBe('https://download.pytorch.org/whl/cu130')
    expect(torchIndexUrlFor({ torch: '2.10.0+xpu' })).toBe('https://download.pytorch.org/whl/xpu')
    expect(torchIndexUrlFor({ torch: '2.10.0+cpu' })).toBe('https://download.pytorch.org/whl/cpu')
  })

  it('maps untagged versions to default PyPI (null) and stays reacquirable', () => {
    expect(torchIndexUrlFor({ torch: '2.10.0' })).toBeNull()
    expect(torchTupleReacquirable({ torch: '2.10.0' })).toBe(true)
  })

  it('rejects custom local tags no trusted index serves', () => {
    expect(torchIndexUrlFor({ torch: '2.10.0+internal1' })).toBeNull()
    expect(torchTupleReacquirable({ torch: '2.10.0+internal1' })).toBe(false)
  })

  it('serves rocm from pytorch.org on linux but not on windows', () => {
    setPlatform('linux')
    expect(torchIndexUrlFor({ torch: '2.10.0+rocm7.1' })).toBe('https://download.pytorch.org/whl/rocm7.1')
    expect(torchTupleReacquirable({ torch: '2.10.0+rocm7.1' })).toBe(true)
    setPlatform('win32')
    expect(torchIndexUrlFor({ torch: '2.9.1+rocm7.2.1' })).toBeNull()
    expect(torchTupleReacquirable({ torch: '2.9.1+rocm7.2.1' })).toBe(false)
  })
})

describe('accelBaseForTag', () => {
  it('maps tags to accelerator variant bases', () => {
    expect(accelBaseForTag('cu130')).toBe('nvidia')
    expect(accelBaseForTag('rocm7.1')).toBe('amd')
    expect(accelBaseForTag('xpu')).toBe('intel-xpu')
    expect(accelBaseForTag('cpu')).toBeNull()
    expect(accelBaseForTag('')).toBeNull()
  })
})

describe('torchTupleMatches (tag-aware)', () => {
  const installed = { torch: '2.10.0+cu130', torchvision: '0.25.0+cu130', torchaudio: '2.10.0+cu130' }

  it('matches the same tuple whether or not the expected side carries tags', () => {
    expect(torchTupleMatches({ torch: '2.10.0+cu130', torchvision: '0.25.0+cu130', torchaudio: '2.10.0+cu130' }, installed)).toBe(true)
    expect(torchTupleMatches({ torch: '2.10.0', torchvision: '0.25.0', torchaudio: '2.10.0' }, installed)).toBe(true)
  })

  it('distinguishes same public version with different local tags', () => {
    expect(torchTupleMatches({ torch: '2.10.0+cu128', torchvision: '0.25.0+cu128', torchaudio: '2.10.0+cu128' }, installed)).toBe(false)
  })

  it('treats an installed package the stack does not declare as a mismatch', () => {
    expect(torchTupleMatches({ torch: '2.10.0+cu130', torchvision: '0.25.0+cu130' }, installed)).toBe(false)
  })
})

describe('torchPackageTuplesEqual (tag-aware)', () => {
  it('is symmetric about declared packages', () => {
    expect(torchPackageTuplesEqual({ torch: '2.10.0+cu130' }, { torch: '2.10.0+cu130', torchaudio: '2.10.0+cu130' })).toBe(false)
  })

  it('distinguishes local tags when both sides carry them', () => {
    expect(torchPackageTuplesEqual({ torch: '2.10.0+cu128' }, { torch: '2.10.0+cu130' })).toBe(false)
    expect(torchPackageTuplesEqual({ torch: '2.10.0+cu130' }, { torch: '2.10.0' })).toBe(true)
  })
})
