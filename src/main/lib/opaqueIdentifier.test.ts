import { describe, expect, it } from 'vitest'
import { normalizeOpaqueIdentifier } from './opaqueIdentifier'

describe('normalizeOpaqueIdentifier', () => {
  it('trims a valid identifier', () => {
    expect(normalizeOpaqueIdentifier('  user-123  ', 128)).toBe('user-123')
  })

  it.each([
    42,
    null,
    undefined,
    '',
    '   ',
    'a'.repeat(129),
    'user\u0000id',
    'user\tid',
    'user\u007fid'
  ])('rejects invalid identifier %j', (value) => {
    expect(normalizeOpaqueIdentifier(value, 128)).toBeNull()
  })
})
