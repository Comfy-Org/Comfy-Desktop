// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mintWorkspaceToken } from './workspaceToken'

function respond(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
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
    ['a refused grant', 403, { code: 'oauth_token_mint_refused' }],
    ['an SSO-enforced workspace', 403, { code: 'sso_required' }],
    ['an unavailable workspace', 404, { code: 'NOT_FOUND' }],
    ['a rate limit', 429, {}],
    ['a server error', 500, {}],
    ['a body without a token', 200, { expires_at: '2026-11-07T12:15:00Z' }],
    ['an unreadable expiry', 200, { token: 'cloud-jwt', expires_at: 'soon' }]
  ])('reports %s as failed', async (_name, status, body) => {
    respond(status, body)

    await expect(mintWorkspaceToken('oauth-access', 'ws-1')).resolves.toEqual({
      kind: 'failed',
      status
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
