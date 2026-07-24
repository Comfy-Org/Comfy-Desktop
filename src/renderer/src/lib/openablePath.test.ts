import { describe, expect, it } from 'vitest'
import { isOpenablePathString } from './openablePath'

describe('isOpenablePathString', () => {
  it('accepts POSIX absolute and home paths', () => {
    expect(isOpenablePathString('/home/user/ComfyUI')).toBe(true)
    expect(isOpenablePathString('~/ComfyUI')).toBe(true)
  })

  it('accepts Windows drive and UNC paths', () => {
    expect(isOpenablePathString('C:\\Users\\me\\ComfyUI')).toBe(true)
    expect(isOpenablePathString('C:/Users/me/ComfyUI')).toBe(true)
    expect(isOpenablePathString('\\\\server\\share\\models')).toBe(true)
  })

  it('rejects empty and placeholder values', () => {
    expect(isOpenablePathString('')).toBe(false)
    expect(isOpenablePathString('   ')).toBe(false)
    expect(isOpenablePathString('—')).toBe(false)
  })

  it('rejects URLs', () => {
    expect(isOpenablePathString('https://github.com/comfyanonymous/ComfyUI')).toBe(false)
    expect(isOpenablePathString('file:///home/user/x')).toBe(false)
    expect(isOpenablePathString('http://localhost:8188/')).toBe(false)
  })

  it('rejects SSH / scp-style git remotes', () => {
    expect(isOpenablePathString('git@github.com:comfyanonymous/ComfyUI.git')).toBe(false)
  })

  it('rejects date-like values that merely contain slashes', () => {
    expect(isOpenablePathString('2024/01/02')).toBe(false)
    expect(isOpenablePathString('01-02-2024')).toBe(false)
  })

  it('keeps date-prefixed paths openable', () => {
    expect(isOpenablePathString('2024/01/02/models')).toBe(true)
    expect(isOpenablePathString('2024-01-02/models')).toBe(true)
  })

  it('rejects plain text without separators', () => {
    expect(isOpenablePathString('master')).toBe(false)
    expect(isOpenablePathString('ComfyUI')).toBe(false)
    expect(isOpenablePathString('v1.2.3')).toBe(false)
  })
})
