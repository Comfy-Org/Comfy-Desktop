import { describe, expect, it } from 'vitest'
import { isIllegalPostHogDistinctId, normalizeOpaqueIdentifier } from './opaqueIdentifier'

describe('isIllegalPostHogDistinctId', () => {
  it.each([
    // Case-insensitive entries match in any casing.
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
    // Case-sensitive entries match only in their listed casing.
    '[object Object]',
    'NaN',
    'None',
    'none',
    'null',
    '0',
    // Blank identities can never merge.
    '',
    '   '
  ])('flags %j as illegal', (value) => {
    expect(isIllegalPostHogDistinctId(value)).toBe(true)
  })

  it.each([
    // Other casings of the case-sensitive entries stay legal.
    'NONE',
    'NULL',
    'nan',
    '[object object]',
    // Near-misses of illegal values stay legal.
    '00',
    'anonymous-2',
    'user-123'
  ])('keeps %j legal', (value) => {
    expect(isIllegalPostHogDistinctId(value)).toBe(false)
  })
})

describe('normalizeOpaqueIdentifier', () => {
  it('trims surrounding whitespace and returns the identifier', () => {
    expect(normalizeOpaqueIdentifier('  user-123  ', 128)).toBe('user-123')
  })

  it('keeps an identifier exactly at the length limit', () => {
    expect(normalizeOpaqueIdentifier('a'.repeat(128), 128)).toBe('a'.repeat(128))
  })

  it.each([
    ['a non-string', 42],
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['over the length limit', 'a'.repeat(129)],
    ['an embedded control character', 'user\u0000id'],
    ['an embedded tab', 'user\tid'],
    ['a DEL character', 'user\u007fid']
  ])('rejects %s', (_case, value) => {
    expect(normalizeOpaqueIdentifier(value, 128)).toBeNull()
  })
})
