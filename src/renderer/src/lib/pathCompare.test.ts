import { describe, expect, it } from 'vitest'
import { canonPath, samePath } from './pathCompare'

describe('canonPath', () => {
  it('collapses repeated separators and drops trailing ones on POSIX', () => {
    expect(canonPath('/mnt//extra/models/', false)).toBe('/mnt/extra/models')
    expect(canonPath('/mnt/extra/./models', false)).toBe('/mnt/extra/models')
  })

  it('resolves .. segments lexically without escaping the root', () => {
    expect(canonPath('/mnt/extra/../shared/models', false)).toBe('/mnt/shared/models')
    expect(canonPath('/../models', false)).toBe('/models')
  })

  it('keeps relative .. segments when there is no root', () => {
    expect(canonPath('../models', false)).toBe('../models')
    expect(canonPath('a/../../models', false)).toBe('../models')
  })

  it('unifies slashes and lowercases on Windows', () => {
    expect(canonPath('C:/Users/Me//Models\\', true)).toBe('c:\\users\\me\\models')
  })

  it('keeps the UNC server/share root intact under ..', () => {
    expect(canonPath('\\\\server\\share\\a\\..\\..\\..\\b', true)).toBe('\\\\server\\share\\b')
  })

  it('leaves drive-relative Windows paths unresolved apart from case', () => {
    expect(canonPath('C:models\\sub', true)).toBe('c:models\\sub')
  })
})

describe('samePath', () => {
  it('matches equivalent spellings per platform', () => {
    expect(samePath('/mnt/extra/models', '/mnt/extra/models/', false)).toBe(true)
    expect(samePath('C:\\Models', 'c:/models', true)).toBe(true)
  })

  it('is case-sensitive on POSIX and rejects different paths', () => {
    expect(samePath('/mnt/Models', '/mnt/models', false)).toBe(false)
    expect(samePath('C:\\Models', 'D:\\Models', true)).toBe(false)
  })

  it('never matches empty inputs', () => {
    expect(samePath('', '', false)).toBe(false)
    expect(samePath('/mnt/models', '', false)).toBe(false)
  })
})
