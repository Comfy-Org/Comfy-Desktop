import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ backend: vi.fn<() => string>() }))

vi.mock('electron', () => ({ safeStorage: { getSelectedStorageBackend: h.backend } }))

const { keepsTokensInOsKeychain } = await import('./storageStrength')

beforeEach(() => {
  h.backend.mockReset()
})

describe('keepsTokensInOsKeychain', () => {
  it.each(['win32', 'darwin'] as const)(
    'trusts the %s keychain without asking Linux',
    (platform) => {
      expect(keepsTokensInOsKeychain(platform)).toBe(true)
      expect(h.backend).not.toHaveBeenCalled()
    }
  )

  it.each(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])(
    'trusts a Linux %s keyring',
    (backend) => {
      h.backend.mockReturnValue(backend)
      expect(keepsTokensInOsKeychain('linux')).toBe(true)
    }
  )

  it.each(['basic_text', 'unknown'])('refuses Linux without a real keyring (%s)', (backend) => {
    h.backend.mockReturnValue(backend)
    expect(keepsTokensInOsKeychain('linux')).toBe(false)
  })

  it('refuses when Linux cannot say which keyring it uses', () => {
    h.backend.mockImplementation(() => {
      throw new Error('not ready')
    })
    expect(keepsTokensInOsKeychain('linux')).toBe(false)
  })
})
