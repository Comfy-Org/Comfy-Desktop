import { describe, expect, it } from 'vitest'

import { distributionUpdateVersion } from './distributionState'
import type { Distribution } from './types'
import type { Installation } from '../types/ipc'

function makeInstall(overrides: Record<string, unknown>): Installation {
  return {
    id: 'i1',
    name: 'Built',
    sourceId: 'comfybuilder',
    sourceLabel: 'Comfy Builder',
    sourceCategory: 'local',
    distributionId: 'd1',
    ...overrides,
  } as unknown as Installation
}

function makeDist(overrides: Partial<Distribution> = {}): Distribution {
  return { id: 'd1', name: 'Image', state: 'installable', version: '9', ...overrides }
}

describe('distributionUpdateVersion', () => {
  it('names the newer catalog version for an install left behind', () => {
    const target = distributionUpdateVersion(makeInstall({ distributionVersion: '7' }), [makeDist()])
    expect(target).toBe('9')
  })

  it('says nothing when the install is already on the catalog version', () => {
    expect(
      distributionUpdateVersion(makeInstall({ distributionVersion: '9' }), [makeDist()])
    ).toBe('')
  })

  // The row's state is computed against the HIGHEST installed version, so a
  // second install stuck at v5 sits under an `installable` row and must still
  // learn it is behind.
  it('compares per-install, not against the row state', () => {
    const rows = [makeDist({ state: 'installable', version: '9' })]
    expect(distributionUpdateVersion(makeInstall({ distributionVersion: '5' }), rows)).toBe('9')
  })

  it('never points at a build this machine cannot run', () => {
    for (const state of ['no-build', 'platform-mismatch'] as const) {
      expect(
        distributionUpdateVersion(makeInstall({ distributionVersion: '7' }), [makeDist({ state })])
      ).toBe('')
    }
  })

  it('treats an empty current version as unknown, not as zero', () => {
    expect(distributionUpdateVersion(makeInstall({ distributionVersion: '' }), [makeDist()])).toBe('')
    expect(distributionUpdateVersion(makeInstall({}), [makeDist()])).toBe('')
  })

  it('claims nothing when either side is not an integer version', () => {
    expect(
      distributionUpdateVersion(makeInstall({ distributionVersion: 'beta' }), [makeDist()])
    ).toBe('')
    expect(
      distributionUpdateVersion(makeInstall({ distributionVersion: '7' }), [
        makeDist({ version: 'nightly' }),
      ])
    ).toBe('')
    expect(
      distributionUpdateVersion(makeInstall({ distributionVersion: '7' }), [
        makeDist({ version: undefined }),
      ])
    ).toBe('')
  })

  it('claims nothing while the catalog is cold or the install has no linked row', () => {
    expect(distributionUpdateVersion(makeInstall({ distributionVersion: '7' }), [])).toBe('')
    expect(
      distributionUpdateVersion(makeInstall({ distributionVersion: '7', distributionId: '' }), [
        makeDist(),
      ])
    ).toBe('')
    expect(
      distributionUpdateVersion(makeInstall({ distributionVersion: '7' }), [
        makeDist({ id: 'other' }),
      ])
    ).toBe('')
  })

  it('ignores an install that did not come from a distribution', () => {
    expect(
      distributionUpdateVersion(
        makeInstall({ sourceId: 'standalone', distributionId: undefined, distributionVersion: '7' }),
        [makeDist()]
      )
    ).toBe('')
  })
})
