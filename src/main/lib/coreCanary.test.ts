// Remote configuration becomes command-line input here, so the payload parse
// and the args merge are specced tightly. The shared fetch plumbing (single
// in-flight fetch, awaiting accessor, fail direction) lives in `opsFlag.test.ts`.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getOpsFlagResult = vi.fn()
vi.mock('./telemetry', () => ({
  getOpsFlagResult: (...args: unknown[]) => getOpsFlagResult(...args)
}))

import {
  CORE_CANARY_ALLOWED_FLAGS,
  CORE_CANARY_FLAG_KEY,
  _resetForTest,
  appendCoreCanaryFlags,
  getCoreCanaryFlagsAsync,
  initCoreCanary,
  parseCoreCanaryFlags,
  withCoreCanaryLaunchArgs
} from './coreCanary'

beforeEach(() => {
  _resetForTest()
  getOpsFlagResult.mockReset()
})

describe('parseCoreCanaryFlags', () => {
  it('accepts and deduplicates allowlisted Core feature names', () => {
    expect(
      parseCoreCanaryFlags(true, {
        flags: ['enable-assets', 'enable-asset-hashing', 'enable-assets']
      })
    ).toEqual(['enable-assets', 'enable-asset-hashing'])
  })

  it('accepts a multivariate flag assignment as enabled', () => {
    expect(parseCoreCanaryFlags('canary', { flags: ['enable-assets'] })).toEqual(['enable-assets'])
  })

  it.each([['control'], ['off'], ['false'], ['disabled'], ['CONTROL']])(
    'treats the %s variant as off so a control group is never enrolled',
    (variant) => {
      // PostHog's default multivariate flag ships a `control` variant, and the
      // payload is easy to copy across every variant by accident.
      expect(parseCoreCanaryFlags(variant, { flags: ['enable-assets'] })).toEqual([])
    }
  )

  it.each([
    ['a disabled flag', false, { flags: ['enable-assets'] }],
    ['a missing payload', true, null],
    ['an array payload', true, ['enable-assets']],
    ['a non-array flags field', true, { flags: 'enable-assets' }],
    ['an oversized list', true, { flags: Array.from({ length: 33 }, () => 'enable-assets') }],
    ['a fetch miss', undefined, undefined]
  ])('fails closed for %s', (_label, value, payload) => {
    expect(parseCoreCanaryFlags(value, payload)).toEqual([])
  })

  it('drops raw argv, value-taking syntax, and non-string entries', () => {
    expect(
      parseCoreCanaryFlags(true, {
        flags: ['--enable-assets', 'enable-assets=true', 42, null, 'enable-assets']
      })
    ).toEqual(['enable-assets'])
  })

  it('drops any name outside the allowlist', () => {
    // The allowlist is the whole trust boundary: there is no `--help` schema to
    // check against at record-build time, and `enable-*` is not a safe shape —
    // `--enable-cors-header` bare means "allow every origin".
    expect(
      parseCoreCanaryFlags(true, {
        flags: ['enable-cors-header', 'enable-manager', 'enable-future-feature', 'listen']
      })
    ).toEqual([])
    expect(CORE_CANARY_ALLOWED_FLAGS).not.toContain('enable-cors-header')
  })
})

describe('appendCoreCanaryFlags', () => {
  it('appends to a source’s existing default args', () => {
    expect(appendCoreCanaryFlags('--enable-manager', ['enable-assets'])).toBe(
      '--enable-manager --enable-assets'
    )
  })

  it('handles a source whose default args are empty', () => {
    expect(appendCoreCanaryFlags('', ['enable-assets'])).toBe('--enable-assets')
  })

  it('returns the args untouched when nothing is enabled', () => {
    expect(appendCoreCanaryFlags('--enable-manager', [])).toBe('--enable-manager')
  })

  it('does not duplicate a flag the args already set', () => {
    expect(appendCoreCanaryFlags('--enable-assets', ['enable-assets'])).toBe('--enable-assets')
    expect(appendCoreCanaryFlags('--enable-assets=true', ['enable-assets'])).toBe(
      '--enable-assets=true'
    )
  })

  it('yields to a --disable-* opposite already in the args', () => {
    // A source's DEFAULT_LAUNCH_ARGS is authoritative over remote config.
    expect(appendCoreCanaryFlags('--disable-assets', ['enable-assets'])).toBe('--disable-assets')
  })

  it('keeps flags whose args control an unrelated feature', () => {
    expect(appendCoreCanaryFlags('--cpu --disable-auto-launch', ['enable-assets'])).toBe(
      '--cpu --disable-auto-launch --enable-assets'
    )
  })
})

describe('withCoreCanaryLaunchArgs', () => {
  async function enrolledWith(flags: string[]): Promise<void> {
    getOpsFlagResult.mockResolvedValue({ value: true, payload: { flags } })
    await initCoreCanary({ distinctId: 'device-id' })
  }

  it('pre-fills the enabled flags onto a freshly built record', async () => {
    await enrolledWith(['enable-assets'])
    await expect(
      withCoreCanaryLaunchArgs({ sourceId: 'standalone', launchArgs: '--enable-manager' })
    ).resolves.toEqual({ sourceId: 'standalone', launchArgs: '--enable-manager --enable-assets' })
  })

  it('leaves a record without launch args alone', async () => {
    await enrolledWith(['enable-assets'])
    const record = { sourceId: 'cloud' }
    await expect(withCoreCanaryLaunchArgs(record)).resolves.toBe(record)
  })

  it('returns the record unchanged when nobody is enrolled', async () => {
    getOpsFlagResult.mockResolvedValue({ value: false, payload: undefined })
    await initCoreCanary({ distinctId: 'device-id' })
    const record = { sourceId: 'standalone', launchArgs: '--enable-manager' }
    await expect(withCoreCanaryLaunchArgs(record)).resolves.toBe(record)
  })

  it('fails closed when the boot fetch never ran', async () => {
    // No `initCoreCanary`: the wizard must not block, and must not enrol.
    const record = { sourceId: 'standalone', launchArgs: '--enable-manager' }
    await expect(withCoreCanaryLaunchArgs(record)).resolves.toBe(record)
    expect(getOpsFlagResult).not.toHaveBeenCalled()
  })

  it('fails closed when evaluation fails', async () => {
    getOpsFlagResult.mockRejectedValue(new Error('offline'))
    await initCoreCanary({ distinctId: 'device-id' })
    const record = { sourceId: 'standalone', launchArgs: '' }
    await expect(withCoreCanaryLaunchArgs(record)).resolves.toBe(record)
  })

  it('awaits an in-flight boot fetch instead of racing to the fallback', async () => {
    let release: (result: unknown) => void = () => {}
    getOpsFlagResult.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    void initCoreCanary({ distinctId: 'device-id' })
    const pending = withCoreCanaryLaunchArgs({ launchArgs: '' })
    release({ value: true, payload: { flags: ['enable-assets'] } })
    await expect(pending).resolves.toEqual({ launchArgs: '--enable-assets' })
  })
})

describe('core canary fetch', () => {
  it('reads its own PostHog key once at boot', async () => {
    getOpsFlagResult.mockResolvedValue({ value: true, payload: { flags: ['enable-assets'] } })
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
    await expect(getCoreCanaryFlagsAsync()).resolves.toEqual(['enable-assets'])
  })
})
