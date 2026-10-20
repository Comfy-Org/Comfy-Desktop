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

  it('reports a token request that outlives its timeout as a timeout', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, init: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError'))
              )
            })
        )
      )
      const refreshed = refresh('r', { tokenUrl: 'https://c/oauth/token' })
      const settled = expect(refreshed).rejects.toMatchObject({
        name: 'SignInFailure',
        reason: 'timeout'
      })

      await vi.advanceTimersByTimeAsync(15_000)

      await settled
    } finally {
      vi.useRealTimers()
    }
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

  it('waits for the browser sign-in as long as the OAuth request lives', async () => {
    stub(200, {})
    vi.mocked(shell.openExternal).mockImplementation(() => new Promise<void>(() => {}))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let settled = false
      const signingIn = signIn(opts).finally(() => {
        settled = true
      })
      signingIn.catch(() => {})
      for (let i = 0; i < 50 && vi.getTimerCount() === 0; i++) {
        await new Promise((resolve) => setImmediate(resolve))
      }

      await vi.advanceTimersByTimeAsync(9 * 60_000)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(60_000)
      await expect(signingIn).rejects.toThrow(/timed out/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails fast when the browser cannot be opened, without waiting for the timeout', async () => {
    stub(200, {})
    vi.mocked(shell.openExternal).mockRejectedValue(new Error('no browser handler'))
    // timeoutMs far beyond the test timeout proves the rejection is immediate.
    await expect(signIn({ ...opts, timeoutMs: 600_000 })).rejects.toMatchObject({
      message: 'no browser handler',
      reason: 'browser_unavailable'
    })
  })

  it.for<{ name: string; respond: () => Promise<Response>; failure: Record<string, unknown> }>([
    {
      name: 'a refused token exchange',
      respond: async () => new Response('down', { status: 503 }),
      failure: { reason: 'server_error', httpStatus: 503 }
    },
    {
      name: 'a token response without an access token',
      respond: async () => Response.json({ expires_in: 3600 }),
      failure: { reason: 'server_error', httpStatus: undefined }
    },
    {
      name: 'a token response that is not JSON',
      respond: async () => new Response('<html>', { status: 200 }),
      failure: { reason: 'server_error', httpStatus: undefined }
    },
    {
      name: 'a null token response',
      respond: async () => Response.json(null),
      failure: { reason: 'server_error', httpStatus: undefined }
    },
    {
      name: 'an unreachable token endpoint',
      respond: async () => {
        throw new TypeError('fetch failed')
      },
      failure: { reason: 'network', httpStatus: undefined }
    }
  ])('reports $name with a reason code', async ({ respond, failure }) => {
    vi.stubGlobal('fetch', vi.fn(respond))
    vi.mocked(shell.openExternal).mockImplementation(async (authorizeUrl: string) => {
      const u = new URL(authorizeUrl)
      get(
        `${u.searchParams.get('redirect_uri')}?code=abc&state=${u.searchParams.get('state')}`,
        (res) => res.resume()
      )
    })
    await expect(signIn({ ...opts, timeoutMs: 5000 })).rejects.toMatchObject({
      name: 'SignInFailure',
      ...failure
    })
  })
})

describe('account OAuth grants', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(shell.openExternal).mockReset()
  })

  function accessToken(workspaceId = 'w2'): string {
    return `e30.${Buffer.from(JSON.stringify({ sub: 'user', workspace_id: workspaceId })).toString('base64url')}.sig`
  }

  it('discovers account support and binds code exchange to the requested workspace', async () => {
    const token = accessToken()
    const fetchMock = vi.fn(async (url: string) =>
      Response.json(
        url.includes('.well-known')
          ? { desktop_account_grants_supported: true }
          : { grant_mode: 'account', access_token: token, refresh_token: 'root', expires_in: 3600 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(shell.openExternal).mockImplementation(async (authorizeUrl: string) => {
      const url = new URL(authorizeUrl)
      expect(url.searchParams.get('grant_mode')).toBe('account')
      expect(url.searchParams.has('workspace_id')).toBe(false)
      get(
        `${url.searchParams.get('redirect_uri')}?code=abc&state=${url.searchParams.get('state')}`,
        (response) => response.resume()
      )
    })
    const result = await signIn({
      authorizeUrl: 'https://c/oauth/authorize',
      tokenUrl: 'https://c/oauth/token',
      clientId: 'comfy-desktop',
      workspaceId: 'w2'
    })
    expect(result.tokens.grantMode).toBe('account')
    expect(
      new URLSearchParams(vi.mocked(fetch).mock.calls[1]?.[1]?.body as string).get('workspace_id')
    ).toBe('w2')
  })

  it.each([{}, { desktop_account_grants_supported: false }])(
    'keeps legacy authorization without server support %j',
    async (metadata) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          Response.json(
            url.includes('.well-known')
              ? metadata
              : { access_token: accessToken(), refresh_token: 'workspace', expires_in: 3600 }
          )
        )
      )
      vi.mocked(shell.openExternal).mockImplementation(async (authorizeUrl: string) => {
        const url = new URL(authorizeUrl)
        expect(url.searchParams.has('grant_mode')).toBe(false)
        get(
          `${url.searchParams.get('redirect_uri')}?code=abc&state=${url.searchParams.get('state')}`,
          (response) => response.resume()
        )
      })
      expect((await signIn()).tokens.grantMode).toBeUndefined()
    }
  )

  it('does not interpret a failed capability request as an unsupported server', async () => {
    stub(503, {})
    await expect(signIn()).rejects.toMatchObject({ reason: 'server_error' })
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it.each([null, [], { desktop_account_grants_supported: 'true' }])(
    'rejects malformed capability metadata %j',
    async (metadata) => {
      stub(200, metadata)
      await expect(signIn()).rejects.toMatchObject({ reason: 'server_error' })
      expect(shell.openExternal).not.toHaveBeenCalled()
    }
  )

  it('rotates the account credential for an explicit workspace', async () => {
    stub(200, {
      grant_mode: 'account',
      access_token: accessToken(),
      refresh_token: 'root-2',
      expires_in: 3600
    })
    const result = await refresh('root-1', { workspaceId: 'w2', grantMode: 'account' })
    expect(result).toMatchObject({ grantMode: 'account', refreshToken: 'root-2' })
    expect(
      new URLSearchParams(vi.mocked(fetch).mock.calls[0]?.[1]?.body as string).get('workspace_id')
    ).toBe('w2')
  })

  it.each([
    { grant_mode: 'workspace', refresh_token: 'root-2' },
    { grant_mode: 'account' },
    { grant_mode: 'account', refresh_token: 'root-2', workspace: 'w3' }
  ])('rejects an account refresh with an invalid authority or target %j', async (response) => {
    stub(200, { ...response, access_token: accessToken(response.workspace), expires_in: 3600 })
    await expect(
      refresh('root', { workspaceId: 'w2', grantMode: 'account' })
    ).rejects.toMatchObject({ reason: 'server_error' })
  })
})
