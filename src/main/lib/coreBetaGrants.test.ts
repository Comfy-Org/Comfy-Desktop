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
  _resetForTest,
  getCoreBetaGrantsAsync,
  initCoreBetaGrants,
  parseCoreBetaGrants,
  selectCoreBetaGrantArgs
} from './coreBetaGrants'
import type { CoreVersionState } from './coreBetaGrants'
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
  it('accepts dashed allowlisted grants, normalizes bounds, and deduplicates by arg', () => {
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
      }
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
})
