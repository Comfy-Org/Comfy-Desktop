import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '' },
}))

import { indexStacksForVariant, _setComputeCapsForTest } from './torchIndexManifest'

const realPlatform = process.platform
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform })
}
afterEach(() => {
  setPlatform(realPlatform)
  _setComputeCapsForTest(undefined)
})

describe('indexStacksForVariant', () => {
  it('serves NVIDIA index stacks on Windows with a mid-range GPU', () => {
    setPlatform('win32')
    _setComputeCapsForTest([8.9]) // RTX 40-series — inside both cu126 and cu128 ranges
    const tags = indexStacksForVariant('win-nvidia').map((e) => (e.source as { indexTag: string }).indexTag)
    expect(tags).toContain('cu126')
    expect(tags).toContain('cu128')
  })

  it('hides stacks whose wheels lack kernels for the detected GPU', () => {
    setPlatform('win32')
    _setComputeCapsForTest([12.0]) // Blackwell — beyond cu126's sm range
    const tags = indexStacksForVariant('win-nvidia').map((e) => (e.source as { indexTag: string }).indexTag)
    expect(tags).not.toContain('cu126')
    expect(tags).toContain('cu128')
  })

  it('serves the legacy build to a Pascal GPU that newer builds dropped', () => {
    setPlatform('win32')
    _setComputeCapsForTest([6.1]) // GTX 10-series
    const tags = indexStacksForVariant('win-nvidia').map((e) => (e.source as { indexTag: string }).indexTag)
    expect(tags).toContain('cu126')
    expect(tags).not.toContain('cu128')
  })

  it('keeps any stack serving at least one of multiple GPUs', () => {
    setPlatform('win32')
    _setComputeCapsForTest([6.1, 12.0])
    const tags = indexStacksForVariant('win-nvidia').map((e) => (e.source as { indexTag: string }).indexTag)
    expect(tags).toContain('cu126')
    expect(tags).toContain('cu128')
  })

  it('hides cap-constrained stacks before the first GPU probe', () => {
    setPlatform('win32')
    _setComputeCapsForTest(undefined)
    expect(indexStacksForVariant('win-nvidia')).toEqual([])
  })

  it('does not filter when the probe failed', () => {
    setPlatform('win32')
    _setComputeCapsForTest(null)
    expect(indexStacksForVariant('win-nvidia').length).toBeGreaterThan(0)
  })

  it('serves nothing to non-matching accelerators or platforms', () => {
    setPlatform('win32')
    _setComputeCapsForTest(null)
    expect(indexStacksForVariant('win-cpu')).toEqual([])
    setPlatform('darwin')
    expect(indexStacksForVariant('mac')).toEqual([])
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
