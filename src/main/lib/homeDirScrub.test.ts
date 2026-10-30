import os from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scrubPII, setScrubbedHomeDir } from '../../shared/piiScrub'
import { registerHomeDirScrub } from './homeDirScrub'

describe('registerHomeDirScrub', () => {
  afterEach(() => {
    setScrubbedHomeDir('')
    vi.restoreAllMocks()
  })

  it('reads os.homedir() by default', () => {
    vi.spyOn(os, 'homedir').mockReturnValue('/var/lib/alice')
    registerHomeDirScrub()
    expect(scrubPII('/var/lib/alice/x')).toBe('/var/lib/[REDACTED]/x')
  })

  it('registers the home directory for scrubbing', () => {
    registerHomeDirScrub(() => 'D:\\Profiles\\alice')
    expect(scrubPII('D:\\Profiles\\alice\\x')).toBe('D:\\Profiles\\[REDACTED]\\x')
  })

  it('does not throw when the OS reports no home', () => {
    expect(() =>
      registerHomeDirScrub(() => {
        throw new Error('ENOENT')
      })
    ).not.toThrow()
  })
})
