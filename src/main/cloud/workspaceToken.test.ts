// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    const expiresAt = new Date(Date.now() + 900_000).toISOString()
    respond(200, { token: 'cloud-jwt', expires_at: expiresAt })

    await expect(
      mintWorkspaceToken('oauth-access', 'ws-2', { apiBase: 'https://cloud.test/api/' })
    ).resolves.toEqual({
      kind: 'minted',
      token: 'cloud-jwt',
      expiresAt: Date.parse(expiresAt)
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
    ['an unreadable expiry', 200, { token: 'cloud-jwt', expires_at: 'soon' }, undefined],
    [
      'an expiry already past',
      200,
      { token: 'cloud-jwt', expires_at: new Date(Date.now() - 1000).toISOString() },
      undefined
    ]
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

describe('mintWorkspaceToken and the local clock', () => {
  const SERVER_NOW_MS = Date.parse('2026-11-08T12:00:00Z')
  const SERVER_NOW = SERVER_NOW_MS / 1000
  const HOUR_MS = 3_600_000
  const LIFETIME_MS = 900_000

  function jwt(claims: Record<string, unknown>): string {
    const b64 = (value: unknown): string =>
      Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url')
    return `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`
  }

  function serverReply(claims: Record<string, unknown>, expiresAtMs: number): void {
    respond(200, { token: jwt(claims), expires_at: new Date(expiresAtMs).toISOString() })
  }

  function fifteenMinuteToken(): Record<string, number> {
    return { iat: SERVER_NOW, exp: SERVER_NOW + LIFETIME_MS / 1000 }
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each<[string, number]>([
    ['an hour ahead of', HOUR_MS],
    ['a day ahead of', 24 * HOUR_MS],
    ['an hour behind', -HOUR_MS],
    ['matching', 0]
  ])('a clock %s the server gets the token its real lifetime', async (_name, skewMs) => {
    const clientNow = SERVER_NOW_MS + skewMs
    vi.setSystemTime(clientNow)
    serverReply(fifteenMinuteToken(), SERVER_NOW_MS + LIFETIME_MS)

    await expect(mintWorkspaceToken('oauth-access', 'ws-1')).resolves.toMatchObject({
      kind: 'minted',
      expiresAt: clientNow + LIFETIME_MS
    })
  })

  it('a slow clock with transit time never stretches the token past its real validity', async () => {
    const skewMs = -HOUR_MS
    const clientStart = SERVER_NOW_MS + skewMs - 2_000
    vi.setSystemTime(clientStart)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        vi.setSystemTime(clientStart + 5_000)
        return new Response(
          JSON.stringify({
            token: jwt(fifteenMinuteToken()),
            expires_at: new Date(SERVER_NOW_MS + LIFETIME_MS).toISOString()
          }),
          { status: 200 }
        )
      })
    )
    const realExpiryOnClientClock = SERVER_NOW_MS + LIFETIME_MS + skewMs

    const mint = await mintWorkspaceToken('oauth-access', 'ws-1')

    expect(mint).toMatchObject({ kind: 'minted', expiresAt: clientStart + LIFETIME_MS })
    expect(mint.kind === 'minted' && mint.expiresAt).toBeLessThanOrEqual(realExpiryOnClientClock)
  })

  it('a parent-capped token keeps only its short lifetime', async () => {
    vi.setSystemTime(SERVER_NOW_MS + HOUR_MS)
    serverReply({ iat: SERVER_NOW, exp: SERVER_NOW + 30 }, SERVER_NOW_MS + 30_000)

    await expect(mintWorkspaceToken('oauth-access', 'ws-1')).resolves.toMatchObject({
      expiresAt: SERVER_NOW_MS + HOUR_MS + 30_000
    })
  })

  it.each<[string, Record<string, number>]>([
    ['a zero', { iat: SERVER_NOW, exp: SERVER_NOW }],
    ['a negative', { iat: SERVER_NOW, exp: SERVER_NOW - 5 }]
  ])('rejects %s lifetime even with a later expires_at', async (_name, claims) => {
    vi.setSystemTime(SERVER_NOW_MS)
    serverReply(claims, SERVER_NOW_MS + LIFETIME_MS)

    await expect(mintWorkspaceToken('oauth-access', 'ws-1')).resolves.toEqual({
      kind: 'failed',
      status: 200
    })
  })

  it('rejects a zero lifetime even when the clock steps back during the request', async () => {
    vi.setSystemTime(SERVER_NOW_MS)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        vi.setSystemTime(SERVER_NOW_MS - 60_000)
        return new Response(
          JSON.stringify({
            token: jwt({ iat: SERVER_NOW, exp: SERVER_NOW }),
            expires_at: new Date(SERVER_NOW_MS).toISOString()
          }),
          { status: 200 }
        )
      })
    )

    await expect(mintWorkspaceToken('oauth-access', 'ws-1')).resolves.toEqual({
      kind: 'failed',
      status: 200
    })
  })

  it('rejects a positive lifetime whose deadline passed before the reply arrived', async () => {
    const clientStart = SERVER_NOW_MS + HOUR_MS
    vi.setSystemTime(clientStart)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        vi.setSystemTime(clientStart + 30_000)
        return new Response(
          JSON.stringify({
            token: jwt({ iat: SERVER_NOW, exp: SERVER_NOW + 30 }),
            expires_at: new Date(SERVER_NOW_MS + 30_000).toISOString()
          }),
          { status: 200 }
        )
      })
    )

    await expect(mintWorkspaceToken('oauth-access', 'ws-1')).resolves.toEqual({
      kind: 'failed',
      status: 200
    })
  })

  it.each<[string, Record<string, unknown>]>([
    ['no iat', { exp: SERVER_NOW + 900 }],
    ['no exp', { iat: SERVER_NOW }],
    ['a non-numeric iat', { iat: 'now', exp: SERVER_NOW + 900 }],
    ['no time claims', {}]
  ])('a token with %s falls back to expires_at', async (_name, claims) => {
    vi.setSystemTime(SERVER_NOW_MS)
    const expiresAt = SERVER_NOW_MS + 120_000
    serverReply(claims, expiresAt)

    await expect(mintWorkspaceToken('oauth-access', 'ws-1')).resolves.toMatchObject({
      kind: 'minted',
      expiresAt
    })

    serverReply(claims, SERVER_NOW_MS - 1)
    await expect(mintWorkspaceToken('oauth-access', 'ws-1')).resolves.toEqual({
      kind: 'failed',
      status: 200
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
