import { describe, expect, it } from 'vitest'
import { isIllegalPostHogDistinctId, normalizeOpaqueIdentifier } from './opaqueIdentifier'

describe('isIllegalPostHogDistinctId', () => {
  it.each([
    'anonymous',
    'ANONYMOUS',
    'guest',
    'distinctid',
    'DistinctId',
    'distinct_id',
    'id',
    'not_authenticated',
    'email',
    'undefined',
    'true',
    'False',
    '[object Object]',
    'NaN',
    'None',
    'none',
    'null',
    '0',
    '',
    '   '
  ])('flags %j as illegal', (value) => {
    expect(isIllegalPostHogDistinctId(value)).toBe(true)
  })

  it.each(['NONE', 'NULL', 'nan', '[object object]', '00', 'anonymous-2', 'user-123'])(
    'keeps %j legal',
    (value) => {
      expect(isIllegalPostHogDistinctId(value)).toBe(false)
    }
  )
})

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
