import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('electron', () => ({ net: { fetch: h.fetch } }))

const { requestWebSessionToken, WEB_SESSION_ROUTE } = await import('./client')

function reply(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

beforeEach(() => {
  h.fetch.mockReset()
})

describe('requestWebSessionToken', () => {
  it('sends the Desktop grant as a bearer token and returns the custom token', async () => {
    h.fetch.mockResolvedValue(reply(200, { custom_token: 'custom-token' }))

    await expect(
      requestWebSessionToken('grant-token', { apiBase: 'https://cloud.example/api/' })
    ).resolves.toEqual({ kind: 'minted', customToken: 'custom-token' })

    const [url, init] = h.fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://cloud.example/api${WEB_SESSION_ROUTE}`)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('omit')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer grant-token' })
  })

  it.each([
    ['an empty token', reply(200, { custom_token: '' }), { kind: 'declined', status: 200 }],
    [
      'a body that is not JSON',
      new Response('nope', { status: 200 }),
      { kind: 'declined', status: 200 }
    ],
    [
      'an endpoint that does not exist yet',
      reply(404, undefined),
      { kind: 'declined', status: 404 }
    ],
    [
      'a switched-off endpoint',
      reply(503, { code: 'DESKTOP_WEB_SESSION_DISABLED' }),
      { kind: 'declined', status: 503, code: 'desktop_web_session_disabled' }
    ],
    [
      'a grant without the scope',
      reply(403, { code: 'insufficient_scope' }),
      { kind: 'declined', status: 403, code: 'insufficient_scope' }
    ]
  ])('declines on %s', async (_name, response, expected) => {
    h.fetch.mockResolvedValue(response)

    await expect(requestWebSessionToken('grant-token')).resolves.toEqual(expected)
  })

  it('declines when Cloud cannot be reached', async () => {
    h.fetch.mockRejectedValue(new TypeError('network down'))

    await expect(requestWebSessionToken('grant-token')).resolves.toEqual({
      kind: 'declined',
      status: null
    })
  })
})
