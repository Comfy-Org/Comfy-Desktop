import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => '' }
}))
vi.mock('../../lib/fetch', () => ({
  fetchJSON: vi.fn()
}))
vi.mock('../../lib/paths', async () => {
  const os = await import('os')
  const path = await import('path')
  const dir = path.join(
    os.tmpdir(),
    `torch-manifest-test-${process.pid}-${Math.random().toString(36).slice(2)}`
  )
  return { dataDir: () => dir }
})
import { fetchJSON } from '../../lib/fetch'
import { dataDir } from '../../lib/paths'
import {
  indexStacksForVariant,
  refreshComputeCaps,
  refreshRemoteIndexStacks,
  ensureRemoteIndexStacks,
  torchSeriesInfo,
  nvidiaDriverMismatch,
  refreshNvidiaDriver,
  _setComputeCapsForTest,
  _setComputeCapProbeForTest,
  _setRemoteDefsForTest,
  _resetRemoteForTest,
  _setNvidiaDriverForTest,
  _setNvidiaDriverProbeForTest
} from './torchIndexManifest'

const realPlatform = process.platform
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform })
}
beforeEach(() => {
  // Pin the in-app manifest (no disk-cache read) unless a test opts into remote state.
  _setRemoteDefsForTest(null)
})
afterEach(() => {
  setPlatform(realPlatform)
  _setComputeCapsForTest(undefined)
  _setComputeCapProbeForTest(undefined)
  _setNvidiaDriverForTest(undefined)
  _setNvidiaDriverProbeForTest(undefined)
  _setRemoteDefsForTest(null)
  vi.mocked(fetchJSON).mockReset()
  fs.rmSync(dataDir(), { recursive: true, force: true })
})

describe('indexStacksForVariant', () => {
  function entryByTag(variant: string, tag: string) {
    return indexStacksForVariant(variant).find(
      (e) => (e.source as { indexTag?: string }).indexTag === tag
    )
  }

  it('serves NVIDIA index stacks on Windows with a mid-range GPU, unannotated', () => {
    setPlatform('win32')
    _setComputeCapsForTest([8.9]) // RTX 40-series — inside both cu126 and cu128 ranges
    expect(entryByTag('win-nvidia', 'cu126')?.capWarning).toBeUndefined()
    expect(entryByTag('win-nvidia', 'cu128')?.capWarning).toBeUndefined()
  })

  it('annotates (never hides) stacks whose wheels lack kernels for the detected GPU', () => {
    setPlatform('win32')
    _setComputeCapsForTest([12.0]) // Blackwell — beyond cu126's sm range
    expect(entryByTag('win-nvidia', 'cu126')?.capWarning).toEqual({
      min: 5.0,
      max: 9.0,
      detected: [12.0]
    })
    expect(entryByTag('win-nvidia', 'cu128')?.capWarning).toBeUndefined()
  })

  it('warns a Pascal GPU about the builds that dropped it, not the legacy build', () => {
    setPlatform('win32')
    _setComputeCapsForTest([6.1]) // GTX 10-series
    expect(entryByTag('win-nvidia', 'cu126')?.capWarning).toBeUndefined()
    expect(entryByTag('win-nvidia', 'cu128')?.capWarning).toEqual({
      min: 7.5,
      max: 12.0,
      detected: [6.1]
    })
  })

  it('a stack serving at least one of multiple GPUs carries no warning', () => {
    setPlatform('win32')
    _setComputeCapsForTest([6.1, 12.0])
    expect(entryByTag('win-nvidia', 'cu126')?.capWarning).toBeUndefined()
    expect(entryByTag('win-nvidia', 'cu128')?.capWarning).toBeUndefined()
  })

  it('serves cap-constrained stacks before the first GPU probe, without warnings', () => {
    setPlatform('win32')
    _setComputeCapsForTest(undefined)
    const entries = indexStacksForVariant('win-nvidia')
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.capWarning === undefined)).toBe(true)
  })

  it('serves everything without warnings when the probe failed', () => {
    setPlatform('win32')
    _setComputeCapsForTest(null)
    const entries = indexStacksForVariant('win-nvidia')
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.capWarning === undefined)).toBe(true)
  })

  it('serves nothing to non-matching accelerators or platforms', () => {
    setPlatform('win32')
    _setComputeCapsForTest(null)
    expect(indexStacksForVariant('win-cpu')).toEqual([])
    setPlatform('darwin')
    expect(indexStacksForVariant('mac')).toEqual([])
  })

  it('serves nothing to a native Windows ARM64 bundle: no trusted index publishes win_arm64 wheels', () => {
    setPlatform('win32')
    _setComputeCapsForTest(null)
    expect(indexStacksForVariant('win-nvidia').length).toBeGreaterThan(0)
    expect(indexStacksForVariant('win-nvidia-arm64')).toEqual([])
  })

  it('refreshComputeCaps turns probe results into warnings on later reads', async () => {
    setPlatform('win32')
    _setComputeCapsForTest(undefined)
    _setComputeCapProbeForTest(async () => [6.1])
    expect(entryByTag('win-nvidia', 'cu128')?.capWarning).toBeUndefined()
    await refreshComputeCaps()
    expect(entryByTag('win-nvidia', 'cu128')?.capWarning).toEqual({
      min: 7.5,
      max: 12.0,
      detected: [6.1]
    })
  })

  it('produces resolvable pip-applied entries with no bundle', () => {
    setPlatform('linux')
    _setComputeCapsForTest(null)
    const entry = indexStacksForVariant('linux-nvidia').find(
      (e) => (e.source as { indexTag: string }).indexTag === 'cu128'
    )!
    expect(entry.stackId).toBe('pytorch-index:cu128:2.11.0')
    expect(entry.source).toEqual({ kind: 'pytorch-index', backend: 'cuda', indexTag: 'cu128' })
    expect(entry.bundle).toBeUndefined()
    expect(entry.packages.torch).toBe('2.11.0+cu128')
    expect(entry.packages.torchvision).toContain('+cu128')
    expect(entry.packages.torchaudio).toContain('+cu128')
    expect(entry.variant).toBe('linux-nvidia')
    expect(entry.noteKey).toBeTruthy()
  })
})

describe('remote manifest', () => {
  const cu130Entry = {
    indexTag: 'cu130',
    accel: 'nvidia',
    platforms: ['win32', 'linux'],
    packages: { torch: '2.11.0+cu130', torchvision: '0.26.0+cu130', torchaudio: '2.11.0+cu130' },
    date: '2026-04-01',
    note: 'Newest CUDA build.'
  }
  const doc = (stacks: unknown[], schemaVersion = 1): Record<string, unknown> => ({
    schemaVersion,
    stacks
  })

  function nvidiaTags(): string[] {
    return indexStacksForVariant('win-nvidia').map(
      (e) => (e.source as { indexTag: string }).indexTag
    )
  }

  beforeEach(() => {
    setPlatform('win32')
    _setComputeCapsForTest(null)
    _resetRemoteForTest()
  })

  it('a fetched manifest replaces the in-app list', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(doc([cu130Entry]))
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(['cu130'])
  })

  it('a remote manifest still surfaces nothing to a Windows ARM64 bundle', async () => {
    // The manifest has no architecture dimension yet, so a win32 NVIDIA entry
    // must not leak x64 wheels into the native ARM64 bundle's picker.
    vi.mocked(fetchJSON).mockResolvedValue(doc([cu130Entry]))
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(['cu130'])
    expect(indexStacksForVariant('win-nvidia-arm64')).toEqual([])
  })

  it('an empty stacks list is a valid remote kill-switch', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(doc([]))
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual([])
  })

  it('keeps the in-app list when the fetch fails', async () => {
    vi.mocked(fetchJSON).mockRejectedValue(new Error('offline'))
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(expect.arrayContaining(['cu126', 'cu128']))
  })

  it('rejects the whole document on an unknown schemaVersion', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(doc([cu130Entry], 2))
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(expect.arrayContaining(['cu126', 'cu128']))
    expect(nvidiaTags()).not.toContain('cu130')
  })

  it('drops entries declaring an unknown install mechanism, keeping the rest', async () => {
    const futureAmdEntry = {
      ...cu130Entry,
      kind: 'amd-windows-sdk',
      indexTag: 'rocm7.14',
      accel: 'amd',
      packages: { torch: '2.12.0+rocm7.14' }
    }
    vi.mocked(fetchJSON).mockResolvedValue(doc([futureAmdEntry, cu130Entry]))
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(['cu130'])
    expect(indexStacksForVariant('win-amd')).toEqual([])
  })

  it('drops entries whose torch local tag disagrees with indexTag, keeping coherent ones', async () => {
    // pip installs from the index the LOCAL TAG derives, so an entry whose
    // indexTag says otherwise would mint a stackId lying about its source.
    const mismatched = { ...cu130Entry, indexTag: 'cu128' }
    const untaggedOnIndex = { ...cu130Entry, packages: { torch: '2.11.0' } }
    const companionMismatch = {
      ...cu130Entry,
      packages: { torch: '2.11.0+cu130', torchvision: '0.26.0+cu128' }
    }
    vi.mocked(fetchJSON).mockResolvedValue(
      doc([mismatched, untaggedOnIndex, companionMismatch, cu130Entry])
    )
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(['cu130'])
  })

  it('drops nightly (dev) entries - schema 1 has no way to express their retention', async () => {
    const nightlyTorch = {
      ...cu130Entry,
      indexTag: 'cu132',
      packages: { torch: '2.13.0.dev20260720+cu132' }
    }
    const nightlyCompanion = {
      ...cu130Entry,
      packages: { torch: '2.11.0+cu130', torchvision: '0.26.0.dev20260720+cu130' }
    }
    // PEP 440 implicit-zero dev spelling must not slip through either
    const implicitZeroDev = {
      ...cu130Entry,
      packages: { torch: '2.11.0+cu130', torchaudio: '2.11.0.dev+cu130' }
    }
    vi.mocked(fetchJSON).mockResolvedValue(
      doc([nightlyTorch, nightlyCompanion, implicitZeroDev, cu130Entry])
    )
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(['cu130'])
  })

  // Dated like the refresh automation publishes: wheel date within the
  // freshness window, dev versions sharing that date and the index tag.
  const recentIso = (daysAgo: number): string =>
    new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const nightlyDate = (daysAgo: number): string => recentIso(daysAgo).replaceAll('-', '')
  const nightlyEntry = (daysAgo: number): Record<string, unknown> => ({
    kind: 'pytorch-nightly-index',
    indexTag: 'cu132',
    accel: 'nvidia',
    platforms: ['win32', 'linux'],
    packages: {
      torch: `2.13.0.dev${nightlyDate(daysAgo)}+cu132`,
      torchvision: `0.28.0.dev${nightlyDate(daysAgo)}+cu132`,
      torchaudio: `2.13.0.dev${nightlyDate(daysAgo)}+cu132`
    },
    date: recentIso(daysAgo)
  })

  it('serves pytorch-nightly-index entries with coherent dev tuples', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(doc([nightlyEntry(2), cu130Entry]))
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(expect.arrayContaining(['cu132', 'cu130']))
    const nightly = indexStacksForVariant('win-nvidia').find(
      (e) => (e.source as { indexTag: string }).indexTag === 'cu132'
    )
    // Same source kind as stable index entries: reacquisition derives the
    // nightly namespace from the dev version itself.
    expect(nightly?.source).toEqual({ kind: 'pytorch-index', backend: 'cuda', indexTag: 'cu132' })
  })

  it('drops nightly-kind entries whose versions are not dev builds', async () => {
    const stableUnderNightlyKind = { ...nightlyEntry(2), packages: { torch: '2.13.0+cu132' } }
    const mixedTuple = {
      ...nightlyEntry(2),
      packages: { ...(nightlyEntry(2).packages as object), torchvision: '0.28.0+cu132' }
    }
    vi.mocked(fetchJSON).mockResolvedValue(doc([stableUnderNightlyKind, mixedTuple, cu130Entry]))
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(['cu130'])
  })

  it('drops mps nightly entries - PyPI serves no dev builds', async () => {
    const mpsNightly = {
      kind: 'pytorch-nightly-index',
      indexTag: 'pypi',
      accel: 'mps',
      platforms: ['darwin'],
      packages: { torch: `2.13.0.dev${nightlyDate(2)}` },
      date: recentIso(2)
    }
    vi.mocked(fetchJSON).mockResolvedValue(doc([mpsNightly, cu130Entry]))
    await refreshRemoteIndexStacks()
    setPlatform('darwin')
    expect(indexStacksForVariant('mac-mps')).toEqual([])
  })

  it('stops offering a nightly entry once its wheel date leaves the freshness window', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(doc([nightlyEntry(2), nightlyEntry(50), cu130Entry]))
    await refreshRemoteIndexStacks()
    const torches = indexStacksForVariant('win-nvidia').map((e) => e.packages.torch)
    expect(torches).toContain(`2.13.0.dev${nightlyDate(2)}+cu132`)
    expect(torches).not.toContain(`2.13.0.dev${nightlyDate(50)}+cu132`)
    // stable entries never age out
    expect(nvidiaTags()).toContain('cu130')
  })

  it('nightly entries survive the disk cache round-trip and stay nightly-gated', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(doc([nightlyEntry(2), cu130Entry]))
    await refreshRemoteIndexStacks()
    _resetRemoteForTest() // cold start: memory cleared, disk cache remains
    // The cached nightly must re-validate as a NIGHTLY (its dev versions
    // would fail stable validation) and still pass the freshness gate.
    expect(nvidiaTags()).toEqual(expect.arrayContaining(['cu132', 'cu130']))
  })

  it('drops nightly entries whose packages disagree on the wheel date', async () => {
    const mixedDates = {
      ...nightlyEntry(2),
      packages: {
        ...(nightlyEntry(2).packages as object),
        torchaudio: `2.13.0.dev${nightlyDate(3)}+cu132`
      }
    }
    vi.mocked(fetchJSON).mockResolvedValue(doc([mixedDates, cu130Entry]))
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(['cu130'])
  })

  it('drops nightly entries whose date field does not match the wheel date', async () => {
    // The freshness gate trusts `date`; a fabricated one must not let an
    // old pin dodge the dead-man's switch.
    const fabricated = { ...nightlyEntry(50), date: recentIso(2) }
    vi.mocked(fetchJSON).mockResolvedValue(doc([fabricated, cu130Entry]))
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(['cu130'])
  })

  it('drops nightly entries dated more than one day in the future', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(doc([nightlyEntry(-30), cu130Entry]))
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(['cu130'])
  })

  it('drops nightly entries whose wheel date is not a real calendar date', async () => {
    const impossible = {
      ...nightlyEntry(2),
      packages: {
        torch: '2.13.0.dev20260231+cu132',
        torchvision: '0.28.0.dev20260231+cu132',
        torchaudio: '2.13.0.dev20260231+cu132'
      },
      date: '2026-02-31'
    }
    vi.mocked(fetchJSON).mockResolvedValue(doc([impossible, cu130Entry]))
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(['cu130'])
  })

  it('drops entries whose accel, mechanism, and index tag are not one coherent source', async () => {
    const amdFromCpuIndex = {
      ...cu130Entry,
      indexTag: 'cpu',
      accel: 'amd',
      platforms: ['linux'],
      packages: { torch: '2.11.0+cpu' }
    }
    const wrongKind = { ...cu130Entry, kind: 'pypi' }
    const taggedMps = {
      ...cu130Entry,
      indexTag: 'pypi',
      accel: 'mps',
      platforms: ['darwin'],
      packages: { torch: '2.11.0+cu130' }
    }
    const mpsOffMac = {
      ...cu130Entry,
      indexTag: 'pypi',
      accel: 'mps',
      platforms: ['darwin', 'win32'],
      packages: { torch: '2.11.0' }
    }
    vi.mocked(fetchJSON).mockResolvedValue(
      doc([amdFromCpuIndex, wrongKind, taggedMps, mpsOffMac, cu130Entry])
    )
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(['cu130'])
    expect(indexStacksForVariant('linux-amd')).toEqual([])
    setPlatform('darwin')
    expect(indexStacksForVariant('mac-mps')).toEqual([])
  })

  it('rejects Windows AMD entries at parse time — schema 1 has no mechanism for them', async () => {
    const winRocm = {
      ...cu130Entry,
      indexTag: 'rocm7.1',
      accel: 'amd',
      platforms: ['win32', 'linux'],
      packages: { torch: '2.10.0+rocm7.1' }
    }
    vi.mocked(fetchJSON).mockResolvedValue(doc([winRocm, cu130Entry]))
    await refreshRemoteIndexStacks()
    expect(indexStacksForVariant('win-amd')).toEqual([])
    setPlatform('linux')
    expect(indexStacksForVariant('linux-amd')).toEqual([])
  })

  const amdMultiArchEntry = {
    kind: 'amd-multi-arch-index',
    indexTag: 'rocm7.14.0',
    accel: 'amd',
    platforms: ['win32', 'linux'],
    packages: {
      torch: '2.10.0+rocm7.14.0',
      torchvision: '0.25.0+rocm7.14.0',
      torchaudio: '2.10.0+rocm7.14.0'
    },
    date: '2026-07-15'
  }

  it('serves amd-multi-arch-index entries on Windows AND Linux with the AMD source', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(doc([amdMultiArchEntry, cu130Entry]))
    await refreshRemoteIndexStacks()
    const entry = indexStacksForVariant('win-amd')[0]
    expect(entry?.source).toEqual({ kind: 'amd-multi-arch-index', indexTag: 'rocm7.14.0' })
    expect(entry?.packages.torch).toBe('2.10.0+rocm7.14.0')
    // Identity in the amd-index namespace: a pytorch.org rocm entry with
    // the same tag + torch version could never share this id.
    expect(entry?.stackId).toBe('amd-index:rocm7.14.0:2.10.0')
    setPlatform('linux')
    expect(indexStacksForVariant('linux-amd')).toHaveLength(1)
  })

  it('coexists with a plain pytorch-index entry sharing the tag + torch version (distinct ids)', async () => {
    // Hypothetical: pytorch.org starts publishing a rocm7.14.0 index. Its
    // Linux entry and AMD's must both survive - per-kind id namespaces mean
    // the duplicate-id guard does not see a collision and drop them.
    const pytorchTwin = { ...amdMultiArchEntry, platforms: ['linux'] } as Record<string, unknown>
    delete pytorchTwin.kind
    vi.mocked(fetchJSON).mockResolvedValue(doc([amdMultiArchEntry, pytorchTwin]))
    await refreshRemoteIndexStacks()
    setPlatform('linux')
    const ids = indexStacksForVariant('linux-amd')
      .map((e) => e.stackId)
      .sort()
    expect(ids).toEqual(['amd-index:rocm7.14.0:2.10.0', 'pytorch-index:rocm7.14.0:2.10.0'])
  })

  it('drops amd-multi-arch-index entries whose accel is not amd', async () => {
    const hijacked = { ...cu130Entry, kind: 'amd-multi-arch-index' }
    vi.mocked(fetchJSON).mockResolvedValue(doc([hijacked, cu130Entry]))
    await refreshRemoteIndexStacks()
    // The hijacked twin must fall out at parse time; were it parsed, it
    // would offer cu130 wheels install-routed through AMD's index.
    expect(nvidiaTags()).toEqual(['cu130'])
  })

  it('drops amd-multi-arch entries with an untagged companion - it would resolve arbitrarily', async () => {
    // Plain pytorch-index entries may carry untagged companions (same index
    // serves them), but on AMD's broad index an untagged pin is ambiguous.
    const untagged = {
      ...amdMultiArchEntry,
      packages: { ...amdMultiArchEntry.packages, torchvision: '0.25.0' }
    }
    vi.mocked(fetchJSON).mockResolvedValue(doc([untagged, cu130Entry]))
    await refreshRemoteIndexStacks()
    expect(indexStacksForVariant('win-amd')).toEqual([])
    expect(nvidiaTags()).toEqual(['cu130'])
  })

  it('drops dev tuples under the amd-multi-arch kind - it is stable-only', async () => {
    const dev = {
      ...amdMultiArchEntry,
      packages: { torch: '2.12.0.dev20260720+rocm7.14.0' }
    }
    vi.mocked(fetchJSON).mockResolvedValue(doc([dev, cu130Entry]))
    await refreshRemoteIndexStacks()
    expect(indexStacksForVariant('win-amd')).toEqual([])
    expect(nvidiaTags()).toEqual(['cu130'])
  })

  it('amd-multi-arch entries survive the disk cache round-trip and keep serving win32', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(doc([amdMultiArchEntry, cu130Entry]))
    await refreshRemoteIndexStacks()
    _resetRemoteForTest() // cold start: memory cleared, disk cache remains
    // The cached entry must re-validate as AMD multi-arch (re-parsed as a
    // plain pytorch-index entry it would be dropped for targeting win32).
    const entry = indexStacksForVariant('win-amd')[0]
    expect(entry?.source).toEqual({ kind: 'amd-multi-arch-index', indexTag: 'rocm7.14.0' })
  })

  it('drops all entries sharing a stackId — the renderer round-trips only the id', async () => {
    const sibling = {
      ...cu130Entry,
      packages: { torch: '2.11.0+cu130', torchaudio: '2.11.0+cu130' }
    }
    vi.mocked(fetchJSON).mockResolvedValue(doc([cu130Entry, sibling]))
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(expect.arrayContaining(['cu126', 'cu128']))
    expect(nvidiaTags()).not.toContain('cu130')
  })

  it('rejects an empty pythonAbis declaration instead of treating it as unrestricted', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(doc([{ ...cu130Entry, pythonAbis: [] }]))
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(expect.arrayContaining(['cu126', 'cu128']))
    expect(nvidiaTags()).not.toContain('cu130')
  })

  it('a non-empty document where no entry survives cannot replace valid state', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(doc([cu130Entry]))
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(['cu130'])
    const evil = {
      ...cu130Entry,
      packages: { torch: '2.11.0+cu130 --index-url https://evil.example' }
    }
    vi.mocked(fetchJSON).mockResolvedValue(doc([evil]))
    await refreshRemoteIndexStacks()
    // The all-invalid response is indistinguishable from garbage — the
    // previous valid manifest stays; withdrawal must be the explicit [].
    expect(nvidiaTags()).toEqual(['cu130'])
  })

  it('drops entries with unsafe package versions (built-ins retained on a first fetch)', async () => {
    const evil = {
      ...cu130Entry,
      packages: { torch: '2.11.0+cu130 --index-url https://evil.example' }
    }
    vi.mocked(fetchJSON).mockResolvedValue(doc([evil]))
    await refreshRemoteIndexStacks()
    expect(nvidiaTags()).toEqual(expect.arrayContaining(['cu126', 'cu128']))
    expect(nvidiaTags()).not.toContain('cu130')
  })

  it('a poisoned disk cache cannot suppress the built-in list', () => {
    // The cache file is re-validated on load; an all-invalid document parses
    // to null (indistinguishable from garbage) and built-ins stay.
    const evil = {
      ...cu130Entry,
      packages: { torch: '2.11.0+cu130 --index-url https://evil.example' }
    }
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.writeFileSync(
      path.join(dataDir(), 'torch-index-manifest-cache.json'),
      JSON.stringify(doc([evil]))
    )
    _resetRemoteForTest()
    expect(nvidiaTags()).toEqual(expect.arrayContaining(['cu126', 'cu128']))
    expect(nvidiaTags()).not.toContain('cu130')
  })

  it('a concurrent refresh and ensure share one in-flight fetch', async () => {
    let release!: (value: unknown) => void
    vi.mocked(fetchJSON).mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }) as Promise<unknown>
    )
    const refresh = refreshRemoteIndexStacks()
    const ensure = ensureRemoteIndexStacks()
    release(doc([cu130Entry]))
    await Promise.all([refresh, ensure])
    expect(vi.mocked(fetchJSON)).toHaveBeenCalledTimes(1)
    expect(nvidiaTags()).toEqual(['cu130'])
  })

  it('never serves ROCm entries on Windows even when the manifest declares them', () => {
    // pytorch.org publishes no Windows ROCm wheels — AMD's own channel is a
    // mechanism this app doesn't support, so the trusted-index gate hides
    // the entry on win32 while Linux (which pytorch.org serves) keeps it.
    _setRemoteDefsForTest([
      {
        indexTag: 'rocm7.1',
        accel: 'amd',
        platforms: ['win32', 'linux'],
        packages: { torch: '2.10.0+rocm7.1' },
        date: '2026-04-01'
      }
    ])
    expect(indexStacksForVariant('win-amd')).toEqual([])
    setPlatform('linux')
    expect(indexStacksForVariant('linux-amd')).toHaveLength(1)
  })

  it('propagates pythonAbis and plain-text note onto entries', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(doc([{ ...cu130Entry, pythonAbis: ['3.13'] }]))
    await refreshRemoteIndexStacks()
    const entry = indexStacksForVariant('win-nvidia')[0]!
    expect(entry.pythonAbis).toEqual(['3.13'])
    expect(entry.note).toBe('Newest CUDA build.')
    expect(entry.noteKey).toBeUndefined()
  })

  it('serves the persisted manifest after a restart without a network fetch', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(doc([cu130Entry]))
    await refreshRemoteIndexStacks()
    _resetRemoteForTest() // cold start: memory cleared, disk cache remains
    expect(nvidiaTags()).toEqual(['cu130'])
  })

  it('ensureRemoteIndexStacks fetches once and never re-fetches after an attempt', async () => {
    vi.mocked(fetchJSON).mockRejectedValue(new Error('offline'))
    await ensureRemoteIndexStacks()
    vi.mocked(fetchJSON).mockResolvedValue(doc([cu130Entry]))
    await ensureRemoteIndexStacks() // no-op: an attempt already settled
    expect(vi.mocked(fetchJSON)).toHaveBeenCalledTimes(1)
    expect(nvidiaTags()).toEqual(expect.arrayContaining(['cu126', 'cu128']))
  })
})

describe('series metadata', () => {
  const cu130Entry = {
    indexTag: 'cu130',
    accel: 'nvidia',
    platforms: ['win32', 'linux'],
    packages: { torch: '2.11.0+cu130', torchvision: '0.26.0+cu130', torchaudio: '2.11.0+cu130' },
    date: '2026-04-01'
  }
  const doc = (series?: unknown): Record<string, unknown> => ({
    schemaVersion: 1,
    stacks: [cu130Entry],
    ...(series !== undefined ? { series } : {})
  })

  beforeEach(() => {
    setPlatform('win32')
    _setComputeCapsForTest(null)
    _resetRemoteForTest()
  })

  it('serves the in-app defaults before any remote manifest', () => {
    const info = torchSeriesInfo('cu130')
    expect(info?.noteKey).toBe('pytorchSeriesNoteCu130')
    expect(info?.minDriver).toEqual({ win32: '580.88', linux: '580.65.06' })
    expect(torchSeriesInfo('cu999')).toBeNull()
  })

  it('a remote series entry replaces the whole built-in entry for its tag only', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(
      doc({
        cu130: { note: 'Remote note', minDriver: { win32: '590.00' } }
      })
    )
    await refreshRemoteIndexStacks()
    // The remote entry wins wholesale: no merging of built-in noteKey/minDriver.
    expect(torchSeriesInfo('cu130')).toEqual({
      note: 'Remote note',
      minDriver: { win32: '590.00' }
    })
    // Tags the remote map does not mention keep their built-in metadata.
    expect(torchSeriesInfo('cu126')?.noteKey).toBe('pytorchSeriesNoteCu126')
  })

  it('a manifest without a series map keeps the built-in metadata', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(doc())
    await refreshRemoteIndexStacks()
    expect(torchSeriesInfo('cu130')?.noteKey).toBe('pytorchSeriesNoteCu130')
  })

  it('drops malformed series entries one by one, falling back per tag', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(
      doc({
        cu130: { note: 'ok' },
        cu128: { noteKey: 'bad key!' }, // unsafe i18n key
        cu126: { minDriver: { win32: 'not-a-version' } }, // non-numeric driver
        cu132: { minDriver: { android: '1.0' } }, // unknown platform
        xpu: { minDriver: {} } // empty map declares nothing
      })
    )
    await refreshRemoteIndexStacks()
    expect(torchSeriesInfo('cu130')).toEqual({ note: 'ok' })
    // Each rejected entry falls back to the built-in default for its tag.
    expect(torchSeriesInfo('cu128')?.noteKey).toBe('pytorchSeriesNoteCu128')
    expect(torchSeriesInfo('cu126')?.minDriver).toEqual({ win32: '527.41', linux: '525.60.13' })
    expect(torchSeriesInfo('cu132')?.noteKey).toBe('pytorchSeriesNoteCu132')
    expect(torchSeriesInfo('xpu')?.noteKey).toBe('pytorchSeriesNoteXpu')
  })

  it('series metadata survives the disk cache round-trip', async () => {
    vi.mocked(fetchJSON).mockResolvedValue(doc({ cu130: { note: 'Remote note' } }))
    await refreshRemoteIndexStacks()
    _resetRemoteForTest() // cold start: memory cleared, disk cache remains
    expect(torchSeriesInfo('cu130')).toEqual({ note: 'Remote note' })
  })
})

describe('nvidiaDriverMismatch', () => {
  const info = { minDriver: { win32: '580.88', linux: '580.65.06' } }

  beforeEach(() => {
    setPlatform('win32')
  })

  it('warns only when the detected driver is older than the platform minimum', () => {
    _setNvidiaDriverForTest('577.00')
    expect(nvidiaDriverMismatch(info)).toEqual({ required: '580.88', detected: '577.00' })
    _setNvidiaDriverForTest('580.88')
    expect(nvidiaDriverMismatch(info)).toBeNull()
    // Numeric comparison, not lexicographic: .100 > .88.
    _setNvidiaDriverForTest('580.100')
    expect(nvidiaDriverMismatch(info)).toBeNull()
  })

  it('applies the linux minimum on linux', () => {
    setPlatform('linux')
    _setNvidiaDriverForTest('580.60.02')
    expect(nvidiaDriverMismatch(info)).toEqual({ required: '580.65.06', detected: '580.60.02' })
  })

  it('stays silent without a detected driver or a declared minimum', () => {
    _setNvidiaDriverForTest(undefined) // never probed
    expect(nvidiaDriverMismatch(info)).toBeNull()
    _setNvidiaDriverForTest(null) // probe failed / no NVIDIA GPU
    expect(nvidiaDriverMismatch(info)).toBeNull()
    _setNvidiaDriverForTest('100.00')
    expect(nvidiaDriverMismatch({})).toBeNull()
    expect(nvidiaDriverMismatch(null)).toBeNull()
    setPlatform('darwin') // no darwin minimum declared
    expect(nvidiaDriverMismatch(info)).toBeNull()
  })

  it('refreshNvidiaDriver caches the probe result for later synchronous reads', async () => {
    _setNvidiaDriverForTest(undefined)
    _setNvidiaDriverProbeForTest(async () => '576.02')
    expect(nvidiaDriverMismatch(info)).toBeNull() // not probed yet
    await refreshNvidiaDriver()
    expect(nvidiaDriverMismatch(info)).toEqual({ required: '580.88', detected: '576.02' })
  })

  it('a failed probe leaves the warnings off', async () => {
    _setNvidiaDriverProbeForTest(async () => null)
    await refreshNvidiaDriver()
    expect(nvidiaDriverMismatch(info)).toBeNull()
  })

  it('a probe that throws resolves the refresh and clears the stale driver', async () => {
    // refreshTorchStackCatalog awaits this before the manifest and release
    // fetches - a rejection would take the whole catalog refresh down. And
    // the previous detection must not keep warning about a replaced driver.
    _setNvidiaDriverForTest('576.02')
    _setNvidiaDriverProbeForTest(async () => {
      throw new Error('nvidia-smi exploded')
    })
    await expect(refreshNvidiaDriver()).resolves.toBeUndefined()
    expect(nvidiaDriverMismatch(info)).toBeNull()
  })
})
