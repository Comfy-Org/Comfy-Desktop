import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory settings store so the test never touches electron or disk.
let mockSettings: Record<string, unknown> = {}

vi.mock('../settings', () => ({
  get: vi.fn((key: string) => mockSettings[key])
}))

vi.mock('./telemetry', () => ({
  capture: vi.fn()
}))

vi.mock('./managerConfig', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureManagerConfig: vi.fn(async () => {})
}))

import { reconcileManagerConfigForLaunch } from './managerConfigLaunch'
import { ensureManagerConfig } from './managerConfig'
import * as telemetry from './telemetry'
import { buildErrorFields } from '../../shared/errorEvent'

const mockEnsure = vi.mocked(ensureManagerConfig)

describe('reconcileManagerConfigForLaunch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettings = {}
  })

  it('skips remote launches entirely (no local install to reconcile)', async () => {
    await expect(
      reconcileManagerConfigForLaunch({ remote: true, installPath: '/inst' })
    ).resolves.toEqual({ ok: true })
    expect(mockEnsure).not.toHaveBeenCalled()
  })

  it("passes the launched install's own level (mirrors stay a global setting)", async () => {
    mockSettings = { useChineseMirrors: true }

    await reconcileManagerConfigForLaunch({
      remote: false,
      installPath: '/inst',
      securityLevel: 'weak'
    })

    expect(mockEnsure).toHaveBeenCalledWith('/inst', {
      useChineseMirrors: true,
      securityLevel: 'weak',
      networkMode: undefined
    })
  })

  it('keeps per-install levels isolated between launches', async () => {
    await reconcileManagerConfigForLaunch({
      remote: false,
      installPath: '/inst-a',
      securityLevel: 'strong'
    })
    await reconcileManagerConfigForLaunch({
      remote: false,
      installPath: '/inst-b',
      securityLevel: 'normal-'
    })

    expect(mockEnsure).toHaveBeenNthCalledWith(1, '/inst-a', {
      useChineseMirrors: false,
      securityLevel: 'strong',
      networkMode: undefined
    })
    expect(mockEnsure).toHaveBeenNthCalledWith(2, '/inst-b', {
      useChineseMirrors: false,
      securityLevel: 'normal-',
      networkMode: undefined
    })
  })

  it("passes the launched install's own network mode", async () => {
    await reconcileManagerConfigForLaunch({
      remote: false,
      installPath: '/inst',
      securityLevel: 'normal',
      networkMode: 'personal_cloud'
    })

    expect(mockEnsure).toHaveBeenCalledWith('/inst', {
      useChineseMirrors: false,
      securityLevel: 'normal',
      networkMode: 'personal_cloud'
    })
  })

  it('passes mirror=false and no options when the user never opted into any', async () => {
    await reconcileManagerConfigForLaunch({ remote: false, installPath: '/inst' })

    expect(mockEnsure).toHaveBeenCalledWith('/inst', {
      useChineseMirrors: false,
      securityLevel: undefined,
      networkMode: undefined
    })
  })

  it('degrades hand-edited bogus values to undefined instead of leaking them', async () => {
    await reconcileManagerConfigForLaunch({
      remote: false,
      installPath: '/inst',
      securityLevel: 'bogus',
      networkMode: 'bogus'
    })

    expect(mockEnsure).toHaveBeenCalledWith('/inst', {
      useChineseMirrors: false,
      securityLevel: undefined,
      networkMode: undefined
    })
  })

  it('stays non-blocking on failure when no Manager option was chosen (mirror-only seeding)', async () => {
    const err = new Error('EACCES: permission denied')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockEnsure.mockRejectedValueOnce(err)

    try {
      await expect(
        reconcileManagerConfigForLaunch({ remote: false, installPath: '/inst' })
      ).resolves.toEqual({ ok: true })

      expect(warn).toHaveBeenCalledWith('Failed to reconcile ComfyUI-Manager config:', err)
      // Exact match against the canonical scrubbed fields - a drift to an
      // ad hoc (unsanitized) payload must fail here.
      expect(telemetry.capture).toHaveBeenCalledWith(
        'comfy.desktop.manager.config_seed_failed',
        buildErrorFields(err)
      )
    } finally {
      warn.mockRestore()
    }
  })

  // Fail closed: launching after a failed write would run Manager with stale
  // (possibly weaker) security settings while the UI claims the new values.
  it('fails closed when a chosen security level cannot be written', async () => {
    const err = new Error('EACCES: permission denied')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockEnsure.mockRejectedValueOnce(err)

    try {
      await expect(
        reconcileManagerConfigForLaunch({
          remote: false,
          installPath: '/inst',
          securityLevel: 'strong'
        })
      ).resolves.toEqual({ ok: false, error: err })
      expect(telemetry.capture).toHaveBeenCalledWith(
        'comfy.desktop.manager.config_seed_failed',
        buildErrorFields(err)
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('fails closed when a chosen network mode cannot be written', async () => {
    const err = new Error('EBUSY: resource busy')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockEnsure.mockRejectedValueOnce(err)

    try {
      await expect(
        reconcileManagerConfigForLaunch({
          remote: false,
          installPath: '/inst',
          networkMode: 'public'
        })
      ).resolves.toEqual({ ok: false, error: err })
    } finally {
      warn.mockRestore()
    }
  })

  it('stays non-blocking on failure when only bogus (ignored) options were passed', async () => {
    const err = new Error('boom')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockEnsure.mockRejectedValueOnce(err)

    try {
      await expect(
        reconcileManagerConfigForLaunch({
          remote: false,
          installPath: '/inst',
          securityLevel: 'bogus',
          networkMode: 'bogus'
        })
      ).resolves.toEqual({ ok: true })
    } finally {
      warn.mockRestore()
    }
  })
})
