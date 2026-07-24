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
    await reconcileManagerConfigForLaunch({ remote: true, installPath: '/inst' })
    expect(mockEnsure).not.toHaveBeenCalled()
  })

  it('passes the launched install\'s own level (mirrors stay a global setting)', async () => {
    mockSettings = { useChineseMirrors: true }

    await reconcileManagerConfigForLaunch({
      remote: false, installPath: '/inst', securityLevel: 'weak'
    })

    expect(mockEnsure).toHaveBeenCalledWith('/inst', {
      useChineseMirrors: true,
      securityLevel: 'weak',
      networkMode: undefined
    })
  })

  it('keeps per-install levels isolated between launches', async () => {
    await reconcileManagerConfigForLaunch({
      remote: false, installPath: '/inst-a', securityLevel: 'strong'
    })
    await reconcileManagerConfigForLaunch({
      remote: false, installPath: '/inst-b', securityLevel: 'normal-'
    })

    expect(mockEnsure).toHaveBeenNthCalledWith(1, '/inst-a', {
      useChineseMirrors: false, securityLevel: 'strong', networkMode: undefined
    })
    expect(mockEnsure).toHaveBeenNthCalledWith(2, '/inst-b', {
      useChineseMirrors: false, securityLevel: 'normal-', networkMode: undefined
    })
  })

  it('passes the launched install\'s own network mode', async () => {
    await reconcileManagerConfigForLaunch({
      remote: false, installPath: '/inst', securityLevel: 'normal', networkMode: 'personal_cloud'
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
      remote: false, installPath: '/inst', securityLevel: 'bogus', networkMode: 'bogus'
    })

    expect(mockEnsure).toHaveBeenCalledWith('/inst', {
      useChineseMirrors: false,
      securityLevel: undefined,
      networkMode: undefined
    })
  })

  it('warns and captures config_seed_failed telemetry on failure without throwing', async () => {
    const err = new Error('EACCES: permission denied')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockEnsure.mockRejectedValueOnce(err)

    try {
      await expect(
        reconcileManagerConfigForLaunch({ remote: false, installPath: '/inst' })
      ).resolves.toBeUndefined()

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
})
