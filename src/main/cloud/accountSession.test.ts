import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), open: vi.fn() }))
vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0' },
  net: { fetch: mocks.fetch },
  shell: { openExternal: mocks.open }
}))

import { mintWorkspaceToken, signInAccount } from './accountSession'

const ROOT = 'comfy-session-secret'
const CODE = `dls_${'a'.repeat(43)}`
const EXPIRES = '2030-01-01T00:00:00.000Z'

function respond(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.fetch.mockReset()
  mocks.open.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('native account login', () => {
  it('hands off a proof-bound code and keeps the account credential out of the browser URL', async () => {
    mocks.fetch
      .mockResolvedValueOnce(respond({ code: CODE, expires_in: 300, poll_interval: 1 }, 201))
      .mockResolvedValueOnce(respond({ status: 'pending' }))
      .mockResolvedValueOnce(respond({ status: 'complete', session_token: ROOT }))
      .mockResolvedValueOnce(respond({ token: 'workspace-token', expires_at: EXPIRES }))
    const onUrl = vi.fn()
    const login = signInAccount(onUrl, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(2000)
    await expect(login).resolves.toEqual({
      accessToken: 'workspace-token',
      sessionToken: ROOT,
      expiresAt: Date.parse(EXPIRES)
    })
    const url = new URL(onUrl.mock.calls[0]![0])
    expect(url.searchParams.get('desktop_login_code')).toBe(CODE)
    expect(url.href).not.toContain(ROOT)
    const createBody = JSON.parse(mocks.fetch.mock.calls[0]![1].body)
    expect(createBody).toMatchObject({ session_type: 'account' })
    const exchangeBody = JSON.parse(mocks.fetch.mock.calls[1]![1].body)
    expect(exchangeBody.code_verifier).not.toBe(createBody.code_challenge)
    expect(exchangeBody.code).toBe(CODE)
    expect(mocks.fetch.mock.calls[3]![1]).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      headers: { Authorization: `Bearer ${ROOT}` },
      body: '{}'
    })
  })

  it('refuses an older server before opening a Firebase-only handoff', async () => {
    mocks.fetch.mockResolvedValue(
      respond({ code: 'dlc_old', expires_in: 300, poll_interval: 1 }, 201)
    )
    await expect(signInAccount(vi.fn(), new AbortController().signal)).rejects.toMatchObject({
      reason: 'server_error'
    })
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('cancels even when the system browser never reports that it opened', async () => {
    mocks.fetch.mockResolvedValue(respond({ code: CODE, expires_in: 300, poll_interval: 1 }, 201))
    mocks.open.mockReturnValue(new Promise(() => {}))
    const abort = new AbortController()
    const login = signInAccount(vi.fn(), abort.signal)
    const result = expect(login).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    abort.abort()
    await result
  })

  it('reports expiry while awaiting the browser without changing caller cancellation', async () => {
    const expiry = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(expiry.signal)
    mocks.fetch.mockResolvedValue(respond({ code: CODE, expires_in: 300, poll_interval: 1 }, 201))
    mocks.open.mockReturnValue(new Promise(() => {}))
    const result = expect(
      signInAccount(vi.fn(), new AbortController().signal)
    ).rejects.toMatchObject({ reason: 'timeout' })
    await vi.advanceTimersByTimeAsync(0)
    expiry.abort(new DOMException('expired', 'TimeoutError'))
    await result
  })

  it('revokes a handed-off session if the first workspace request fails', async () => {
    mocks.fetch
      .mockResolvedValueOnce(respond({ code: CODE, expires_in: 300, poll_interval: 1 }, 201))
      .mockResolvedValueOnce(respond({ status: 'complete', session_token: ROOT }))
      .mockResolvedValueOnce(respond({ code: 'FORBIDDEN' }, 403))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(respond({ success: true }))
    const result = expect(
      signInAccount(vi.fn(), new AbortController().signal)
    ).rejects.toMatchObject({ httpStatus: 403 })
    await vi.advanceTimersByTimeAsync(1000)
    await result
    expect(mocks.fetch.mock.calls[3]![0]).toMatch(/\/auth\/token\/revoke$/)
    expect(mocks.fetch.mock.calls[4]![0]).toMatch(/\/auth\/session$/)
    expect(mocks.fetch.mock.calls[4]![1]).toMatchObject({
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ROOT}` }
    })
  })
})

describe('workspace mint', () => {
  it('asks the backend for the selected workspace using the account credential', async () => {
    mocks.fetch.mockResolvedValue(respond({ token: 'scoped-token', expires_at: EXPIRES }))
    await expect(mintWorkspaceToken(ROOT, 'w-team')).resolves.toMatchObject({
      accessToken: 'scoped-token',
      sessionToken: ROOT
    })
    expect(mocks.fetch.mock.calls[0]![1]).toMatchObject({
      body: JSON.stringify({ workspace_id: 'w-team' }),
      credentials: 'omit'
    })
  })

  it.each([{}, { token: 'token', expires_at: 'invalid' }])(
    'rejects an invalid workspace token response',
    async (body) => {
      mocks.fetch.mockResolvedValue(respond(body))
      await expect(mintWorkspaceToken(ROOT)).rejects.toMatchObject({ reason: 'server_error' })
    }
  )
})
