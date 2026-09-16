import { beforeEach, describe, expect, it, vi } from 'vitest'

const getOpsFlagResult = vi.fn()
vi.mock('./telemetry', () => ({
  getOpsFlagResult: (...args: unknown[]) => getOpsFlagResult(...args)
}))

import {
  CORE_CANARY_ALLOWED_FLAGS,
  CORE_CANARY_FLAG_KEY,
  _resetForTest,
  getCoreCanaryFlagsAsync,
  initCoreCanary,
  parseCoreCanaryFlags,
  selectCoreCanaryArgs
} from './coreCanary'
import type { CoreVersionState } from './coreCanary'
import { coreSemverExact } from './version'
import type { InstallationRecord } from '../installations'

beforeEach(() => {
  _resetForTest()
  getOpsFlagResult.mockReset()
})

describe('parseCoreCanaryFlags', () => {
  it('accepts dashed allowlisted grants, normalizes bounds, and deduplicates by arg', () => {
    expect(
      parseCoreCanaryFlags(true, {
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
      parseCoreCanaryFlags('canary', {
        flags: [{ arg: '--enable-assets', min_core_version: '0.3.80' }]
      })
    ).toEqual([{ arg: '--enable-assets', minCoreVersion: '0.3.80' }])
  })

  it.each([['control'], ['off'], ['false'], ['disabled'], ['CONTROL']])(
    'treats the %s variant as off',
    (variant) => {
      expect(
        parseCoreCanaryFlags(variant, {
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
    expect(parseCoreCanaryFlags(value, payload)).toEqual([])
  })

  it('drops legacy strings, bare names, missing minimums, malformed args, and unknown args', () => {
    expect(
      parseCoreCanaryFlags(true, {
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
    expect(CORE_CANARY_ALLOWED_FLAGS).toEqual([
      '--enable-assets',
      '--enable-asset-hashing',
      '--disable-assets'
    ])
  })

  it('grants --disable-assets, the remote force-off for when assets go default-on', () => {
    // Core has no such flag yet. Granting one it cannot parse is already safe — the args
    // schema filters it and the launch reports it as `dropped_unsupported` — so the allowlist
    // can carry it ahead of Core.
    expect(
      parseCoreCanaryFlags(true, {
        flags: [{ arg: '--disable-assets', min_core_version: '0.4.0' }]
      })
    ).toEqual([{ arg: '--disable-assets', minCoreVersion: '0.4.0' }])
  })

  it('drops non-string and non-semver bounds, including SHA-like tokens', () => {
    expect(
      parseCoreCanaryFlags(true, {
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
      parseCoreCanaryFlags(true, {
        flags: [
          { arg: '--enable-assets', min_core_version: '0.3.80' },
          { arg: '--disable-assets', min_core_version: '0.3.80' }
        ]
      })
    ).toEqual([])
  })

  it('keeps unrelated grants when no pair contradicts', () => {
    expect(
      parseCoreCanaryFlags(true, {
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

describe('selectCoreCanaryArgs', () => {
  const unboundedGrant = {
    arg: '--enable-assets',
    minCoreVersion: '0.3.80'
  }
  const boundedGrant = {
    arg: '--enable-assets',
    minCoreVersion: '0.3.80',
    maxCoreVersion: '0.4.0'
  }

  /** Defaults to exact: an install sitting on its release tag is the ordinary case, so the
   *  cases below vary only what they are actually about. */
  function at(semver: string | null, exact = true): CoreVersionState {
    return { semver, exact }
  }

  it.each([
    ['below', '0.3.79', []],
    ['equal to', '0.3.80', [unboundedGrant]],
    ['above', '0.3.81', [unboundedGrant]]
  ])('selects by a core version %s the inclusive minimum', (_label, coreVersion, expected) => {
    expect(selectCoreCanaryArgs([unboundedGrant], at(coreVersion), true, [])).toEqual(expected)
  })

  it.each([
    ['below', '0.3.99', [boundedGrant]],
    ['at', '0.4.0', []],
    ['above', '0.4.1', []]
  ])('selects by a core version %s the exclusive maximum', (_label, coreVersion, expected) => {
    expect(selectCoreCanaryArgs([boundedGrant], at(coreVersion), true, [])).toEqual(expected)
  })

  it.each([
    ['enabled', true, [unboundedGrant]],
    ['disabled', false, []]
  ])('returns the grant when beta features are %s', (_label, betaEnabled, expected) => {
    expect(selectCoreCanaryArgs([unboundedGrant], at('0.3.81'), betaEnabled, [])).toEqual(expected)
  })

  it('skips a grant when the exact dashed arg is already present', () => {
    expect(
      selectCoreCanaryArgs([unboundedGrant], at('0.3.81'), true, [
        '--cpu',
        '--enable-assets',
        'unfiltered-user-value'
      ])
    ).toEqual([])
  })

  it('suppresses an --enable grant when the user supplied the --disable opposite', () => {
    expect(
      selectCoreCanaryArgs([unboundedGrant], at('0.3.81'), true, ['--disable-assets'])
    ).toEqual([])
  })

  it('suppresses a --disable grant when the user supplied the --enable opposite', () => {
    const disableGrant = { arg: '--disable-assets', minCoreVersion: '0.3.80' }
    expect(selectCoreCanaryArgs([disableGrant], at('0.3.81'), true, ['--enable-assets'])).toEqual(
      []
    )
  })

  it('suppresses a grant whose opposite another grant in the same payload already took', () => {
    const disableGrant = { arg: '--disable-assets', minCoreVersion: '0.3.80' }
    expect(selectCoreCanaryArgs([unboundedGrant, disableGrant], at('0.3.81'), true, [])).toEqual([
      unboundedGrant
    ])
    expect(selectCoreCanaryArgs([disableGrant, unboundedGrant], at('0.3.81'), true, [])).toEqual([
      disableGrant
    ])
  })

  it('pairs opposites by exact stem, not by a shared prefix', () => {
    // `--enable-assets` and `--disable-asset-hashing` are different features; the stems
    // (`assets` vs `asset-hashing`) must not collide just because one prefixes the other.
    expect(
      selectCoreCanaryArgs([unboundedGrant], at('0.3.81'), true, ['--disable-asset-hashing'])
    ).toEqual([unboundedGrant])
  })

  it.each([['--enable-assets=true'], ['--disable-assets=true'], ['--DISABLE-ASSETS']])(
    'does not treat the near miss %s as an exact arg token',
    (userArg) => {
      // Exact-token match on both the duplicate and the conflict check: the allowlist grammar
      // has no `=value` or mixed-case form, so a lookalike is an ordinary user arg that
      // neither suppresses the grant nor counts as already present.
      expect(selectCoreCanaryArgs([unboundedGrant], at('0.3.81'), true, [userArg])).toEqual([
        unboundedGrant
      ])
    }
  )

  it('leaves unrelated user args alone when deciding a grant', () => {
    expect(
      selectCoreCanaryArgs([unboundedGrant], at('0.3.81'), true, [
        '--listen',
        '--port',
        '8188',
        '--cpu'
      ])
    ).toEqual([unboundedGrant])
  })

  it('returns no grants when the core version is unknown', () => {
    expect(selectCoreCanaryArgs([unboundedGrant], at(null), true, [])).toEqual([])
  })

  /** Derives exactness the way production does, so these cases pin the real `commitsAhead`
   *  semantics rather than a hand-set boolean that could drift from `coreSemverExact`. */
  function exactnessOf(commitsAhead: number | undefined): boolean {
    const inst: InstallationRecord = {
      id: 'inst-1',
      name: 'ComfyUI',
      createdAt: '2026-01-01T00:00:00.000Z',
      installPath: '/tmp/comfy',
      sourceId: 'git',
      comfyVersion: {
        commit: '61e5e3b5a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        baseTag: 'v0.3.99',
        commitsAhead
      }
    }
    return coreSemverExact(inst)
  }

  it('applies a max-bounded grant when the install sits exactly on its tag', () => {
    expect(selectCoreCanaryArgs([boundedGrant], at('0.3.99', exactnessOf(0)), true, [])).toEqual([
      boundedGrant
    ])
  })

  it.each([
    ['the commit comparison failed', undefined],
    ['the install is 40 commits past the tag', 40]
  ] as const)('withholds a max-bounded grant when %s', (_label, commitsAhead) => {
    // `coreSemver` resolves from `baseTag`, so a latest-channel install still MEASURES as
    // 0.3.99 and would otherwise slip under the `<0.4.0` ceiling it is actually well past.
    expect(
      selectCoreCanaryArgs([boundedGrant], at('0.3.99', exactnessOf(commitsAhead)), true, [])
    ).toEqual([])
  })

  it('still applies a min-only grant when the install is not exactly on its tag', () => {
    // The lower bound stays conservative under baseTag lag: the running code can only be NEWER
    // than its tag, so `>=min` can under-report but never over-report.
    expect(
      selectCoreCanaryArgs([unboundedGrant], at('0.3.81', exactnessOf(undefined)), true, [])
    ).toEqual([unboundedGrant])
  })
})

describe('core canary fetch', () => {
  it('reads its own PostHog key once at boot', async () => {
    getOpsFlagResult.mockResolvedValue({
      value: true,
      payload: { flags: [{ arg: '--enable-assets', min_core_version: '0.3.80' }] }
    })
    await Promise.all([
      initCoreCanary({ distinctId: 'device-id' }),
      initCoreCanary({ distinctId: 'device-id' })
    ])

    expect(getOpsFlagResult).toHaveBeenCalledOnce()
    // The trailing callback is what lets a revocation arriving after the boot deadline reach
    // disk for the next launch. This flag persists grants, so it is the one that must have one.
    expect(getOpsFlagResult).toHaveBeenCalledWith(
      CORE_CANARY_FLAG_KEY,
      'device-id',
      expect.any(Number),
      expect.any(Function)
    )
    await expect(getCoreCanaryFlagsAsync()).resolves.toEqual([
      { arg: '--enable-assets', minCoreVersion: '0.3.80' }
    ])
  })
})
