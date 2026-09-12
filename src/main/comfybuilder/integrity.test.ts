// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  coerceDigest,
  digestKey,
  digestsEqual,
  isValidDigest,
  isValidSha256,
  makeDigest,
  normalizeDigestHex,
  normalizeSha256,
  parseDigestKey,
  selectModelDigest
} from './integrity'

const HEX_A = 'a'.repeat(64)
const HEX_B = 'b'.repeat(64)

describe('algorithm-tagged digests', () => {
  it('tags a bare hex value with the algorithm it was given', () => {
    expect(makeDigest(HEX_A, 'blake3')).toEqual({ algo: 'blake3', value: HEX_A })
    expect(makeDigest(HEX_A, 'sha256')).toEqual({ algo: 'sha256', value: HEX_A })
  })

  it('strips the matching prefix and normalizes case and whitespace', () => {
    expect(normalizeDigestHex(`  BLAKE3:${HEX_A.toUpperCase()} `, 'blake3')).toBe(HEX_A)
    expect(normalizeDigestHex(`sha256:${HEX_A}`, 'sha256')).toBe(HEX_A)
  })

  it('refuses a value labelled with a DIFFERENT algorithm instead of re-tagging it', () => {
    expect(normalizeDigestHex(`blake3:${HEX_A}`, 'sha256')).toBe('')
    expect(makeDigest(`sha256:${HEX_A}`, 'blake3')).toBeNull()
  })

  it.each([undefined, '', 'not-a-digest', 'a'.repeat(63), 'g'.repeat(64)])(
    'rejects %s as a digest value',
    (raw) => {
      expect(makeDigest(raw, 'blake3')).toBeNull()
      expect(makeDigest(raw, 'sha256')).toBeNull()
    }
  )

  it('rejects a structurally invalid tagged value', () => {
    expect(isValidDigest(undefined)).toBe(false)
    expect(isValidDigest({ algo: 'md5' as never, value: HEX_A })).toBe(false)
    expect(isValidDigest({ algo: 'blake3', value: 'short' })).toBe(false)
    expect(isValidDigest({ algo: 'blake3', value: HEX_A })).toBe(true)
  })
})

describe('digestKey - the algorithm is part of the identity', () => {
  it('keys a digest as <algo>:<hex>', () => {
    expect(digestKey({ algo: 'blake3', value: HEX_A })).toBe(`blake3:${HEX_A}`)
    expect(digestKey({ algo: 'sha256', value: HEX_A })).toBe(`sha256:${HEX_A}`)
  })

  it('gives IDENTICAL hex under different algorithms DIFFERENT keys', () => {
    const asBlake3 = { algo: 'blake3', value: HEX_A } as const
    const asSha256 = { algo: 'sha256', value: HEX_A } as const
    expect(asBlake3.value).toBe(asSha256.value)
    expect(digestKey(asBlake3)).not.toBe(digestKey(asSha256))
    expect(digestsEqual(asBlake3, asSha256)).toBe(false)
  })

  it('never reports two absent or invalid digests as equal', () => {
    expect(digestsEqual(undefined, undefined)).toBe(false)
    expect(digestsEqual(null, { algo: 'blake3', value: HEX_A })).toBe(false)
    expect(digestKey(undefined)).toBeUndefined()
  })

  it('round-trips through parseDigestKey', () => {
    expect(parseDigestKey(`blake3:${HEX_A}`)).toEqual({ algo: 'blake3', value: HEX_A })
    expect(parseDigestKey(`sha256:${HEX_B}`)).toEqual({ algo: 'sha256', value: HEX_B })
    expect(parseDigestKey(HEX_A)).toBeNull()
    expect(parseDigestKey(`md5:${HEX_A}`)).toBeNull()
  })

  it('coerces only a well-formed persisted object', () => {
    expect(coerceDigest({ algo: 'blake3', value: HEX_A })).toEqual({ algo: 'blake3', value: HEX_A })
    expect(coerceDigest({ algo: 'md5', value: HEX_A })).toBeNull()
    expect(coerceDigest({ value: HEX_A })).toBeNull()
    expect(coerceDigest(HEX_A)).toBeNull()
    expect(coerceDigest(null)).toBeNull()
  })
})

describe('selectModelDigest', () => {
  it('prefers blake3 when the manifest carries one', () => {
    expect(selectModelDigest({ blake3: HEX_A, sha256: HEX_B })).toEqual({
      algo: 'blake3',
      value: HEX_A
    })
  })

  it('falls back to sha256 for a manifest sealed before blake3 sealing', () => {
    expect(selectModelDigest({ sha256: HEX_B })).toEqual({ algo: 'sha256', value: HEX_B })
  })

  it('falls back to sha256 when the blake3 field is present but unusable', () => {
    expect(selectModelDigest({ blake3: '', sha256: HEX_B })).toEqual({
      algo: 'sha256',
      value: HEX_B
    })
    expect(selectModelDigest({ blake3: 'nonsense', sha256: HEX_B })).toEqual({
      algo: 'sha256',
      value: HEX_B
    })
  })

  it('returns null when neither field is usable', () => {
    expect(selectModelDigest({})).toBeNull()
    expect(selectModelDigest(undefined)).toBeNull()
    expect(selectModelDigest({ sha256: 'nope' })).toBeNull()
  })
})

describe('archive-install sha256 helpers stay intact', () => {
  it('keeps normalizeSha256 and isValidSha256 behaving exactly as before', () => {
    expect(normalizeSha256(`SHA256:${HEX_A.toUpperCase()}`)).toBe(HEX_A)
    expect(normalizeSha256(undefined)).toBe('')
    expect(isValidSha256(HEX_A)).toBe(true)
    expect(isValidSha256('nope')).toBe(false)
  })
})
