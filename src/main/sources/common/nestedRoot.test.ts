import path from 'path'
import { describe, expect, it } from 'vitest'

import { resolveNestedComfyUIParent } from './nestedRoot'

describe('resolveNestedComfyUIParent', () => {
  const always = (): boolean => true
  const never = (): boolean => false

  it('returns the parent when the dir is ComfyUI and the parent has the marker', () => {
    const dir = path.join('root', 'ComfyUI')
    expect(resolveNestedComfyUIParent(dir, always)).toBe('root')
  })

  it('matches ComfyUI case-insensitively', () => {
    const dir = path.join('root', 'comfyui')
    expect(resolveNestedComfyUIParent(dir, always)).toBe('root')
  })

  it('returns null when the dir is not named ComfyUI', () => {
    const dir = path.join('root', 'models')
    expect(resolveNestedComfyUIParent(dir, always)).toBeNull()
  })

  it('returns null when the parent lacks the marker', () => {
    const dir = path.join('root', 'ComfyUI')
    expect(resolveNestedComfyUIParent(dir, never)).toBeNull()
  })

  it('passes the parent path to the marker predicate', () => {
    const dir = path.join('root', 'ComfyUI')
    let seen = ''
    resolveNestedComfyUIParent(dir, (parent) => {
      seen = parent
      return true
    })
    expect(seen).toBe('root')
  })
})
