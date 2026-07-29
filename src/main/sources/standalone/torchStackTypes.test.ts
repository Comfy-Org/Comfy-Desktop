import { describe, it, expect, afterEach } from 'vitest'
import {
  publicVersion, torchLocalTag, stackVersionMatches, torchIndexUrlFor,
  torchTupleReacquirable, accelBaseForTag, torchTupleMatches, torchPackageTuplesEqual,
  observedTuple, hasFullObservedTuple, parseIndexStackId, makeIndexStackId, stackAppliesViaPip,
  parseAmdIndexStackId, makeAmdIndexStackId, parseAnyIndexStackId,
  torchIndexUrlForSource, torchTupleReacquirableFrom, AMD_MULTI_ARCH_INDEX_URL,
} from './torchStackTypes'
import type { ObservedTorchStack } from './torchStackTypes'

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

  it('maps tagged nightly (dev) versions to the nightly index namespace', () => {
    expect(torchIndexUrlFor({ torch: '2.13.0.dev20260720+cu132' })).toBe(
      'https://download.pytorch.org/whl/nightly/cu132'
    )
    expect(torchTupleReacquirable({ torch: '2.13.0.dev20260720+cu132' })).toBe(true)
    expect(torchIndexUrlFor({ torch: '2.13.0.dev20260720+xpu' })).toBe('https://download.pytorch.org/whl/nightly/xpu')
    setPlatform('linux')
    expect(torchIndexUrlFor({ torch: '2.13.0.dev20260720+rocm7.2' })).toBe(
      'https://download.pytorch.org/whl/nightly/rocm7.2'
    )
  })

  it('maps untagged nightly versions to the nightly cpu index only on mac', () => {
    // pytorch.org leaves the local tag off nightly/cpu wheels only for
    // macOS; untagged dev builds elsewhere have no trusted provenance and
    // must not fall back to PyPI (it carries no dev builds).
    setPlatform('darwin')
    expect(torchIndexUrlFor({ torch: '2.13.0.dev20260720' })).toBe('https://download.pytorch.org/whl/nightly/cpu')
    expect(torchTupleReacquirable({ torch: '2.13.0.dev20260720' })).toBe(true)
    for (const platform of ['win32', 'linux'] as const) {
      setPlatform(platform)
      expect(torchIndexUrlFor({ torch: '2.13.0.dev20260720' })).toBeNull()
      expect(torchTupleReacquirable({ torch: '2.13.0.dev20260720' })).toBe(false)
    }
  })

  it('still rejects nightly builds no trusted index serves', () => {
    setPlatform('win32')
    expect(torchIndexUrlFor({ torch: '2.13.0.dev20260720+rocm7.2' })).toBeNull()
    expect(torchTupleReacquirable({ torch: '2.13.0.dev20260720+rocm7.2' })).toBe(false)
    expect(torchIndexUrlFor({ torch: '2.13.0.dev20260720+internal1' })).toBeNull()
    expect(torchTupleReacquirable({ torch: '2.13.0.dev20260720+internal1' })).toBe(false)
  })

  it('recognises all PEP 440 dev spellings but not rc/post releases', () => {
    // implicit-zero and compact dev forms are still nightlies
    expect(torchIndexUrlFor({ torch: '2.13.0.dev+cu132' })).toBe('https://download.pytorch.org/whl/nightly/cu132')
    expect(torchIndexUrlFor({ torch: '2.13.0dev1+cu132' })).toBe('https://download.pytorch.org/whl/nightly/cu132')
    // rc and post releases are stable-index builds, not nightlies
    expect(torchIndexUrlFor({ torch: '2.13.0rc1+cu130' })).toBe('https://download.pytorch.org/whl/cu130')
    expect(torchIndexUrlFor({ torch: '2.13.0.post1+cu130' })).toBe('https://download.pytorch.org/whl/cu130')
    expect(torchIndexUrlFor({ torch: '2.13.0.post1' })).toBeNull()
    expect(torchTupleReacquirable({ torch: '2.13.0.post1' })).toBe(true)
  })
})

describe('torchIndexUrlForSource / torchTupleReacquirableFrom', () => {
  const amdSource = { kind: 'amd-multi-arch-index', indexTag: 'rocm7.14.0' } as const
  const amdTuple = { torch: '2.10.0+rocm7.14.0' }

  it('serves an amd-multi-arch source from the hardcoded AMD index on every platform', () => {
    for (const platform of ['win32', 'linux'] as const) {
      setPlatform(platform)
      expect(torchIndexUrlForSource(amdSource, amdTuple)).toBe(AMD_MULTI_ARCH_INDEX_URL)
      expect(torchTupleReacquirableFrom(amdSource, amdTuple)).toBe(true)
    }
  })

  it('falls back to the tag-derived lookup for every other source', () => {
    setPlatform('win32')
    expect(
      torchIndexUrlForSource({ kind: 'pytorch-index', backend: 'cuda', indexTag: 'cu130' }, { torch: '2.10.0+cu130' })
    ).toBe('https://download.pytorch.org/whl/cu130')
    expect(
      torchTupleReacquirableFrom({ kind: 'comfy-bundle', variant: 'win-nvidia', bundleTag: 'v1' }, { torch: '2.10.0+cu130' })
    ).toBe(true)
    // Without the AMD source kind, a Windows ROCm tuple has no trusted index.
    expect(torchIndexUrlForSource(null, amdTuple)).toBeNull()
    expect(torchTupleReacquirableFrom(null, amdTuple)).toBe(false)
  })

  it('fails closed when the AMD source does not coherently name the tuple', () => {
    // AMD's index serves many ROCm versions: a ref whose tag disagrees with
    // the build must not re-acquire a different build under this identity.
    for (const torch of [
      '2.10.0+rocm7.13.0', // tag mismatch
      '2.10.0+cu130', // wrong vendor entirely
      '2.12.0.dev20260720+rocm7.14.0', // dev build - the manifest mints none
    ]) {
      expect(torchIndexUrlForSource(amdSource, { torch })).toBeNull()
      expect(torchTupleReacquirableFrom(amdSource, { torch })).toBe(false)
    }
    // A non-rocm source tag is never an AMD multi-arch identity.
    expect(
      torchIndexUrlForSource({ kind: 'amd-multi-arch-index', indexTag: 'cu130' }, { torch: '2.10.0+cu130' })
    ).toBeNull()
    // Companion packages must carry the same tag: an untagged or mismatched
    // companion pin would resolve to an arbitrary build from AMD's index.
    for (const packages of [
      { ...amdTuple, torchvision: '0.25.0+rocm7.13.0' },
      { ...amdTuple, torchvision: '0.25.0' },
      { ...amdTuple, torchaudio: '2.10.0+rocm7.13.0' },
    ]) {
      expect(torchIndexUrlForSource(amdSource, packages)).toBeNull()
      expect(torchTupleReacquirableFrom(amdSource, packages)).toBe(false)
    }
    // A fully tagged tuple - the shape the manifest actually mints - passes.
    expect(
      torchIndexUrlForSource(amdSource, {
        ...amdTuple,
        torchvision: '0.25.0+rocm7.14.0',
        torchaudio: '2.10.0+rocm7.14.0',
      })
    ).toBe(AMD_MULTI_ARCH_INDEX_URL)
  })
})

describe('parseIndexStackId / makeIndexStackId', () => {
  it('round-trips and strips the local tag from the version key', () => {
    expect(makeIndexStackId('cu128', '2.11.0+cu128')).toBe('pytorch-index:cu128:2.11.0')
    expect(parseIndexStackId('pytorch-index:cu128:2.11.0')).toEqual({ indexTag: 'cu128', version: '2.11.0' })
  })

  it('rejects malformed and foreign ids', () => {
    expect(parseIndexStackId('comfy-bundle:win-nvidia:v1.0')).toBeNull()
    expect(parseIndexStackId('pytorch-index:cu128')).toBeNull()
    expect(parseIndexStackId('pytorch-index:cu 128:2.11.0')).toBeNull()
  })

  it('AMD multi-arch ids live in their own namespace - no cross-parse with pytorch-index ids', () => {
    expect(makeAmdIndexStackId('rocm7.14.0', '2.10.0+rocm7.14.0')).toBe('amd-index:rocm7.14.0:2.10.0')
    expect(parseAmdIndexStackId('amd-index:rocm7.14.0:2.10.0')).toEqual({ indexTag: 'rocm7.14.0', version: '2.10.0' })
    expect(parseAmdIndexStackId('pytorch-index:rocm7.14.0:2.10.0')).toBeNull()
    expect(parseIndexStackId('amd-index:rocm7.14.0:2.10.0')).toBeNull()
    // The same tag + version mints DIFFERENT ids per source kind.
    expect(makeAmdIndexStackId('rocm7.14.0', '2.10.0')).not.toBe(makeIndexStackId('rocm7.14.0', '2.10.0'))
  })

  it('parseAnyIndexStackId accepts both index-served namespaces, nothing else', () => {
    expect(parseAnyIndexStackId('pytorch-index:cu128:2.11.0')).toEqual({ indexTag: 'cu128', version: '2.11.0' })
    expect(parseAnyIndexStackId('amd-index:rocm7.14.0:2.10.0')).toEqual({ indexTag: 'rocm7.14.0', version: '2.10.0' })
    expect(parseAnyIndexStackId('comfy-bundle:win-nvidia:v1.0')).toBeNull()
  })
})

describe('stackAppliesViaPip', () => {
  const bundleSrc = { kind: 'comfy-bundle', variant: 'win-nvidia', bundleTag: 'v1.0' } as const
  const indexSrc = { kind: 'pytorch-index', backend: 'cuda', indexTag: 'cu128' } as const

  it('bundle stacks graft on managed installs but pip-apply on adopted ones', () => {
    expect(stackAppliesViaPip(bundleSrc, false)).toBe(false)
    expect(stackAppliesViaPip(bundleSrc, true)).toBe(true)
  })

  it('index-served stacks pip-apply on every install type', () => {
    expect(stackAppliesViaPip(indexSrc, false)).toBe(true)
    expect(stackAppliesViaPip(indexSrc, true)).toBe(true)
    expect(stackAppliesViaPip({ kind: 'pypi', backend: 'mps' }, false)).toBe(true)
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

describe('observedTuple / hasFullObservedTuple', () => {
  const base = { kind: 'observed', observedAt: '2026-01-01T00:00:00Z' } as const

  it('requires both tuple fields to be present (null counts as present)', () => {
    expect(hasFullObservedTuple({ ...base, torchVersion: '2.4.1' })).toBe(false)
    expect(hasFullObservedTuple({ ...base, torchVersion: '2.4.1', torchvisionVersion: '0.19.1' })).toBe(false)
    expect(hasFullObservedTuple({ ...base, torchVersion: '2.4.1', torchvisionVersion: '0.19.1', torchaudioVersion: null })).toBe(true)
  })

  it('builds a tuple with only the recorded packages', () => {
    const record: ObservedTorchStack = {
      ...base, torchVersion: '2.4.1+cu121', torchvisionVersion: '0.19.1+cu121', torchaudioVersion: null,
    }
    expect(observedTuple(record)).toEqual({ torch: '2.4.1+cu121', torchvision: '0.19.1+cu121' })
  })
})
