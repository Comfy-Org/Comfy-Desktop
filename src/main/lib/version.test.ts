import { describe, it, expect } from 'vitest'
import semver from 'semver'
import { coreSemver, formatComfyVersion } from './version'
import type { ComfyVersion } from './version'
import type { InstallationRecord } from '../installations'

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

/** Minimal install record; every case below varies only the version fields. */
function record(fields: Partial<InstallationRecord>): InstallationRecord {
  return {
    id: 'inst-1',
    name: 'ComfyUI',
    createdAt: '2026-01-01T00:00:00.000Z',
    installPath: '/tmp/comfy',
    sourceId: 'git',
    ...fields
  }
}

describe('coreSemver', () => {
  it('strips a single leading v from a release tag', () => {
    expect(coreSemver(record({ version: 'v0.3.80' }))).toBe('0.3.80')
  })

  it('accepts a bare release tag unchanged', () => {
    expect(coreSemver(record({ version: '0.3.80' }))).toBe('0.3.80')
  })

  it('prefers comfyVersion.baseTag over the version field', () => {
    const inst = record({
      version: '61e5e3b5',
      comfyVersion: {
        commit: '61e5e3b5a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        baseTag: 'v0.3.81',
        commitsAhead: 0
      }
    })
    expect(coreSemver(inst)).toBe('0.3.81')
  })

  it('resolves from baseTag on a git install that is ahead of the tag', () => {
    const inst = record({
      version: '61e5e3b5',
      comfyVersion: {
        commit: '61e5e3b5a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        baseTag: 'v0.3.80',
        commitsAhead: 21
      }
    })
    expect(coreSemver(inst)).toBe('0.3.80')
  })

  it('keeps a prerelease a prerelease so range checks order it correctly', () => {
    expect(coreSemver(record({ version: 'v0.3.80-rc.1' }))).toBe('0.3.80-rc.1')
    // The whole point of not coercing: an rc must NOT satisfy a >= 0.3.80 gate.
    expect(semver.gte('0.3.80-rc.1', '0.3.80')).toBe(false)
  })

  it('returns null for a git install falling back to its commit SHA', () => {
    // src/main/sources/git.ts stores the first 8 commit chars in `version`.
    // Coercion would launder 61e5e3b5 into 61.0.0 and satisfy any minimum.
    expect(coreSemver(record({ version: '61e5e3b5' }))).toBeNull()
    expect(coreSemver(record({ version: 'abc12345' }))).toBeNull()
  })

  it('returns null for builder and remote version tokens', () => {
    expect(coreSemver(record({ version: '3' }))).toBeNull()
    expect(coreSemver(record({ version: '0.3' }))).toBeNull()
    expect(coreSemver(record({ version: 'unknown' }))).toBeNull()
  })

  it('returns null for a malformed prerelease suffix', () => {
    expect(coreSemver(record({ version: '0.3.80rc1' }))).toBeNull()
  })

  it('returns null for garbage, absent, and non-string versions', () => {
    expect(coreSemver(record({ version: 'garbage' }))).toBeNull()
    expect(coreSemver(record({ version: '' }))).toBeNull()
    expect(coreSemver(record({}))).toBeNull()
    expect(coreSemver(record({ version: 3 }))).toBeNull()
  })

  it('returns null when baseTag itself is unparseable', () => {
    const inst = record({
      version: 'v0.3.80',
      comfyVersion: {
        commit: '61e5e3b5a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        baseTag: 'nightly',
        commitsAhead: 3
      }
    })
    expect(coreSemver(inst)).toBeNull()
  })
})
