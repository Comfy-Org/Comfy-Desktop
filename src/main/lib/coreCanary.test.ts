import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComfyArgsSchema } from './comfy-args'

const getOpsFlagResult = vi.fn()
vi.mock('./telemetry', () => ({
  getOpsFlagResult: (...args: unknown[]) => getOpsFlagResult(...args)
}))

import {
  CORE_CANARY_FLAG_KEY,
  _resetForTest,
  getCoreCanaryConfigAsync,
  initCoreCanary,
  parseCoreCanaryConfig,
  resolveCoreCanaryLaunchArgs
} from './coreCanary'

const schema: ComfyArgsSchema = {
  knownFlags: new Set([
    'enable-assets',
    'enable-asset-hashing',
    'enable-manager',
    'enable-cors-header'
  ]),
  args: [
    {
      name: 'enable-assets',
      flag: '--enable-assets',
      help: 'Enable assets',
      type: 'boolean',
      category: 'features'
    },
    {
      name: 'enable-asset-hashing',
      flag: '--enable-asset-hashing',
      help: 'Enable asset hashing',
      type: 'boolean',
      category: 'features'
    },
    {
      name: 'enable-manager',
      flag: '--enable-manager',
      help: 'Enable Manager',
      type: 'boolean',
      category: 'manager'
    },
    {
      name: 'enable-cors-header',
      flag: '--enable-cors-header',
      help: 'Set CORS origin',
      type: 'value',
      category: 'network'
    }
  ]
}

beforeEach(() => {
  _resetForTest()
  getOpsFlagResult.mockReset()
})

describe('parseCoreCanaryConfig', () => {
  it('accepts and deduplicates enabled Core feature names', () => {
    expect(
      parseCoreCanaryConfig(true, {
        flags: ['enable-assets', 'enable-asset-hashing', 'enable-assets']
      })
    ).toEqual({ flags: ['enable-assets', 'enable-asset-hashing'] })
  })

  it('accepts a multivariate flag assignment as enabled', () => {
    expect(parseCoreCanaryConfig('canary', { flags: ['enable-assets'] })).toEqual({
      flags: ['enable-assets']
    })
  })

  it.each([
    [false, { flags: ['enable-assets'] }],
    [true, null],
    [true, ['enable-assets']],
    [true, { flags: 'enable-assets' }],
    [true, { flags: Array.from({ length: 33 }, () => 'enable-assets') }]
  ])('fails closed for a disabled flag or malformed payload', (value, payload) => {
    expect(parseCoreCanaryConfig(value, payload)).toEqual({ flags: [] })
  })

  it('drops raw argv, value-taking syntax, and invalid names', () => {
    expect(
      parseCoreCanaryConfig(true, {
        flags: ['--enable-assets', 'enable-assets=true', 'listen', 'enable-assets']
      })
    ).toEqual({ flags: ['enable-assets'] })
  })
})

describe('resolveCoreCanaryLaunchArgs', () => {
  it('injects only supported boolean flags in Core’s features category', () => {
    const config = {
      flags: [
        'enable-assets',
        'enable-asset-hashing',
        'enable-manager',
        'enable-cors-header',
        'enable-future-feature'
      ]
    }
    expect(resolveCoreCanaryLaunchArgs(config, schema)).toEqual([
      '--enable-assets',
      '--enable-asset-hashing'
    ])
  })
})

describe('core canary fetch', () => {
  it('fetches once at boot and exposes the parsed payload', async () => {
    getOpsFlagResult.mockResolvedValue({
      value: true,
      payload: { flags: ['enable-assets'] }
    })
    await Promise.all([
      initCoreCanary({ distinctId: 'installation-id' }),
      initCoreCanary({ distinctId: 'installation-id' })
    ])

    expect(getOpsFlagResult).toHaveBeenCalledOnce()
    expect(getOpsFlagResult).toHaveBeenCalledWith(
      CORE_CANARY_FLAG_KEY,
      'installation-id',
      expect.any(Number)
    )
    await expect(getCoreCanaryConfigAsync()).resolves.toEqual({ flags: ['enable-assets'] })
  })

  it('awaits an in-flight boot fetch instead of racing to the fallback', async () => {
    let release: (result: unknown) => void = () => {}
    getOpsFlagResult.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    void initCoreCanary({ distinctId: 'installation-id' })
    const pending = getCoreCanaryConfigAsync()
    release({ value: true, payload: { flags: ['enable-assets'] } })
    await expect(pending).resolves.toEqual({ flags: ['enable-assets'] })
  })

  it('fails closed when evaluation fails', async () => {
    getOpsFlagResult.mockRejectedValue(new Error('offline'))
    await initCoreCanary({ distinctId: 'installation-id' })
    await expect(getCoreCanaryConfigAsync()).resolves.toEqual({ flags: [] })
  })
})
