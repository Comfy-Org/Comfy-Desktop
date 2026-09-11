// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn(async () => {}) } }))

import { get } from 'node:http'
import { shell } from 'electron'
import { refresh, signIn } from './oauth'

function stub(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' }
        })
    )
  )
}

describe('oauth.refresh', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends a form-encoded refresh_token grant with client_id and resource', async () => {
    stub(200, { access_token: 'a2', expires_in: 3600 })
    await refresh('the-refresh', {
      tokenUrl: 'https://c/oauth/token',
      clientId: 'cid',
      resource: 'https://c/api'
    })

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://c/oauth/token')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    )
    const body = new URLSearchParams(init.body as string)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('the-refresh')
    expect(body.get('client_id')).toBe('cid')
    expect(body.get('resource')).toBe('https://c/api')
  })

  it('keeps the prior refresh token when the server omits one', async () => {
    stub(200, { access_token: 'a2', expires_in: 3600 }) // no refresh_token
    const t = await refresh('old-refresh', { tokenUrl: 'https://c/oauth/token' })
    expect(t.accessToken).toBe('a2')
    expect(t.refreshToken).toBe('old-refresh')
    expect(t.expiresAt).toBeGreaterThan(Date.now())
  })

  it('adopts a rotated refresh token when the server returns one', async () => {
    stub(200, { access_token: 'a2', refresh_token: 'new', expires_in: 3600 })
    expect((await refresh('old', { tokenUrl: 'https://c/oauth/token' })).refreshToken).toBe('new')
  })

  it('rejects a response missing access_token', async () => {
    stub(200, { expires_in: 3600 })
    await expect(refresh('r', { tokenUrl: 'https://c/oauth/token' })).rejects.toThrow(
      /access_token/
    )
  })

  it('rejects a response with a non-numeric expires_in', async () => {
    stub(200, { access_token: 'a', expires_in: 'soon' })
    await expect(refresh('r', { tokenUrl: 'https://c/oauth/token' })).rejects.toThrow(/expires_in/)
  })
})

describe('oauth.signIn', () => {
  afterEach(() => vi.unstubAllGlobals())

  const opts = {
    authorizeUrl: 'https://c/oauth/authorize',
    tokenUrl: 'https://c/oauth/token',
    clientId: 'cid',
    scope: 'openid',
    resource: 'https://c/api'
  }

  it('completes the flow when the browser opens and calls back', async () => {
    stub(200, { access_token: 'tok', refresh_token: 'r1', expires_in: 3600 })
    vi.mocked(shell.openExternal).mockImplementation(async (authorizeUrl: string) => {
      const u = new URL(authorizeUrl)
      const redirect = u.searchParams.get('redirect_uri')
      const state = u.searchParams.get('state')
      // Simulate the browser redirect with raw http (global fetch is stubbed).
      get(`${redirect}?code=abc&state=${state}`, (res) => res.resume())
    })
    const { tokens, status } = await signIn({ ...opts, timeoutMs: 5000 })
    expect(tokens.accessToken).toBe('tok')
    expect(tokens.refreshToken).toBe('r1')
    expect(status.signedIn).toBe(true)
  })

  it('rejects on the callback timeout even when openExternal never settles', async () => {
    // A wedged OS shell handler must not strand the sign-in (and with it the
    // single-flight login promise) forever.
    stub(200, {})
    vi.mocked(shell.openExternal).mockImplementation(() => new Promise<void>(() => {}))
    await expect(signIn({ ...opts, timeoutMs: 250 })).rejects.toThrow(/timed out/)
  })

  it('fails fast when the browser cannot be opened, without waiting for the timeout', async () => {
    stub(200, {})
    vi.mocked(shell.openExternal).mockRejectedValue(new Error('no browser handler'))
    // timeoutMs far beyond the test timeout proves the rejection is immediate.
    await expect(signIn({ ...opts, timeoutMs: 600_000 })).rejects.toThrow('no browser handler')
  })
})
