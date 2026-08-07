import { describe, it, expect } from 'vitest'
import { formatComfyVersion } from './version'
import type { ComfyVersion } from './version'

describe('formatComfyVersion', () => {
  it('returns "unknown" when no data at all', () => {
    expect(formatComfyVersion(undefined, 'short')).toBe('unknown')
    expect(formatComfyVersion(undefined, 'detail')).toBe('unknown')
  })

  it('returns short SHA when no baseTag', () => {
    const v: ComfyVersion = { commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' }
    expect(formatComfyVersion(v, 'short')).toBe('a1b2c3d')
    expect(formatComfyVersion(v, 'detail')).toBe('a1b2c3d')
  })

  it('returns baseTag when commitsAhead is 0', () => {
    const v: ComfyVersion = {
      commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      baseTag: 'v0.14.2',
      commitsAhead: 0
    }
    expect(formatComfyVersion(v, 'short')).toBe('v0.14.2')
    expect(formatComfyVersion(v, 'detail')).toBe('v0.14.2')
  })

  it('returns baseTag + SHA when commitsAhead is undefined (API failure)', () => {
    const v: ComfyVersion = {
      commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      baseTag: 'v0.14.2'
    }
    expect(formatComfyVersion(v, 'short')).toBe('v0.14.2 (a1b2c3d)')
    expect(formatComfyVersion(v, 'detail')).toBe('v0.14.2 (a1b2c3d)')
  })

  it('returns short format with commits ahead', () => {
    const v: ComfyVersion = {
      commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      baseTag: 'v0.14.2',
      commitsAhead: 21
    }
    expect(formatComfyVersion(v, 'short')).toBe('v0.14.2+21')
  })

  it('returns detail format with commits ahead', () => {
    const v: ComfyVersion = {
      commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      baseTag: 'v0.14.2',
      commitsAhead: 21
    }
    expect(formatComfyVersion(v, 'detail')).toBe('v0.14.2 + 21 commits (a1b2c3d)')
  })

  it('uses singular "commit" for commitsAhead === 1', () => {
    const v: ComfyVersion = {
      commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      baseTag: 'v0.14.2',
      commitsAhead: 1
    }
    expect(formatComfyVersion(v, 'detail')).toBe('v0.14.2 + 1 commit (a1b2c3d)')
    expect(formatComfyVersion(v, 'short')).toBe('v0.14.2+1')
  })
})
