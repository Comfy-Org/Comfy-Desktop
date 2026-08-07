// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

// The token request goes through Chromium's net.fetch; delegate to the current
// global fetch so the vi.stubGlobal('fetch', ...) stubs below keep driving it.
// The spy is what proves the request took the proxy-aware route.
const netFetch = vi.hoisted(() =>
  vi.fn((...args: Parameters<typeof fetch>) => globalThis.fetch(...args))
)
vi.mock('electron', () => ({
  shell: { openExternal: vi.fn(async () => {}) },
  net: { fetch: netFetch }
}))

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
  afterEach(() => {
    vi.unstubAllGlobals()
    netFetch.mockClear()
  })

  // Bare fetch ignores the system proxy, which is exactly what an enterprise
  // user behind one has.
  it('requests the token through the proxy-aware net.fetch, cookie-free', async () => {
    stub(200, { access_token: 'a', expires_in: 3600 })
    await refresh('r', { tokenUrl: 'https://c/oauth/token' })
    expect(netFetch).toHaveBeenCalledTimes(1)
    expect(netFetch.mock.calls[0]![1]).toMatchObject({ credentials: 'omit' })
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
