import { describe, it, expect } from 'vitest'
import semver from 'semver'
import { selectCoreBetaGrantArgs } from './coreBetaGrants'
import {
  coreGateVersion,
  coreRecordCurrent,
  coreSemver,
  coreSemverExact,
  coreSemverVerified,
  formatComfyVersion
} from './version'
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

describe('coreSemverExact', () => {
  const commit = '61e5e3b5a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'

  it('is exact when the install sits on the tag', () => {
    expect(
      coreSemverExact(record({ comfyVersion: { commit, baseTag: 'v0.3.80', commitsAhead: 0 } }))
    ).toBe(true)
  })

  it('is not exact when the install is ahead of the tag', () => {
    expect(
      coreSemverExact(record({ comfyVersion: { commit, baseTag: 'v0.3.80', commitsAhead: 40 } }))
    ).toBe(false)
  })

  it('is not exact when the commit comparison failed', () => {
    // undefined = the GitHub comparison API failed, so how far past the tag we are is UNKNOWN.
    // `formatComfyVersion` already refuses to imply exactness here; the version gate must too.
    expect(coreSemverExact(record({ comfyVersion: { commit, baseTag: 'v0.3.80' } }))).toBe(false)
  })

  it('is not exact for a legacy install carrying no comfyVersion', () => {
    expect(coreSemverExact(record({ version: 'v0.3.80' }))).toBe(false)
  })
})

describe('coreSemverVerified', () => {
  const commit = '61e5e3b5a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'

  it('is verified when resolution established the tag by ancestry', () => {
    const inst = record({
      comfyVersion: { commit, baseTag: 'v0.3.80', commitsAhead: 21, baseTagVerified: true }
    })
    expect(coreSemverVerified(inst)).toBe(true)
  })

  it('is not verified when resolution fell back to a tag it could not prove', () => {
    const inst = record({
      comfyVersion: { commit, baseTag: 'v0.3.80', commitsAhead: 21, baseTagVerified: false }
    })
    expect(coreSemverVerified(inst)).toBe(false)
  })

  it('is not verified for a record persisted before the field existed', () => {
    // The whole persisted shape an older Desktop wrote: a tag with no provenance recorded.
    // Reading that as verified would restore exactly the gap this field closes.
    const legacy = JSON.parse(
      `{"commit":"${commit}","baseTag":"v0.3.80","commitsAhead":0}`
    ) as ComfyVersion
    expect('baseTagVerified' in legacy).toBe(false)
    expect(coreSemverVerified(record({ comfyVersion: legacy }))).toBe(false)
  })

  it('is not verified for a legacy install carrying no comfyVersion', () => {
    expect(coreSemverVerified(record({ version: 'v0.3.80' }))).toBe(false)
  })
})

describe('coreGateVersion', () => {
  const commit = 'b0f4b7b294ce1b2c3d4e5f6a1b2c3d4e5f6a1b2c'
  const grants = [{ arg: '--enable-assets', minCoreVersion: '0.36.0' }]
  const select = (inst: InstallationRecord) =>
    selectCoreBetaGrantArgs(grants, { ...coreGateVersion(inst), current: true }, true, [])

  it('measures a verified base as itself', () => {
    const inst = record({
      comfyVersion: { commit, baseTag: 'v0.37.0', commitsAhead: 0, baseTagVerified: true }
    })
    expect(coreGateVersion(inst)).toEqual({ semver: '0.37.0', exact: true, verified: true })
  })

  it('floors an unverified upgrade at the ancestor it displaced, and still grants', () => {
    // The QA install after v0.37.1 was published on a release branch: same checkout, relabelled.
    const inst = record({
      comfyVersion: {
        commit,
        baseTag: 'v0.37.1',
        commitsAhead: 5,
        baseTagVerified: false,
        ancestorTag: 'v0.37.0'
      }
    })
    expect(coreGateVersion(inst)).toEqual({ semver: '0.37.0', exact: false, verified: true })
    expect(select(inst)).toEqual(grants)
  })

  it('never measures the unverified label, so it cannot satisfy a minimum the floor misses', () => {
    // #1537's case: the label names a release the install does not contain in full.
    const inst = record({
      comfyVersion: {
        commit,
        baseTag: 'v0.37.1',
        commitsAhead: 5,
        baseTagVerified: false,
        ancestorTag: 'v0.37.0'
      }
    })
    const gated = [{ arg: '--enable-assets', minCoreVersion: '0.37.1' }]
    expect(
      selectCoreBetaGrantArgs(gated, { ...coreGateVersion(inst), current: true }, true, [])
    ).toEqual([])
  })

  it('is not exact on an unverified label even when its distance reads 0', () => {
    const inst = record({
      comfyVersion: {
        commit,
        baseTag: 'v0.37.1',
        commitsAhead: 0,
        baseTagVerified: false,
        ancestorTag: 'v0.37.0'
      }
    })
    expect(coreGateVersion(inst).exact).toBe(false)
  })

  it('refuses an unverified label with no ancestor recorded', () => {
    // Merge-base fallback on a record persisted before `ancestorTag` existed, or a fallbackTag.
    const inst = record({
      comfyVersion: { commit, baseTag: 'v0.37.1', commitsAhead: 5, baseTagVerified: false }
    })
    expect(coreGateVersion(inst)).toEqual({ semver: '0.37.1', exact: false, verified: false })
    expect(select(inst)).toEqual([])
  })
})

describe('coreRecordCurrent', () => {
  const commit = '61e5e3b5a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'
  const pulled = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c'
  const git = record({ comfyVersion: { commit, baseTag: 'v0.3.80', commitsAhead: 0 } })

  it('is current when the live checkout is still at the recorded commit', () => {
    expect(coreRecordCurrent(git, { kind: 'head', commit })).toBe(true)
  })

  it('is not current once a pull has moved the checkout off the recorded commit', () => {
    // `commitsAhead: 0` above stays true of the SUPERSEDED commit, so every other reader still
    // reports an exact, on-tag install. This is the only one that notices.
    expect(coreSemverExact(git)).toBe(true)
    expect(coreRecordCurrent(git, { kind: 'head', commit: pulled })).toBe(false)
  })

  it('is current for a standalone install, which has no HEAD to read', () => {
    expect(coreRecordCurrent(git, { kind: 'not-git' })).toBe(true)
    expect(coreRecordCurrent(record({ version: 'v0.3.80' }), { kind: 'not-git' })).toBe(true)
  })

  it('is not current when the install is git-managed but its HEAD could not be read', () => {
    // The state this distinction exists for. "No git" and "HEAD unreadable" are both absences
    // of a comparable SHA, but only the first means nothing can contradict the record; the
    // second is a checkout we failed to inspect, and an unreadable HEAD most often means one is
    // being rewritten under us. Granting on it would fail open in a gate that must fail closed.
    expect(coreRecordCurrent(git, { kind: 'unreadable' })).toBe(false)
  })

  it('is not current on an unreadable HEAD however complete the record is', () => {
    // Nothing the record can say earns a grant here: the refusal is a property of not having
    // established the checkout, so a fully-populated verified record must not buy past it.
    const complete = record({
      comfyVersion: { commit, baseTag: 'v0.3.80', commitsAhead: 0, baseTagVerified: true }
    })
    expect(coreSemverVerified(complete)).toBe(true)
    expect(coreRecordCurrent(complete, { kind: 'unreadable' })).toBe(false)
  })

  it('is not current when HEAD is readable but the record names no commit to compare', () => {
    expect(coreRecordCurrent(record({ version: 'v0.3.80' }), { kind: 'head', commit })).toBe(false)
  })

  it('is not current when HEAD is readable but the recorded commit is not a string', () => {
    // Records are persisted JSON and reach this reader unvalidated, so the type is a claim
    // rather than a guarantee; a non-string cannot be compared and must not pass as a match.
    const malformed = JSON.parse(`{"commit":61,"baseTag":"v0.3.80"}`) as ComfyVersion
    expect(coreRecordCurrent(record({ comfyVersion: malformed }), { kind: 'head', commit })).toBe(
      false
    )
  })

  it('accepts the recorded commit in either case, since hex SHAs name the same commit', () => {
    expect(coreRecordCurrent(git, { kind: 'head', commit: commit.toUpperCase() })).toBe(true)
  })

  it('rejects an abbreviation of the recorded commit rather than prefix-matching it', () => {
    // Whole-token on purpose: a prefix match would accept a record that merely starts the same
    // way, which is the assurance this check exists to provide.
    expect(coreRecordCurrent(git, { kind: 'head', commit: commit.slice(0, 8) })).toBe(false)
  })
})

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
