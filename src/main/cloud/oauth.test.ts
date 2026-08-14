// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn(async () => {}) } }))

import { refresh } from './oauth'

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
