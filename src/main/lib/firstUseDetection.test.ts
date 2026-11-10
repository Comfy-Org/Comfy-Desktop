// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
vi.mock('../installations', () => ({ list: () => list() }))

import { detectFirstUseState } from './firstUseDetection'

describe('detectFirstUseState', () => {
  beforeEach(() => list.mockReset())

  it('still shows the build picker when the only local build is the Apps build', async () => {
    list.mockResolvedValue([
      { id: 'apps', sourceId: 'standalone', appsBuild: true },
      { id: 'cloud', sourceId: 'cloud' }
    ])
    expect(await detectFirstUseState()).toEqual({ skipPick: false, hasLegacyDesktop: false })
  })

  it('skips the picker once the person has a build of their own', async () => {
    list.mockResolvedValue([
      { id: 'apps', sourceId: 'standalone', appsBuild: true },
      { id: 'mine', sourceId: 'standalone' }
    ])
    expect(await detectFirstUseState()).toEqual({ skipPick: true, hasLegacyDesktop: false })
  })
})
