import { afterEach, describe, expect, it } from 'vitest'
import { scrubPII, setScrubbedHomeDir } from '../../shared/piiScrub'
import { registerHomeDirScrub } from './homeDirScrub'

describe('registerHomeDirScrub', () => {
  afterEach(() => setScrubbedHomeDir(''))

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
