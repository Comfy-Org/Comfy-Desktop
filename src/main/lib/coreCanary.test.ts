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
          { arg: '--disable-assets', min_core_version: '0.3.80' },
          null,
          42
        ]
      })
    ).toEqual([])
    expect(CORE_CANARY_ALLOWED_FLAGS).toEqual(['--enable-assets', '--enable-asset-hashing'])
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

  it.each([
    ['below', '0.3.79', []],
    ['equal to', '0.3.80', [unboundedGrant]],
    ['above', '0.3.81', [unboundedGrant]]
  ])('selects by a core version %s the inclusive minimum', (_label, coreVersion, expected) => {
    expect(selectCoreCanaryArgs([unboundedGrant], coreVersion, true, [])).toEqual(expected)
  })

  it.each([
    ['below', '0.3.99', [boundedGrant]],
    ['at', '0.4.0', []],
    ['above', '0.4.1', []]
  ])('selects by a core version %s the exclusive maximum', (_label, coreVersion, expected) => {
    expect(selectCoreCanaryArgs([boundedGrant], coreVersion, true, [])).toEqual(expected)
  })

  it.each([
    ['enabled', true, [unboundedGrant]],
    ['disabled', false, []]
  ])('returns the grant when beta features are %s', (_label, betaEnabled, expected) => {
    expect(selectCoreCanaryArgs([unboundedGrant], '0.3.81', betaEnabled, [])).toEqual(expected)
  })

  it('skips a grant when the exact dashed arg is already present', () => {
    expect(
      selectCoreCanaryArgs([unboundedGrant], '0.3.81', true, [
        '--cpu',
        '--enable-assets',
        'unfiltered-user-value'
      ])
    ).toEqual([])
  })

  it('does not suppress a grant when the conflicting opposite is present', () => {
    expect(selectCoreCanaryArgs([unboundedGrant], '0.3.81', true, ['--disable-assets'])).toEqual([
      unboundedGrant
    ])
  })

  it('does not treat a value-taking near miss as the exact arg token', () => {
    expect(
      selectCoreCanaryArgs([unboundedGrant], '0.3.81', true, ['--enable-assets=true'])
    ).toEqual([unboundedGrant])
  })

  it('returns no grants when the core version is unknown', () => {
    expect(selectCoreCanaryArgs([unboundedGrant], null, true, [])).toEqual([])
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
    expect(getOpsFlagResult).toHaveBeenCalledWith(
      CORE_CANARY_FLAG_KEY,
      'device-id',
      expect.any(Number)
    )
    await expect(getCoreCanaryFlagsAsync()).resolves.toEqual([
      { arg: '--enable-assets', minCoreVersion: '0.3.80' }
    ])
  })
})
