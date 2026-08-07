// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildAuthorizeUrl,
  codeChallengeFromVerifier,
  generateCodeVerifier,
  generateState
} from './pkce'

describe('pkce', () => {
  it('code verifier + state are distinct base64url secrets', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier())
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('code challenge is S256(verifier) in base64url', () => {
    const v = 'test-verifier'
    expect(codeChallengeFromVerifier(v)).toBe(createHash('sha256').update(v).digest('base64url'))
  })

  it('buildAuthorizeUrl sets the PKCE params', () => {
    const u = new URL(
      buildAuthorizeUrl({
        authorizeUrl: 'https://c/oauth/authorize',
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:5/callback',
        scope: 'sc',
        resource: 'https://c/api',
        state: 'st',
        codeChallenge: 'ch'
      })
    )
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('client_id')).toBe('cid')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('workspace_id')).toBeNull()
  })

  it('buildAuthorizeUrl includes workspace_id only when given (switch path)', () => {
    const u = new URL(
      buildAuthorizeUrl({
        authorizeUrl: 'https://c/oauth/authorize',
        clientId: 'cid',
        redirectUri: 'r',
        scope: 's',
        state: 'st',
        codeChallenge: 'ch',
        workspaceId: 'w-1'
      })
    )
    expect(u.searchParams.get('workspace_id')).toBe('w-1')
  })
})
