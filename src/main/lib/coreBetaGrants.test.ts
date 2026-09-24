import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const getOpsFlagResult = vi.fn()
vi.mock('./telemetry', () => ({
  getOpsFlagResult: (...args: unknown[]) => getOpsFlagResult(...args)
}))

// `coreBetaGrants` is the one flag that persists, so resolving a value here writes `ops-flags.json`
// for real — into the developer's own config dir, granting them the beta grants on their next launch.
// Pinning `configDir()` to a temp dir is how `opsFlag.test.ts` and `experiments.test.ts` contain
// that. Set for every test, not just the fetch one: an empty dir would resolve the file relative
// to cwd and drop it in the repo root.
let testConfigDir = ''
vi.mock('./paths', () => ({
  configDir: () => testConfigDir
}))

import {
  CORE_BETA_GRANTABLE_ARGS,
  CORE_BETA_FEATURES_FLAG_KEY,
  NO_CORE_COMMITS,
  _resetForTest,
  commitGrantShas,
  getCoreBetaGrantsAsync,
  initCoreBetaGrants,
  parseCoreBetaGrants,
  selectCoreBetaGrantArgs
} from './coreBetaGrants'
import type { CoreBetaGrant, CoreCommitState, CoreVersionState } from './coreBetaGrants'
import { coreGateVersion, coreRecordCurrent } from './version'
import type { ComfyVersion } from './version'
import type { InstallationRecord } from '../installations'

beforeEach(() => {
  _resetForTest()
  getOpsFlagResult.mockReset()
  testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-beta-'))
})

afterEach(() => {
  fs.rmSync(testConfigDir, { recursive: true, force: true })
})

describe('parseCoreBetaGrants', () => {
  it('accepts dashed allowlisted grants, normalizes bounds, and keeps every entry for an arg', () => {
    expect(
      parseCoreBetaGrants(true, {
        flags: [
          { arg: '--enable-assets', min_core_version: 'v0.3.80' },
          {
            arg: '--enable-asset-hashing',
            min_core_version: '0.3.81',
            max_core_version: 'v0.4.0'
          },
          { arg: '--enable-assets', min_core_version: '0.3.90' }
        ]
      })
    ).toEqual([
      { arg: '--enable-assets', minCoreVersion: '0.3.80' },
      {
        arg: '--enable-asset-hashing',
        minCoreVersion: '0.3.81',
        maxCoreVersion: '0.4.0'
      },
      { arg: '--enable-assets', minCoreVersion: '0.3.90' }
    ])
  })

  it('accepts a multivariate flag assignment as enabled', () => {
    expect(
      parseCoreBetaGrants('beta', {
        flags: [{ arg: '--enable-assets', min_core_version: '0.3.80' }]
      })
    ).toEqual([{ arg: '--enable-assets', minCoreVersion: '0.3.80' }])
  })

  it.each([['control'], ['off'], ['false'], ['disabled'], ['CONTROL']])(
    'treats the %s variant as off',
    (variant) => {
      expect(
        parseCoreBetaGrants(variant, {
          flags: [{ arg: '--enable-assets', min_core_version: '0.3.80' }]
        })
      ).toEqual([])
    }
  )

  it.each([
    ['a disabled flag', false, { flags: [{ arg: '--enable-assets', min_core_version: '0.3.80' }] }],
    ['a missing payload', true, null],
    ['an array payload', true, [{ arg: '--enable-assets', min_core_version: '0.3.80' }]],
    ['malformed JSON', true, '{not-json'],
    ['a non-array flags field', true, { flags: '--enable-assets' }],
    [
      'an oversized list',
      true,
      {
        flags: Array.from({ length: 33 }, () => ({
          arg: '--enable-assets',
          min_core_version: '0.3.80'
        }))
      }
    ],
    ['a fetch miss', undefined, undefined]
  ])('fails closed for %s', (_label, value, payload) => {
    expect(parseCoreBetaGrants(value, payload)).toEqual([])
  })

  it('drops legacy strings, bare names, missing minimums, malformed args, and unknown args', () => {
    expect(
      parseCoreBetaGrants(true, {
        flags: [
          '--enable-assets',
          { arg: 'enable-assets', min_core_version: '0.3.80' },
          { arg: '--enable-assets' },
          { arg: '--enable-assets=true', min_core_version: '0.3.80' },
          { arg: '--Enable-assets', min_core_version: '0.3.80' },
          { arg: '--enable-manager', min_core_version: '0.3.80' },
          null,
          42
        ]
      })
    ).toEqual([])
    expect(CORE_BETA_GRANTABLE_ARGS).toEqual([
      '--enable-assets',
      '--enable-asset-hashing',
      '--disable-assets',
      '--enable-agent'
    ])
  })

  it('grants --disable-assets, the remote force-off for when assets go default-on', () => {
    // Core has no such flag yet. Granting one it cannot parse is already safe — the args
    // schema filters it and the launch reports it as `dropped_unsupported` — so the allowlist
    // can carry it ahead of Core.
    expect(
      parseCoreBetaGrants(true, {
        flags: [{ arg: '--disable-assets', min_core_version: '0.4.0' }]
      })
    ).toEqual([{ arg: '--disable-assets', minCoreVersion: '0.4.0' }])
  })

  it('drops non-string and non-semver bounds, including SHA-like tokens', () => {
    expect(
      parseCoreBetaGrants(true, {
        flags: [
          { arg: '--enable-assets', min_core_version: 380 },
          { arg: '--enable-assets', min_core_version: '61e5e3b5' },
          { arg: '--enable-assets', min_core_version: '0.3.80rc1' },
          { arg: '--enable-assets', min_core_version: '0.3.80', max_core_version: 400 },
          {
            arg: '--enable-assets',
            min_core_version: '0.3.80',
            max_core_version: '61e5e3b5'
          },
          {
            arg: '--enable-assets',
            min_core_version: '0.3.80',
            max_core_version: undefined
          }
        ]
      })
    ).toEqual([])
  })

  it('grants nothing when a payload names both a flag and its opposite', () => {
    expect(
      parseCoreBetaGrants(true, {
        flags: [
          { arg: '--enable-assets', min_core_version: '0.3.80' },
          { arg: '--disable-assets', min_core_version: '0.3.80' }
        ]
      })
    ).toEqual([])
  })

  it('keeps unrelated grants when no pair contradicts', () => {
    expect(
      parseCoreBetaGrants(true, {
        flags: [
          { arg: '--enable-assets', min_core_version: '0.3.80' },
          { arg: '--enable-asset-hashing', min_core_version: '0.3.80' }
        ]
      })
    ).toEqual([
      { arg: '--enable-assets', minCoreVersion: '0.3.80' },
      { arg: '--enable-asset-hashing', minCoreVersion: '0.3.80' }
    ])
  })
})

describe('parseCoreBetaGrants notice wording', () => {
  /** The exact payload shape live in the prod acceptance-test flag. A flag object carrying
   *  nothing but `arg` + `min_core_version` MUST keep granting — the notice fields are copy,
   *  added after that payload was written, and cannot become required. */
  it('grants a payload entry that says nothing about the notice', () => {
    expect(
      parseCoreBetaGrants(true, {
        flags: [{ arg: '--enable-assets', min_core_version: '0.36.0' }]
      })
    ).toEqual([{ arg: '--enable-assets', minCoreVersion: '0.36.0' }])
  })

  it('carries a silent request and a feature name onto the grant', () => {
    expect(
      parseCoreBetaGrants(true, {
        flags: [
          { arg: '--enable-assets', min_core_version: '0.3.80', description: 'Asset library' },
          { arg: '--enable-agent', min_core_version: '0.3.80', notice: 'silent' }
        ]
      })
    ).toEqual([
      {
        arg: '--enable-assets',
        minCoreVersion: '0.3.80',
        notice: { description: 'Asset library' }
      },
      { arg: '--enable-agent', minCoreVersion: '0.3.80', notice: { silent: true } }
    ])
  })

  it('only the exact string "silent" suppresses the card', () => {
    // `notice: true` reads as "yes, notify" at least as naturally as "yes, silent", and a
    // rollout silenced by accident is invisible until someone asks why nobody was told.
    for (const notice of [true, 1, 'SILENT', 'quiet', null]) {
      expect(
        parseCoreBetaGrants(true, {
          flags: [{ arg: '--enable-assets', min_core_version: '0.3.80', notice }]
        })
      ).toEqual([{ arg: '--enable-assets', minCoreVersion: '0.3.80' }])
    }
  })

  it('trims a description and drops a blank one', () => {
    expect(
      parseCoreBetaGrants(true, {
        flags: [{ arg: '--enable-assets', min_core_version: '0.3.80', description: '  Assets  ' }]
      })
    ).toEqual([
      { arg: '--enable-assets', minCoreVersion: '0.3.80', notice: { description: 'Assets' } }
    ])
    expect(
      parseCoreBetaGrants(true, {
        flags: [{ arg: '--enable-assets', min_core_version: '0.3.80', description: '   ' }]
      })
    ).toEqual([{ arg: '--enable-assets', minCoreVersion: '0.3.80' }])
  })

  it('drops an over-long or non-string description instead of refusing the grant', () => {
    // Copy never gates a flag: a name too long for the card, or the wrong type entirely, costs
    // the card its wording and nothing else.
    for (const description of ['x'.repeat(49), 42, { text: 'Assets' }, ['Assets']]) {
      expect(
        parseCoreBetaGrants(true, {
          flags: [{ arg: '--enable-assets', min_core_version: '0.3.80', description }]
        })
      ).toEqual([{ arg: '--enable-assets', minCoreVersion: '0.3.80' }])
    }
  })

  it.each([
    ['a newline', 'Assets\nbrowser'],
    ['a C0 control', 'Assets\u0007browser'],
    ['a bidi override', 'Assets\u202Ebrowser'],
    ['a zero-width joiner', 'Assets\u200Dbrowser']
  ])('drops a description containing %s', (_label, description) => {
    // The name is rendered verbatim in desktop chrome next to a Settings action, so anything
    // that can reshape or reverse the sentence falls back to the generic wording.
    expect(
      parseCoreBetaGrants(true, {
        flags: [{ arg: '--enable-assets', min_core_version: '0.3.80', description }]
      })
    ).toEqual([{ arg: '--enable-assets', minCoreVersion: '0.3.80' }])
  })

  it('keeps a description exactly at the limit', () => {
    const description = 'x'.repeat(48)
    expect(
      parseCoreBetaGrants(true, {
        flags: [{ arg: '--enable-assets', min_core_version: '0.3.80', description }]
      })
    ).toEqual([{ arg: '--enable-assets', minCoreVersion: '0.3.80', notice: { description } }])
  })
})

describe('selectCoreBetaGrantArgs', () => {
  const unboundedGrant = {
    arg: '--enable-assets',
    minCoreVersion: '0.3.80'
  }
  const boundedGrant = {
    arg: '--enable-assets',
    minCoreVersion: '0.3.80',
    maxCoreVersion: '0.4.0'
  }

  /** Defaults to exact, verified and current: an install sitting on an ancestry-established
   *  release tag its record still describes is the ordinary case, so the cases below vary only
   *  what they are actually about. */
  function at(semver: string | null, exact = true): CoreVersionState {
    return { semver, exact, verified: true, current: true }
  }

  it.each([
    ['below', '0.3.79', []],
    ['equal to', '0.3.80', [unboundedGrant]],
    ['above', '0.3.81', [unboundedGrant]]
  ])('selects by a core version %s the inclusive minimum', (_label, coreVersion, expected) => {
    expect(selectCoreBetaGrantArgs([unboundedGrant], at(coreVersion), true, [])).toEqual(expected)
  })

  it.each([
    ['below', '0.3.99', [boundedGrant]],
    ['at', '0.4.0', []],
    ['above', '0.4.1', []]
  ])('selects by a core version %s the exclusive maximum', (_label, coreVersion, expected) => {
    expect(selectCoreBetaGrantArgs([boundedGrant], at(coreVersion), true, [])).toEqual(expected)
  })

  it.each([
    ['enabled', true, [unboundedGrant]],
    ['disabled', false, []]
  ])('returns the grant when beta features are %s', (_label, betaEnabled, expected) => {
    expect(selectCoreBetaGrantArgs([unboundedGrant], at('0.3.81'), betaEnabled, [])).toEqual(
      expected
    )
  })

  it('skips a grant when the exact dashed arg is already present', () => {
    expect(
      selectCoreBetaGrantArgs([unboundedGrant], at('0.3.81'), true, [
        '--cpu',
        '--enable-assets',
        'unfiltered-user-value'
      ])
    ).toEqual([])
  })

  it('suppresses an --enable grant when the user supplied the --disable opposite', () => {
    expect(
      selectCoreBetaGrantArgs([unboundedGrant], at('0.3.81'), true, ['--disable-assets'])
    ).toEqual([])
  })

  it('suppresses a --disable grant when the user supplied the --enable opposite', () => {
    const disableGrant = { arg: '--disable-assets', minCoreVersion: '0.3.80' }
    expect(
      selectCoreBetaGrantArgs([disableGrant], at('0.3.81'), true, ['--enable-assets'])
    ).toEqual([])
  })

  it('suppresses a grant whose opposite another grant in the same payload already took', () => {
    const disableGrant = { arg: '--disable-assets', minCoreVersion: '0.3.80' }
    expect(selectCoreBetaGrantArgs([unboundedGrant, disableGrant], at('0.3.81'), true, [])).toEqual(
      [unboundedGrant]
    )
    expect(selectCoreBetaGrantArgs([disableGrant, unboundedGrant], at('0.3.81'), true, [])).toEqual(
      [disableGrant]
    )
  })

  it('pairs opposites by exact stem, not by a shared prefix', () => {
    // `--enable-assets` and `--disable-asset-hashing` are different features; the stems
    // (`assets` vs `asset-hashing`) must not collide just because one prefixes the other.
    expect(
      selectCoreBetaGrantArgs([unboundedGrant], at('0.3.81'), true, ['--disable-asset-hashing'])
    ).toEqual([unboundedGrant])
  })

  it.each([['--enable-assets=true'], ['--disable-assets=true'], ['--DISABLE-ASSETS']])(
    'does not treat the near miss %s as an exact arg token',
    (userArg) => {
      // Exact-token match on both the duplicate and the conflict check: the allowlist grammar
      // has no `=value` or mixed-case form, so a lookalike is an ordinary user arg that
      // neither suppresses the grant nor counts as already present.
      expect(selectCoreBetaGrantArgs([unboundedGrant], at('0.3.81'), true, [userArg])).toEqual([
        unboundedGrant
      ])
    }
  )

  it('leaves unrelated user args alone when deciding a grant', () => {
    expect(
      selectCoreBetaGrantArgs([unboundedGrant], at('0.3.81'), true, [
        '--listen',
        '--port',
        '8188',
        '--cpu'
      ])
    ).toEqual([unboundedGrant])
  })

  it('returns no grants when the core version is unknown', () => {
    expect(selectCoreBetaGrantArgs([unboundedGrant], at(null), true, [])).toEqual([])
  })

  /** An install record carrying exactly the version data under test, so the cases below derive
   *  their gate inputs from production readers rather than hand-set booleans that could drift. */
  function installWith(comfyVersion: ComfyVersion): InstallationRecord {
    return {
      id: 'inst-1',
      name: 'ComfyUI',
      createdAt: '2026-01-01T00:00:00.000Z',
      installPath: '/tmp/comfy',
      sourceId: 'git',
      comfyVersion
    }
  }

  const COMMIT = '61e5e3b5a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'

  it('returns no grants when the base tag was not established by ancestry', () => {
    // `resolveLocalVersion`'s merge-base fallback runs only because v0.3.99 is NOT an ancestor,
    // so this install may be missing the fix a raised minimum is asking for.
    const mergeBaseFallback = installWith({
      commit: COMMIT,
      baseTag: 'v0.3.99',
      commitsAhead: 12,
      baseTagVerified: false
    })
    expect(
      selectCoreBetaGrantArgs(
        [unboundedGrant],
        { ...coreGateVersion(mergeBaseFallback), current: true },
        true,
        []
      )
    ).toEqual([])
  })

  it('returns no grants for a legacy record persisted without the verification field', () => {
    const legacy = installWith({ commit: COMMIT, baseTag: 'v0.3.99', commitsAhead: 0 })
    expect(
      selectCoreBetaGrantArgs(
        [unboundedGrant],
        { ...coreGateVersion(legacy), current: true },
        true,
        []
      )
    ).toEqual([])
  })

  it('returns the grant when the base tag is ancestry-established', () => {
    const verifiedBase = installWith({
      commit: COMMIT,
      baseTag: 'v0.3.99',
      commitsAhead: 12,
      baseTagVerified: true
    })
    expect(
      selectCoreBetaGrantArgs(
        [unboundedGrant],
        { ...coreGateVersion(verifiedBase), current: true },
        true,
        []
      )
    ).toEqual([unboundedGrant])
  })

  const PULLED_COMMIT = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c'

  it('returns no grants when the live checkout has moved off the recorded commit', () => {
    // A pull after the record was written leaves `exact` and `verified` true of a commit that is
    // no longer running, so neither of them can refuse this — they are assertions about the
    // recorded commit, not about the checkout still being at it.
    const pulled = installWith({
      commit: COMMIT,
      baseTag: 'v0.3.99',
      commitsAhead: 0,
      baseTagVerified: true
    })
    expect(
      selectCoreBetaGrantArgs(
        [unboundedGrant],
        {
          ...coreGateVersion(pulled),
          current: coreRecordCurrent(pulled, { kind: 'head', commit: PULLED_COMMIT })
        },
        true,
        []
      )
    ).toEqual([])
  })

  it('returns the grant when the live checkout is still at the recorded commit', () => {
    const atRecord = installWith({
      commit: COMMIT,
      baseTag: 'v0.3.99',
      commitsAhead: 0,
      baseTagVerified: true
    })
    expect(
      selectCoreBetaGrantArgs(
        [unboundedGrant],
        {
          ...coreGateVersion(atRecord),
          current: coreRecordCurrent(atRecord, { kind: 'head', commit: COMMIT })
        },
        true,
        []
      )
    ).toEqual([unboundedGrant])
  })

  /** Derives exactness the way production does, so these cases pin the real `commitsAhead`
   *  semantics rather than a hand-set boolean that could drift from `coreGateVersion`. */
  function exactnessOf(commitsAhead: number | undefined): boolean {
    return coreGateVersion(
      installWith({ commit: COMMIT, baseTag: 'v0.3.99', commitsAhead, baseTagVerified: true })
    ).exact
  }

  it('applies a max-bounded grant when the install sits exactly on its tag', () => {
    expect(selectCoreBetaGrantArgs([boundedGrant], at('0.3.99', exactnessOf(0)), true, [])).toEqual(
      [boundedGrant]
    )
  })

  it.each([
    ['the commit comparison failed', undefined],
    ['the install is 40 commits past the tag', 40]
  ] as const)('withholds a max-bounded grant when %s', (_label, commitsAhead) => {
    // `coreSemver` resolves from `baseTag`, so a latest-channel install still MEASURES as
    // 0.3.99 and would otherwise slip under the `<0.4.0` ceiling it is actually well past.
    expect(
      selectCoreBetaGrantArgs([boundedGrant], at('0.3.99', exactnessOf(commitsAhead)), true, [])
    ).toEqual([])
  })

  it('still applies a min-only grant when the install is not exactly on its tag', () => {
    // The lower bound stays conservative under baseTag lag: the running code can only be NEWER
    // than its tag, so `>=min` can under-report but never over-report.
    expect(
      selectCoreBetaGrantArgs([unboundedGrant], at('0.3.81', exactnessOf(undefined)), true, [])
    ).toEqual([unboundedGrant])
  })
})

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const SHA_C = 'c'.repeat(40)
const SHA_D = 'd'.repeat(40)

describe('parseCoreBetaGrants commit ranges', () => {
  it('parses one lineage per tuple, lowercasing SHAs and keeping an open upper bound', () => {
    expect(
      parseCoreBetaGrants(true, {
        flags: [
          {
            arg: '--enable-assets',
            commit_ranges: [
              [SHA_A.toUpperCase(), SHA_B],
              [SHA_C, null]
            ],
            description: 'Asset library'
          }
        ]
      })
    ).toEqual([
      {
        arg: '--enable-assets',
        commitRanges: [
          [SHA_A, SHA_B],
          [SHA_C, null]
        ],
        notice: { description: 'Asset library' }
      }
    ])
  })

  it('keeps a version entry and a commit entry for the same arg side by side', () => {
    expect(
      parseCoreBetaGrants(true, {
        flags: [
          { arg: '--enable-assets', min_core_version: '0.3.80' },
          { arg: '--enable-assets', commit_ranges: [[SHA_A, null]] }
        ]
      })
    ).toEqual([
      { arg: '--enable-assets', minCoreVersion: '0.3.80' },
      { arg: '--enable-assets', commitRanges: [[SHA_A, null]] }
    ])
  })

  it.each([
    ['an abbreviated SHA', [['aaaaaaa', null]]],
    ['a non-hex SHA', [['g'.repeat(40), null]]],
    ['a malformed upper bound', [[SHA_A, 'b'.repeat(39)]]],
    ['an omitted upper bound', [[SHA_A]]],
    ['an undefined upper bound', [[SHA_A, undefined]]],
    ['a three-element tuple', [[SHA_A, SHA_B, SHA_C]]],
    ['an object instead of a tuple', [{ lower: SHA_A, upper: null }]],
    [
      'one bad lineage among good ones',
      [
        [SHA_A, null],
        ['nope', null]
      ]
    ],
    ['an empty list', []],
    ['a bare string', SHA_A],
    ['more lineages than the cap', Array.from({ length: 9 }, () => [SHA_A, null])]
  ])('drops a commit entry with %s', (_label, commitRanges) => {
    expect(
      parseCoreBetaGrants(true, {
        flags: [{ arg: '--enable-assets', commit_ranges: commitRanges }]
      })
    ).toEqual([])
  })

  it('drops an entry that carries both a commit range and a version bound', () => {
    expect(
      parseCoreBetaGrants(true, {
        flags: [
          { arg: '--enable-assets', min_core_version: '0.3.80', commit_ranges: [[SHA_A, null]] },
          { arg: '--enable-assets', max_core_version: '0.4.0', commit_ranges: [[SHA_A, null]] }
        ]
      })
    ).toEqual([])
  })

  it('grants nothing when a commit entry and a version entry name opposite args', () => {
    expect(
      parseCoreBetaGrants(true, {
        flags: [
          { arg: '--enable-assets', min_core_version: '0.3.80' },
          { arg: '--disable-assets', commit_ranges: [[SHA_A, null]] }
        ]
      })
    ).toEqual([])
  })
})

describe('selectCoreBetaGrantArgs commit ranges', () => {
  const HEAD = 'e'.repeat(40)
  const versionGrant: CoreBetaGrant = { arg: '--enable-assets', minCoreVersion: '0.3.80' }
  const openGrant: CoreBetaGrant = { arg: '--enable-assets', commitRanges: [[SHA_A, null]] }
  const closedGrant: CoreBetaGrant = { arg: '--enable-assets', commitRanges: [[SHA_A, SHA_B]] }

  function facts(ancestry: Record<string, boolean>): CoreCommitState {
    return { head: HEAD, ancestry: new Map(Object.entries(ancestry)) }
  }

  const version = (semver: string | null = '0.3.81'): CoreVersionState => ({
    semver,
    exact: true,
    verified: true,
    current: true
  })

  it.each([
    ['contains the lower bound', { [SHA_A]: true }, [openGrant]],
    ['provably lacks the lower bound', { [SHA_A]: false }, []],
    ['could not relate the lower bound', {}, []]
  ])('with an open upper bound, grants when HEAD %s', (_label, ancestry, expected) => {
    expect(selectCoreBetaGrantArgs([openGrant], version(), true, [], facts(ancestry))).toEqual(
      expected
    )
  })

  it.each([
    ['provably lacks the upper bound', { [SHA_A]: true, [SHA_B]: false }, [closedGrant]],
    ['already contains the upper bound', { [SHA_A]: true, [SHA_B]: true }, []],
    ['could not relate the upper bound (unknown is not "before it")', { [SHA_A]: true }, []],
    ['lacks the lower bound', { [SHA_A]: false, [SHA_B]: false }, []]
  ])('with a closed upper bound, grants only when HEAD %s', (_label, ancestry, expected) => {
    expect(selectCoreBetaGrantArgs([closedGrant], version(), true, [], facts(ancestry))).toEqual(
      expected
    )
  })

  it('logs whether HEAD fell inside the ranges, so a refusal is visible', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    selectCoreBetaGrantArgs(
      [closedGrant],
      version(),
      true,
      [],
      facts({ [SHA_A]: true, [SHA_B]: true })
    )
    selectCoreBetaGrantArgs(
      [closedGrant],
      version(),
      true,
      [],
      facts({ [SHA_A]: true, [SHA_B]: false })
    )

    const lines = log.mock.calls.map((call) => String(call[0])).filter((l) => l.includes('commits'))
    expect(lines).toEqual([
      expect.stringMatching(/ in-range=no$/),
      expect.stringMatching(/ in-range=yes$/)
    ])
    log.mockRestore()
  })

  it('grants when ANY lineage matches', () => {
    const backported: CoreBetaGrant = {
      arg: '--enable-assets',
      commitRanges: [
        [SHA_A, SHA_B],
        [SHA_C, SHA_D]
      ]
    }
    const onReleaseBranch = facts({ [SHA_A]: false, [SHA_C]: true, [SHA_D]: false })
    expect(selectCoreBetaGrantArgs([backported], version(), true, [], onReleaseBranch)).toEqual([
      backported
    ])
    const onNeither = facts({ [SHA_A]: false, [SHA_C]: false })
    expect(selectCoreBetaGrantArgs([backported], version(), true, [], onNeither)).toEqual([])
  })

  it('grants nothing from a commit entry when no ancestry was resolved', () => {
    expect(selectCoreBetaGrantArgs([openGrant], version(), true, [])).toEqual([])
    expect(selectCoreBetaGrantArgs([openGrant], version(), true, [], NO_CORE_COMMITS)).toEqual([])
  })

  it('grants nothing when beta features are off, whatever the ancestry', () => {
    expect(
      selectCoreBetaGrantArgs([openGrant], version(), false, [], facts({ [SHA_A]: true }))
    ).toEqual([])
  })

  it.each([['--enable-assets'], ['--disable-assets']])(
    'yields a commit grant to the user-supplied %s',
    (userArg) => {
      expect(
        selectCoreBetaGrantArgs([openGrant], version(), true, [userArg], facts({ [SHA_A]: true }))
      ).toEqual([])
    }
  )

  it.each([
    ['the core version is unknown', { semver: null, exact: true, verified: true, current: true }],
    [
      'the base tag is unverified',
      { semver: '0.3.81', exact: true, verified: false, current: true }
    ],
    [
      'the record is stale against the checkout',
      { semver: '0.3.81', exact: true, verified: true, current: false }
    ],
    [
      'the install is past its tag',
      { semver: '0.3.81', exact: false, verified: true, current: true }
    ]
  ] satisfies [string, CoreVersionState][])(
    'measures a commit entry against HEAD even when %s',
    (_label, core) => {
      expect(
        selectCoreBetaGrantArgs(
          [closedGrant],
          core,
          true,
          [],
          facts({ [SHA_A]: true, [SHA_B]: false })
        ),
        'the version refusals guard the RECORD, which a commit entry never reads'
      ).toEqual([closedGrant])
    }
  )

  describe('OR across entries for one arg', () => {
    const matching = facts({ [SHA_A]: true })

    it('grants through the commit entry when the version entry does not match', () => {
      expect(
        selectCoreBetaGrantArgs([versionGrant, openGrant], version('0.3.79'), true, [], matching)
      ).toEqual([openGrant])
    })

    it('grants through the version entry when the commit entry does not match', () => {
      expect(
        selectCoreBetaGrantArgs([versionGrant, openGrant], version(), true, [], NO_CORE_COMMITS)
      ).toEqual([versionGrant])
    })

    it('grants through the version entry on an install whose version gate is refused', () => {
      const unverified = { ...version(), verified: false }
      expect(
        selectCoreBetaGrantArgs([versionGrant, openGrant], unverified, true, [], matching)
      ).toEqual([openGrant])
    })

    it('names the arg once, from the first matching entry, when both match', () => {
      expect(
        selectCoreBetaGrantArgs([versionGrant, openGrant], version(), true, [], matching)
      ).toEqual([versionGrant])
      expect(
        selectCoreBetaGrantArgs([openGrant, versionGrant], version(), true, [], matching)
      ).toEqual([openGrant])
    })

    it('grants through a later version entry for the same arg', () => {
      const later: CoreBetaGrant = { arg: '--enable-assets', minCoreVersion: '0.3.70' }
      const floor: CoreBetaGrant = { arg: '--enable-assets', minCoreVersion: '0.3.90' }
      expect(selectCoreBetaGrantArgs([floor, later], version('0.3.81'), true, [])).toEqual([later])
    })
  })
})

describe('selectCoreBetaGrantArgs withheld reasons', () => {
  const HEAD = 'e'.repeat(40)
  const at: CoreVersionState = { semver: '0.3.81', exact: true, verified: true, current: true }

  function withheldFor(
    flags: CoreBetaGrant[],
    ancestry: Record<string, boolean> = {},
    opts: { core?: CoreVersionState; userArgs?: string[]; head?: string | null } = {}
  ): string[] {
    const lines: string[] = []
    selectCoreBetaGrantArgs(
      flags,
      opts.core ?? at,
      true,
      opts.userArgs ?? [],
      {
        head: opts.head === undefined ? HEAD : opts.head,
        ancestry: new Map(Object.entries(ancestry))
      },
      lines
    )
    return lines
  }

  const commitEntry = (lower: string, upper: string | null): CoreBetaGrant => ({
    arg: '--enable-assets',
    commitRanges: [[lower, upper]]
  })

  it.each([
    [
      'HEAD is past the upper bound',
      { [SHA_A]: true, [SHA_B]: true },
      'HEAD past upper bbbbbbbbbbbb'
    ],
    ['the lower bound is not contained', { [SHA_A]: false }, 'lower aaaaaaaaaaaa not contained'],
    ['the lower bound is unresolved', {}, 'lower aaaaaaaaaaaa unresolved'],
    ['the upper bound is unresolved', { [SHA_A]: true }, 'upper bbbbbbbbbbbb unresolved']
  ])('names the failed bound when %s', (_label, ancestry, reason) => {
    expect(withheldFor([commitEntry(SHA_A, SHA_B)], ancestry)).toEqual([
      `[core-beta] --enable-assets withheld: entry 1: commit range aaaaaaaaaaaa..bbbbbbbbbbbb: ${reason}`
    ])
  })

  it('says there was no HEAD to measure on a checkout without one', () => {
    expect(withheldFor([commitEntry(SHA_A, null)], {}, { head: null })).toEqual([
      '[core-beta] --enable-assets withheld: entry 1: no readable git HEAD to measure'
    ])
  })

  it('reports every lineage of a multi-range entry', () => {
    const entry: CoreBetaGrant = {
      arg: '--enable-assets',
      commitRanges: [
        [SHA_A, null],
        [SHA_C, SHA_D]
      ]
    }
    expect(withheldFor([entry], { [SHA_A]: false, [SHA_C]: true, [SHA_D]: true })).toEqual([
      '[core-beta] --enable-assets withheld: entry 1: commit range aaaaaaaaaaaa..: lower aaaaaaaaaaaa not contained | commit range cccccccccccc..dddddddddddd: HEAD past upper dddddddddddd'
    ])
  })

  it.each([
    [
      'below the minimum',
      { arg: '--enable-assets', minCoreVersion: '0.3.90' },
      at,
      'version 0.3.81 < min 0.3.90'
    ],
    [
      'at or past the maximum',
      { arg: '--enable-assets', minCoreVersion: '0.3.80', maxCoreVersion: '0.3.81' },
      at,
      'version 0.3.81 >= max 0.3.81'
    ],
    [
      'bounded above on an inexact tag',
      { arg: '--enable-assets', minCoreVersion: '0.3.80', maxCoreVersion: '0.4.0' },
      { ...at, exact: false },
      'max 0.4.0 needs an exact release tag'
    ],
    [
      'on an unknown core version',
      { arg: '--enable-assets', minCoreVersion: '0.3.80' },
      { ...at, semver: null },
      'core version unknown'
    ],
    [
      'on an unverified base',
      { arg: '--enable-assets', minCoreVersion: '0.3.80' },
      { ...at, verified: false },
      'no ancestry-proven release (base 0.3.81)'
    ],
    [
      'on a record the checkout does not confirm',
      { arg: '--enable-assets', minCoreVersion: '0.3.80' },
      { ...at, current: false },
      'checkout does not confirm the record'
    ]
  ] satisfies [string, CoreBetaGrant, CoreVersionState, string][])(
    'names the version shortfall when %s',
    (_label, entry, core, reason) => {
      expect(withheldFor([entry], {}, { core })).toEqual([
        `[core-beta] --enable-assets withheld: entry 1: ${reason}`
      ])
    }
  )

  it('lists each failed entry for an arg on one line', () => {
    expect(
      withheldFor(
        [{ arg: '--enable-assets', minCoreVersion: '0.3.90' }, commitEntry(SHA_A, null)],
        {
          [SHA_A]: false
        }
      )
    ).toEqual([
      '[core-beta] --enable-assets withheld: entry 1: version 0.3.81 < min 0.3.90; entry 2: commit range aaaaaaaaaaaa..: lower aaaaaaaaaaaa not contained'
    ])
  })

  it.each([
    [['--enable-assets'], 'already in the launch args'],
    [['--disable-assets'], 'the launch args contain --disable-assets']
  ])('says the user args won when they contain %s', (userArgs, reason) => {
    expect(withheldFor([commitEntry(SHA_A, null)], { [SHA_A]: true }, { userArgs })).toEqual([
      `[core-beta] --enable-assets withheld: ${reason}`
    ])
  })

  it('says a grant yielded to its granted opposite', () => {
    const disable: CoreBetaGrant = { arg: '--disable-assets', minCoreVersion: '0.3.80' }
    expect(withheldFor([commitEntry(SHA_A, null), disable], { [SHA_A]: true })).toEqual([
      '[core-beta] --disable-assets withheld: conflicts with granted --enable-assets'
    ])
  })

  it('reports nothing for a granted arg, even when an earlier entry for it failed', () => {
    expect(
      withheldFor(
        [{ arg: '--enable-assets', minCoreVersion: '0.3.90' }, commitEntry(SHA_A, null)],
        {
          [SHA_A]: true
        }
      )
    ).toEqual([])
  })

  it('reports nothing when beta features are off', () => {
    const lines: string[] = []
    selectCoreBetaGrantArgs([commitEntry(SHA_A, null)], at, false, [], NO_CORE_COMMITS, lines)
    expect(lines).toEqual([])
  })
})

describe('commitGrantShas', () => {
  it('lists each SHA the commit entries name once, skipping version entries and open bounds', () => {
    expect(
      commitGrantShas([
        { arg: '--enable-assets', minCoreVersion: '0.3.80' },
        {
          arg: '--enable-assets',
          commitRanges: [
            [SHA_A, SHA_B],
            [SHA_C, null]
          ]
        },
        { arg: '--enable-asset-hashing', commitRanges: [[SHA_A, SHA_D]] }
      ])
    ).toEqual([SHA_A, SHA_B, SHA_C, SHA_D])
  })
})

describe('core beta grants fetch', () => {
  it('reads its own PostHog key once at boot', async () => {
    getOpsFlagResult.mockResolvedValue({
      kind: 'value',
      value: true,
      payload: { flags: [{ arg: '--enable-assets', min_core_version: '0.3.80' }] }
    })
    await Promise.all([
      initCoreBetaGrants({ distinctId: 'device-id' }),
      initCoreBetaGrants({ distinctId: 'device-id' })
    ])

    expect(getOpsFlagResult).toHaveBeenCalledOnce()
    // The trailing callback is what lets a revocation arriving after the boot deadline reach
    // disk for the next launch. This flag persists grants, so it is the one that must have one.
    expect(getOpsFlagResult).toHaveBeenCalledWith(
      CORE_BETA_FEATURES_FLAG_KEY,
      'device-id',
      expect.any(Number),
      expect.any(Function)
    )
    await expect(getCoreBetaGrantsAsync()).resolves.toEqual([
      { arg: '--enable-assets', minCoreVersion: '0.3.80' }
    ])
  })
  it('logs the cached commit ranges in full, on one line', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    getOpsFlagResult.mockResolvedValue({
      kind: 'value',
      value: true,
      payload: { flags: [{ arg: '--enable-assets', commit_ranges: [[SHA_A, null]] }] }
    })

    await initCoreBetaGrants({ distinctId: 'device-id' })

    const init = log.mock.calls.find((call) => String(call[0]).startsWith('[core-beta] init:'))
    const rendered = init!.map(String).join(' ')
    expect(rendered, 'the SHA must survive inspection instead of folding to [Array]').toContain(
      SHA_A
    )
    expect(rendered, 'one line, so a [core-beta] grep catches all of it').not.toContain('\n')
    log.mockRestore()
  })
})
