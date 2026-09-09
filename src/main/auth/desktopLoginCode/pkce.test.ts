import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { codeChallengeS256, createCodeVerifier } from './pkce'

describe('createCodeVerifier', () => {
  it('produces a 43-char base64url string (32 random bytes)', () => {
    expect(createCodeVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('produces a fresh value per call', () => {
    expect(createCodeVerifier()).not.toBe(createCodeVerifier())
  })
})

describe('codeChallengeS256', () => {
  it('matches the RFC 7636 appendix B vector', () => {
    expect(codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    )
  })

  it('is base64url(sha256(verifier)) for a generated verifier', () => {
    const verifier = createCodeVerifier()
    expect(codeChallengeS256(verifier)).toBe(
      createHash('sha256').update(verifier).digest('base64url')
    )
  })
})
