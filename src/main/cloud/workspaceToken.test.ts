// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { classifyMint, mintWorkspaceToken } from './workspaceToken'
import type { WorkspaceTokenMint } from './workspaceToken'

function respond(status: number, body: unknown, headers: Record<string, string> = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers }))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mintWorkspaceToken', () => {
  it('posts the workspace with the access token as Bearer', async () => {
    respond(200, { token: 'cloud-jwt', expires_at: '2026-11-07T12:15:00Z' })

    await expect(
      mintWorkspaceToken('oauth-access', 'ws-2', { apiBase: 'https://cloud.test/api/' })
    ).resolves.toEqual({
      kind: 'minted',
      token: 'cloud-jwt',
      expiresAt: Date.parse('2026-11-07T12:15:00Z')
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://cloud.test/api/auth/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer oauth-access' }),
        body: JSON.stringify({ workspace_id: 'ws-2' })
      })
    )
  })

  it.each([
    ['a refused grant', 403, { code: 'oauth_token_mint_refused' }, 'oauth_token_mint_refused'],
    ['an SSO-enforced workspace', 403, { code: 'sso_required' }, 'sso_required'],
    ['an unavailable workspace', 404, { code: 'NOT_FOUND' }, 'NOT_FOUND'],
    ['a rate limit', 429, {}, undefined],
    ['a server error', 500, {}, undefined],
    [
      'a disabled mint',
      503,
      { code: 'oauth_workspace_mint_disabled' },
      'oauth_workspace_mint_disabled'
    ],
    ['a non-string code', 403, { code: 7 }, undefined],
    ['a body without a token', 200, { expires_at: '2026-11-07T12:15:00Z' }, undefined],
    ['an unreadable expiry', 200, { token: 'cloud-jwt', expires_at: 'soon' }, undefined]
  ])('reports %s as failed with its error code', async (_name, status, body, code) => {
    respond(status, body)

    await expect(mintWorkspaceToken('oauth-access', 'ws-1')).resolves.toEqual({
      kind: 'failed',
      status,
      ...(code ? { code } : {})
    })
  })

  it.each([
    ['120', 120],
    ['0', 0],
    ['Wed, 21 Oct 2026 07:28:00 GMT', undefined],
    ['-5', undefined],
    ['', undefined]
  ])('reads a Retry-After of %j', async (header, retryAfterSeconds) => {
    respond(429, {}, { 'Retry-After': header })

    await expect(mintWorkspaceToken('oauth-access', 'ws-1')).resolves.toEqual({
      kind: 'failed',
      status: 429,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
    })
  })

  it('reports a network error as failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline')
      })
    )

    await expect(mintWorkspaceToken('oauth-access', 'ws-1')).resolves.toEqual({
      kind: 'failed',
      status: null
    })
  })
})

describe('classifyMint', () => {
  const failed = (status: number | null, code?: string): WorkspaceTokenMint => ({
    kind: 'failed',
    status,
    ...(code ? { code } : {})
  })

  it('passes a minted token through', () => {
    const mint: WorkspaceTokenMint = { kind: 'minted', token: 't', expiresAt: 1 }

    expect(classifyMint(mint)).toEqual(mint)
  })

  it.each([
    ['404 NOT_FOUND', failed(404, 'NOT_FOUND'), { kind: 'unavailable' }],
    [
      '403 sso_required',
      failed(403, 'sso_required'),
      { kind: 'reauthorize', reason: 'sso_required' }
    ],
    ['403 with no code', failed(403), { kind: 'refused' }],
    [
      '403 account_outside_organization',
      failed(403, 'account_outside_organization'),
      { kind: 'refused' }
    ],
    [
      '403 personal_workspace_disabled',
      failed(403, 'personal_workspace_disabled'),
      { kind: 'refused' }
    ],
    ['403 workspace_access_denied', failed(403, 'workspace_access_denied'), { kind: 'refused' }],
    ['403 oauth_token_mint_refused', failed(403, 'oauth_token_mint_refused'), { kind: 'refused' }],
    ['403 insufficient_scope', failed(403, 'insufficient_scope'), { kind: 'refused' }],
    [
      '403 oauth_derived_mint_refused',
      failed(403, 'oauth_derived_mint_refused'),
      { kind: 'refused' }
    ],
    ['400', failed(400), { kind: 'refused' }],
    [
      '401 oauth_grant_ended',
      failed(401, 'oauth_grant_ended'),
      { kind: 'reauthorize', reason: 'grant_ended' }
    ],
    ['plain 401', failed(401), { kind: 'unauthorized' }],
    [
      '503 oauth_workspace_mint_disabled',
      failed(503, 'oauth_workspace_mint_disabled'),
      { kind: 'reauthorize', reason: 'mint_disabled' }
    ],
    ['503 of another kind', failed(503, 'maintenance'), { kind: 'retryable' }],
    [
      '500 with the disabled code',
      failed(500, 'oauth_workspace_mint_disabled'),
      { kind: 'retryable' }
    ],
    ['429', failed(429), { kind: 'retryable' }],
    ['500', failed(500), { kind: 'retryable' }],
    ['503', failed(503), { kind: 'retryable' }],
    ['a network failure', failed(null), { kind: 'retryable' }],
    ['a malformed 200', failed(200), { kind: 'retryable' }]
  ])('classifies %s', (_name, mint, outcome) => {
    expect(classifyMint(mint)).toEqual(outcome)
  })

  it('carries Retry-After on a retryable outcome', () => {
    expect(classifyMint({ kind: 'failed', status: 429, retryAfterSeconds: 30 })).toEqual({
      kind: 'retryable',
      retryAfterSeconds: 30
    })
  })
})
