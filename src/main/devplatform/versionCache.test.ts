import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearVersionCache,
  getCachedVersions,
  getVersionCacheGeneration,
  setCachedVersions
} from './versionCache'

describe('versionCache', () => {
  beforeEach(() => clearVersionCache())

  it('ignores a catalog response from before the cache was invalidated', () => {
    const staleGeneration = getVersionCacheGeneration()
    clearVersionCache()
    setCachedVersions('d1', [9], staleGeneration)
    expect(getCachedVersions('d1')).toBeNull()
  })
})
