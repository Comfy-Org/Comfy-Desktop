import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildAuthorizeUrl,
  codeChallengeFromVerifier,
  generateCodeVerifier,
  generateState,
} from './pkce'

describe('pkce helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('matches the RFC 7636 appendix B challenge vector', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(codeChallengeFromVerifier(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('generates a URL-safe code verifier without padding', () => {
    const verifier = generateCodeVerifier()

    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(verifier).not.toContain('=')
  })

  it('generates a URL-safe state without padding', () => {
    const state = generateState()

    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(state).not.toContain('=')
  })

  it('builds an authorize url with required query params', () => {
    const url = buildAuthorizeUrl({
      authorizeUrl: 'https://login.example.com/oauth2/authorize',
      clientId: 'comfy-builder-dev',
      redirectUri: 'http://127.0.0.1:5173/callback?x=1',
      scope: 'openid profile email',
      resource: 'https://cloud.example.com/api',
      state: 'state-value',
      codeChallenge: 'challenge-value',
    })

    const parsed = new URL(url)

    expect(parsed.origin + parsed.pathname).toBe('https://login.example.com/oauth2/authorize')
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('client_id')).toBe('comfy-builder-dev')
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5173/callback?x=1')
    expect(parsed.searchParams.get('scope')).toBe('openid profile email')
    expect(parsed.searchParams.get('resource')).toBe('https://cloud.example.com/api')
    expect(parsed.searchParams.get('state')).toBe('state-value')
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge-value')
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
  })
})
